import asyncio
import os
import shutil
import tempfile
from pathlib import Path

from flowforge.core.base_tool import BaseTool, ToolInput, ToolOutput
from flowforge.core.tracing import get_logger

logger = get_logger("video_generate")


class VideoGenerateTool(BaseTool):
    name = "video_generate"
    description = "Generate video from text script using TTS and FFmpeg"
    safety_level = "dangerous"
    is_concurrency_safe = False
    parameters_schema = {
        "type": "object",
        "required": ["script", "output_path"],
        "properties": {
            "script": {
                "type": "string",
                "description": "Text script for TTS narration",
            },
            "output_path": {
                "type": "string",
                "description": "Output video file path (e.g. output/video.mp4)",
            },
            "voice": {
                "type": "string",
                "default": "zh-CN-YunxiNeural",
                "description": "edge-tts voice name",
            },
            "bg_image": {
                "type": "string",
                "default": "",
                "description": "Optional background image path",
            },
        },
    }

    async def execute(self, input: ToolInput) -> ToolOutput:
        script: str = input.params["script"]
        output_path: str = input.params["output_path"]
        voice: str = input.params.get("voice", "zh-CN-YunxiNeural")
        bg_image: str = input.params.get("bg_image", "")

        # Validate required params
        if not script.strip():
            return ToolOutput(result={}, error="Script cannot be empty")
        if not output_path.strip():
            return ToolOutput(result={}, error="Output path cannot be empty")

        # Check dependencies availability
        edge_tts_available = shutil.which("edge-tts") is not None
        ffmpeg_available = shutil.which("ffmpeg") is not None

        if not edge_tts_available or not ffmpeg_available:
            missing = []
            if not edge_tts_available:
                missing.append("edge-tts")
            if not ffmpeg_available:
                missing.append("ffmpeg")
            msg = (
                f"Missing dependencies: {', '.join(missing)}. "
                f"Install them to enable video generation: "
                f"pip install edge-tts && apt-get install ffmpeg"
            )
            logger.warning(msg)
            return ToolOutput(result={}, error=msg)

        # Ensure output directory exists
        try:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return ToolOutput(result={}, error=f"Cannot create output directory: {e}")

        # Run TTS + FFmpeg pipeline
        try:
            result = await self._generate_video(script, output_path, voice, bg_image)
            return result
        except Exception as e:
            logger.error(f"Video generation failed: {e}")
            return ToolOutput(result={}, error=f"Video generation failed: {e}")

    async def _generate_video(
        self, script: str, output_path: str, voice: str, bg_image: str
    ) -> ToolOutput:
        """Execute the real TTS + FFmpeg pipeline."""
        with tempfile.TemporaryDirectory(prefix="video_gen_") as tmp_dir:
            audio_path = os.path.join(tmp_dir, "narration.mp3")

            # Step 1: TTS — generate audio from script
            logger.info(f"Running edge-tts: voice={voice}, script_len={len(script)}")
            tts_cmd = [
                "edge-tts",
                "--voice", voice,
                "--text", script,
                "--write-media", audio_path,
            ]
            process = await asyncio.create_subprocess_exec(
                *tts_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=120)
            if process.returncode != 0:
                err_msg = stderr.decode(errors="replace").strip() or "edge-tts failed with unknown error"
                logger.error(f"edge-tts failed (rc={process.returncode}): {err_msg}")
                return ToolOutput(result={}, error=f"edge-tts failed: {err_msg}")

            if not os.path.exists(audio_path) or os.path.getsize(audio_path) == 0:
                return ToolOutput(result={}, error="edge-tts produced no audio output")

            # Step 2: Get audio duration
            duration = await self._get_audio_duration(audio_path)
            logger.info(f"TTS audio generated: duration={duration:.1f}s")

            # Step 3: FFmpeg — combine audio with background image or black screen
            ffmpeg_cmd = self._build_ffmpeg_cmd(audio_path, output_path, bg_image, tmp_dir)
            logger.info(f"Running ffmpeg: {' '.join(ffmpeg_cmd)}")
            process = await asyncio.create_subprocess_exec(
                *ffmpeg_cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=300)
            if process.returncode != 0:
                err_msg = stderr.decode(errors="replace").strip() or "ffmpeg failed with unknown error"
                logger.error(f"ffmpeg failed (rc={process.returncode}): {err_msg}")
                return ToolOutput(result={}, error=f"ffmpeg failed: {err_msg}")

            if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
                return ToolOutput(result={}, error="ffmpeg produced no video output")

            file_size = os.path.getsize(output_path)
            logger.info(
                f"Video generated successfully: {output_path} "
                f"({duration:.1f}s, {file_size} bytes)"
            )

            return ToolOutput(
                result={
                    "video_path": output_path,
                    "duration_seconds": round(duration, 1),
                    "file_size_bytes": file_size,
                    "voice": voice,
                }
            )

    async def _get_audio_duration(self, audio_path: str) -> float:
        """Get audio duration in seconds using ffprobe."""
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            audio_path,
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, _ = await asyncio.wait_for(process.communicate(), timeout=10)
            if process.returncode == 0:
                import json
                data = json.loads(stdout.decode())
                return float(data.get("format", {}).get("duration", 0))
        except Exception as e:
            logger.warning(f"ffprobe failed, using 0 duration: {e}")
        return 0.0

    def _build_ffmpeg_cmd(
        self, audio_path: str, output_path: str, bg_image: str, tmp_dir: str
    ) -> list[str]:
        """Build the FFmpeg command based on whether a background image is provided."""
        if bg_image and os.path.exists(bg_image):
            # Use background image with audio
            return [
                "ffmpeg", "-y",
                "-loop", "1",
                "-i", bg_image,
                "-i", audio_path,
                "-c:v", "libx264",
                "-tune", "stillimage",
                "-c:a", "aac",
                "-b:a", "192k",
                "-pix_fmt", "yuv420p",
                "-shortest",
                output_path,
            ]
        else:
            # Generate black background video with audio
            return [
                "ffmpeg", "-y",
                "-f", "lavfi",
                "-i", "color=c=black:s=1280x720:d=0.1",
                "-i", audio_path,
                "-c:v", "libx264",
                "-c:a", "aac",
                "-b:a", "192k",
                "-pix_fmt", "yuv420p",
                "-shortest",
                output_path,
            ]

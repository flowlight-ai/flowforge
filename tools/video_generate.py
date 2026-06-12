import os
import shutil
from pathlib import Path
from typing import Any, Dict

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
            msg = f"Missing dependencies: {', '.join(missing)}. Install them to enable video generation."
            logger.warning(msg)
            return ToolOutput(result={}, error=msg)

        # Ensure output directory exists
        try:
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            return ToolOutput(result={}, error=f"Cannot create output directory: {e}")

        # Phase 2 STUB: validate params and return placeholder
        # Actual TTS + FFmpeg pipeline will be implemented in Phase 2
        logger.info(
            f"Video generation stub: script={len(script)} chars, "
            f"output={output_path}, voice={voice}, bg_image={bg_image}"
        )

        return ToolOutput(
            result={
                "video_path": output_path,
                "duration_seconds": 0,
                "message": "Video generation is a stub — actual implementation pending Phase 2",
            }
        )

"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface VoiceInputProps {
  /** 转写文本回调 */
  onTranscript: (text: string) => void;
  /** 是否启用 */
  isEnabled: boolean;
  /** 语言 */
  language: string;
}

const SUPPORTED_LANGUAGES = [
  { code: "zh-CN", label: "中文（简体）" },
  { code: "zh-TW", label: "中文（繁体）" },
  { code: "en-US", label: "English" },
  { code: "ja-JP", label: "日本語" },
  { code: "ko-KR", label: "한국어" },
  { code: "de-DE", label: "Deutsch" },
  { code: "fr-FR", label: "Français" },
];

/** 语音输入组件 — 基于 Web Speech API 实现语音转文字 */
export default function VoiceInput({ onTranscript, isEnabled, language }: VoiceInputProps) {
  const [isListening, setIsListening] = useState(false);
  const [interimText, setInterimText] = useState("");
  const [finalText, setFinalText] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState(language);
  const [error, setError] = useState<string | null>(null);
  const [pulsePhase, setPulsePhase] = useState(0);
  const recognitionRef = useRef<any>(null);
  const pulseRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check browser support
  const SpeechRecognition = typeof window !== "undefined"
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;
  const isSupported = !!SpeechRecognition;

  // Pulse animation while listening
  useEffect(() => {
    if (isListening) {
      pulseRef.current = setInterval(() => {
        setPulsePhase((prev) => (prev + 1) % 360);
      }, 50);
    } else {
      if (pulseRef.current) clearInterval(pulseRef.current);
      setPulsePhase(0);
    }
    return () => {
      if (pulseRef.current) clearInterval(pulseRef.current);
    };
  }, [isListening]);

  const startListening = useCallback(() => {
    if (!SpeechRecognition || !isEnabled) return;
    setError(null);
    setInterimText("");
    setFinalText("");

    const recognition = new SpeechRecognition();
    recognition.lang = selectedLanguage;
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      if (final) {
        setFinalText((prev) => prev + final);
        onTranscript(final);
      }
      if (interim) {
        setInterimText(interim);
      }
    };

    recognition.onerror = (event: any) => {
      setError(event.error === "not-allowed" ? "麦克风权限被拒绝" : `识别错误: ${event.error}`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimText("");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [SpeechRecognition, isEnabled, selectedLanguage, onTranscript]);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
    };
  }, []);

  if (!isSupported) {
    return (
      <div className="flex items-center gap-2 px-2 py-1 text-xs text-gray-600">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
          <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2c0 .76-.13 1.49-.36 2.18" />
          <line x1="12" y1="19" x2="12" y2="23" />
          <line x1="8" y1="23" x2="16" y2="23" />
        </svg>
        <span>浏览器不支持语音识别</span>
      </div>
    );
  }

  if (!isEnabled) {
    return null;
  }

  // Pulse animation scale
  const pulseScale = isListening ? 1 + Math.sin(pulsePhase * Math.PI / 180) * 0.15 : 1;
  const pulseOpacity = isListening ? 0.3 + Math.sin(pulsePhase * Math.PI / 180) * 0.2 : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Push-to-talk button */}
        <div className="relative">
          {/* Pulse ring */}
          {isListening && (
            <div
              className="absolute inset-0 rounded-full bg-red-500"
              style={{
                transform: `scale(${pulseScale + 0.3})`,
                opacity: pulseOpacity,
                transition: "transform 0.05s ease-out",
              }}
            />
          )}
          <button
            onClick={toggleListening}
            className={`relative w-9 h-9 rounded-full flex items-center justify-center transition-all ${
              isListening
                ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                : "bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700"
            }`}
            title={isListening ? "停止录音" : "开始录音"}
          >
            {isListening ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            )}
          </button>
        </div>

        {/* Language selector */}
        <select
          value={selectedLanguage}
          onChange={(e) => setSelectedLanguage(e.target.value)}
          disabled={isListening}
          className="bg-gray-900 border border-gray-700 rounded-lg px-2 py-1 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
        >
          {SUPPORTED_LANGUAGES.map((lang) => (
            <option key={lang.code} value={lang.code}>{lang.label}</option>
          ))}
        </select>

        {/* Status */}
        {isListening && (
          <span className="text-[11px] text-red-400 font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" style={{ animation: "pulse 1s ease-in-out infinite" }} />
            录音中
          </span>
        )}
      </div>

      {/* Real-time transcription */}
      {(finalText || interimText) && (
        <div className="bg-gray-900/50 border border-gray-800 rounded-lg px-3 py-2 text-sm">
          <span className="text-gray-300">{finalText}</span>
          {interimText && (
            <span className="text-gray-500 italic">{interimText}</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="text-[11px] text-red-400 flex items-center gap-1">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}

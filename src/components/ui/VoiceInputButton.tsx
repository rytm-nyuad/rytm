"use client";

import { useRef, useEffect, useCallback } from "react";
import { Mic, MicOff } from "lucide-react";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface VoiceInputButtonProps {
  onTranscript: (fullText: string) => void;
  currentValue?: string;
  className?: string;
  size?: "sm" | "md";
  disabled?: boolean;
}

export function VoiceInputButton({
  onTranscript,
  currentValue = "",
  className = "",
  size = "md",
  disabled = false,
}: VoiceInputButtonProps) {
  const {
    isSupported,
    isListening,
    transcript,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechRecognition();

  const preVoiceTextRef = useRef("");
  const onTranscriptRef = useRef(onTranscript);
  const activeSessionRef = useRef(false);
  onTranscriptRef.current = onTranscript;

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
      activeSessionRef.current = false;
    } else {
      preVoiceTextRef.current = currentValue;
      activeSessionRef.current = true;
      resetTranscript();
      startListening();
    }
  }, [isListening, currentValue, stopListening, resetTranscript, startListening]);

  // Only push transcript updates while actively recording
  useEffect(() => {
    if (!activeSessionRef.current) return;
    if (!transcript) return;

    const prev = preVoiceTextRef.current;
    const combined = prev ? `${prev} ${transcript}` : transcript;
    onTranscriptRef.current(combined);
  }, [transcript]);

  // When listening stops naturally (silence timeout), end the session
  useEffect(() => {
    if (!isListening) {
      activeSessionRef.current = false;
    }
  }, [isListening]);

  if (!isSupported) return null;

  const sizeClasses =
    size === "sm" ? "p-1.5" : "p-2";
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";

  return (
    <button
      type="button"
      onClick={handleToggle}
      disabled={disabled}
      aria-label={isListening ? "Stop voice input" : "Start voice input"}
      className={`
        ${sizeClasses}
        rounded-lg transition-all flex-shrink-0
        disabled:opacity-50 disabled:cursor-not-allowed
        ${
          isListening
            ? "bg-red-500/20 text-red-400 ring-2 ring-red-500 animate-pulse"
            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
        }
        ${className}
      `}
    >
      {isListening ? (
        <MicOff className={iconSize} />
      ) : (
        <Mic className={iconSize} />
      )}
    </button>
  );
}

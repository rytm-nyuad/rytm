"use client";

import { useState } from "react";
import { ArrowUp, MessageSquare } from "lucide-react";
import { VoiceInputButton } from "@/components/ui/VoiceInputButton";

interface CoachPromptBarProps {
  onSendMessage: (message: string) => void;
  onOpenChats: () => void;
}

export function CoachPromptBar({ onSendMessage, onOpenChats }: CoachPromptBarProps) {
  const [input, setInput] = useState("");

  const handleSubmit = () => {
    const message = input.trim();
    if (message) {
      onSendMessage(message);
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-2 sm:px-4">
      <div
        className="
          w-full
          px-3 sm:px-4 py-2 sm:py-3
          rounded-full
          dark:bg-gradient-to-r dark:from-zinc-800/90 dark:via-zinc-800/95 dark:to-zinc-800/90
          light:bg-white
          dark:border dark:border-zinc-700/50
          light:border light:border-gray-200
          transition-all duration-300
          dark:shadow-2xl dark:shadow-black/40
          light:shadow-md
          backdrop-blur-sm
          flex items-center gap-3
        "
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to work on today?"
          className="
            flex-1
            bg-transparent
            dark:text-white light:text-slate-900
            dark:placeholder-zinc-400 light:placeholder-slate-400
            focus:outline-none
            text-xs sm:text-sm
            px-1 sm:px-2
          "
        />
        <VoiceInputButton
          onTranscript={(t) => setInput(t)}
          currentValue={input}
          className="rounded-full flex-shrink-0"
        />
        <button
          onClick={onOpenChats}
          className="
            p-2 rounded-full
            dark:bg-zinc-700/50 light:bg-gray-100
            dark:text-white light:text-blue-600
            dark:hover:bg-zinc-600/50 light:hover:bg-gray-200
            transition-all
            flex-shrink-0
          "
          title="View previous sessions"
        >
          <MessageSquare className="w-4 h-4" />
        </button>
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="
            p-2 rounded-full
            dark:bg-white light:bg-blue-600
            dark:text-black light:text-white
            dark:hover:bg-zinc-100 light:hover:bg-blue-700
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-all
            flex-shrink-0
          "
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

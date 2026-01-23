"use client";

import { useState } from "react";
import { ArrowUp } from "lucide-react";

interface CoachPromptBarProps {
  onSendMessage: (message: string) => void;
}

export function CoachPromptBar({ onSendMessage }: CoachPromptBarProps) {
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
    <div className="w-full max-w-3xl mx-auto px-6">
      <div
        className="
          w-full
          px-4 py-3
          rounded-full
          dark:bg-gradient-to-r dark:from-zinc-800/90 dark:via-zinc-800/95 dark:to-zinc-800/90
          light:bg-gradient-to-r light:from-cyan-400/60 light:via-cyan-400/70 light:to-cyan-400/60
          dark:border dark:border-zinc-700/50
          light:border light:border-cyan-300/60
          transition-all duration-300
          dark:shadow-2xl dark:shadow-black/40
          light:shadow-2xl light:shadow-cyan-900/40
          backdrop-blur-sm
          flex items-center gap-3
        "
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Talk to your coach about today..."
          className="
            flex-1
            bg-transparent
            dark:text-white light:text-white
            dark:placeholder-zinc-400 light:placeholder-white/70
            focus:outline-none
            text-sm
            px-2
          "
        />
        <button
          onClick={handleSubmit}
          disabled={!input.trim()}
          className="
            p-2 rounded-full
            bg-white
            dark:text-black light:text-cyan-600
            hover:bg-zinc-100
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

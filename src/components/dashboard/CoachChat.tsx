"use client";

import { useState } from "react";
import { Send, Play } from "lucide-react";
import type { ChatMessage } from "@/types/dashboard";

interface CoachChatProps {
  className?: string;
}

export function CoachChat({ className = "" }: CoachChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sessionActive, setSessionActive] = useState(false);

  const startSession = () => {
    setSessionActive(true);
    
    // TODO: Call function to refresh user context from Supabase
    const systemMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "system",
      content: "I've refreshed your day's context. Ask me anything.",
      timestamp: new Date(),
    };
    
    setMessages([systemMessage]);
  };

  const handleSend = () => {
    if (!input.trim()) return;

    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages([...messages, newMessage]);
    setInput("");

    // TODO: Send to LLM and get response
    // For now, just echo back
    setTimeout(() => {
      const response: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: "I'm here to help. (Assistant responses will be connected soon)",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, response]);
    }, 500);
  };

  return (
    <div className={`h-full bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="font-semibold text-white text-sm">Assistant Coach</h3>
      </div>

      {/* Content */}
      {!sessionActive ? (
        <div className="flex-1 flex items-center justify-center p-4">
          <button
            onClick={startSession}
            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors text-sm font-medium"
          >
            <Play className="w-4 h-4" />
            Start Coach Session
          </button>
        </div>
      ) : (
        <>
          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[120px]">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`rounded-lg p-3 text-sm ${
                  msg.role === "user"
                    ? "bg-zinc-800 text-white"
                    : "bg-zinc-700/50 text-zinc-300"
                }`}
              >
                {msg.content}
              </div>
            ))}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-zinc-800">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="Ask me..."
                className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600 text-sm"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-3 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

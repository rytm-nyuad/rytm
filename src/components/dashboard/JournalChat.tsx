"use client";

import { useState, useEffect } from "react";
import { Send, Plus } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import type { ChatMessage } from "@/types/dashboard";

interface JournalChatProps {
  className?: string;
  onMessageSent?: () => void;
}

export function JournalChat({ className = "", onMessageSent }: JournalChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"unstructured" | "structured">("unstructured");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Get user ID on mount
  useEffect(() => {
    const getUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setUserId(session.user.id);
      }
    };
    getUser();
  }, []);

  const handleModeChange = (newMode: "unstructured" | "structured") => {
    setMode(newMode);
    // Clear messages when switching modes
    setMessages([]);
    setInput("");
  };

  const handleNewEntry = async () => {
    // Clear local messages
    setMessages([]);
    setInput("");
    
    // For guided mode, create a new thread
    if (mode === "structured" && userId) {
      try {
        await fetch("/api/journal/new-thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error creating new thread:", error);
      }
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !userId || loading) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");

    // FREE MODE: Save directly to database, no API call
    if (mode === "unstructured") {
      await supabase.from("journal_messages").insert({
        user_id: userId,
        thread_id: null,
        mode: "free",
        role: "user",
        content: userMessage.content,
      });

      if (onMessageSent) {
        onMessageSent();
      }
      return;
    }

    // GUIDED MODE: Call API for AI response
    setLoading(true);

    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: userMessage.content,
          mode: "guided",
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Failed to get AI response:", data.error);
        return;
      }

      // Add AI response to chat (only for guided mode)
      if (data.response && mode === "structured") {
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      }

      // Notify parent that a message was sent (for progress tracking)
      if (onMessageSent) {
        onMessageSent();
      }
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`h-full bg-zinc-900 border border-zinc-800 rounded-xl flex flex-col ${className}`}>
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="font-semibold text-white">Journal</h3>
        <div className="flex gap-3 items-center">
          {/* New Entry Button */}
          <button
            onClick={handleNewEntry}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors border border-zinc-700"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Entry</span>
          </button>
          
          {/* Toggle Switch for Free/Guided */}
          <div className="flex bg-zinc-800 rounded-full p-0.5 border border-zinc-700">
            <button
              onClick={() => handleModeChange("unstructured")}
              className={`px-3 py-1 text-xs rounded-full transition-all ${
                mode === "unstructured"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Free
            </button>
            <button
              onClick={() => handleModeChange("structured")}
              className={`px-3 py-1 text-xs rounded-full transition-all ${
                mode === "structured"
                  ? "bg-white text-black"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              Guided
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3 min-h-[120px]">
        {messages.length === 0 ? (
          <div className="text-center text-zinc-500 text-sm pt-8">
            {mode === "unstructured"
              ? "What's been on your mind..."
              : "Feeling stuck? Use our structured journaling to clear your mind."}
          </div>
        ) : (
          messages.map((msg) => (
            <div 
              key={msg.id} 
              className={`rounded-lg p-3 ${
                msg.role === "user" 
                  ? "bg-zinc-800 ml-8" 
                  : "bg-purple-600/20 border border-purple-600/30 mr-8"
              }`}
            >
              <p className="text-white text-sm">{msg.content}</p>
              <p className="text-xs text-zinc-500 mt-1">
                {msg.timestamp.toLocaleTimeString()}
              </p>
            </div>
          ))
        )}
        {loading && (
          <div className="bg-purple-600/20 border border-purple-600/30 rounded-lg p-3 mr-8">
            <p className="text-white text-sm">Thinking...</p>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex gap-2">
          <input
            id="journal-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Write here..."
            className="flex-1 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600 text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="px-4 py-2 bg-white text-black rounded-lg hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

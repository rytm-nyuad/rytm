"use client";

import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, Target, CheckCircle } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface GoalInterviewModalProps {
  onClose: () => void;
  onGoalCreated: () => void;
}

export function GoalInterviewModal({ onClose, onGoalCreated }: GoalInterviewModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);
  const [framingGoal, setFramingGoal] = useState(false);
  const [goalCreated, setGoalCreated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startInterview();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startInterview = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/coach/goal-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      });
      const data = await res.json();
      if (data.question) {
        setMessages([{ role: "assistant", content: data.question }]);
      }
    } catch (err) {
      console.error("Failed to start interview:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!trimmed || loading || finished) return;

    const userMessage: Message = { role: "user", content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/coach/goal-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "answer",
          answer: trimmed,
          history: messages,
        }),
      });
      const data = await res.json();

      if (data.finished) {
        setFinished(true);
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Great! I have everything I need. Let me create your personalized goal plan..." },
        ]);
        await frameGoal();
      } else if (data.question) {
        setMessages((prev) => [...prev, { role: "assistant", content: data.question }]);
      }
    } catch (err) {
      console.error("Interview error:", err);
    } finally {
      setLoading(false);
    }
  };

  const frameGoal = async () => {
    setFramingGoal(true);
    try {
      const res = await fetch("/api/coach/goal-framing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.success) {
        setGoalCreated(true);
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Your goal has been created: **${data.goal?.title || "Wellness goal"}**. You're all set — let's generate your first morning plan!`,
          },
        ]);
        setTimeout(() => {
          onGoalCreated();
        }, 2000);
      }
    } catch (err) {
      console.error("Goal framing error:", err);
    } finally {
      setFramingGoal(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg dark:bg-zinc-900 bg-white rounded-2xl shadow-2xl border dark:border-zinc-800 border-zinc-200 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b dark:border-zinc-800 border-zinc-200">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Target className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold dark:text-white text-zinc-900">Set Your Goal</h2>
              <p className="text-xs dark:text-zinc-500 text-zinc-400">6 quick questions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors"
          >
            <X className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`rounded-xl px-4 py-2.5 max-w-[85%] text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "dark:bg-white/90 bg-violet-600 dark:text-black text-white font-medium"
                    : "dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-800"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {(loading || framingGoal) && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 dark:bg-zinc-800 bg-zinc-100">
                <Loader2 className="w-4 h-4 animate-spin dark:text-zinc-400 text-zinc-500" />
              </div>
            </div>
          )}
          {goalCreated && (
            <div className="flex justify-center">
              <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 text-sm font-medium">
                <CheckCircle className="w-4 h-4" />
                Goal created! Redirecting...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {!finished && (
          <div className="p-4 border-t dark:border-zinc-800 border-zinc-200">
            <div className="flex gap-2 dark:bg-zinc-800 bg-zinc-100 rounded-xl p-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Type your answer..."
                disabled={loading}
                className="flex-1 px-2 py-1.5 bg-transparent dark:text-white text-zinc-900 dark:placeholder-zinc-500 placeholder-zinc-400 focus:outline-none text-sm"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

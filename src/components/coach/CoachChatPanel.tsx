"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Send, Plus, MessageSquare, Trash2, Calendar, Heart, Zap, TrendingUp, Loader2 } from "lucide-react";
import {
  getCoachConversations,
  getCoachMessages,
  deleteCoachConversation,
  type CoachConversation,
  type CoachMessage,
} from "@/lib/db/coach";

interface CoachChatPanelProps {
  userId: string;
  firstName: string;
}

const EXAMPLE_PROMPTS = [
  { text: "Help me plan today", icon: Calendar, description: "Get organized and set priorities" },
  { text: "I'm feeling off", icon: Heart, description: "Let's talk through what's on your mind" },
  { text: "Push me right now", icon: Zap, description: "Get motivated and take action" },
  { text: "Build better habits", icon: TrendingUp, description: "Create lasting positive changes" },
];

export function CoachChatPanel({ userId, firstName }: CoachChatPanelProps) {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const loadConversations = useCallback(async () => {
    const convos = await getCoachConversations(userId);
    setConversations(convos);
  }, [userId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    const msgs = await getCoachMessages(conversationId);
    setMessages(msgs);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    }
  }, [currentConversationId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = async () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const handleSend = useCallback(async (content?: string) => {
    const messageContent = content || input.trim();
    if (!messageContent || loading) return;

    setInput("");
    setLoading(true);

    // Optimistically add the user message to UI
    const optimisticUserMsg: CoachMessage = {
      id: `temp-${Date.now()}`,
      thread_id: currentConversationId || "",
      role: "user",
      content: messageContent,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMsg]);

    try {
      const res = await fetch("/api/coach/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: messageContent,
          threadId: currentConversationId,
        }),
      });

      if (!res.ok) throw new Error("Failed to get response");

      const data = await res.json();

      // Update thread ID if new conversation was created
      if (!currentConversationId && data.threadId) {
        setCurrentConversationId(data.threadId);
        await loadConversations();
      }

      // Reload messages from DB (includes real IDs and assistant response)
      await loadMessages(data.threadId);
    } catch (err) {
      console.error("Chat error:", err);
      // Remove the optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUserMsg.id));
    } finally {
      setLoading(false);
    }
  }, [input, currentConversationId, loading, loadConversations, loadMessages]);

  const handleDeleteConversation = async (id: string) => {
    await deleteCoachConversation(id);
    if (currentConversationId === id) {
      setCurrentConversationId(null);
      setMessages([]);
    }
    await loadConversations();
  };

  const showEmptyState = !currentConversationId || messages.length === 0;

  return (
    <div className="flex rounded-2xl overflow-hidden dark:bg-zinc-900 bg-white border dark:border-zinc-800 border-zinc-200" style={{ height: "600px" }}>
      {/* Sidebar */}
      <div className="hidden md:flex md:w-56 flex-col dark:bg-zinc-950/50 bg-zinc-50 border-r dark:border-zinc-800 border-zinc-200">
        <div className="p-3 border-b dark:border-zinc-800 border-zinc-200">
          <button
            onClick={handleNewChat}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg dark:bg-zinc-900 bg-white dark:hover:bg-zinc-800 hover:bg-zinc-100 transition-colors text-sm font-medium dark:text-zinc-300 text-zinc-700 border dark:border-zinc-800 border-zinc-200"
          >
            <Plus className="w-4 h-4" />
            New Session
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <p className="text-xs font-semibold dark:text-zinc-600 text-zinc-400 uppercase tracking-wider px-2 py-2">
            Sessions
          </p>
          {conversations.length === 0 && (
            <p className="text-xs dark:text-zinc-600 text-zinc-400 px-2 py-1">No sessions yet</p>
          )}
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setCurrentConversationId(conv.id)}
              className={`group flex items-center gap-2 px-2 py-2 rounded-lg mb-0.5 cursor-pointer transition-colors ${
                currentConversationId === conv.id
                  ? "dark:bg-zinc-800 bg-zinc-200"
                  : "dark:hover:bg-zinc-900 hover:bg-zinc-100"
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5 dark:text-zinc-500 text-zinc-400 flex-shrink-0" />
              <span className="text-xs dark:text-zinc-300 text-zinc-700 truncate flex-1">
                {conv.title || "Session"}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-500/20 rounded transition-all"
              >
                <Trash2 className="w-3 h-3 text-red-400" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-4 border-b dark:border-zinc-800 border-zinc-200">
          <h2 className="text-sm font-bold dark:text-white text-zinc-900">RYTM Coach</h2>
          <p className="text-xs dark:text-zinc-500 text-zinc-400 mt-0.5">Ask anything about your wellness journey</p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto relative">
          {showEmptyState ? (
            <div className="h-full flex flex-col items-center justify-center px-6">
              <div className="text-center space-y-5 w-full max-w-sm">
                <div>
                  <p className="text-base font-bold dark:text-white text-zinc-900">
                    Hey {firstName}, what&apos;s on your mind?
                  </p>
                  <p className="text-xs dark:text-zinc-500 text-zinc-400 mt-1">
                    I have context on your goals and today&apos;s plan.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {EXAMPLE_PROMPTS.map((prompt, i) => {
                    const Icon = prompt.icon;
                    return (
                      <button
                        key={i}
                        onClick={() => handleSend(prompt.text)}
                        className="flex flex-col items-start gap-1.5 p-3 rounded-xl dark:bg-zinc-800 bg-zinc-100 dark:hover:bg-zinc-700 hover:bg-zinc-200 transition-colors text-left border dark:border-zinc-700 border-zinc-200"
                      >
                        <Icon className="w-4 h-4 dark:text-zinc-400 text-zinc-500" />
                        <span className="text-xs font-medium dark:text-zinc-200 text-zinc-700">{prompt.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`rounded-xl px-4 py-2.5 max-w-[80%] text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "dark:bg-white/90 bg-violet-600 dark:text-black text-white font-medium"
                        : "dark:bg-zinc-800 bg-zinc-100 dark:text-zinc-100 text-zinc-800"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="rounded-xl px-4 py-3 dark:bg-zinc-800 bg-zinc-100">
                    <Loader2 className="w-4 h-4 animate-spin dark:text-zinc-400 text-zinc-500" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-4 border-t dark:border-zinc-800 border-zinc-200">
          <div className="flex gap-2 dark:bg-zinc-800 bg-zinc-100 rounded-xl p-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
              placeholder="Ask your coach..."
              disabled={loading}
              className="flex-1 px-2 py-1.5 bg-transparent dark:text-white text-zinc-900 dark:placeholder-zinc-500 placeholder-zinc-400 focus:outline-none text-sm"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="p-2.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import {
  Send,
  Plus,
  MessageSquare,
  Trash2,
  BookOpen,
  Lightbulb,
} from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import type { ChatMessage } from "@/types/dashboard";

interface JournalThread {
  id: string;
  title: string;
  journal_type: "free" | "guided";
  last_message_at: string;
  message_count: number;
}

interface JournalChatProps {
  className?: string;
  onMessageSent?: () => void;
  autoFocus?: boolean;

  // KEEP: required to backlog correctly
  selectedDate: Date;
  canonicalTimeZone: string;
}

export function JournalChat({
  className = "",
  onMessageSent,
  autoFocus = false,
  selectedDate,
  canonicalTimeZone,
}: JournalChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"unstructured" | "structured">(
    "unstructured"
  );
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState<JournalThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  /* =========================
     CHANGE: single date formatter for canonical tz
     - avoids duplicate helpers / accidental wrong tz
  ========================== */
  const formatLocalDate = useMemo(() => {
    const tz =
      canonicalTimeZone ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC";

    return (d: Date) =>
      new Intl.DateTimeFormat("en-CA", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d); // YYYY-MM-DD
  }, [canonicalTimeZone]);

  /* =========================
     ADD: stable localDate strings for selected day + today (in canonical tz)
  ========================== */
  const selectedLocalDate = useMemo(
    () => formatLocalDate(selectedDate),
    [formatLocalDate, selectedDate]
  );

  const todayLocalDate = useMemo(
    () => formatLocalDate(new Date()),
    [formatLocalDate]
  );

  // KEEP: Focus input when autoFocus prop changes to true
  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const loadThreads = async (uid: string) => {
    const { data, error } = await supabase.rpc("get_user_journal_threads", {
      p_user_id: uid,
      p_limit: 50,
    });

    if (error) {
      console.error("Error loading threads:", error);
      return;
    }

    setThreads(data || []);
  };

  // KEEP: Get user ID on mount
  useEffect(() => {
    const getUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setUserId(session.user.id);
        loadThreads(session.user.id);
      }
    };
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadThreadMessages = async (threadId: string) => {
    const { data, error } = await supabase.rpc("get_thread_messages", {
      p_thread_id: threadId,
      p_user_id: userId,
    });

    if (error) {
      console.error("Error loading messages:", error);
      return;
    }

    const formattedMessages: ChatMessage[] = (data || []).map((msg: any) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.created_at),
    }));

    setMessages(formattedMessages);
    setCurrentThreadId(threadId);
  };

  /* =========================
     CHANGE: refresh summary for the *selected day*
     - fixes "journal doesn't update checklist until reload"
     - fixes "always refreshes today" bug when backlogging
  ========================== */
  const refreshSummaryAndNotify = async (localDate: string) => {
    if (!userId) return;

    const { error: refreshErr } = await supabase.rpc("refresh_daily_summary", {
      p_user_id: userId,
      p_target_date: localDate, // CHANGE: not null
    });

    if (refreshErr) {
      console.error("refresh_daily_summary failed:", refreshErr);
    }

    // KEEP: parent will call loadDashboardData(userId, selectedDate)
    onMessageSent?.();
  };

  const deleteThread = async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();

    const { error } = await supabase.rpc("delete_journal_thread", {
      p_thread_id: threadId,
      p_user_id: userId,
    });

    if (error) {
      console.error("Error deleting thread:", error);
      return;
    }

    // KEEP
    loadThreads(userId);

    if (currentThreadId === threadId) {
      setMessages([]);
      setCurrentThreadId(null);
    }

    // CHANGE: refresh *selected* day summary (not always today)
    await refreshSummaryAndNotify(selectedLocalDate);
  };

  const handleModeChange = (newMode: "unstructured" | "structured") => {
    setMode(newMode);
    setMessages([]);
    setInput("");
    setCurrentThreadId(null);
  };

  const handleNewSession = async () => {
    if (!userId) return;

    setMessages([]);
    setInput("");
    setCurrentThreadId(null);

    const journalType = mode === "structured" ? "guided" : "free";
    await supabase
      .from("journal_threads")
      .update({ status: "closed" })
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("journal_type", journalType);

    if (mode === "structured") {
      try {
        await fetch("/api/journal/new-thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        console.error("Error creating new thread:", error);
      }
    }

    loadThreads(userId);
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

    // Determine whether we should preserve the exact timestamp
    // CHANGE: only keep real time when selected day == today in canonical tz
    const clientAt =
      selectedLocalDate === todayLocalDate ? new Date().toISOString() : null;

    // ==========================================================
    // FREE MODE (RPC insert)
    // ==========================================================
    if (mode === "unstructured") {
      try {
        let threadIdToUse = currentThreadId;

        // KEEP: Get or create thread for free mode
        if (!threadIdToUse) {
          const { data: threadId, error: threadError } = await supabase.rpc(
            "get_or_create_active_thread",
            {
              p_user_id: userId,
              p_journal_type: "free",
            }
          );

          if (threadError) {
            console.error("Error creating thread:", threadError);
            return;
          }

          threadIdToUse = threadId;
          setCurrentThreadId(threadIdToUse);
        }

        // CHANGE: use RPC wrapper so local_date is correct + summary updates
        const { data: ok, error: rpcErr } = await supabase.rpc(
          "log_journal_message_for_date",
          {
            p_user_id: userId,
            p_local_date: selectedLocalDate,
            p_thread_id: threadIdToUse,
            p_mode: "free",
            p_role: "user",
            p_content: userMessage.content,
            p_at: clientAt, // null => noon fallback in RPC
          }
        );

        if (rpcErr || ok !== true) {
          console.error("log_journal_message_for_date failed:", rpcErr);
          return;
        }

        // CHANGE: refresh selected day + notify parent
        await refreshSummaryAndNotify(selectedLocalDate);

        // KEEP: update sidebar
        loadThreads(userId);
      } catch (error) {
        console.error("Error in free-mode send:", error);
      }

      return;
    }

    // ==========================================================
    // GUIDED MODE (API route does inserts via RPC)
    // ==========================================================
    setLoading(true);

    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: userMessage.content,
          mode: "guided",
          // CHANGE: pass selected day localDate so API can backlog correctly
          localDate: selectedLocalDate,
          // CHANGE: pass timestamp only for "today" in canonical tz
          clientAt,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Failed to get AI response:", data.error);
        return;
      }

      // KEEP: Add AI response to chat (UI only)
      if (data.response) {
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      }

      // CHANGE: refresh selected day + notify parent
      await refreshSummaryAndNotify(selectedLocalDate);

      // KEEP: update sidebar counts
      loadThreads(userId);
    } catch (error) {
      console.error("Error sending message:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`h-full bg-zinc-900 border border-zinc-800 rounded-xl flex ${className}`}
    >
      {/* Sidebar */}
      <div
        className={`border-r border-zinc-800 flex flex-col transition-all duration-300 ${
          showSidebar ? "w-56" : "w-0"
        } overflow-hidden`}
      >
        <div className="p-3 border-b border-zinc-800">
          <button
            onClick={handleNewSession}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Session</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-3">
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">
              Previous Sessions
            </h4>
            <div className="space-y-1">
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`w-full flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-800 transition-colors group cursor-pointer ${
                    currentThreadId === thread.id ? "bg-zinc-800" : ""
                  }`}
                  onClick={() => loadThreadMessages(thread.id)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {thread.journal_type === "guided" ? (
                      <Lightbulb className="w-4 h-4 text-purple-400" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-blue-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">
                      {thread.title}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {new Date(thread.last_message_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={(e) => deleteThread(thread.id, e)}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-zinc-700 rounded transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-zinc-400" />
            </button>
            <h3 className="font-semibold text-white">Journal</h3>
          </div>

          {/* Toggle */}
          <div className="flex gap-3 items-center">
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
              ref={inputRef}
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
    </div>
  );
}

"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Send, Plus, MessageSquare, Trash2, BookOpen, Lightbulb } from "lucide-react";
import { VoiceInputButton } from "@/components/ui/VoiceInputButton";
import { createBrowserClient } from "@supabase/ssr";
import type { ChatMessage } from "@/types/dashboard";
import { formatLocalDate } from "@/lib/time";

interface JournalThread {
  id: string;
  title: string;
  journal_type: "free" | "guided";
  last_message_at: string;
  message_count: number;
  session_date_local: string | null; // YYYY-MM-DD local date in user's timezone
  session_timezone: string | null; // Canonical timezone of user at session creation
}

interface JournalChatProps {
  className?: string;
  onMessageSent?: () => void; // Parent should reload dashboard on this
  autoFocus?: boolean;
  selectedDate: Date;
  canonicalTimeZone: string;

  // Parent-selected session (single source of truth)
  activeThreadId?: string | null;
  activeJournalType?: "free" | "guided";

  // Notify parent when user selects a session in the sidebar
  onSessionSelected?: (threadId: string, date: Date, mode: "free" | "guided") => void;
}

export function JournalChat({
  className = "",
  onMessageSent,
  onSessionSelected,
  autoFocus = false,
  selectedDate,
  canonicalTimeZone,
  activeThreadId = null,
  activeJournalType,
}: JournalChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"unstructured" | "structured">("unstructured");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [threads, setThreads] = useState<JournalThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showMobileSessions, setShowMobileSessions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  // Single source of truth: local dates in canonical tz
  const tz = useMemo(() => canonicalTimeZone || "UTC", [canonicalTimeZone]);
  const selectedLocalDate = useMemo(() => formatLocalDate(selectedDate, tz), [selectedDate, tz]);
  const todayLocalDate = useMemo(() => formatLocalDate(new Date(), tz), [tz]);

  // Focus input when requested
  useEffect(() => {
    if (autoFocus && inputRef.current) inputRef.current.focus();
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

  const loadThreadMessagesById = async (threadId: string) => {
    if (!userId) return;

    const { data, error } = await supabase.rpc("get_thread_messages", {
      p_thread_id: threadId,
      p_user_id: userId,
    });

    if (error) {
      console.error("Error loading messages:", error);
      return;
    }

    const formatted: ChatMessage[] = (data || []).map((msg: any) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      timestamp: new Date(msg.created_at),
    }));

    setMessages(formatted);
    setCurrentThreadId(threadId);
  };

  // Get user session on mount
  useEffect(() => {
    const getUser = async () => {
      try {
        const resp = await fetch("/api/auth/session");
        const json = await resp.json();
        const session = json?.session;
        if (session?.user?.id) {
          setUserId(session.user.id);
          await loadThreads(session.user.id);
        }
      } catch {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.id) {
          setUserId(session.user.id);
          await loadThreads(session.user.id);
        }
      }
    };
    getUser();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Parent-controlled selection:
   * - When activeJournalType changes, set UI mode accordingly
   * - When activeThreadId changes, load messages for that exact thread
   */
  useEffect(() => {
    if (!userId) return;

    if (activeJournalType) {
      setMode(activeJournalType === "guided" ? "structured" : "unstructured");
    }

    if (activeThreadId) {
      loadThreadMessagesById(activeThreadId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThreadId, activeJournalType, userId]);

  // Session picker used by both desktop + mobile
  const selectThread = (thread: JournalThread) => {
    const pickedMode: "free" | "guided" = thread.journal_type === "guided" ? "guided" : "free";
    const pickedDate = thread.session_date_local ? new Date(thread.session_date_local) : selectedDate;
    onSessionSelected?.(thread.id, pickedDate, pickedMode);
  };

  // Refresh daily_summary for the selectedLocalDate and notify parent
  const refreshSummaryAndNotify = async () => {
    if (!userId) return;

    const { error } = await supabase.rpc("refresh_daily_summary", {
      p_user_id: userId,
      p_target_date: selectedLocalDate,
    });

    if (error) console.error("refresh_daily_summary failed:", error);

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

    await loadThreads(userId);

    // If we deleted the currently loaded thread, clear UI
    if (currentThreadId === threadId) {
      setMessages([]);
      setCurrentThreadId(null);
    }

    await refreshSummaryAndNotify();
  };

  const handleModeChange = (newMode: "unstructured" | "structured") => {
    setMode(newMode);

    // When explicitly switching modes, clear the current session in this component.
    // (Parent may optionally also clear selected thread)
    setMessages([]);
    setInput("");
    setCurrentThreadId(null);
  };

  const handleNewSession = async () => {
    if (!userId) return;

    // Clear everything to start a fresh session in this component.
    setMessages([]);
    setInput("");
    setCurrentThreadId(null);

    const journalType = mode === "structured" ? "guided" : "free";

    // Close current active thread(s) of this type (your status values should match your DB constraints)
    await supabase
      .from("journal_threads")
      .update({ status: "completed" })
      .eq("user_id", userId)
      .eq("status", "active")
      .eq("journal_type", journalType);

    // Guided: you may be creating a new guided thread via API
    if (mode === "structured") {
      try {
        await fetch("/api/journal/new-thread", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Recommended: include localDate + timezone if your route supports it
          // body: JSON.stringify({ localDate: selectedLocalDate, sessionTimeZone: tz }),
        });
      } catch (err) {
        console.error("Error creating new guided thread:", err);
      }
    }

    await loadThreads(userId);
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

    // Only preserve exact time if the selected date is "today" in canonical tz
    const clientAt = selectedLocalDate === todayLocalDate ? new Date().toISOString() : null;

    // =========================
    // FREE MODE (RPC insert)
    // =========================
    if (mode === "unstructured") {
      try {
        let threadIdToUse = currentThreadId;

        if (!threadIdToUse) {
          const { data: threadId, error: threadError } = await supabase.rpc("get_or_create_active_thread", {
            p_user_id: userId,
            p_journal_type: "free",
            p_session_date_local: selectedLocalDate,
            p_session_timezone: tz,
          });

          if (threadError || !threadId) {
            console.error("Error creating thread:", threadError);
            return;
          }

          threadIdToUse = threadId;
          setCurrentThreadId(threadIdToUse);
        }

        const { data: userMsg, error: rpcErr } = await supabase.rpc("log_journal_message_for_date", {
          p_user_id: userId,
          p_local_date: selectedLocalDate,
          p_thread_id: threadIdToUse,
          p_mode: "free",
          p_role: "user",
          p_content: userMessage.content,
          p_at: clientAt,
        });

        if (rpcErr || !userMsg?.id) {
          console.error("log_journal_message_for_date failed:", rpcErr);
          return;
        }

        await refreshSummaryAndNotify();
        await loadThreads(userId);
      } catch (err) {
        console.error("Error in free-mode send:", err);
      }
      return;
    }

    // =========================
    // GUIDED MODE (API inserts via RPC)
    // =========================
    setLoading(true);

    try {
      const response = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: userMessage.content,
          mode: "guided",
          localDate: selectedLocalDate,
          clientAt,
          // IMPORTANT: pass the currently loaded threadId so the backend can append deterministically
          threadId: currentThreadId,
          sessionTimeZone: tz,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Failed to get AI response:", data.error);
        return;
      }

      // If server returns threadId and we didn't have one, capture it
      if (!currentThreadId && data.threadId) {
        setCurrentThreadId(data.threadId);
      }

      if (data.response) {
        const aiMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: data.response,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, aiMessage]);
      }

      await refreshSummaryAndNotify();
      await loadThreads(userId);
    } catch (err) {
      console.error("Error sending message:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`h-full bg-zinc-900 border border-zinc-800 rounded-xl flex ${className}`}>
      {/* Mobile Sessions Overlay */}
      {showMobileSessions && (
        <div className="fixed inset-0 z-50 bg-zinc-900 flex flex-col sm:hidden">
          <div className="flex items-center justify-between p-4 border-b border-zinc-800">
            <h3 className="font-semibold text-white">Previous Sessions</h3>
            <button
              onClick={() => setShowMobileSessions(false)}
              className="p-2 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            <div className="space-y-1">
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`w-full flex items-start gap-2 p-3 rounded-lg hover:bg-zinc-800 transition-colors group cursor-pointer ${
                    currentThreadId === thread.id ? "bg-zinc-800" : ""
                  }`}
                  onClick={() => {
                    selectThread(thread);
                    setShowMobileSessions(false);
                  }}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {thread.journal_type === "guided" ? (
                      <Lightbulb className="w-4 h-4 text-purple-400" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-blue-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{thread.title}</p>
                    <p className="text-xs text-zinc-500">{new Date(thread.last_message_at).toLocaleDateString()}</p>
                  </div>

                  <button
                    onClick={(e) => deleteThread(thread.id, e)}
                    className="p-1 hover:bg-zinc-700 rounded transition-all text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Sidebar - desktop */}
      <div
        className={`hidden sm:flex border-r border-zinc-800 flex-col transition-all duration-300 ${
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
            <h4 className="text-xs font-medium text-zinc-500 uppercase mb-2">Previous Sessions</h4>
            <div className="space-y-1">
              {threads.map((thread) => (
                <div
                  key={thread.id}
                  className={`w-full flex items-start gap-2 p-2 rounded-lg hover:bg-zinc-800 transition-colors group cursor-pointer ${
                    currentThreadId === thread.id ? "bg-zinc-800" : ""
                  }`}
                  onClick={() => selectThread(thread)}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {thread.journal_type === "guided" ? (
                      <Lightbulb className="w-4 h-4 text-purple-400" />
                    ) : (
                      <BookOpen className="w-4 h-4 text-blue-400" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{thread.title}</p>
                    <p className="text-xs text-zinc-500">{new Date(thread.last_message_at).toLocaleDateString()}</p>
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

      {/* Main Chat */}
      <div className="flex-1 flex flex-col">
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="hidden sm:block p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-zinc-400" />
            </button>

            <button
              onClick={() => setShowMobileSessions(true)}
              className="sm:hidden p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-zinc-400" />
            </button>

            <h3 className="font-semibold text-white text-sm sm:text-base">Journal • {selectedLocalDate}</h3>

            <button
              onClick={handleNewSession}
              className="sm:hidden p-1.5 rounded-lg hover:bg-zinc-800 transition-colors"
              title="New Session"
            >
              <Plus className="w-4 h-4 text-zinc-400" />
            </button>
          </div>

          <div className="flex gap-2 sm:gap-3 items-center">
            <div className="flex bg-zinc-800 rounded-full p-0.5 border border-zinc-700">
              <button
                onClick={() => handleModeChange("unstructured")}
                className={`px-3 py-1 text-xs rounded-full transition-all ${
                  mode === "unstructured" ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                Free
              </button>
              <button
                onClick={() => handleModeChange("structured")}
                className={`px-3 py-1 text-xs rounded-full transition-all ${
                  mode === "structured" ? "bg-white text-black" : "text-zinc-400 hover:text-white"
                }`}
              >
                Guided
              </button>
            </div>
          </div>
        </div>

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
                  msg.role === "user" ? "bg-zinc-800 ml-8" : "bg-purple-600/20 border border-purple-600/30 mr-8"
                }`}
              >
                <p className="text-white text-sm">{msg.content}</p>
                <p className="text-xs text-zinc-500 mt-1">{msg.timestamp.toLocaleTimeString()}</p>
              </div>
            ))
          )}

          {loading && (
            <div className="bg-purple-600/20 border border-purple-600/30 rounded-lg p-3 mr-8">
              <p className="text-white text-sm">Thinking...</p>
            </div>
          )}
        </div>

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
            <VoiceInputButton
              onTranscript={(t) => setInput(t)}
              currentValue={input}
              disabled={loading}
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

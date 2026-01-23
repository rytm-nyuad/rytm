"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Plus, MessageSquare, Trash2 } from "lucide-react";
import {
  getCoachConversations,
  getCoachMessages,
  createCoachConversation,
  addCoachMessage,
  deleteCoachConversation,
  type CoachConversation,
  type CoachMessage,
} from "@/lib/db/coach";

interface FullScreenCoachProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  firstName: string;
  initialMessage?: string;
}

const EXAMPLE_PROMPTS = [
  "Help me build better habits",
  "Why am I struggling with consistency?",
  "Create a morning routine for me",
  "How can I stay motivated?",
];

export function FullScreenCoach({ isOpen, onClose, userId, firstName, initialMessage }: FullScreenCoachProps) {
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const hasProcessedInitialMessage = useRef(false);

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

  // Reset when modal closes
  useEffect(() => {
    if (!isOpen) {
      hasProcessedInitialMessage.current = false;
      setCurrentConversationId(null);
      setMessages([]);
      setInput("");
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && userId) {
      loadConversations();
    }
  }, [isOpen, userId, loadConversations]);

  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    }
  }, [currentConversationId, loadMessages]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleNewChat = async () => {
    const conversationId = await createCoachConversation(userId, "New conversation");
    if (conversationId) {
      setCurrentConversationId(conversationId);
      setMessages([]);
      await loadConversations();
    }
  };

  const handleSend = useCallback(async (content?: string) => {
    const messageContent = content || input.trim();
    if (!messageContent) return;

    console.log("handleSend called with:", messageContent);
    
    let conversationId = currentConversationId;

    // Create new conversation if none exists
    if (!conversationId) {
      console.log("Creating new conversation...");
      conversationId = await createCoachConversation(userId, messageContent.slice(0, 50));
      if (!conversationId) {
        console.error("Failed to create conversation");
        return;
      }
      console.log("New conversation created:", conversationId);
      setCurrentConversationId(conversationId);
      await loadConversations();
      
      // Wait a bit for the state to update
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    setLoading(true);
    if (!content) {
      setInput("");
    }

    console.log("Adding user message to conversation:", conversationId);
    // Add user message
    const success = await addCoachMessage(conversationId, "user", messageContent);
    console.log("User message added:", success);
    
    if (success) {
      // Reload messages immediately to show user's message
      await loadMessages(conversationId);

      // Send placeholder response
      setTimeout(async () => {
        console.log("Adding assistant response...");
        await addCoachMessage(
          conversationId!,
          "assistant",
          "Thanks for reaching out! I'm your personal coach, and I'm here to help you build better habits and stay consistent. Full AI coaching features are coming soon! 🚀"
        );
        await loadMessages(conversationId!);
        setLoading(false);
      }, 800);
    } else {
      console.error("Failed to add user message");
      setLoading(false);
    }
  }, [input, currentConversationId, userId, loadConversations, loadMessages]);

  // Handle initial message when modal opens
  useEffect(() => {
    if (isOpen && initialMessage && !hasProcessedInitialMessage.current && userId) {
      hasProcessedInitialMessage.current = true;
      console.log("Processing initial message:", initialMessage);
      handleSend(initialMessage);
    }
  }, [isOpen, initialMessage, userId, handleSend]);

  const handleDeleteConversation = async (id: string) => {
    await deleteCoachConversation(id);
    if (currentConversationId === id) {
      setCurrentConversationId(null);
      setMessages([]);
    }
    await loadConversations();
  };

  const handlePromptClick = (prompt: string) => {
    handleSend(prompt);
  };

  if (!isOpen) return null;

  const showEmptyState = !currentConversationId || messages.length === 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 pointer-events-none">
        <div
          className="
          w-full h-full sm:h-[95vh] max-w-7xl
          dark:bg-black light:bg-cyan-500
          sm:rounded-2xl
          shadow-2xl
          flex
          pointer-events-auto
          animate-in zoom-in-95 duration-200
          overflow-hidden
        "
        >
          {/* Sidebar */}
          <div className="hidden md:flex md:w-64 dark:bg-zinc-950 light:bg-cyan-600 dark:border-r dark:border-zinc-800 light:border-r light:border-cyan-500 flex-col">
            {/* New Chat Button */}
            <div className="p-3">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg dark:bg-zinc-900 light:bg-cyan-500 dark:hover:bg-zinc-800 light:hover:bg-cyan-400 transition-colors text-white"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">New Chat</span>
              </button>
            </div>

            {/* Conversations List */}
            <div className="flex-1 overflow-y-auto px-2">
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setCurrentConversationId(conv.id)}
                  className={`
                    group flex items-center gap-2 px-3 py-2 rounded-lg mb-1 cursor-pointer transition-colors
                    ${
                      currentConversationId === conv.id
                        ? "dark:bg-zinc-800 light:bg-cyan-500"
                        : "dark:hover:bg-zinc-900 light:hover:bg-cyan-500/50"
                    }
                  `}
                >
                  <MessageSquare className="w-4 h-4 text-white/60 flex-shrink-0" />
                  <span className="text-sm text-white/80 truncate flex-1">
                    {conv.title || "New conversation"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-opacity"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col">
            {/* Header */}
            <div className="px-4 sm:px-6 py-4 dark:border-b dark:border-zinc-800 light:border-b light:border-cyan-400 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Your Elite Coach</h2>
              <button
                onClick={onClose}
                className="p-2 rounded-lg dark:text-zinc-400 light:text-cyan-100 dark:hover:bg-zinc-900 light:hover:bg-cyan-400 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages or Empty State */}
            <div className="flex-1 overflow-y-auto">
              {showEmptyState ? (
                <div className="h-full flex flex-col items-center justify-center px-4 max-w-2xl mx-auto">
                  <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                    Hi, {firstName} 👋
                  </h1>
                  <p className="dark:text-zinc-400 light:text-cyan-100 text-center mb-8">
                    I'm your personal coach. Ask me anything about building habits, staying consistent, or reaching your goals.
                  </p>

                  {/* Example Prompts */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                    {EXAMPLE_PROMPTS.map((prompt, index) => (
                      <button
                        key={index}
                        onClick={() => handlePromptClick(prompt)}
                        className="px-4 py-3 rounded-xl text-left dark:bg-zinc-900 light:bg-cyan-400 dark:hover:bg-zinc-800 light:hover:bg-cyan-300 dark:text-white light:text-white transition-colors text-sm"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`rounded-2xl px-4 py-3 max-w-[85%] ${
                          msg.role === "user"
                            ? "dark:bg-white light:bg-white dark:text-black light:text-cyan-600"
                            : "dark:bg-zinc-900 light:bg-cyan-400 dark:text-white light:text-white"
                        }`}
                      >
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="rounded-2xl px-4 py-3 dark:bg-zinc-900 light:bg-cyan-400 dark:text-white light:text-white">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }}></div>
                          <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }}></div>
                          <div className="w-2 h-2 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }}></div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 sm:p-6 dark:border-t dark:border-zinc-800 light:border-t light:border-cyan-400">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-2 dark:bg-zinc-900 light:bg-cyan-400 rounded-2xl p-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    placeholder="Message your coach..."
                    className="
                      flex-1 px-4 py-2 bg-transparent
                      dark:text-white light:text-white
                      dark:placeholder-zinc-500 light:placeholder-cyan-100
                      focus:outline-none
                      text-sm
                    "
                    disabled={loading}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || loading}
                    className="
                      p-2 rounded-xl
                      bg-white
                      dark:text-black light:text-cyan-600
                      hover:bg-zinc-100
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-colors
                      flex-shrink-0
                    "
                  >
                    <Send className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

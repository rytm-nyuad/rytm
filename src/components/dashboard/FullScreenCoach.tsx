"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Send, Plus, MessageSquare, Trash2, Calendar, Heart, Zap, TrendingUp } from "lucide-react";
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
  { text: "Help me plan today", icon: Calendar, description: "Get organized and set priorities" },
  { text: "I'm feeling off", icon: Heart, description: "Let's talk through what's on your mind" },
  { text: "Push me right now", icon: Zap, description: "Get motivated and take action" },
  { text: "Build better habits", icon: TrendingUp, description: "Create lasting positive changes" },
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
    const success = await addCoachMessage(conversationId, "user", messageContent, userId);
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
          "Thanks for reaching out! I'm your personal coach, and I'm here to help you build better habits and stay consistent. Full AI coaching features are coming soon! 🚀",
          userId
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
      {/* Full-screen backdrop with vignette */}
      <div
        className="fixed inset-0 bg-black/90 z-40 animate-in fade-in duration-300"
        style={{
          background: 'radial-gradient(circle at center, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.95) 100%)'
        }}
        onClick={onClose}
      />

      {/* Full-height session overlay */}
      <div className="fixed inset-0 z-50 flex pointer-events-none">
        <div
          className="
          w-full h-full
          dark:bg-gradient-to-b dark:from-zinc-950 dark:via-black dark:to-zinc-950
          light:bg-gradient-to-b light:from-cyan-700 light:via-cyan-600 light:to-cyan-800
          flex
          pointer-events-auto
          animate-in fade-in slide-in-from-bottom-4 duration-300
        "
        >
          {/* Sidebar - Previous Sessions */}
          <div className="hidden md:flex md:w-64 dark:bg-black/40 light:bg-cyan-900/40 backdrop-blur-sm dark:border-r dark:border-zinc-800/50 light:border-r light:border-cyan-700/50 flex-col">
            {/* New Session Button */}
            <div className="p-4 border-b dark:border-zinc-800/50 light:border-cyan-700/50">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center gap-2 px-4 py-3 rounded-lg dark:bg-zinc-900/60 light:bg-cyan-700/60 dark:hover:bg-zinc-800/60 light:hover:bg-cyan-600/60 transition-all text-white font-medium text-sm backdrop-blur-sm"
              >
                <Plus className="w-4 h-4" />
                <span>New Session</span>
              </button>
            </div>

            {/* Previous Sessions List */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <p className="text-xs font-semibold dark:text-zinc-500 light:text-cyan-300 uppercase tracking-wider px-3 py-2">
                Previous Sessions
              </p>
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => setCurrentConversationId(conv.id)}
                  className={`
                    group flex items-center gap-2 px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-all
                    ${
                      currentConversationId === conv.id
                        ? "dark:bg-zinc-800/80 light:bg-cyan-700/80 backdrop-blur-sm"
                        : "dark:hover:bg-zinc-900/40 light:hover:bg-cyan-700/40"
                    }
                  `}
                >
                  <MessageSquare className="w-3.5 h-3.5 dark:text-zinc-400 light:text-cyan-200 flex-shrink-0" />
                  <span className="text-sm dark:text-zinc-300 light:text-cyan-50 truncate flex-1">
                    {conv.title || "Session"}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/20 rounded transition-all"
                  >
                    <Trash2 className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Main Session Area */}
          <div className="flex-1 flex flex-col relative">
            {/* Session Header */}
            <div className="px-6 py-5 dark:border-b dark:border-zinc-800/30 light:border-b light:border-cyan-700/30 backdrop-blur-sm">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-white tracking-tight">
                    RYTM Coach
                  </h1>
                  <p className="text-sm dark:text-zinc-400 light:text-cyan-200 mt-0.5">
                    Daily Session — Focus & Consistency
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium dark:text-zinc-300 light:text-cyan-100 dark:hover:bg-red-500/20 light:hover:bg-red-500/20 dark:hover:text-red-400 light:hover:text-red-300 transition-all backdrop-blur-sm"
                >
                  <span>Back to dashboard</span>
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Messages or Empty State - Center spotlight */}
            <div 
              className="flex-1 overflow-y-auto relative"
              style={{
                background: 'radial-gradient(ellipse at center, rgba(255,255,255,0.03) 0%, transparent 70%)'
              }}
            >
              {showEmptyState ? (
                <div className="h-full flex flex-col items-center justify-center px-6 max-w-3xl mx-auto">
                  <div className="text-center space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="space-y-2">
                      <h2 className="text-3xl sm:text-4xl font-bold text-white">
                        Let's lock in, {firstName}.
                      </h2>
                      <p className="text-base dark:text-zinc-400 light:text-cyan-200">
                        What do you want to improve right now?
                      </p>
                    </div>

                    {/* Action-oriented prompt cards - horizontal layout */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full max-w-6xl pt-6">
                      {EXAMPLE_PROMPTS.map((prompt, index) => {
                        const Icon = prompt.icon;
                        return (
                          <button
                            key={index}
                            onClick={() => handlePromptClick(prompt.text)}
                            className="group relative px-6 py-8 rounded-2xl text-left dark:bg-zinc-900/60 light:bg-cyan-700/60 dark:hover:bg-zinc-800/80 light:hover:bg-cyan-600/80 backdrop-blur-md dark:text-white light:text-white transition-all border dark:border-zinc-800/50 light:border-cyan-600/50 hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-xl flex flex-col items-start gap-3"
                          >
                            {/* Icon */}
                            <div className="w-12 h-12 rounded-xl dark:bg-white/10 light:bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                              <Icon className="w-6 h-6 dark:text-white light:text-white" />
                            </div>
                            
                            {/* Text content */}
                            <div className="space-y-1.5">
                              <h3 className="font-semibold text-base leading-tight">
                                {prompt.text}
                              </h3>
                              <p className="text-xs dark:text-zinc-400 light:text-cyan-200 leading-snug">
                                {prompt.description}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-6 space-y-4 max-w-4xl mx-auto w-full">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-300`}
                    >
                      <div
                        className={`rounded-2xl px-5 py-3.5 max-w-[85%] backdrop-blur-sm ${
                          msg.role === "user"
                            ? "dark:bg-white/95 light:bg-white/95 dark:text-black light:text-cyan-900 font-medium"
                            : "dark:bg-zinc-900/80 light:bg-cyan-700/80 dark:text-white light:text-white border dark:border-zinc-800/50 light:border-cyan-600/50"
                        }`}
                      >
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex justify-start animate-in fade-in duration-200">
                      <div className="rounded-2xl px-5 py-3.5 dark:bg-zinc-900/80 light:bg-cyan-700/80 backdrop-blur-sm border dark:border-zinc-800/50 light:border-cyan-600/50">
                        <div className="flex gap-1.5">
                          <div className="w-2 h-2 rounded-full dark:bg-zinc-400 light:bg-cyan-200 animate-bounce" style={{ animationDelay: "0ms" }}></div>
                          <div className="w-2 h-2 rounded-full dark:bg-zinc-400 light:bg-cyan-200 animate-bounce" style={{ animationDelay: "150ms" }}></div>
                          <div className="w-2 h-2 rounded-full dark:bg-zinc-400 light:bg-cyan-200 animate-bounce" style={{ animationDelay: "300ms" }}></div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Session Input */}
            <div className="p-6 dark:border-t dark:border-zinc-800/30 light:border-t light:border-cyan-700/30 backdrop-blur-sm">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-3 dark:bg-zinc-900/60 light:bg-cyan-700/60 rounded-2xl p-3 backdrop-blur-sm border dark:border-zinc-800/50 light:border-cyan-600/50">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                    placeholder={showEmptyState ? "Start today's session…" : ""}
                    className="
                      flex-1 px-4 py-3 bg-transparent
                      dark:text-white light:text-white
                      dark:placeholder-zinc-500 light:placeholder-cyan-200
                      focus:outline-none
                      text-sm font-medium
                    "
                    disabled={loading}
                  />
                  <button
                    onClick={() => handleSend()}
                    disabled={!input.trim() || loading}
                    className="
                      px-5 py-3 rounded-xl
                      bg-white
                      dark:text-black light:text-cyan-900
                      hover:bg-zinc-100
                      disabled:opacity-50 disabled:cursor-not-allowed
                      transition-all font-semibold text-sm
                      hover:scale-105 active:scale-95
                      flex-shrink-0
                    "
                  >
                    <Send className="w-4 h-4" />
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

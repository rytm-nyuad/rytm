// src/components/dashboard/DailyTodoList.tsx
"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Plus, X, Check, Pencil } from "lucide-react";
import { VoiceInputButton } from "@/components/ui/VoiceInputButton";
import { createBrowserClient } from "@supabase/ssr";
import { formatLocalDate, formatLocalDisplayDate } from "@/lib/time";
import {
  listTodosByDate,
  addTodo,
  toggleTodo,
  deleteTodo,
  editTodo,
} from "@/lib/db/todos";
import type { DailyTodo } from "@/types/todo";

interface DailyTodoListProps {
  firstName?: string;
  selectedDate: Date;
  canonicalTimeZone: string;
  className?: string;
}

export function DailyTodoList({
  firstName = "Your",
  selectedDate,
  canonicalTimeZone,
  className = "",
}: DailyTodoListProps) {
  const [activeTodos, setActiveTodos] = useState<DailyTodo[]>([]);
  const [completedTodos, setCompletedTodos] = useState<DailyTodo[]>([]);
  const [newTask, setNewTask] = useState("");
  const [userId, setUserId] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  const supabase = useMemo(
    () =>
      createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      ),
    []
  );

  const tz = useMemo(
    () => canonicalTimeZone || "UTC",
    [canonicalTimeZone]
  );
  const localDate = useMemo(
    () => formatLocalDate(selectedDate, tz),
    [selectedDate, tz]
  );

  // Auth
  useEffect(() => {
    const getUser = async () => {
      try {
        const resp = await fetch("/api/auth/session");
        const json = await resp.json();
        const session = json?.session;
        if (session?.user?.id) setUserId(session.user.id);
      } catch {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.user?.id) setUserId(session.user.id);
      }
    };
    getUser();
  }, [supabase]);

  // Load todos when user or date changes
  const loadTodos = useCallback(async () => {
    if (!userId) return;
    const { active, completed } = await listTodosByDate(userId, localDate);
    setActiveTodos(active);
    setCompletedTodos(completed);
  }, [userId, localDate]);

  useEffect(() => {
    loadTodos();
  }, [loadTodos]);

  // Add
  const handleAdd = async () => {
    const text = newTask.trim();
    if (!text || !userId) return;

    // Optimistic: add a placeholder
    const optimistic: DailyTodo = {
      id: `temp-${Date.now()}`,
      user_id: userId,
      date: localDate,
      text,
      is_completed: false,
      completed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setActiveTodos((prev) => [...prev, optimistic]);
    setNewTask("");

    const result = await addTodo(userId, localDate, text);
    if (result) {
      // Replace placeholder with real
      setActiveTodos((prev) =>
        prev.map((t) => (t.id === optimistic.id ? result : t))
      );
    } else {
      // Rollback
      setActiveTodos((prev) =>
        prev.filter((t) => t.id !== optimistic.id)
      );
    }
  };

  // Toggle
  const handleToggle = async (todo: DailyTodo) => {
    const wasCompleted = todo.is_completed;
    const updated: DailyTodo = {
      ...todo,
      is_completed: !wasCompleted,
      completed_at: !wasCompleted ? new Date().toISOString() : null,
    };

    // Optimistic move
    if (!wasCompleted) {
      setActiveTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setCompletedTodos((prev) => [updated, ...prev]);
    } else {
      setCompletedTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setActiveTodos((prev) => [...prev, updated]);
    }

    const ok = await toggleTodo(todo.id, !wasCompleted);
    if (!ok) {
      // Rollback
      if (!wasCompleted) {
        setCompletedTodos((prev) =>
          prev.filter((t) => t.id !== todo.id)
        );
        setActiveTodos((prev) => [...prev, todo]);
      } else {
        setActiveTodos((prev) =>
          prev.filter((t) => t.id !== todo.id)
        );
        setCompletedTodos((prev) => [todo, ...prev]);
      }
    }
  };

  // Delete
  const handleDelete = async (todo: DailyTodo) => {
    const list = todo.is_completed ? "completed" : "active";

    // Optimistic remove
    if (list === "active") {
      setActiveTodos((prev) => prev.filter((t) => t.id !== todo.id));
    } else {
      setCompletedTodos((prev) => prev.filter((t) => t.id !== todo.id));
    }

    const ok = await deleteTodo(todo.id);
    if (!ok) {
      // Rollback
      if (list === "active") {
        setActiveTodos((prev) => [...prev, todo]);
      } else {
        setCompletedTodos((prev) => [...prev, todo]);
      }
    }
  };

  // Edit
  const handleEdit = async (todo: DailyTodo, newText: string) => {
    const trimmed = newText.trim();
    if (!trimmed || trimmed === todo.text) return;

    const updateList = (list: DailyTodo[]) =>
      list.map((t) =>
        t.id === todo.id
          ? { ...t, text: trimmed, updated_at: new Date().toISOString() }
          : t
      );

    if (todo.is_completed) {
      setCompletedTodos(updateList);
    } else {
      setActiveTodos(updateList);
    }

    const ok = await editTodo(todo.id, trimmed);
    if (!ok) {
      const rollback = (list: DailyTodo[]) =>
        list.map((t) => (t.id === todo.id ? todo : t));
      if (todo.is_completed) {
        setCompletedTodos(rollback);
      } else {
        setActiveTodos(rollback);
      }
    }
  };

  const remainingCount = activeTodos.length;
  const completedCount = completedTodos.length;

  return (
    <div className={`flex flex-col h-full ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-semibold dark:text-white light:text-slate-900">
          {firstName}'s To-Do
        </h3>
        <span className="text-xs dark:text-zinc-500 light:text-slate-500">
          {formatLocalDisplayDate(selectedDate, tz)}
        </span>
      </div>

      {/* Add task input */}
      <div className="flex gap-2 mb-3">
        <input
          ref={inputRef}
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add new task"
          className="flex-1 px-3 py-1.5 text-sm dark:bg-zinc-800 light:bg-gray-100 border dark:border-zinc-700 light:border-gray-300 rounded-lg dark:text-white light:text-slate-900 dark:placeholder-zinc-500 light:placeholder-slate-400 focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-blue-500"
        />
        <VoiceInputButton
          onTranscript={(t) => setNewTask(t)}
          currentValue={newTask}
          size="sm"
        />
        <button
          onClick={handleAdd}
          disabled={!newTask.trim()}
          className="p-1.5 rounded-lg dark:bg-zinc-800 light:bg-gray-200 dark:text-white light:text-slate-700 dark:hover:bg-zinc-700 light:hover:bg-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          aria-label="Add task"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Task list */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5">
        {/* Active tasks */}
        {activeTodos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        ))}

        {/* Completed tasks */}
        {completedTodos.length > 0 && activeTodos.length > 0 && (
          <div className="my-2 border-t dark:border-zinc-800 light:border-gray-200" />
        )}
        {completedTodos.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onEdit={handleEdit}
          />
        ))}

        {/* Empty state */}
        {activeTodos.length === 0 && completedTodos.length === 0 && (
          <p className="text-xs dark:text-zinc-600 light:text-slate-400 italic pt-2">
            No tasks for this day yet.
          </p>
        )}
      </div>

      {/* Remaining & completed count */}
      {(activeTodos.length > 0 || completedTodos.length > 0) && (
        <div className="pt-2 mt-2 border-t dark:border-zinc-800 light:border-gray-200">
          <p className="text-xs dark:text-zinc-500 light:text-slate-500">
            {remainingCount === 0 && completedCount > 0
              ? "All done!"
              : remainingCount > 0 && completedCount > 0
              ? `${remainingCount} remaining | ${completedCount} completed`
              : remainingCount > 0
              ? `${remainingCount} remaining`
              : ""}
          </p>
        </div>
      )}
    </div>
  );
}

/* ─── Single row ─── */

function TodoRow({
  todo,
  onToggle,
  onDelete,
  onEdit,
}: {
  todo: DailyTodo;
  onToggle: (t: DailyTodo) => void;
  onDelete: (t: DailyTodo) => void;
  onEdit: (t: DailyTodo, newText: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(todo.text);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  // Keep editText in sync if todo.text is updated externally
  useEffect(() => {
    if (!isEditing) setEditText(todo.text);
  }, [todo.text, isEditing]);

  const handleSave = () => {
    const trimmed = editText.trim();
    if (!trimmed) {
      setEditText(todo.text);
      setIsEditing(false);
      return;
    }
    if (trimmed !== todo.text) {
      onEdit(todo, trimmed);
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(todo.text);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); handleSave(); }
    if (e.key === "Escape") handleCancel();
  };

  return (
    <div className="group flex items-center gap-2 py-1.5 px-2 rounded-lg dark:hover:bg-zinc-800/50 light:hover:bg-gray-50 transition-colors">
      {/* Checkbox */}
      <button
        onClick={() => onToggle(todo)}
        className={`w-4 h-4 flex-shrink-0 rounded border transition-colors flex items-center justify-center ${
          todo.is_completed
            ? "dark:bg-white light:bg-blue-600 dark:border-white light:border-blue-600"
            : "dark:border-zinc-600 light:border-gray-400 dark:bg-transparent light:bg-transparent dark:hover:border-zinc-400 light:hover:border-gray-500"
        }`}
        aria-label={todo.is_completed ? "Mark as active" : "Mark as complete"}
      >
        {todo.is_completed && (
          <Check className="w-3 h-3 dark:text-black light:text-white" />
        )}
      </button>

      {/* Text / Edit input */}
      {isEditing ? (
        <input
          ref={editInputRef}
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleSave}
          className="flex-1 text-xs leading-tight bg-transparent border-b dark:border-zinc-600 light:border-gray-400 dark:text-white light:text-slate-900 focus:outline-none dark:focus:border-purple-500 light:focus:border-blue-500 py-0"
        />
      ) : (
        <span
          className={`flex-1 text-xs leading-tight ${
            todo.is_completed
              ? "line-through dark:text-zinc-500 light:text-slate-400"
              : "dark:text-white light:text-slate-900 cursor-pointer"
          }`}
          onClick={() => {
            if (!todo.is_completed) {
              setEditText(todo.text);
              setIsEditing(true);
            }
          }}
        >
          {todo.text}
        </span>
      )}

      {/* Edit icon (hover, active tasks only) */}
      {!isEditing && !todo.is_completed && (
        <button
          onClick={() => { setEditText(todo.text); setIsEditing(true); }}
          className="flex-shrink-0 p-0.5 rounded dark:text-zinc-600 light:text-slate-400 dark:hover:text-zinc-300 light:hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
          aria-label="Edit task"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}

      {/* Delete */}
      <button
        onClick={() => onDelete(todo)}
        className="flex-shrink-0 p-0.5 rounded dark:text-zinc-600 light:text-slate-400 dark:hover:text-red-400 light:hover:text-red-500 dark:hover:bg-zinc-700 light:hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
        aria-label="Delete task"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

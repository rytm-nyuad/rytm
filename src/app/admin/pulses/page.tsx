"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Pulse {
  id: string;
  pulse_number: number;
  slug: string;
  title: string;
  subtitle: string | null;
  excerpt: string | null;
  content_markdown: string;
  cover_image_url: string | null;
  tags: string[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  author_name: string | null;
}

type EditorPulse = {
  id?: string;
  pulse_number: number;
  slug: string;
  title: string;
  subtitle: string;
  excerpt: string;
  content_markdown: string;
  cover_image_url: string;
  tags: string;
  is_published: boolean;
  author_name: string;
};

const emptyPulse: EditorPulse = {
  pulse_number: 0,
  slug: "",
  title: "",
  subtitle: "",
  excerpt: "",
  content_markdown: "",
  cover_image_url: "",
  tags: "",
  is_published: false,
  author_name: "RYTM Team",
};

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminPulsesPage() {
  const router = useRouter();
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [editing, setEditing] = useState<EditorPulse | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadPulses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pulses");
      const data = await res.json();

      if (!data.isAdmin) {
        router.push("/sign-in");
        return;
      }

      setIsAdmin(true);
      setPulses(data.pulses || []);
    } catch {
      setError("Failed to load pulses");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadPulses();
  }, [loadPulses]);

  const startNew = () => {
    const nextNumber =
      pulses.length > 0
        ? Math.max(...pulses.map((p) => p.pulse_number)) + 1
        : 1;
    setEditing({ ...emptyPulse, pulse_number: nextNumber });
    setError(null);
    setSuccess(null);
  };

  const startEdit = (pulse: Pulse) => {
    setEditing({
      id: pulse.id,
      pulse_number: pulse.pulse_number,
      slug: pulse.slug,
      title: pulse.title,
      subtitle: pulse.subtitle || "",
      excerpt: pulse.excerpt || "",
      content_markdown: pulse.content_markdown,
      cover_image_url: pulse.cover_image_url || "",
      tags: pulse.tags.join(", "),
      is_published: pulse.is_published,
      author_name: pulse.author_name || "RYTM Team",
    });
    setError(null);
    setSuccess(null);
  };

  const handleTitleChange = (title: string) => {
    if (!editing) return;
    const autoSlug =
      `pulse-${String(editing.pulse_number).padStart(3, "0")}-${slugify(title)}`;
    setEditing({
      ...editing,
      title,
      slug: editing.id ? editing.slug : autoSlug,
    });
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const body = {
        ...editing,
        tags: editing.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
      };

      const res = await fetch("/api/pulses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Save failed");
        return;
      }

      setSuccess("Pulse saved successfully");
      setEditing(null);
      await loadPulses();
    } catch {
      setError("Network error — failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this pulse permanently?")) return;

    try {
      const res = await fetch(`/api/pulses?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Delete failed");
        return;
      }
      await loadPulses();
    } catch {
      setError("Network error — failed to delete");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-zinc-500 text-lg">Loading...</div>
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-zinc-500 text-lg">Access denied</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="border-b border-white/[0.06] bg-zinc-950">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-5">
          <div className="flex items-center gap-4">
            <Link
              href="/pulses"
              className="text-xl font-bold tracking-tight hover:text-zinc-300 transition-colors"
            >
              rytm
            </Link>
            <span className="text-zinc-600">/</span>
            <span className="text-sm font-medium text-zinc-400">
              Pulses Admin
            </span>
          </div>
          <button
            onClick={startNew}
            className="px-4 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors"
          >
            + New Pulse
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Status messages */}
        {error && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
            {success}
          </div>
        )}

        {/* Editor */}
        {editing && (
          <div className="mb-10 p-6 rounded-xl border border-white/[0.08] bg-zinc-950">
            <h2 className="text-lg font-semibold mb-6">
              {editing.id ? "Edit Pulse" : "New Pulse"}
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                  Pulse Number
                </label>
                <input
                  type="number"
                  value={editing.pulse_number}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      pulse_number: parseInt(e.target.value) || 0,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                  Slug
                </label>
                <input
                  type="text"
                  value={editing.slug}
                  onChange={(e) =>
                    setEditing({ ...editing, slug: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                Title
              </label>
              <input
                type="text"
                value={editing.title}
                onChange={(e) => handleTitleChange(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
                placeholder='Pulse #002 — Title Here'
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                Subtitle
              </label>
              <input
                type="text"
                value={editing.subtitle}
                onChange={(e) =>
                  setEditing({ ...editing, subtitle: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                Excerpt
              </label>
              <textarea
                value={editing.excerpt}
                onChange={(e) =>
                  setEditing({ ...editing, excerpt: e.target.value })
                }
                rows={2}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20 resize-y"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={editing.tags}
                  onChange={(e) =>
                    setEditing({ ...editing, tags: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
                  placeholder="sleep, circadian, modeling"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                  Author Name
                </label>
                <input
                  type="text"
                  value={editing.author_name}
                  onChange={(e) =>
                    setEditing({ ...editing, author_name: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                Cover Image URL (optional)
              </label>
              <input
                type="text"
                value={editing.cover_image_url}
                onChange={(e) =>
                  setEditing({ ...editing, cover_image_url: e.target.value })
                }
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm focus:outline-none focus:border-white/20"
              />
            </div>

            <div className="mb-6">
              <label className="block text-xs text-zinc-500 uppercase tracking-wide mb-1.5">
                Content (Markdown)
              </label>
              <textarea
                value={editing.content_markdown}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    content_markdown: e.target.value,
                  })
                }
                rows={20}
                className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-white/[0.08] text-white text-sm font-mono focus:outline-none focus:border-white/20 resize-y"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.is_published}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      is_published: e.target.checked,
                    })
                  }
                  className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 accent-white"
                />
                <span className="text-sm text-zinc-400">Publish</span>
              </label>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    setEditing(null);
                    setError(null);
                    setSuccess(null);
                  }}
                  className="px-4 py-2 text-sm text-zinc-500 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium bg-white text-black rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Pulse"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-white/[0.06] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06] bg-zinc-950/50">
                <th className="text-left text-xs text-zinc-500 uppercase tracking-wide px-4 py-3 font-medium">
                  #
                </th>
                <th className="text-left text-xs text-zinc-500 uppercase tracking-wide px-4 py-3 font-medium">
                  Title
                </th>
                <th className="text-left text-xs text-zinc-500 uppercase tracking-wide px-4 py-3 font-medium hidden md:table-cell">
                  Status
                </th>
                <th className="text-left text-xs text-zinc-500 uppercase tracking-wide px-4 py-3 font-medium hidden md:table-cell">
                  Published
                </th>
                <th className="text-right text-xs text-zinc-500 uppercase tracking-wide px-4 py-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pulses.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="text-center py-12 text-zinc-600 text-sm"
                  >
                    No pulses yet. Create your first one.
                  </td>
                </tr>
              ) : (
                pulses.map((pulse) => (
                  <tr
                    key={pulse.id}
                    className="border-b border-white/[0.04] hover:bg-zinc-950/40 transition-colors"
                  >
                    <td className="px-4 py-3 text-sm text-zinc-500 font-mono">
                      {String(pulse.pulse_number).padStart(3, "0")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-white">
                        {pulse.title}
                      </div>
                      <div className="text-xs text-zinc-600 mt-0.5">
                        /{pulse.slug}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {pulse.is_published ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                          Published
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium rounded-full bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
                          <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-zinc-500 hidden md:table-cell">
                      {formatDate(pulse.published_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {pulse.is_published && (
                          <Link
                            href={`/pulses/${pulse.slug}`}
                            target="_blank"
                            className="text-xs text-zinc-600 hover:text-white transition-colors"
                          >
                            View
                          </Link>
                        )}
                        <button
                          onClick={() => startEdit(pulse)}
                          className="text-xs text-zinc-500 hover:text-white transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(pulse.id)}
                          className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}

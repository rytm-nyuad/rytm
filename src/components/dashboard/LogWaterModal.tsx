"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/field";

interface LogWaterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (amountMl: number, source: string) => Promise<void>;
}

export function LogWaterModal({ isOpen, onClose, onSubmit }: LogWaterModalProps) {
  const [amountMl, setAmountMl] = useState(250);
  const [source, setSource] = useState("water");
  const [otherSource, setOtherSource] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (amountMl <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    if (source === "other" && !otherSource.trim()) {
      setError("Please specify what type of drink");
      return;
    }

    setSubmitting(true);
    try {
      const finalSource = source === "other" ? otherSource : source;
      await onSubmit(amountMl, finalSource);
      setAmountMl(250);
      setSource("water");
      setOtherSource("");
      onClose();
    } catch (err) {
      setError("Failed to log water");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="relative w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h3 className="text-2xl font-bold text-white mb-6">Log Water & Drinks</h3>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
              {error}
            </div>
          )}

          <Field>
            <FieldLabel>Source</FieldLabel>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-600"
              disabled={submitting}
            >
              <option value="water">Water</option>
              <option value="coffee">Coffee</option>
              <option value="tea">Tea</option>
              <option value="soda">Soda</option>
              <option value="energy_drink">Energy Drink</option>
              <option value="juice">Juice</option>
              <option value="other">Other</option>
            </select>
          </Field>

          {source === "other" && (
            <Field>
              <FieldLabel>Specify drink type</FieldLabel>
              <input
                type="text"
                value={otherSource}
                onChange={(e) => setOtherSource(e.target.value)}
                placeholder="e.g., Smoothie, Sports drink..."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-600"
                disabled={submitting}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>Amount (ml)</FieldLabel>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setAmountMl(Math.max(0, amountMl - 100))}
                className="flex flex-col items-center px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white hover:bg-zinc-700 transition-colors"
                disabled={submitting || amountMl <= 0}
              >
                <span className="text-xl font-bold">−</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">100ml</span>
              </button>
              <div className="flex-1 relative">
                <input
                  type="number"
                  value={amountMl}
                  onChange={(e) => setAmountMl(Math.max(0, parseInt(e.target.value) || 0))}
                  className="w-full text-center text-3xl font-bold text-white bg-transparent border-none focus:outline-none focus:ring-0"
                  disabled={submitting}
                />
                <span className="absolute right-1/4 top-1/2 -translate-y-1/2 text-sm text-zinc-500 pointer-events-none">ml</span>
              </div>
              <button
                type="button"
                onClick={() => setAmountMl(amountMl + 100)}
                className="flex flex-col items-center px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white hover:bg-zinc-700 transition-colors"
                disabled={submitting}
              >
                <span className="text-xl font-bold">+</span>
                <span className="text-[10px] text-zinc-500 mt-0.5">100ml</span>
              </button>
            </div>
          </Field>

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting} className="flex-1">
              {submitting ? "Logging..." : "Log Drinks"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

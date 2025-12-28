"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/field";

interface DailyCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    mood: number,
    stress: number,
    energy: number,
    focus: number,
    workload: number,
    sleepRestfulness: number,
    socialConnectedness: number,
    emotions: string[]
  ) => Promise<void>;
}

const emotionOptions = [
  "Happy",
  "Sad",
  "Anxious",
  "Calm",
  "Energetic",
  "Tired",
  "Frustrated",
  "Motivated",
  "Overwhelmed",
  "Content",
];

export function DailyCheckInModal({ isOpen, onClose, onSubmit }: DailyCheckInModalProps) {
  const [mood, setMood] = useState(3);
  const [stress, setStress] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [focus, setFocus] = useState(3);
  const [workload, setWorkload] = useState(3);
  const [sleepRestfulness, setSleepRestfulness] = useState(3);
  const [socialConnectedness, setSocialConnectedness] = useState(3);
  const [emotions, setEmotions] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const toggleEmotion = (emotion: string) => {
    setEmotions((prev) =>
      prev.includes(emotion)
        ? prev.filter((e) => e !== emotion)
        : [...prev, emotion]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (emotions.length === 0) {
      setError("Please select at least one emotion");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit(
        mood,
        stress,
        energy,
        focus,
        workload,
        sleepRestfulness,
        socialConnectedness,
        emotions
      );
      onClose();
    } catch (err) {
      setError("Failed to submit check-in");
    } finally {
      setSubmitting(false);
    }
  };

  const SliderField = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: number;
    onChange: (value: number) => void;
  }) => (
    <Field>
      <div className="flex justify-between mb-2">
        <FieldLabel>{label}</FieldLabel>
        <span className="text-white font-medium">{value}</span>
      </div>
      <div className="relative">
        <div className="h-2 bg-zinc-800 rounded-full">
          <div
            className="h-full bg-white rounded-full transition-all duration-200"
            style={{ width: `${(value / 5) * 100}%` }}
          />
        </div>
        <input
          type="range"
          min="1"
          max="5"
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer"
          disabled={submitting}
        />
      </div>
    </Field>
  );

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-6 my-8">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h3 className="text-2xl font-bold text-white mb-6">Daily Check-In</h3>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-6">
            <SliderField label="Mood" value={mood} onChange={setMood} />
            <SliderField label="Stress" value={stress} onChange={setStress} />
            <SliderField label="Energy" value={energy} onChange={setEnergy} />
            <SliderField label="Focus" value={focus} onChange={setFocus} />
            <SliderField label="Workload" value={workload} onChange={setWorkload} />
            <SliderField
              label="Sleep Restfulness"
              value={sleepRestfulness}
              onChange={setSleepRestfulness}
            />
            <SliderField
              label="Social Connectedness"
              value={socialConnectedness}
              onChange={setSocialConnectedness}
            />
          </div>

          {/* Emotions */}
          <Field>
            <FieldLabel>How are you feeling? (Select all that apply)</FieldLabel>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {emotionOptions.map((emotion) => (
                <button
                  key={emotion}
                  type="button"
                  onClick={() => toggleEmotion(emotion)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    emotions.includes(emotion)
                      ? "bg-white text-black"
                      : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                  }`}
                  disabled={submitting}
                >
                  {emotion}
                </button>
              ))}
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
              {submitting ? "Submitting..." : "Submit Check-In"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

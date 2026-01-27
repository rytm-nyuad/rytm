"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/field";

interface DailyCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: {
    sleepQuality: number;
    energy: number;
    focus: number;
    workload: number;
    copingCapacity: number;
    stress: number;
    stressUnexpected: number;
    social: number;
    mood: number;
    moodStability: number;
    emotions: string[];
  }) => Promise<void>;
}

const emotionOptions = [
  "Bored",
  "Sad",
  "Tired",
  "Tense",
  "Annoyed",
  "Frustrated",
  "Content",
  "Relaxed",
  "Happy",
  "Excited",
  "Alert",
];

export function DailyCheckInModal({ isOpen, onClose, onSubmit }: DailyCheckInModalProps) {
  // VAS scores (0-100) - start at 50 but track if touched
  const [sleepQuality, setSleepQuality] = useState(50);
  const [energy, setEnergy] = useState(50);
  const [focus, setFocus] = useState(50);
  const [workload, setWorkload] = useState(50);
  const [copingCapacity, setCopingCapacity] = useState(50);
  const [stress, setStress] = useState(50);
  const [stressUnexpected, setStressUnexpected] = useState(50);
  const [social, setSocial] = useState(50);
  const [mood, setMood] = useState(50);
  const [moodStability, setMoodStability] = useState(50);
  
  // Track which sliders have been touched
  const [touched, setTouched] = useState({
    sleepQuality: false,
    energy: false,
    focus: false,
    workload: false,
    copingCapacity: false,
    stress: false,
    stressUnexpected: false,
    social: false,
    mood: false,
    moodStability: false,
  });
  
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

    // Check if all sliders have been touched
    const allTouched = Object.values(touched).every(t => t);
    if (!allTouched) {
      setError("Please interact with all sliders before submitting");
      return;
    }

    if (emotions.length === 0) {
      setError("Please select at least one emotion");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        sleepQuality: Math.round(sleepQuality),
        energy: Math.round(energy),
        focus: Math.round(focus),
        workload: Math.round(workload),
        copingCapacity: Math.round(copingCapacity),
        stress: Math.round(stress),
        stressUnexpected: Math.round(stressUnexpected),
        social: Math.round(social),
        mood: Math.round(mood),
        moodStability: Math.round(moodStability),
        emotions,
      });
      onClose();
    } catch (err) {
      setError("Failed to submit check-in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="relative w-full max-w-7xl max-h-[90vh] dark:bg-zinc-900 light:bg-gradient-to-b light:from-cyan-700 light:via-cyan-600 light:to-cyan-800 dark:border dark:border-zinc-800 light:border-none rounded-xl shadow-2xl p-8 flex flex-col">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 dark:text-zinc-400 light:text-white dark:hover:text-white light:hover:text-white/80 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h3 className="text-2xl font-bold dark:text-white light:text-white mb-6">Daily Check-In</h3>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto pr-2 space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
              {error}
            </div>
          )}

          {/* VAS Questions - All Inline */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            {/* Sleep Quality */}
            <div>
              <FieldLabel className="text-sm mb-8">When you woke up, how rested did you feel?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.sleepQuality ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.sleepQuality ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${sleepQuality}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.sleepQuality ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${sleepQuality}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={sleepQuality} onChange={(e) => { setTouched(prev => ({ ...prev, sleepQuality: true })); setSleepQuality(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                <span>Not at all rested</span>
                <span>Fully rested</span>
              </div>
            </div>

            {/* Energy */}
            <div>
              <FieldLabel className="text-sm mb-8">How much energy did you feel you had today?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.energy ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.energy ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${energy}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.energy ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${energy}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={energy} onChange={(e) => { setTouched(prev => ({ ...prev, energy: true })); setEnergy(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>No energy at all</span>
                  <span>Very high energy</span>
              </div>
            </div>

            {/* Focus */}
            <div>
              <FieldLabel className="text-sm mb-8">Were you able to concentrate today when you needed to?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.focus ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.focus ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${focus}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.focus ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${focus}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={focus} onChange={(e) => { setTouched(prev => ({ ...prev, focus: true })); setFocus(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not able at all</span>
                  <span>Fully able to focus</span>
              </div>
            </div>

            {/* Workload */}
            <div>
              <FieldLabel className="text-sm mb-8">Overall, how demanding did today feel for you?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.workload ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.workload ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${workload}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.workload ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${workload}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={workload} onChange={(e) => { setTouched(prev => ({ ...prev, workload: true })); setWorkload(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not at all demanding</span>
                  <span>Extremely demanding</span>
              </div>
            </div>

            {/* Coping Capacity */}
            <div>
              <FieldLabel className="text-sm mb-8">To what extent did you feel able to handle the demands placed on you?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.copingCapacity ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.copingCapacity ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${copingCapacity}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.copingCapacity ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${copingCapacity}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={copingCapacity} onChange={(e) => { setTouched(prev => ({ ...prev, copingCapacity: true })); setCopingCapacity(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not at all</span>
                  <span>Completely</span>
              </div>
            </div>

            {/* Stress */}
            <div>
              <FieldLabel className="text-sm mb-8">Overall, how stressful did today feel for you?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.stress ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.stress ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${stress}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.stress ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${stress}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={stress} onChange={(e) => { setTouched(prev => ({ ...prev, stress: true })); setStress(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not at all stressful</span>
                  <span>Extremely stressful</span>
              </div>
            </div>

            {/* Stress Unexpected */}
            <div>
              <FieldLabel className="text-sm mb-8">To what extent did unexpected events contribute to your stress today?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.stressUnexpected ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.stressUnexpected ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${stressUnexpected}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.stressUnexpected ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${stressUnexpected}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={stressUnexpected} onChange={(e) => { setTouched(prev => ({ ...prev, stressUnexpected: true })); setStressUnexpected(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not at all</span>
                  <span>Very much</span>
              </div>
            </div>

            {/* Social */}
            <div>
              <FieldLabel className="text-sm mb-8">Did your social interactions today feel sufficient for you?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.social ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.social ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${social}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.social ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${social}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={social} onChange={(e) => { setTouched(prev => ({ ...prev, social: true })); setSocial(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Not at all sufficient</span>
                  <span>Completely sufficient</span>
              </div>
            </div>

            {/* Mood */}
            <div>
              <FieldLabel className="text-sm mb-8">Overall, how did today feel emotionally for you?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.mood ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.mood ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${mood}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.mood ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${mood}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={mood} onChange={(e) => { setTouched(prev => ({ ...prev, mood: true })); setMood(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Very negative</span>
                  <span>Very positive</span>
              </div>
            </div>

            {/* Mood Stability */}
            <div>
              <FieldLabel className="text-sm mb-8">How much did your emotional state change throughout the day?</FieldLabel>
              <div className="relative px-4 mt-4">
                <div className={`h-2 rounded-full mb-2 relative ${touched.moodStability ? 'dark:bg-zinc-800 light:bg-blue-400/40' : 'dark:bg-zinc-800/50 light:bg-blue-400/20'}`}>
                  <div className={`h-full rounded-full ${touched.moodStability ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-700 light:bg-white/50'}`} style={{ width: `${moodStability}%` }} />
                  <div className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full shadow-lg ${touched.moodStability ? 'dark:bg-white light:bg-white' : 'dark:bg-zinc-600 light:bg-white/60'}`} style={{ left: `${moodStability}%`, transform: `translate(-50%, -50%)` }} />
                </div>
                <input type="range" min="0" max="100" step="any" value={moodStability} onChange={(e) => { setTouched(prev => ({ ...prev, moodStability: true })); setMoodStability(parseFloat(e.target.value)); }} className="absolute inset-0 w-full opacity-0 cursor-pointer" disabled={submitting} style={{ top: 0, left: 0, right: 0 }} />
              </div>
              <div className="flex justify-between text-xs text-white px-4 mt-1">
                  <span>Very stable</span>
                  <span>Changed a lot</span>
              </div>
            </div>
          </div>

          {/* Emotions - Full Width Below Grid */}
          <div className="pt-2">
            <FieldLabel className="mb-3">Which of the following emotions did you feel at any point today?</FieldLabel>
            <p className="text-xs dark:text-zinc-400 light:text-white/80 mb-3">Select all that apply</p>
            <div className="grid grid-cols-6 gap-2">
              {emotionOptions.map((emotion) => (
                <button
                  key={emotion}
                  type="button"
                  onClick={() => toggleEmotion(emotion)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    emotions.includes(emotion)
                      ? "dark:bg-white dark:text-black light:bg-white light:text-blue-600"
                      : "dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-white light:bg-blue-400/30 light:text-white light:hover:bg-blue-400/40"
                  }`}
                  disabled={submitting}
                >
                  {emotion}
                </button>
              ))}
            </div>
          </div>
          </div>

          <div className="flex gap-3 pt-4 mt-4 border-t dark:border-zinc-800 light:border-white/20">
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

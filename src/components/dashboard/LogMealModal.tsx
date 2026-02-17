"use client";

import { useState, useRef, useEffect } from "react";
import { X, Upload, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/Button";
import { Field, FieldLabel } from "@/components/ui/field";

// Interface for a single meal draft
interface MealDraft {
  mealType: string;
  otherMealType: string;
  mealTime: string; // HH:MM format (24h)
  description: string;
  selectedFile: File | null;
  previewUrl: string | null;
}

interface LogMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (mealType: string, description?: string, photoUrl?: string, mealTime?: string) => Promise<void>;
  userId: string;
}

export function LogMealModal({ isOpen, onClose, onSubmit, userId }: LogMealModalProps) {
  // SINGLE SOURCE OF TRUTH: mealDrafts array
  const [mealDrafts, setMealDrafts] = useState<MealDraft[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  
  const formContainerRef = useRef<HTMLDivElement>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // Helper: Create empty draft
  const createEmptyDraft = (): MealDraft => ({
    mealType: "breakfast",
    otherMealType: "",
    mealTime: "",
    description: "",
    selectedFile: null,
    previewUrl: null,
  });

  // Helper: Update specific draft
  const updateDraft = (index: number, patch: Partial<MealDraft>) => {
    setMealDrafts(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  // Helper: Update current draft
  const updateCurrentDraft = (patch: Partial<MealDraft>) => {
    updateDraft(currentIndex, patch);
  };

  // Helper: Revoke object URL if it's a blob URL
  const revokeObjectUrl = (url: string | null) => {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  };

  // Helper: Cleanup all object URLs
  const cleanupAllUrls = () => {
    mealDrafts.forEach(draft => revokeObjectUrl(draft.previewUrl));
  };

  // Initialize with one empty draft when modal opens
  useEffect(() => {
    if (isOpen && mealDrafts.length === 0) {
      setMealDrafts([createEmptyDraft()]);
      setCurrentIndex(0);
    }
  }, [isOpen, mealDrafts.length]);

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setMealDrafts(prev => {
        // Cleanup all object URLs
        prev.forEach(draft => {
          if (draft.previewUrl && draft.previewUrl.startsWith('blob:')) {
            URL.revokeObjectURL(draft.previewUrl);
          }
        });
        return [];
      });
      setCurrentIndex(0);
      setError(null);
    }
  }, [isOpen]);

  // Reset animation state after transition
  useEffect(() => {
    if (slideDirection) {
      const timer = setTimeout(() => setSlideDirection(null), 300);
      return () => clearTimeout(timer);
    }
  }, [slideDirection]);

  if (!isOpen) return null;

  // Validate time format (HH:MM)
  const validateTime = (time: string): boolean => {
    if (!time) return true; // Optional
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return timeRegex.test(time);
  };

  // Validate a specific draft
  const validateDraft = (draft: MealDraft): boolean => {
    // Drink entries are valid with just the type (no description/image required)
    if (draft.mealType !== "drink" && !draft.description.trim() && !draft.selectedFile) {
      setError("Please provide a description or upload an image");
      return false;
    }

    if (draft.mealType === "other" && !draft.otherMealType.trim()) {
      setError("Please specify the meal type");
      return false;
    }

    if (draft.mealTime && !validateTime(draft.mealTime)) {
      setError("Please enter a valid time in HH:MM format");
      return false;
    }

    setError(null);
    return true;
  };

  // Validate current draft
  const validateCurrent = (): boolean => {
    if (currentIndex >= mealDrafts.length) return false;
    return validateDraft(mealDrafts[currentIndex]);
  };

  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    // Revoke previous URL if it exists
    const currentDraft = mealDrafts[currentIndex];
    revokeObjectUrl(currentDraft.previewUrl);

    // Create new preview URL
    const newPreviewUrl = URL.createObjectURL(file);
    
    updateCurrentDraft({
      selectedFile: file,
      previewUrl: newPreviewUrl,
    });
    
    setError(null);
  };

  // Handle remove image
  const handleRemoveImage = () => {
    const currentDraft = mealDrafts[currentIndex];
    revokeObjectUrl(currentDraft.previewUrl);
    
    updateCurrentDraft({
      selectedFile: null,
      previewUrl: null,
    });
  };

  // Handle adding another meal
  const handleAddAnother = () => {
    // Validate current draft first
    if (!validateCurrent()) {
      return; // Do NOT advance if invalid
    }

    // Add new empty draft
    setMealDrafts(prev => [...prev, createEmptyDraft()]);
    
    // Navigate to new draft with animation
    setSlideDirection('left');
    setCurrentIndex(prev => prev + 1);
  };

  // Navigate to specific step
  const navigateToStep = (index: number) => {
    if (index === currentIndex) return;
    if (index < 0 || index >= mealDrafts.length) return;

    // If navigating forward, validate current step first
    if (index > currentIndex && !validateCurrent()) {
      return; // Block navigation if current step invalid
    }

    // Determine slide direction
    setSlideDirection(index > currentIndex ? 'left' : 'right');
    setCurrentIndex(index);
  };

  // Remove current meal entry
  const handleRemoveMeal = () => {
    // Only allow delete if more than 1 meal
    if (mealDrafts.length <= 1) {
      return;
    }

    // Revoke the preview URL of the draft being removed
    revokeObjectUrl(mealDrafts[currentIndex].previewUrl);
    
    // Remove current draft
    const newDrafts = [...mealDrafts];
    newDrafts.splice(currentIndex, 1);
    setMealDrafts(newDrafts);
    
    // Adjust current index (go to previous, or stay at 0)
    const newIndex = Math.min(currentIndex, newDrafts.length - 1);
    setCurrentIndex(Math.max(0, newIndex));
    
    setError(null);
  };

  // Upload image to storage
  const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    const { error } = await supabase.storage
      .from('meal-photos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Upload error:', error);
      throw new Error('Failed to upload image');
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('meal-photos')
      .getPublicUrl(fileName);

    return publicUrl;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate current draft
    if (!validateCurrent()) {
      return;
    }

    // Optional: Validate ALL drafts before submitting
    for (let i = 0; i < mealDrafts.length; i++) {
      if (!validateDraft(mealDrafts[i])) {
        // Jump to first invalid draft
        setCurrentIndex(i);
        return;
      }
    }

    setSubmitting(true);
    setUploading(true);
    
    try {
      // Process all meal drafts
      for (const draft of mealDrafts) {
        let photoUrl: string | undefined;

        // Upload image if selected
        if (draft.selectedFile) {
          photoUrl = await uploadImage(draft.selectedFile);
        }

        // Map 'other' to 'Snack' for backend, prepend custom meal type to description
        const finalMealType = draft.mealType === "other" ? "snack" : draft.mealType;
        const finalDescription = draft.mealType === "other" 
          ? `${draft.otherMealType}: ${draft.description}`.trim()
          : draft.description;
        
        await onSubmit(
          finalMealType,
          finalDescription || undefined,
          photoUrl,
          draft.mealTime || undefined
        );
      }
      
      // Cleanup and close
      cleanupAllUrls();
      setMealDrafts([]);
      setCurrentIndex(0);
      onClose();
    } catch (err) {
      console.error('Submit error:', err);
      setError(err instanceof Error ? err.message : "Failed to log meals");
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  // Handle modal close
  const handleClose = () => {
    cleanupAllUrls();
    setMealDrafts([]);
    setCurrentIndex(0);
    setError(null);
    onClose();
  };

  // Derived values
  const totalSteps = mealDrafts.length;
  const hasMultipleMeals = totalSteps > 1;
  const currentDraft = mealDrafts[currentIndex] || createEmptyDraft();

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
      <div className="relative w-full max-w-lg max-h-[85dvh] sm:max-h-none overflow-y-auto sm:overflow-visible dark:bg-zinc-900 light:bg-gradient-to-b light:from-cyan-700 light:via-cyan-600 light:to-cyan-800 dark:border dark:border-zinc-800 light:border-none rounded-xl shadow-2xl p-4 sm:p-6 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-6">
        {/* Top Right Buttons */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          {/* Delete Meal Button - Only show if more than 1 meal */}
          {hasMultipleMeals && (
            <button
              type="button"
              onClick={handleRemoveMeal}
              disabled={submitting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg dark:bg-red-900/50 light:bg-red-500/30 dark:text-red-400 light:text-white dark:hover:bg-red-900/70 light:hover:bg-red-500/50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Remove this meal"
            >
              <Trash2 className="w-4 h-4" />
              <span className="text-sm font-medium">Remove</span>
            </button>
          )}
          
          {/* Close Button */}
          <button
            onClick={handleClose}
            className="p-1.5 dark:text-zinc-400 light:text-white dark:hover:text-white light:hover:text-white/80 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Navigator - Top Center */}
        {hasMultipleMeals && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigateToStep(currentIndex - 1)}
              disabled={currentIndex === 0 || submitting}
              className="p-1.5 rounded-lg dark:bg-zinc-800 light:bg-blue-400/30 dark:text-zinc-400 light:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:dark:bg-zinc-700 hover:enabled:light:bg-blue-400/50 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium dark:text-zinc-400 light:text-white/90">
              {currentIndex + 1} / {totalSteps}
            </span>
            <button
              type="button"
              onClick={() => navigateToStep(currentIndex + 1)}
              disabled={currentIndex >= totalSteps - 1 || submitting}
              className="p-1.5 rounded-lg dark:bg-zinc-800 light:bg-blue-400/30 dark:text-zinc-400 light:text-white disabled:opacity-30 disabled:cursor-not-allowed hover:enabled:dark:bg-zinc-700 hover:enabled:light:bg-blue-400/50 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Header */}
        <h3 className="text-2xl font-bold dark:text-white light:text-white mb-6">
          {hasMultipleMeals ? `Meal ${currentIndex + 1}` : 'Log Meal'}
        </h3>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
              {error}
            </div>
          )}

          {/* Form container with slide animation */}
          <div
            ref={formContainerRef}
            className={`space-y-6 transition-all duration-300 ease-in-out ${
              slideDirection === 'left'
                ? 'animate-slide-left'
                : slideDirection === 'right'
                ? 'animate-slide-right'
                : ''
            }`}
          >
            {/* Meal Type & Time - Side by side on larger screens */}
            <div className="flex flex-col sm:flex-row gap-4">
              <Field className="flex-1">
                <FieldLabel>Meal Type</FieldLabel>
                <select
                  value={currentDraft.mealType}
                  onChange={(e) => updateCurrentDraft({ mealType: e.target.value })}
                  className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-blue-400/30 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50"
                  disabled={submitting}
                >
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                  <option value="snack">Snack</option>
                  <option value="drink">Drink</option>
                  <option value="other">Other</option>
                </select>
              </Field>

              <Field className="flex-1">
                <FieldLabel>Time of Meal (optional)</FieldLabel>
                <input
                  type="time"
                  step="60"
                  value={currentDraft.mealTime}
                  onChange={(e) => updateCurrentDraft({ mealTime: e.target.value })}
                  placeholder="HH:MM"
                  className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-blue-400/30 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white dark:[color-scheme:dark] light:[color-scheme:light] focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50 transition-colors"
                  style={{
                    colorScheme: 'dark'
                  }}
                  disabled={submitting}
                />
              </Field>
            </div>

            {currentDraft.mealType === "other" && (
              <Field>
                <FieldLabel>Specify meal type</FieldLabel>
                <input
                  type="text"
                  value={currentDraft.otherMealType}
                  onChange={(e) => updateCurrentDraft({ otherMealType: e.target.value })}
                  placeholder="e.g., Brunch, Dessert..."
                  className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-blue-400/30 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white dark:placeholder-zinc-500 light:placeholder-white/60 focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50"
                  disabled={submitting}
                />
              </Field>
            )}

            <Field>
              <FieldLabel>{currentDraft.mealType === "drink" ? "Description (optional)" : "Description (optional if image provided)"}</FieldLabel>
              <textarea
                value={currentDraft.description}
                onChange={(e) => updateCurrentDraft({ description: e.target.value })}
                placeholder={currentDraft.mealType === "drink" ? "e.g., Water, Coffee, Protein Shake..." : "What did you eat?"}
                rows={4}
                className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-blue-400/30 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white dark:placeholder-zinc-500 light:placeholder-white/60 focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50 resize-none"
                disabled={submitting}
              />
            </Field>

            <Field>
              <FieldLabel>Photo (optional)</FieldLabel>
              {currentDraft.previewUrl ? (
                <div className="relative">
                  <img
                    src={currentDraft.previewUrl}
                    alt="Meal preview"
                    className="w-full h-48 object-cover rounded-lg border border-zinc-700"
                  />
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="absolute top-2 right-2 p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                    disabled={submitting}
                  >
                    <Trash2 className="w-4 h-4 text-white" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed dark:border-zinc-700 light:border-white/40 rounded-lg cursor-pointer dark:hover:border-zinc-600 light:hover:border-white/60 transition-colors">
                  <Upload className="w-8 h-8 dark:text-zinc-500 light:text-white/70 mb-2" />
                  <span className="text-sm dark:text-zinc-500 light:text-white/90">Click to upload image</span>
                  <span className="text-xs dark:text-zinc-600 light:text-white/70 mt-1">Max 5MB • JPG, PNG, GIF</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                    disabled={submitting}
                  />
                </label>
              )}
            </Field>
          </div>

          {/* Footer Buttons */}
          <div className="space-y-3">
            {/* Add Another Meal Button */}
            <Button
              type="button"
              variant="outline"
              onClick={handleAddAnother}
              disabled={submitting}
              className="w-full dark:bg-zinc-800 light:bg-blue-400/30 dark:border-zinc-700 light:border-white/30 dark:text-white light:text-white dark:hover:bg-zinc-700 light:hover:bg-blue-400/50"
            >
              + Add another meal
            </Button>

            {/* Cancel & Submit Buttons */}
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={submitting}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button type="submit" disabled={submitting} className="flex-1">
                {uploading
                  ? "Uploading..."
                  : submitting
                  ? "Logging..."
                  : hasMultipleMeals
                  ? `Log ${totalSteps} meal${totalSteps > 1 ? 's' : ''}`
                  : "Log meal"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

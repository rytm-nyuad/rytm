"use client";

import { useState } from "react";
import { X, Upload, Trash2 } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";

interface LogMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (mealType: string, description?: string, photoUrl?: string) => Promise<void>;
  userId: string;
}

export function LogMealModal({ isOpen, onClose, onSubmit, userId }: LogMealModalProps) {
  const [mealType, setMealType] = useState<string>("breakfast");
  const [otherMealType, setOtherMealType] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  if (!isOpen) return null;

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

    setSelectedFile(file);
    setError(null);

    // Create preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
  };

  const handleRemoveImage = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedFile(null);
    setPreviewUrl(null);
  };

  const uploadImage = async (file: File): Promise<string> => {
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    const { data, error } = await supabase.storage
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!description.trim() && !selectedFile) {
      setError("Please provide a description or upload an image");
      return;
    }

    if (mealType === "other" && !otherMealType.trim()) {
      setError("Please specify the meal type");
      return;
    }

    setSubmitting(true);
    try {
      let photoUrl: string | undefined;

      // Upload image if selected
      if (selectedFile) {
        setUploading(true);
        photoUrl = await uploadImage(selectedFile);
        setUploading(false);
      }

      const finalMealType = mealType === "other" ? otherMealType : mealType;
      await onSubmit(finalMealType, description || undefined, photoUrl);
      
      // Reset form
      setDescription("");
      setMealType("breakfast");
      setOtherMealType("");
      handleRemoveImage();
      onClose();
    } catch (err) {
      console.error('Submit error:', err);
      setError(err instanceof Error ? err.message : "Failed to log meal");
    } finally {
      setSubmitting(false);
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="relative w-full max-w-lg dark:bg-zinc-900 light:bg-gradient-to-br light:from-blue-600 light:to-blue-700 dark:border dark:border-zinc-800 light:border-none rounded-xl shadow-2xl p-6">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 dark:text-zinc-400 light:text-white/90 dark:hover:text-white light:hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <h3 className="text-2xl font-bold dark:text-white light:text-white mb-6">Log Meal</h3>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 text-red-500 text-sm">
              {error}
            </div>
          )}

          <Field>
            <FieldLabel>Meal Type</FieldLabel>
            <select
              value={mealType}
              onChange={(e) => setMealType(e.target.value)}
              className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-white/20 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50"
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

          {mealType === "other" && (
            <Field>
              <FieldLabel>Specify meal type</FieldLabel>
              <input
                type="text"
                value={otherMealType}
                onChange={(e) => setOtherMealType(e.target.value)}
                placeholder="e.g., Brunch, Dessert..."
                className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-white/20 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white dark:placeholder-zinc-500 light:placeholder-white/70 focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50"
                disabled={submitting}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>Description (optional if image provided)</FieldLabel>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What did you eat?"
              rows={4}
              className="w-full px-3 py-2 dark:bg-zinc-800 light:bg-white/20 dark:border-zinc-700 light:border-white/30 border rounded-lg dark:text-white light:text-white dark:placeholder-zinc-500 light:placeholder-white/70 focus:outline-none focus:ring-2 dark:focus:ring-purple-600 light:focus:ring-white/50 resize-none"
              disabled={submitting}
            />
          </Field>

          <Field>
            <FieldLabel>Photo (optional)</FieldLabel>
            {previewUrl ? (
              <div className="relative">
                <img
                  src={previewUrl}
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
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-700 rounded-lg cursor-pointer hover:border-zinc-600 transition-colors">
                <Upload className="w-8 h-8 text-zinc-500 mb-2" />
                <span className="text-sm text-zinc-500">Click to upload image</span>
                <span className="text-xs text-zinc-600 mt-1">Max 5MB • JPG, PNG, GIF</span>
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

          <div className="flex gap-3">
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
              {uploading ? "Uploading..." : submitting ? "Logging..." : "Log Meal"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

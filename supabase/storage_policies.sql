-- Storage Policies for meal-photos bucket
-- Run these in Supabase SQL Editor

-- Allow authenticated users to upload their own meal photos
CREATE POLICY "Users can upload meal photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'meal-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to view meal photos
CREATE POLICY "Users can view meal photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'meal-photos');

-- Allow users to delete their own photos
CREATE POLICY "Users can delete own meal photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'meal-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow users to update their own photos (optional)
CREATE POLICY "Users can update own meal photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'meal-photos' 
  AND (storage.foldername(name))[1] = auth.uid()::text
);

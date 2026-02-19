-- Storage Policies for pulses bucket
-- Run these in Supabase SQL Editor

-- Allow public read access to pulse cover images
CREATE POLICY "Public can view pulse images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'pulses');

-- Allow authenticated admins to upload pulse images
CREATE POLICY "Admins can upload pulse images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'pulses');

-- Allow authenticated admins to delete pulse images
CREATE POLICY "Admins can delete pulse images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'pulses');

-- Allow authenticated admins to update pulse images
CREATE POLICY "Admins can update pulse images"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'pulses');

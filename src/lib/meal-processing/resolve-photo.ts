// ============================================================
// RYTM v1 – Resolve Meal Photo for Vision
// ============================================================
// Generates a temporary signed URL from Supabase Storage so the
// OpenAI extraction model can fetch the meal image.
//
// The signed URL is ephemeral (default 1 hour) and must NEVER
// be stored in the database or returned to the client.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_EXPIRES_SECONDS = 3600; // 1 hour

// ---- Public API ----

export interface ResolvePhotoParams {
  supabaseAdmin: SupabaseClient;
  bucket: string;            // e.g. "meal-photos"
  photoUrl: string | null;
  userId: string;
  expiresInSeconds?: number;
}

export interface ResolvePhotoResult {
  signedUrl: string | null;
  pathTried: string | null;
  reason?: string;
}

/**
 * Resolves a temporary signed URL for the meal photo so it can
 * be sent to OpenAI's vision input.
 *
 * Returns { signedUrl: null } if photo_url is empty or signing fails.
 */
export async function resolveMealPhotoForVision(
  params: ResolvePhotoParams,
): Promise<ResolvePhotoResult> {
  const { supabaseAdmin, bucket, photoUrl, userId, expiresInSeconds } = params;

  if (!photoUrl || !photoUrl.trim()) {
    return { signedUrl: null, pathTried: null, reason: 'No photo URL provided' };
  }

  // Derive the storage object path from the URL
  const path = extractStoragePath(photoUrl, bucket, userId);

  if (!path) {
    return {
      signedUrl: null,
      pathTried: photoUrl,
      reason: `Could not derive storage path from: ${photoUrl}`,
    };
  }

  // Generate signed URL
  try {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS);

    if (error || !data?.signedUrl) {
      return {
        signedUrl: null,
        pathTried: path,
        reason: `Signing failed: ${error?.message ?? 'no signed URL returned'}`,
      };
    }

    return { signedUrl: data.signedUrl, pathTried: path };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { signedUrl: null, pathTried: path, reason: `Signing error: ${message}` };
  }
}

// ---- Path extraction helper ----

/**
 * Derives the Supabase Storage object path from various photo_url formats:
 *
 *  A) Raw path:          "USER_UUID/filename.jpg"
 *  B) Full storage URL:  "https://xxx.supabase.co/storage/v1/object/public/meal-photos/USER_UUID/file.jpg"
 *                        "https://xxx.supabase.co/storage/v1/object/sign/meal-photos/USER_UUID/file.jpg?..."
 *                        "https://xxx.supabase.co/storage/v1/object/meal-photos/USER_UUID/file.jpg"
 *  C) Relative path:     "/storage/v1/object/public/meal-photos/USER_UUID/file.jpg"
 */
export function extractStoragePath(
  photoUrl: string,
  bucket: string,
  _userId: string,
): string | null {
  const trimmed = photoUrl.trim();
  if (!trimmed) return null;

  // ── Case B/C: URL contains "storage/v1/object" ──
  if (trimmed.includes('storage/v1/object')) {
    // We need everything AFTER "<bucket>/" in the path.
    // Possible patterns after /object/:
    //   /object/public/<bucket>/<path>
    //   /object/sign/<bucket>/<path>?token=...
    //   /object/<bucket>/<path>

    // Parse as URL to get just the pathname (strip query params)
    let pathname: string;
    try {
      const url = new URL(trimmed, 'https://placeholder.local');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      pathname = decodeURIComponent(trimmed.split('?')[0]);
    }

    // Build regex to match: /storage/v1/object/(public|sign|authenticated)?/<bucket>/<PATH>
    // The bucket name might appear after public/, sign/, or directly after object/
    const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(
      `storage/v1/object/(?:public/|sign/|authenticated/)?${escapedBucket}/(.+)`,
    );
    const match = pathname.match(regex);

    if (match?.[1]) {
      return normalizePath(match[1]);
    }

    // Fallback: try to find bucket name anywhere in path and grab what follows
    const bucketIdx = pathname.indexOf(`${bucket}/`);
    if (bucketIdx !== -1) {
      const after = pathname.substring(bucketIdx + bucket.length + 1);
      if (after) return normalizePath(after);
    }

    return null;
  }

  // ── Case A: Raw path (no "storage/v1/object") ──
  return normalizePath(trimmed);
}

/** Remove leading slashes, decode URI components, collapse double slashes */
function normalizePath(p: string): string {
  let cleaned = p.replace(/^\/+/, '').replace(/\/+/g, '/');
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch {
    // already decoded or invalid encoding — keep as-is
  }
  return cleaned || null as unknown as string;
}

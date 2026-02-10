/**
 * WHOOP Token Refresh Helper
 * 
 * Handles token refresh for WHOOP OAuth integration.
 * Uses DB lock pattern to prevent concurrent refresh attempts.
 */

import { SupabaseClient } from "@supabase/supabase-js";

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const REFRESH_BUFFER_MS = 2 * 60 * 1000; // 2 minutes
const LOCK_TTL_MS = 30 * 1000; // 30 seconds lock

interface WhoopCredentials {
  app_user_id: string;
  whoop_user_id: number;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  scope: string;
  status: string;
  refresh_in_progress_until: string | null;
}

interface RefreshResult {
  success: boolean;
  access_token?: string;
  expires_at?: string;
  error?: string;
}

/**
 * Check if tokens need refresh (expires within 2 minutes)
 */
export function needsRefresh(expiresAt: string): boolean {
  const expiresAtMs = new Date(expiresAt).getTime();
  const now = Date.now();
  return now >= expiresAtMs - REFRESH_BUFFER_MS;
}

/**
 * Refresh WHOOP access token using refresh token
 * 
 * @param userId - App user ID
 * @param supabase - Supabase client with service role
 * @returns RefreshResult with new tokens or error
 */
export async function refreshWhoopToken(
  userId: string,
  supabase: SupabaseClient
): Promise<RefreshResult> {
  const CLIENT_ID = process.env.WHOOP_CLIENT_ID!;
  const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET!;

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("[WHOOP] Missing WHOOP_CLIENT_ID or WHOOP_CLIENT_SECRET");
    return { success: false, error: "Missing OAuth credentials" };
  }

  try {
    // 1) Fetch current credentials
    const { data: creds, error: fetchError } = await supabase
      .from("whoop_credentials")
      .select("*")
      .eq("app_user_id", userId)
      .maybeSingle();

    if (fetchError || !creds) {
      console.error("[WHOOP] No credentials found for user:", userId, fetchError);
      return { success: false, error: "No credentials found" };
    }

    const credentials = creds as WhoopCredentials;

    // 2) Check if already being refreshed (lock check)
    if (credentials.refresh_in_progress_until) {
      const lockExpiresAt = new Date(credentials.refresh_in_progress_until).getTime();
      if (Date.now() < lockExpiresAt) {
        console.log("[WHOOP] Refresh already in progress for user:", userId);
        return { success: false, error: "Refresh in progress" };
      }
    }

    // 3) Check if refresh token exists
    if (!credentials.refresh_token) {
      console.error("[WHOOP] No refresh token available for user:", userId);
      await supabase
        .from("whoop_credentials")
        .update({
          status: "needs_reauth",
          last_refresh_error: "No refresh token available",
          updated_at: new Date().toISOString(),
        } as any)
        .eq("app_user_id", userId);
      return { success: false, error: "No refresh token" };
    }

    // 4) Acquire lock
    const lockUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();
    const { error: lockError } = await supabase
      .from("whoop_credentials")
      .update({ refresh_in_progress_until: lockUntil } as any)
      .eq("app_user_id", userId);

    if (lockError) {
      console.error("[WHOOP] Failed to acquire lock:", lockError);
      return { success: false, error: "Lock acquisition failed" };
    }

    // 5) Call WHOOP token refresh endpoint
    // WHOOP requires client_secret_post authentication method
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refresh_token,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    });

    const tokenRes = await fetch(WHOOP_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    const tokenJson = await tokenRes.json();

    if (!tokenRes.ok) {
      console.error("[WHOOP] Token refresh failed:", tokenJson);
      
      // Update DB with error and release lock
      await supabase
        .from("whoop_credentials")
        .update({
          status: "needs_reauth",
          last_refresh_error: JSON.stringify(tokenJson),
          refresh_in_progress_until: null,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("app_user_id", userId);

      return { success: false, error: "Token refresh failed" };
    }

    // 6) Extract new tokens
    const newAccessToken: string = tokenJson.access_token;
    const newRefreshToken: string | undefined = tokenJson.refresh_token;
    const expiresIn: number = tokenJson.expires_in;
    const newExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

    console.log("[WHOOP] Token refreshed successfully for user:", userId);

    // 7) Update DB with new tokens and release lock
    const updatePayload: any = {
      access_token: newAccessToken,
      expires_at: newExpiresAt,
      status: "active",
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: null,
      refresh_in_progress_until: null,
      updated_at: new Date().toISOString(),
    };

    // Only update refresh_token if a new one was provided
    if (newRefreshToken) {
      updatePayload.refresh_token = newRefreshToken;
    }

    const { error: updateError } = await supabase
      .from("whoop_credentials")
      .update(updatePayload as any)
      .eq("app_user_id", userId);

    if (updateError) {
      console.error("[WHOOP] Failed to save refreshed tokens:", updateError);
      return { success: false, error: "Failed to save tokens" };
    }

    return {
      success: true,
      access_token: newAccessToken,
      expires_at: newExpiresAt,
    };
  } catch (error) {
    console.error("[WHOOP] Exception during token refresh:", error);
    
    // Release lock on exception
    await supabase
      .from("whoop_credentials")
      .update({
        refresh_in_progress_until: null,
        last_refresh_error: String(error),
        updated_at: new Date().toISOString(),
      } as any)
      .eq("app_user_id", userId);

    return { success: false, error: String(error) };
  }
}

/**
 * Get valid WHOOP access token for a user (refresh if needed)
 * 
 * @param userId - App user ID
 * @param supabase - Supabase client with service role
 * @returns Valid access token or null
 */
export async function getValidWhoopToken(
  userId: string,
  supabase: SupabaseClient
): Promise<string | null> {
  // Fetch credentials
  const { data: creds, error: fetchError } = await supabase
    .from("whoop_credentials")
    .select("access_token, expires_at, status")
    .eq("app_user_id", userId)
    .maybeSingle();

  if (fetchError || !creds) {
    console.error("[WHOOP] No credentials found for user:", userId);
    return null;
  }

  // Check if needs refresh
  if (needsRefresh(creds.expires_at as string)) {
    console.log("[WHOOP] Token expired or expiring soon, refreshing...");
    const refreshResult = await refreshWhoopToken(userId, supabase);
    
    if (refreshResult.success && refreshResult.access_token) {
      return refreshResult.access_token;
    } else {
      console.error("[WHOOP] Failed to refresh token:", refreshResult.error);
      return null;
    }
  }

  return creds.access_token as string;
}

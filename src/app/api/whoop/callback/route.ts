import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const WHOOP_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const WHOOP_PROFILE_URL = "https://api.prod.whoop.com/developer/v2/user/profile/basic";

export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.WHOOP_CLIENT_ID!;
  const CLIENT_SECRET = process.env.WHOOP_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI!;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.error("[WHOOP] Missing WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET / WHOOP_REDIRECT_URI env vars.");
    return NextResponse.json(
      { error: "WHOOP OAuth not configured" },
      { status: 500 }
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // If WHOOP sent an OAuth error (user declined, etc.)
  if (error) {
    console.error("[WHOOP] OAuth error:", error);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=" + encodeURIComponent(error),
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    console.error("[WHOOP] Missing code or state in callback");
    const redirectUrl = new URL(
      "/dashboard?whoop_error=missing_code_or_state",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();

  // 1) Get current authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[WHOOP] No authenticated user in callback");
    const redirectUrl = new URL(
      "/sign-in?whoop_error=not_authenticated",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // 2) Validate state (anti-CSRF)
  const { data: oauthRow, error: oauthError } = await supabase
    .from("whoop_oauth_state")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (oauthError || !oauthRow) {
    console.error("[WHOOP] Invalid or unknown state", oauthError);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=invalid_state",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // Extra safety: ensure callback user matches the user who started the flow
  if (oauthRow.app_user_id !== appUserId) {
    console.error("[WHOOP] State user mismatch");
    const redirectUrl = new URL(
      "/dashboard?whoop_error=user_mismatch",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // 3) Exchange authorization code for access + refresh tokens
  // WHOOP requires client_secret_post authentication method
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
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
    console.error("[WHOOP] Token exchange failed:", tokenJson);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=token_exchange_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const accessToken: string = tokenJson.access_token;
  const refreshToken: string | undefined = tokenJson.refresh_token;
  const expiresIn: number = tokenJson.expires_in; // seconds
  const scopeString: string = tokenJson.scope || "";

  // Calculate expires_at
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  console.log("[WHOOP] Token exchange successful, expires_in:", expiresIn);

  // 4) Fetch WHOOP profile to get whoop_user_id
  let whoopUserId: number | null = null;

  try {
    const profileRes = await fetch(WHOOP_PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const profileJson = await profileRes.json();

    if (!profileRes.ok) {
      console.error(
        "[WHOOP] Failed to fetch profile:",
        profileRes.status,
        profileJson
      );
      const redirectUrl = new URL(
        "/dashboard?whoop_error=profile_fetch_failed",
        req.nextUrl.origin
      );
      return NextResponse.redirect(redirectUrl);
    }

    whoopUserId = profileJson.user_id;
    console.log("[WHOOP] Profile fetched, whoop_user_id:", whoopUserId);

    if (!whoopUserId) {
      console.error("[WHOOP] No user_id in profile response");
      const redirectUrl = new URL(
        "/dashboard?whoop_error=no_user_id",
        req.nextUrl.origin
      );
      return NextResponse.redirect(redirectUrl);
    }
  } catch (e) {
    console.error("[WHOOP] Error fetching profile:", e);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=profile_fetch_exception",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // 5) Upsert credentials (tokens + scope)
  const { error: credsError } = await supabase
    .from("whoop_credentials")
    .upsert(
      {
        app_user_id: appUserId,
        whoop_user_id: whoopUserId,
        access_token: accessToken,
        refresh_token: refreshToken || null,
        expires_at: expiresAt,
        scope: scopeString,
        status: "active",
        updated_at: new Date().toISOString(),
        last_refresh_at: new Date().toISOString(),
        revoked_at: null,
        last_refresh_error: null,
      },
      {
        onConflict: "app_user_id",
      }
    );

  if (credsError) {
    console.error("[WHOOP] Error saving credentials:", credsError);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=db_upsert_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  console.log("[WHOOP] Credentials saved successfully");

  // 6) Clean up used oauth state
  const { error: deleteError } = await supabase
    .from("whoop_oauth_state")
    .delete()
    .eq("state", state);

  if (deleteError) {
    console.error("[WHOOP] Error cleaning up oauth state:", deleteError);
    // Not fatal, just log it
  }

  // 7) Redirect back to dashboard with success flag
  const redirectUrl = new URL("/dashboard?whoop=connected", req.nextUrl.origin);
  return NextResponse.redirect(redirectUrl);
}

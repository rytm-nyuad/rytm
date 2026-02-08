import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.events.readonly",
];

function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString("hex");
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

  if (!CLIENT_ID || !REDIRECT_URI) {
    console.warn("[Calendar] Missing GOOGLE_CLIENT_ID / GOOGLE_REDIRECT_URI env vars.");
  }

  const supabase = await createClient();

  // Ensure user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[Calendar] connect: no authenticated user");
    const redirectUrl = new URL("/sign-in?calendar_error=not_authenticated", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // PKCE + state
  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(32);
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Save state + code_verifier
  const payload = {
    state,
    app_user_id: appUserId,
    code_verifier: codeVerifier,
    created_at: new Date().toISOString(),
  };

  const { error: insertError } = await supabase
    .from("calendar_oauth_state")
    .insert(payload);

  if (insertError) {
    // Enhanced logging for debugging
    console.error("[Calendar] Error inserting oauth state:", insertError);
    console.error("[Calendar] Insert payload:", payload);

    // Include short error message in redirect (safe for internal testing)
    const errMsg = encodeURIComponent(
      (insertError?.message || JSON.stringify(insertError)).toString().slice(0, 200)
    );
    const redirectUrl = new URL(`/dashboard?calendar_error=oauth_state_insert_failed&err=${errMsg}`, req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  // Build Google authorization URL
  const scopes = GOOGLE_SCOPES.join(" ");
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  // Request offline access so we get a refresh token, and prompt=consent to ensure refresh token on repeat
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authUrl.toString());
}

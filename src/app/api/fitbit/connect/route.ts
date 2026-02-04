import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto"; // Node.js crypto
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const FITBIT_AUTH_URL = "https://www.fitbit.com/oauth2/authorize";
//activity%20heartrate%20location%20nutrition%20oxygen_saturation%20profile
//%20respiratory_rate%20settings%20sleep%20social%20temperature%20weight
const FITBIT_SCOPES = [
  "activity",
  "heartrate",
  "location",
  "nutrition",
  "oxygen_saturation",
  "profile",
  "respiratory_rate",
  "settings",
  "sleep",
  "social",
  "temperature",
  "weight",
];

// Helper to generate a random string (for state & PKCE code_verifier)
function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString("hex");
}

// base64url encode
function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// Generate PKCE code challenge from verifier
function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  return base64UrlEncode(hash);
}

export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.FITBIT_CLIENT_ID!;
  const REDIRECT_URI = process.env.FITBIT_REDIRECT_URI!;

  if (!CLIENT_ID || !REDIRECT_URI) {
    console.warn(
      "[Fitbit] Missing FITBIT_CLIENT_ID / FITBIT_REDIRECT_URI env vars."
    );
  }
  const supabase = await createClient();

  // 1) Ensure user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[Fitbit] connect: no authenticated user");
    const redirectUrl = new URL("/sign-in?fitbit_error=not_authenticated", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // 2) Create PKCE + state
  const state = generateRandomString(16);
  const codeVerifier = generateRandomString(32);
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // 3) Save state + code_verifier in fitbit_oauth_state
  const { error: insertError } = await supabase
    .from("fitbit_oauth_state")
    .insert({
      state,
      app_user_id: appUserId,
      code_verifier: codeVerifier,
      created_at: new Date().toISOString(),
    });

  if (insertError) {
    console.error("[Fitbit] Error inserting oauth state:", insertError);
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=oauth_state_insert_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // 4) Build Fitbit authorization URL
  const scopes = FITBIT_SCOPES.join(" ");

  const authUrl = new URL(FITBIT_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  // 5) Redirect user to Fitbit
  return NextResponse.redirect(authUrl.toString());
}

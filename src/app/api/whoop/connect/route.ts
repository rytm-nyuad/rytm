import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const WHOOP_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";

// Minimum scopes for WHOOP integration
// read:profile - to get whoop_user_id and bind account
// offline - to receive refresh tokens
const WHOOP_SCOPES = [
  "offline",                // <-- keep this, needed for refresh_token
  "read:profile",
  "read:recovery",
  "read:cycles",
  "read:sleep",
  "read:workout",
  "read:body_measurement",
];


// Helper to generate a random state string (WHOOP requires >= 8 characters)
function generateRandomString(length: number): string {
  return crypto.randomBytes(length).toString("hex");
}

export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.WHOOP_CLIENT_ID!;
  const REDIRECT_URI = process.env.WHOOP_REDIRECT_URI!;

  if (!CLIENT_ID || !REDIRECT_URI) {
    console.error("[WHOOP] Missing WHOOP_CLIENT_ID / WHOOP_REDIRECT_URI env vars.");
    return NextResponse.json(
      { error: "WHOOP OAuth not configured" },
      { status: 500 }
    );
  }

  const supabase = await createClient();

  // 1) Ensure user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[WHOOP] connect: no authenticated user");
    const redirectUrl = new URL("/sign-in?whoop_error=not_authenticated", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // 2) Generate state (>= 8 characters for WHOOP)
  const state = generateRandomString(16); // 32 hex chars

  // 3) Save state in whoop_oauth_state for CSRF protection
  const { error: insertError } = await supabase
    .from("whoop_oauth_state")
    .insert({
      state,
      app_user_id: appUserId,
      created_at: new Date().toISOString(),
    });

  if (insertError) {
    console.error("[WHOOP] Error inserting oauth state:", insertError);
    const redirectUrl = new URL(
      "/dashboard?whoop_error=oauth_state_insert_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // 4) Build WHOOP authorization URL
  const scopes = WHOOP_SCOPES.join(" ");

  const authUrl = new URL(WHOOP_AUTH_URL);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("scope", scopes);
  authUrl.searchParams.set("state", state);

  console.log("[WHOOP] Redirecting to WHOOP auth:", authUrl.toString());

  // 5) Redirect user to WHOOP authorization
  return NextResponse.redirect(authUrl.toString());
}

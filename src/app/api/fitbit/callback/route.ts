import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TOKEN_URL = "https://api.fitbit.com/oauth2/token";
const PROFILE_URL = "https://api.fitbit.com/1/user/-/profile.json";


export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.FITBIT_CLIENT_ID!;
  const CLIENT_SECRET = process.env.FITBIT_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.FITBIT_REDIRECT_URI!;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.warn(
      "[Fitbit] Missing FITBIT_CLIENT_ID / FITBIT_CLIENT_SECRET / FITBIT_REDIRECT_URI env vars."
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // If Fitbit sent an OAuth error (user declined, etc.)
  if (error) {
    console.error("[Fitbit] OAuth error:", error);
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=" + encodeURIComponent(error),
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    console.error("[Fitbit] Missing code or state in callback");
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=missing_code_or_state",
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
    console.error("[Fitbit] No authenticated user in callback");
    const redirectUrl = new URL(
      "/?fitbit_error=not_authenticated",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // 2) Look up state + code_verifier from fitbit_oauth_state
  const { data: oauthRow, error: oauthError } = await supabase
    .from("fitbit_oauth_state")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (oauthError || !oauthRow) {
    console.error("[Fitbit] Invalid or unknown state", oauthError);
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=invalid_state",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // Extra safety: ensure callback user matches the user who started the flow
  if (oauthRow.app_user_id !== appUserId) {
    console.error("[Fitbit] State user mismatch");
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=user_mismatch",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const codeVerifier: string = oauthRow.code_verifier;

  // 3) Exchange authorization code for access + refresh tokens
  const basicAuthToken = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuthToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const tokenJson = await tokenRes.json();

  if (!tokenRes.ok) {
    console.error("[Fitbit] Token exchange failed:", tokenJson);
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=token_exchange_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  const accessToken: string = tokenJson.access_token;
  const refreshToken: string = tokenJson.refresh_token;
  const fitbitUserId: string = tokenJson.user_id;
  const scopeString: string | undefined = tokenJson.scope;
  const scopes: string[] =
    typeof scopeString === "string" ? scopeString.split(" ") : [];

  // 4) Fetch Fitbit profile (for fitbit_profile table)
  let profileRow: any = null;

  try {
    const profileRes = await fetch(PROFILE_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const profileJson = await profileRes.json();
    if (!profileRes.ok) {
      console.error(
        "[Fitbit] Failed to fetch profile:",
        profileRes.status,
        profileJson
      );
    } else {
      const u = profileJson?.user ?? {};

      profileRow = {
        app_user_id: appUserId,
        age: u.age ?? null,
        date_of_birth: u.dateOfBirth ?? null,
        distance_unit: u.distanceUnit ?? null,
        gender: u.gender ?? null,
        height: u.height ?? null,
        height_unit: u.heightUnit ?? null,
        temperature_unit: u.temperatureUnit ?? null,
        weight: u.weight ?? null,
        weight_unit: u.weightUnit ?? null,
        user_timezone: u.timezone ?? null,
        updated_at: new Date().toISOString(),
      };

      console.log("[Fitbit] Profile row to upsert:", profileRow);
    }
  } catch (e) {
    console.error("[Fitbit] Error fetching profile:", e);
  }

  // 5) Upsert credentials (tokens + scopes)
  const { error: credsError } = await supabase
    .from("fitbit_credentials")
    .upsert(
      {
        app_user_id: appUserId,
        fitbit_user_id: fitbitUserId,
        access_token: accessToken,
        refresh_token: refreshToken,
        scopes,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "app_user_id",
      }
    );

  if (credsError) {
    console.error("[Fitbit] Error saving credentials:", credsError);
    const redirectUrl = new URL(
      "/dashboard?fitbit_error=db_upsert_failed",
      req.nextUrl.origin
    );
    return NextResponse.redirect(redirectUrl);
  }

  // 6) Upsert profile (if fetched successfully)
  if (profileRow) {
    const { error: profileError } = await supabase
      .from("fitbit_profile")
      .upsert(profileRow, { onConflict: "app_user_id" });

    if (profileError) {
      console.error("[Fitbit] Error saving fitbit_profile:", profileError);
      // We don't fail the whole OAuth flow for this, but you could if you want.
    }
  }

  // 7) Clean up used oauth state (no .catch)
  const { error: deleteError } = await supabase
    .from("fitbit_oauth_state")
    .delete()
    .eq("state", state);

  if (deleteError) {
    console.error("[Fitbit] Error cleaning up oauth state:", deleteError);
    // Not fatal to the user, but log it.
  }

  // 8) Redirect back to your dashboard with a success flag
  const APP_URL =
    process.env.NEXTAUTH_URL || req.nextUrl.origin;

  const redirectUrl = new URL("/dashboard?fitbit=connected", APP_URL);
  return NextResponse.redirect(redirectUrl);

}

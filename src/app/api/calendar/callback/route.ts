import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const CALENDAR_PRIMARY_URL = "https://www.googleapis.com/calendar/v3/calendars/primary";

export async function GET(req: NextRequest) {
  const CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
  const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;
  const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI!;

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    console.warn("[Calendar] Missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI env vars.");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    console.error("[Calendar] OAuth error:", error);
    const redirectUrl = new URL("/dashboard?calendar_error=" + encodeURIComponent(error), req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  if (!code || !state) {
    console.error("[Calendar] Missing code or state in callback");
    const redirectUrl = new URL("/dashboard?calendar_error=missing_code_or_state", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();

  // Get authenticated user
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[Calendar] No authenticated user in callback");
    const redirectUrl = new URL("/?calendar_error=not_authenticated", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const appUserId = user.id;

  // Lookup state + code_verifier
  const { data: oauthRow, error: oauthError } = await supabase
    .from("calendar_oauth_state")
    .select("*")
    .eq("state", state)
    .maybeSingle();

  if (oauthError || !oauthRow) {
    console.error("[Calendar] Invalid or unknown state", oauthError);
    const redirectUrl = new URL("/dashboard?calendar_error=invalid_state", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  if (oauthRow.app_user_id !== appUserId) {
    console.error("[Calendar] State user mismatch");
    const redirectUrl = new URL("/dashboard?calendar_error=user_mismatch", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const codeVerifier: string = oauthRow.code_verifier;

  // Exchange authorization code for tokens
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: code!,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });

  const tokenRes = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const tokenJson = await tokenRes.json();

  if (!tokenRes.ok) {
    console.error("[Calendar] Token exchange failed:", tokenJson);
    const redirectUrl = new URL("/dashboard?calendar_error=token_exchange_failed", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  const accessToken: string = tokenJson.access_token;
  const refreshToken: string = tokenJson.refresh_token;
  const scopeString: string | undefined = tokenJson.scope;
  const scopes: string[] = typeof scopeString === "string" ? scopeString.split(" ") : [];

  // Fetch userinfo
  let userInfo: any = null;
  try {
    const userRes = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const userJson = await userRes.json();
    if (userRes.ok) userInfo = userJson;
    else console.error("[Calendar] Failed to fetch userinfo:", userJson);
  } catch (e) {
    console.error("[Calendar] Error fetching userinfo:", e);
  }

  // Fetch primary calendar metadata (for timezone)
  let calendarMeta: any = null;
  try {
    const calRes = await fetch(CALENDAR_PRIMARY_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
    const calJson = await calRes.json();
    if (calRes.ok) calendarMeta = calJson;
    else console.warn("[Calendar] Failed to fetch primary calendar:", calJson);
  } catch (e) {
    console.error("[Calendar] Error fetching primary calendar:", e);
  }

  // Upsert credentials
  const { error: credsError } = await supabase
    .from("calendar_credentials")
    .upsert(
      {
        app_user_id: appUserId,
        provider_user_id: userInfo?.sub ?? userInfo?.id ?? null,
        access_token: accessToken,
        refresh_token: refreshToken,
        scopes,
        status: 'active',
        updated_at: new Date().toISOString(),
      },
      { onConflict: "app_user_id" }
    );

  if (credsError) {
    console.error("[Calendar] Error saving credentials:", credsError);
    const redirectUrl = new URL("/dashboard?calendar_error=db_upsert_failed", req.nextUrl.origin);
    return NextResponse.redirect(redirectUrl);
  }

  // Upsert profile (if available)
  if (userInfo || calendarMeta) {
    const profileRow: any = {
      app_user_id: appUserId,
      email: userInfo?.email ?? null,
      display_name: userInfo?.name ?? null,
      timezone: calendarMeta?.timeZone ?? null,
      updated_at: new Date().toISOString(),
    };

    const { error: profileError } = await supabase
      .from("calendar_profile")
      .upsert(profileRow, { onConflict: "app_user_id" });

    if (profileError) {
      console.error("[Calendar] Error saving calendar_profile:", profileError);
    }
  }

  // Clean up oauth state
  const { error: deleteError } = await supabase
    .from("calendar_oauth_state")
    .delete()
    .eq("state", state);

  if (deleteError) {
    console.error("[Calendar] Error cleaning up oauth state:", deleteError);
  }

  const APP_URL = process.env.NEXTAUTH_URL || req.nextUrl.origin;
  const redirectUrl = new URL("/dashboard?calendar=connected", APP_URL);
  return NextResponse.redirect(redirectUrl);
}

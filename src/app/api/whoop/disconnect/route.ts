import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic';

const WHOOP_REVOKE_URL = "https://api.prod.whoop.com/developer/v2/user/access";

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // 1) Ensure user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    console.error("[WHOOP] disconnect: no authenticated user");
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const appUserId = user.id;

  // 2) Get current WHOOP credentials
  const { data: creds, error: fetchError } = await supabase
    .from("whoop_credentials")
    .select("access_token, whoop_user_id")
    .eq("app_user_id", appUserId)
    .maybeSingle();

  if (fetchError || !creds) {
    console.error("[WHOOP] No credentials found for disconnect:", fetchError);
    return NextResponse.json(
      { error: "No WHOOP connection found" },
      { status: 404 }
    );
  }

  const accessToken = creds.access_token;

  // 3) Revoke access with WHOOP API
  try {
    const revokeRes = await fetch(WHOOP_REVOKE_URL, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!revokeRes.ok) {
      console.error(
        "[WHOOP] Failed to revoke access:",
        revokeRes.status,
        await revokeRes.text()
      );
      // Continue anyway to clean up local DB
    } else {
      console.log("[WHOOP] Access revoked successfully with WHOOP API");
    }
  } catch (e) {
    console.error("[WHOOP] Error calling revoke endpoint:", e);
    // Continue anyway to clean up local DB
  }

  // 4) Mark credentials as revoked in DB (or delete them)
  // Option A: Mark as revoked
  const { error: updateError } = await supabase
    .from("whoop_credentials")
    .update({
      status: "needs_reauth",
      revoked_at: new Date().toISOString(),
      access_token: "", // Clear token
      refresh_token: null,
      updated_at: new Date().toISOString(),
    })
    .eq("app_user_id", appUserId);

  // Option B: Delete credentials entirely (uncomment if preferred)
  // const { error: deleteError } = await supabase
  //   .from("whoop_credentials")
  //   .delete()
  //   .eq("app_user_id", appUserId);

  if (updateError) {
    console.error("[WHOOP] Error updating credentials for disconnect:", updateError);
    return NextResponse.json(
      { error: "Failed to disconnect" },
      { status: 500 }
    );
  }

  console.log("[WHOOP] User disconnected successfully");

  return NextResponse.json(
    { success: true, message: "WHOOP disconnected successfully" },
    { status: 200 }
  );
}

// scripts/syncFitbitBatch.ts
//
// Batch script to force Fitbit data pulls for a subset of users
// over a configurable number of daysBack.
//
// Usage examples (from project root):
//   npx ts-node scripts/syncFitbitBatch.ts
//   npx ts-node scripts/syncFitbitBatch.ts --days=14
//   npx ts-node scripts/syncFitbitBatch.ts --users=<uuid1>,<uuid2> --days=30
//
// IMPORTANT:
// - This should run server-side ONLY.
// - Use the SERVICE ROLE key (SUPABASE_SERVICE_ROLE_KEY) so RLS doesn't block writes.
// - Make sure the import path to syncFitbitDailyForUser matches your project structure.

import { createClient } from "@supabase/supabase-js";
import {
  syncFitbitDailyForUser,
} from "../src/lib/fitbit"; // adjust the path if your structure differs

import {
  FitbitNotConnectedError,
  FitbitAuthRevokedError,
} from "../src/lib/fitbit"; // if these are not exported separately, you can remove & check instanceof by name string

// -------------------------------
// Config defaults (easy to edit)
// -------------------------------

// Default number of days back if not given via --days= argument
const DEFAULT_DAYS_BACK = 14;

// Default user IDs if not given via --users= argument
// Fill this with your app_user_id values (from fitbit_credentials / profiles)
const DEFAULT_USER_IDS: string[] = [
  // "00000000-0000-0000-0000-000000000000",
  "bf8434ee-b495-4da4-96d0-d919c5b4a957",
  "0a9f1777-12d6-47f2-b0a6-ef29e767ac47",
  "fbb8c9c6-972a-43a9-a529-caf994d8abfd",
  "9a74b43b-4714-4311-ae92-a6df16a38d05",
  "ba7806f0-d26f-4b9d-95d7-917d4159b638",
  "4df4655f-d44e-4c9f-b830-6fc4aa4ddd13",
  "1bdd1fe8-3444-4a6e-ae4a-c10b40fa4a5c",
  "332cafe0-4831-4bd2-a0c9-4569bdcc8019",
  "5775373a-d309-4c68-a817-3a9c37e9b303",
  "482980f2-7524-438e-8d45-81d6ba40c886",
  "93abebc5-a8bf-4adf-9f52-cd32875bf1a5",
  "68d89cfe-5647-4a19-8548-c9fc6b8880be",
  "65aaea99-e7ee-4ca4-86b5-9eab1f19b132",
  "b8d1ffca-192e-44ce-a215-8240edcf7097",
  "684fcfd7-f96e-4184-bbe2-58b7fd645a7c",
  "caf7e2a6-361b-486b-b76f-c8aabd5b8f45",
];

// -------------------------------
// CLI arg parsing helpers
// -------------------------------

function parseDaysBackFromArgs(): number {
  const arg = process.argv.find((a) => a.startsWith("--days="));
  if (!arg) return DEFAULT_DAYS_BACK;

  const raw = arg.split("=")[1];
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) {
    console.warn(
      `[Batch] Invalid --days=${raw}, falling back to DEFAULT_DAYS_BACK=${DEFAULT_DAYS_BACK}`
    );
    return DEFAULT_DAYS_BACK;
  }
  return n;
}

function parseUsersFromArgs(): string[] {
  const arg = process.argv.find((a) => a.startsWith("--users="));
  if (!arg) return DEFAULT_USER_IDS;

  const raw = arg.split("=")[1];
  if (!raw.trim()) return DEFAULT_USER_IDS;

  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length === 0) return DEFAULT_USER_IDS;

  return parts;
}

// -------------------------------
// Supabase client factory
// -------------------------------

function createServiceSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    console.error(
      "[Batch] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL environment variable."
    );
    process.exit(1);
  }
  if (!serviceRoleKey) {
    console.error(
      "[Batch] Missing SUPABASE_SERVICE_ROLE_KEY environment variable. " +
        "Use the service role key so this script can bypass RLS for writes."
    );
    process.exit(1);
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      // No browser, no session persistence needed in this script
      persistSession: false,
    },
  });

  return client;
}

// -------------------------------
// Main batch logic
// -------------------------------

async function runBatch() {
  const daysBack = parseDaysBackFromArgs();
  const userIds = parseUsersFromArgs();

  if (!userIds.length) {
    console.error(
      "[Batch] No user IDs specified. Either fill DEFAULT_USER_IDS or pass --users=<id1>,<id2>."
    );
    process.exit(1);
  }

  console.log(
    `[Batch] Starting Fitbit sync for ${userIds.length} user(s), daysBack=${daysBack}`
  );

  const supabase = createServiceSupabaseClient();

  for (const userId of userIds) {
    console.log("\n===========================================");
    console.log(`[Batch] Syncing Fitbit for user: ${userId}`);
    console.log("===========================================");

    try {
      const result = await syncFitbitDailyForUser(supabase, userId, {
        daysBack,
      });

      console.log("[Batch] Sync OK", {
        timezone: result.timezone,
        syncedDates: result.syncedDates,
        lastSyncedAt: result.lastSyncedAt,
      });
    } catch (err: any) {
      // Handle known Fitbit errors more nicely
      if (err instanceof FitbitNotConnectedError) {
        console.warn(
          `[Batch] Skipping user ${userId}: Fitbit not connected (${err.message})`
        );
        continue;
      }

      if (err instanceof FitbitAuthRevokedError) {
        console.warn(
          `[Batch] User ${userId}: Fitbit auth revoked / invalid refresh token. ` +
            "You may need to have the user reconnect Fitbit."
        );
        continue;
      }

      // Generic error
      console.error(`[Batch] Error syncing user ${userId}:`, err);
    }
  }

  console.log("\n[Batch] All done.");
}

// -------------------------------
// Entrypoint
// -------------------------------

runBatch()
  .then(() => {
    // Ensure the process exits cleanly, especially if there are hanging handles.
    process.exit(0);
  })
  .catch((err) => {
    console.error("[Batch] Unhandled error:", err);
    process.exit(1);
  });

# WHOOP Integration Setup Guide

## ✅ Completed Setup

Your WHOOP OAuth integration has been fully implemented following the same pattern as your Fitbit integration. Here's what was created:

## 📁 Files Created

### 1. Database Schema
**File:** `supabase/whoop_schema.sql`
- `whoop_oauth_state` table for CSRF protection
- `whoop_credentials` table with RLS policies
- Proper indexes for performance
- Security: Tokens protected from client access via RLS

### 2. API Routes
**Folder:** `src/app/api/whoop/`

#### a) Connect Route (`connect/route.ts`)
- Generates secure state string (>= 8 chars as WHOOP requires)
- Stores state in DB for CSRF validation
- Redirects to WHOOP authorization with:
  - `client_id`
  - `redirect_uri`
  - `response_type=code`
  - `scope=offline read:profile` (space-delimited)
  - `state` (anti-CSRF token)

#### b) Callback Route (`callback/route.ts`)
- Validates state (anti-CSRF)
- Exchanges authorization code for tokens
- Fetches WHOOP user profile to get `whoop_user_id`
- Stores credentials in database:
  - `access_token`
  - `refresh_token`
  - `expires_at` (calculated from `expires_in`)
  - `scope`
  - `whoop_user_id`
- Cleans up used OAuth state
- Redirects to `/dashboard?whoop=connected`

#### c) Disconnect Route (`disconnect/route.ts`)
- Revokes access via WHOOP API: `DELETE /v2/user/access`
- Marks credentials as revoked in DB
- Clears tokens from database

### 3. Token Refresh Helper
**File:** `src/lib/whoop/tokenRefresh.ts`

Functions provided:
- `needsRefresh(expiresAt: string): boolean` - Check if token needs refresh (2-minute buffer)
- `refreshWhoopToken(userId, supabase): Promise<RefreshResult>` - Refresh tokens with lock pattern
- `getValidWhoopToken(userId, supabase): Promise<string | null>` - Get valid token (auto-refresh if needed)

**Lock Pattern Features:**
- Prevents concurrent refresh attempts
- 30-second lock TTL
- Automatic lock release on success/failure
- Error tracking in `last_refresh_error` field

### 4. Frontend Integration
**File:** `src/components/dashboard/TopNav.tsx`

Added WHOOP integration button:
- Real-time connection status checking
- Visual indicators:
  - Green checkmark (✓) when connected
  - Red pulsing dot when needs reconnection
  - "WHOOP" text when not connected
- Desktop and mobile responsive layouts
- Follows exact same pattern as Fitbit button

## 🔐 Environment Variables

Your `.env.local` is already configured with:
```env
WHOOP_CLIENT_ID=e00fd738-1037-45f3-aaff-4e3987d53ce8
WHOOP_CLIENT_SECRET=ac717a363206a1d8b3037c24eaddd2aee053d1b30fde11ecf6c980bc89e5e05e
WHOOP_REDIRECT_URI=http://localhost:3000/api/whoop/callback
WHOOP_AUTH_URL=https://api.prod.whoop.com/oauth/oauth2/auth
WHOOP_TOKEN_URL=https://api.prod.whoop.com/oauth/oauth2/token
```

**⚠️ Important:** Update `WHOOP_REDIRECT_URI` for production to match your deployed domain.

## 🚀 Setup Steps

### Step 1: Run Database Migration
Execute the SQL schema to create the necessary tables:

```bash
# Option 1: Via Supabase Dashboard
# Copy contents of supabase/whoop_schema.sql
# Paste into SQL Editor in Supabase Dashboard
# Run the query

# Option 2: Via Supabase CLI (if using locally)
supabase db push
```

### Step 2: Verify Environment Variables
Ensure your `.env.local` has all WHOOP credentials (already done ✅)

### Step 3: Restart Development Server
```bash
# Stop your current server (Ctrl+C)
npm run dev
# or
yarn dev
```

### Step 4: Test the Integration

#### A. Connect Flow
1. Navigate to `/dashboard`
2. Click the "WHOOP" button in the top navigation
3. You'll be redirected to WHOOP authorization page
4. Log in to WHOOP and grant permissions
5. You'll be redirected back to your app at `/dashboard?whoop=connected`
6. Button should now show "WHOOP ✓" with green status

#### B. Check Database
```sql
-- Verify credentials were saved
SELECT app_user_id, whoop_user_id, scope, status, created_at 
FROM whoop_credentials;

-- Check OAuth state was cleaned up
SELECT * FROM whoop_oauth_state;
-- Should be empty after successful connection
```

#### C. Test Disconnect
```javascript
// In browser console or via API client
fetch('/api/whoop/disconnect', { method: 'POST' })
  .then(r => r.json())
  .then(console.log);
```

## 📊 Database Schema Details

### whoop_credentials Table
| Column | Type | Description |
|--------|------|-------------|
| app_user_id | uuid | FK to profiles, PRIMARY KEY |
| whoop_user_id | bigint | WHOOP user ID from profile API |
| access_token | text | Current access token |
| refresh_token | text | Refresh token (nullable) |
| expires_at | timestamptz | When access_token expires |
| scope | text | Granted OAuth scopes |
| status | text | 'active' or 'needs_reauth' |
| created_at | timestamptz | First connection time |
| updated_at | timestamptz | Last update time |
| revoked_at | timestamptz | When user disconnected (nullable) |
| last_refresh_at | timestamptz | Last successful refresh (nullable) |
| last_refresh_error | text | Last error message (nullable) |
| refresh_in_progress_until | timestamptz | Lock for concurrent refresh prevention (nullable) |

## 🔄 Token Refresh Usage

### In Your Backend Routes
```typescript
import { getValidWhoopToken } from "@/lib/whoop/tokenRefresh";
import { createClient } from "@/lib/supabase/server";

// In your API route
const supabase = await createClient();
const { data: { user } } = await supabase.auth.getUser();

if (!user) {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

// Get a valid token (auto-refreshes if needed)
const accessToken = await getValidWhoopToken(user.id, supabase);

if (!accessToken) {
  return NextResponse.json(
    { error: "WHOOP not connected or token expired" },
    { status: 403 }
  );
}

// Use the token to call WHOOP API
const response = await fetch("https://api.prod.whoop.com/developer/v2/...", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

## 🎯 Next Steps: Data Ingestion

Now that OAuth is set up, you can implement data endpoints:

### Recommended WHOOP API Endpoints
Based on WHOOP's v2 API:

1. **Profile** (already used in callback)
   - `GET /developer/v2/user/profile/basic`

2. **Recovery Data**
   - `GET /developer/v2/recovery`
   - Daily recovery scores, HRV, resting HR, etc.

3. **Sleep Data**
   - `GET /developer/v2/sleep`
   - Sleep stages, efficiency, disturbances

4. **Workout Data**
   - `GET /developer/v2/workout`
   - Strain, heart rate zones, calories

5. **Cycle Data**
   - `GET /developer/v2/cycle`
   - Daily strain, recovery, sleep performance

### Example Data Sync Route
```typescript
// src/app/api/whoop/sync/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getValidWhoopToken } from "@/lib/whoop/tokenRefresh";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const accessToken = await getValidWhoopToken(user.id, supabase);
  if (!accessToken) {
    return NextResponse.json({ error: "WHOOP not connected" }, { status: 403 });
  }

  // Fetch recovery data for last 7 days
  const endDate = new Date().toISOString().split('T')[0];
  const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const response = await fetch(
    `https://api.prod.whoop.com/developer/v2/recovery?start=${startDate}&end=${endDate}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  const data = await response.json();

  // Store in your database
  // ... your data storage logic ...

  return NextResponse.json({ success: true, data });
}
```

## 🔒 Security Notes

1. **RLS Policies**: Tokens are protected - only service role can read actual token values
2. **State Validation**: CSRF protection via state parameter
3. **User Matching**: Ensures OAuth callback user matches initiating user
4. **Lock Pattern**: Prevents race conditions in token refresh
5. **Error Tracking**: All failures logged to `last_refresh_error`

## 🐛 Troubleshooting

### Connection Issues
```sql
-- Check if user has credentials
SELECT * FROM whoop_credentials WHERE app_user_id = '<user-id>';

-- Check for hanging OAuth states
SELECT * FROM whoop_oauth_state WHERE created_at < NOW() - INTERVAL '1 hour';
-- Should be cleaned up automatically, but can delete manually if stuck
```

### Token Refresh Issues
```sql
-- Check token status
SELECT 
  app_user_id, 
  status, 
  expires_at, 
  last_refresh_at, 
  last_refresh_error,
  refresh_in_progress_until
FROM whoop_credentials
WHERE app_user_id = '<user-id>';

-- Manually release stuck locks
UPDATE whoop_credentials 
SET refresh_in_progress_until = NULL 
WHERE refresh_in_progress_until < NOW();
```

### Frontend Not Showing Connected Status
1. Check browser console for errors
2. Verify RLS policies allow SELECT on status field
3. Confirm user is authenticated
4. Check database has credentials for user

## 📝 Scope Reference

Current scopes: `offline read:profile`

Additional WHOOP scopes available:
- `read:recovery` - Recovery data
- `read:cycles` - Strain/recovery cycles
- `read:sleep` - Sleep data
- `read:workout` - Workout data
- `read:body_measurement` - Body measurements

To add more scopes:
1. Update `WHOOP_SCOPES` array in [src/app/api/whoop/connect/route.ts](src/app/api/whoop/connect/route.ts)
2. Users will need to reconnect to grant new permissions
3. Store new scope string in `whoop_credentials.scope`

## ✨ Summary

You now have a fully functional WHOOP OAuth integration with:
- ✅ Secure OAuth 2.0 flow with CSRF protection
- ✅ Token storage with RLS security
- ✅ Automatic token refresh with lock pattern
- ✅ Frontend status indicators
- ✅ Disconnect/revoke functionality
- ✅ Ready for data ingestion

Next steps: Implement data sync endpoints based on your app's needs!

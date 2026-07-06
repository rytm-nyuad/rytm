# 7-Day Session Persistence Implementation

## Overview
Implemented persistent session authentication where users only need to sign in once every 7 days instead of on every visit. This is achieved through:

1. **Server-side authentication** - Auth happens via `/api/auth/sign-in` endpoint
2. **HTTP-only session cookies** - Browser manages 7-day cookies automatically
3. **Server-side session validation** - Per-request session refresh via middleware
4. **Auto-redirect for logged-in users** - Home page detects session and redirects to dashboard

## Architecture: Server-Side Auth with HTTP-Only Cookies

### Key Insight
- **Client-side auth (localStorage)**: Sessions lost after browser restart because JavaScript can't access localStorage when cookies expired
- **Server-side auth (HTTP-only cookies)**: Browser automatically maintains cookies for 7 days; server reads them on each request

## Files Created/Modified

### 1. **`middleware.ts`** (MODIFIED)
- Root-level Next.js middleware that runs on every request
- Calls `updateSession()` to refresh tokens via Supabase
- Simplified to focus only on session refresh (no redirect logic)

### 2. **`src/lib/supabase/middleware.ts`** (EXISTING)
- Utility function for server-side session refresh logic
- Handles HTTP-only cookie management
- Calls `supabase.auth.getUser()` to validate/refresh tokens

### 3. **`src/lib/supabase/browser.ts`** (MODIFIED)
- Updated browser client configuration with:
  - `persistSession: true` - localStorage as fallback for session recovery
  - `autoRefreshToken: true` - automatically refreshes tokens
  - `detectSessionInUrl: true` - detects OAuth callbacks in URL
  - `flowType: 'pkce'` - uses PKCE flow for better security

### 4. **`src/lib/supabase/server.ts`** (MODIFIED)
- Enhanced cookie handling to set 7-day max age (604800 seconds)
- Applied to all server-side Supabase client interactions
- Ensures session cookies persist for 7 days browser-side

### 5. **`src/app/api/auth/sign-in/route.ts`** (NEW - CRITICAL)
- **POST endpoint** for server-side email/password authentication
- Receives `{ email, password }` from client
- Calls `supabase.auth.signInWithPassword()` server-side
- Collects authentication cookies from Supabase response
- Sets cookies on response with `maxAge: 604800` (7 days)
- Returns `{ user, redirectTo }` JSON (redirectTo = "/dashboard" or "/consent")
- **Critical**: Stores cookies in response headers, not JavaScript-accessible

### 6. **`src/app/api/auth/session/route.ts`** (NEW - CRITICAL)
- **GET endpoint** for server-side session validation
- Reads HTTP-only cookies from request headers
- Returns `{ user, session }` if valid, else `{ user: null, session: null }`
- Used by client pages instead of `supabase.auth.getSession()`
- **Critical**: Server reads cookies; client can't access cookies directly

### 7. **`src/app/auth/callback/route.ts`** (MODIFIED)
- Updated OAuth callback to set 7-day session expiry
- Sets `maxAge: 7 * 24 * 60 * 60` on authentication cookies
- Handles Google OAuth token exchange

### 8. **`src/app/page.tsx`** (NEW - HOME PAGE)
- Client component with `"use client"` directive
- On mount, calls `fetch('/api/auth/session')` to check for session
- If session exists → `router.replace('/dashboard')` (auto-redirect)
- If no session → Shows landing page with sign-in/sign-up links
- **Critical**: Solves "I have to click sign-in" problem

### 9. **Client pages updated to use server session endpoint** (MODIFIED)
- `/src/app/dashboard/page.tsx`
- `/src/app/consent/page.tsx`
- `/src/app/consent/sign/page.tsx`
- `/src/app/(auth)/reset-password/page.tsx`
- `/src/app/(auth)/sign-up/page.tsx`
- `/src/app/(auth)/forgot-password/page.tsx`
- `/src/components/dashboard/JournalChat.tsx`

**Changed from**: `supabase.auth.getSession()`  
**Changed to**: `fetch('/api/auth/session')` then `const { user, session } = await resp.json()`

### 10. **`src/app/(auth)/sign-in/page.tsx`** (MODIFIED)
- Sign-in form now calls `/api/auth/sign-in` endpoint via POST instead of client-side auth
- Receives session from server (cookies already set by response headers)
- Redirects to `/dashboard` or `/consent` based on server response

### 11. **API Routes marked with dynamic = 'force-dynamic'** (MODIFIED)
All API routes and dynamic pages configured to skip static prerendering:
- `export const dynamic = 'force-dynamic'` prevents build errors
- Ensures routes run only on-demand at runtime, not prerendered

## How It Works

### Authentication Flow (Server-Side)
1. **Sign-In Page**: User enters email/password in form
2. **Client POST**: Browser sends credentials to `/api/auth/sign-in`
3. **Server-Side Auth**: `/api/auth/sign-in` calls `supabase.auth.signInWithPassword()`
4. **Cookie Response**: Supabase returns session; server collects cookies
5. **HTTP Headers**: Server sets `Set-Cookie` headers with `maxAge: 604800` (7 days)
6. **Browser Storage**: Browser automatically stores HTTP-only cookies (can't be accessed by JavaScript)
7. **Redirect**: Client receives `{ user, redirectTo }` and redirects to dashboard/consent

### Session Persistence Across Browser Restarts
1. **Browser Closed**: HTTP-only cookies remain in browser storage (persisted to disk)
2. **Browser Reopened**: User visits app
3. **Middleware Runs**: Every request triggers middleware → calls `supabase.auth.getUser()`
4. **Cookie Sent**: Browser automatically sends HTTP-only cookies with request headers
5. **Server Reads**: `getUser()` reads cookies from request, validates session
6. **Auto-Redirect**: Home page detects session via `/api/auth/session` → redirects to dashboard
7. **Result**: User stays logged in without re-entering credentials!

### Per-Request Session Validation
1. Middleware intercepts every request
2. Calls `supabase.auth.getUser()` to validate/refresh session
3. If token is near expiry, Supabase automatically issues new token
4. New token is returned in response cookies (browser updates stored cookies)
5. User remains logged in seamlessly

### Why This Works (vs. Client-Side Auth)
- **Client localStorage**: Lost after browser restart (not persistent)
- **Server HTTP-only cookies**: Browser automatically manages for 7 days
- **Middleware**: Validates session on every request
- **Server endpoint**: Client pages read session from server, not localStorage

## Key Configuration Values

| Setting | Value | Purpose |
|---------|-------|---------|
| Session Max Age | 604800 seconds (7 days) | Cookie/token expiry time |
| Cookie Type | HTTP-only | Not accessible by JavaScript (more secure) |
| Auto-Refresh | Middleware on every request | Tokens refresh automatically |
| Persist Session | Browser cookies | Survives browser restart for 7 days |
| Middleware | All routes | Session validation on every request |
| Sign-in Endpoint | `/api/auth/sign-in` | POST endpoint for authentication |
| Session Endpoint | `/api/auth/session` | GET endpoint for session validation |

## User Experience

**Before Implementation:**
- ❌ Users sign in
- ❌ Close browser or refresh page
- ❌ Session lost, must sign in again
- ❌ Must click "Sign In" button on home page every visit

**After Implementation:**
- ✅ Users sign in once (server-side authentication)
- ✅ HTTP-only cookies stored for 7 days
- ✅ Can close/reopen browser, still logged in
- ✅ Visit home page → auto-redirects to dashboard (session detected)
- ✅ Can stay logged in for up to 7 days without re-authenticating
- ✅ Automatic token refresh prevents interruptions
- ✅ After 7 days, simple re-authentication required

## Security Considerations

1. **Server-side authentication**: Auth never happens in browser (more secure)
2. **HTTP-only cookies**: Tokens stored securely (not accessible via JavaScript)
3. **7-day expiry**: Balances convenience with security
4. **PKCE flow**: Prevents authorization code interception (OAuth)
5. **Middleware validation**: Every request validates session integrity
6. **No localStorage exposure**: Tokens not accessible to XSS attacks
7. **Automatic refresh**: Tokens rotated regularly via middleware

## Testing the Implementation

```bash
# Build and start
npm run build
npm run dev

# Test flow:
1. Visit http://localhost:3001/ → should show landing page (no session)
2. Click "Sign In" or navigate to /sign-in
3. Enter credentials and submit
4. Should redirect to /dashboard (or /consent if consent needed)
5. Close browser completely (CMD+Q on Mac, Alt+F4 on Windows, etc.)
6. Reopen browser and visit http://localhost:3001/
7. Should auto-redirect to /dashboard (SESSION PERSISTED!)
8. Can verify cookies in DevTools → Application → Cookies → check Supabase cookies
   - Should see HttpOnly=✓, Max-Age≈604800, Secure (in HTTPS)
9. After 7 days, session expires and user must sign in again
```

## Environment-Specific Notes

- **Local development**: Works with `.env.local` configuration
- **Production**: Uses GitHub Actions environment variables
- **Cookie domain**: Automatically set to request domain
- **Cookie path**: Set to `/` (available across entire app)
- **HTTPS**: Cookies marked `Secure` in production (HTTPS only)
- **NEXTAUTH_URL**: Must be set correctly (e.g., `http://localhost:3001` for dev)

## Debugging Session Issues

**Issue**: Session lost after browser restart  
**Check**: 
- Verify cookies in DevTools → Application → Cookies
- Look for Supabase-related cookies with HttpOnly=✓
- Check browser console for `/api/auth/session` errors
- Verify `NEXTAUTH_URL` environment variable is correct

**Issue**: Not auto-redirecting to dashboard  
**Check**:
- Verify `/api/auth/session` returns `{ session: { user: ... } }`
- Check browser console for fetch errors
- Verify middleware is running (check server logs)
- Ensure `src/app/page.tsx` has `"use client"` directive

**Issue**: Getting "Cannot find module" build errors for API routes  
**Fix**: Add `export const dynamic = 'force-dynamic'` to API routes and dynamic pages

## Future Enhancements

Optional improvements:
- Add "Remember me for 30 days" option (longer cookie max-age)
- Implement device fingerprinting for extra security
- Add logout on other devices option
- Add session activity tracking/alerts
- Add manual session refresh button
- Implement progressive session extension (refresh on activity)

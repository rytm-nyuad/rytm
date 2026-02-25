import { NextResponse, type NextRequest } from 'next/server';
import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { isEmailAllowed, ALLOWED_EMAILS } from '@/lib/allowlist';

export async function middleware(request: NextRequest) {
  // Build a single response object that we'll mutate with refreshed cookies
  let response = NextResponse.next({
    request: { headers: request.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: request.headers } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options as CookieOptions)
          );
        },
      },
    }
  );

  // Validate the session (refreshes token if needed, sets cookies above)
  const { data: { user } } = await supabase.auth.getUser();

  // Skip allowlist check for auth + coming-soon paths
  const { pathname } = request.nextUrl;
  if (pathname.startsWith('/auth') || pathname.startsWith('/api/auth') || pathname.startsWith('/coming-soon')) {
    return response;
  }

  // No allowlist configured — open access
  if (!ALLOWED_EMAILS) return response;

  // Not logged in — let the app's own route guards handle the redirect
  if (!user) {
    // If there are supabase auth cookies but getUser() returned null (e.g. token
    // refresh race), block access rather than letting an unknown session through.
    const hasSbCookies = request.cookies.getAll().some(c => c.name.startsWith('sb-'));
    if (hasSbCookies && ALLOWED_EMAILS) {
      return NextResponse.redirect(new URL('/coming-soon', request.url));
    }
    return response;
  }

  // Logged in but not on the allowlist — show coming soon page
  if (!isEmailAllowed(user.email)) {
    return NextResponse.redirect(new URL('/coming-soon', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};

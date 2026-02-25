import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { isEmailAllowed } from '@/lib/allowlist';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const { email, password } = await request.json();

  const cookieStore = await cookies();
  let responseCookies: Array<{ name: string; value: string; options?: CookieOptions }> = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value, options }) => {
            const enhancedOptions = {
              ...options,
              maxAge: 7 * 24 * 60 * 60, // 7 days
            };
            // Store for later use in response
            responseCookies.push({ name, value, options: enhancedOptions });
            // Also set in cookie store for this request
            cookieStore.set(name, value, enhancedOptions);
          });
        },
      },
    }
  );

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // ── Allowlist gate ──
    if (!isEmailAllowed(data.user?.email)) {
      return NextResponse.json({ redirectTo: '/coming-soon' }, { status: 200 });
    }

    // Check consent
    const { data: consentData } = await supabase
      .from('consent_signatures')
      .select('id')
      .eq('user_id', data.user!.id)
      .maybeSingle();

    const redirectTo = consentData ? '/dashboard' : '/consent';

    // Create response and add cookies
    const response = NextResponse.json({ user: data.user, redirectTo }, { status: 200 });
    
    // Add all cookies to response
    responseCookies.forEach(({ name, value, options }) => {
      response.cookies.set(name, value, options as any);
    });

    return response;
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const appUrl = process.env.NEXTAUTH_URL || new URL(request.url).origin;
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: object }>) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (error) {
      console.error('Auth callback error:', error);
      return NextResponse.redirect(`${appUrl}/sign-in?error=auth_failed`);
    }
    
    if (data.user) {
      // Check if user has signed consent
      const { data: consentData, error: consentError } = await supabase
        .from("consent_signatures")
        .select("id")
        .eq("user_id", data.user.id)
        .maybeSingle(); // Use maybeSingle() instead of single() to avoid error when no record exists

      console.log('Consent check in callback:', { 
        hasConsent: !!consentData, 
        consentError: consentError?.message,
        userId: data.user.id 
      });

      // Create response with proper cookie headers
      const response = consentData 
        ? NextResponse.redirect(`${appUrl}/dashboard`)
        : NextResponse.redirect(`${appUrl}/consent`);

      return response;
    }
  }

  // Return the user to sign-in with error
  return NextResponse.redirect(`${appUrl}/sign-in?error=no_code`);
}

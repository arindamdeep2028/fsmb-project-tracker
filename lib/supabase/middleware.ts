import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

export type Claims = { user_role?: string; user_active?: boolean; must_change_password?: boolean; sub?: string };

/**
 * Refreshes the session cookie and returns the user's token claims (routing hints only).
 * `extraRequestHeaders` (the CSP and its nonce) are passed on to the page render with every response this
 * builds; `response()` gives the current one — it is rebuilt whenever Supabase sets or clears cookies.
 */
export async function updateSession(request: NextRequest, extraRequestHeaders: Record<string, string> = {}) {
  const forward = () => {
    const headers = new Headers(request.headers);
    for (const [k, v] of Object.entries(extraRequestHeaders)) headers.set(k, v);
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = forward();
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  const claims = (data?.claims ?? null) as Claims | null;
  return { supabase, claims, response: () => response };
}

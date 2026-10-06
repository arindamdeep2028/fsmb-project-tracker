import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { landingForRole } from "@/lib/auth/landing";
import { routeFor } from "@/lib/auth/routing";
import { buildCsp } from "@/lib/security-headers";

/**
 * Layer 1 of routing (Frontend Blueprint §5): session present, account active, password changed, URL prefix
 * vs role claim — the decision itself is lib/auth/routing.ts. Runs for pages and for Server Action posts alike,
 * so a deactivated or must-change session cannot call an action either. The live profile is checked again in
 * the server layouts; RLS decides the data. Also sets the Content-Security-Policy (with its per-request nonce).
 */
export async function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp({ nonce, supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL, dev: process.env.NODE_ENV === "development" });
  const { supabase, claims, response } = await updateSession(request, { "x-nonce": nonce, "content-security-policy": csp });
  const path = request.nextUrl.pathname;
  const finish = (res: NextResponse) => { res.headers.set("Content-Security-Policy", csp); return res; };
  const redirect = (to: string, query = "") => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = query;
    const res = NextResponse.redirect(url);
    response().cookies.getAll().forEach((c) => res.cookies.set(c));
    return finish(res);
  };

  // The token's claims can be up to an hour old. Before acting on "inactive" or "must change password" — or on
  // /login?reason=inactive, where the server layout sends a deactivated session — read the live profile once.
  const needsLive = Boolean(claims?.sub) && (claims!.user_active === false || claims!.must_change_password === true
    || (path === "/login" && request.nextUrl.searchParams.get("reason") === "inactive"));
  let live: { active: boolean; must_change_password: boolean } | null | undefined;
  if (needsLive) {
    const { data, error } = await supabase.from("profiles").select("active, must_change_password").eq("id", claims!.sub!).maybeSingle();
    live = error ? undefined : data;      // undefined = could not check: fall back to the claims
  }

  const decision = routeFor({
    path, signedIn: Boolean(claims?.sub), role: claims?.user_role,
    active: live === undefined ? claims?.user_active !== false : Boolean(live?.active),
    mustChangePassword: live === undefined ? claims?.must_change_password === true : Boolean(live?.must_change_password),
  });
  switch (decision.do) {
    case "pass": return finish(response());
    case "signOutAndShowLogin":
      await supabase.auth.signOut();          // clears the session cookies on response()
      return path === "/login" ? finish(response()) : redirect("/login", "?reason=inactive");
    case "redirect":
      return redirect(decision.to, decision.to === "/login" && path !== "/" ? `?next=${encodeURIComponent(path)}` : "");
    case "landing": return redirect(landingForRole(claims?.user_role));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};

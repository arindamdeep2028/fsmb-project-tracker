import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { landingForRole } from "@/lib/auth/landing";

const PUBLIC = ["/login", "/reset-password", "/setup", "/auth"];

/**
 * Layer 1 of routing (Frontend Blueprint §5): session present, account active, URL prefix vs role claim.
 * The live profile is checked again in the server layouts; RLS decides the data.
 */
export async function middleware(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));
  const redirect = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    url.search = to === "/login" && path !== "/" ? `?next=${encodeURIComponent(path)}` : "";
    const res = NextResponse.redirect(url);
    response.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  };

  if (!claims?.sub) return isPublic ? response : redirect("/login");
  if (claims.user_active === false && path !== "/login") return redirect("/login");
  if (path === "/login") return redirect(landingForRole(claims.user_role));

  const role = claims.user_role;
  if ((path.startsWith("/admin") || path.startsWith("/dashboard/admin")) && role !== "admin") return redirect(landingForRole(role));
  if ((path.startsWith("/dashboard/department") || path === "/performance") && role !== "admin" && role !== "dept_head")
    return redirect(landingForRole(role));
  if (path.startsWith("/dashboard/projects") && role === "engineer") return redirect("/dashboard");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)"],
};

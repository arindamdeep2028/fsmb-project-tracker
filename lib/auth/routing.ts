/**
 * The middleware's routing decision, as a pure function (tests/unit/security.test.ts). Safe for middleware.
 *
 *   signed out        public pages pass; everything else goes to /login
 *   deactivated       signed out and shown the sign-in page — never bounced between /login and a dashboard
 *   must change pw    only /change-password and /auth/* are reachable; pages and Server Action posts alike
 *   signed in         /login goes to the role's landing page; role-prefixed areas as before
 */
export const PUBLIC_PATHS = ["/login", "/reset-password", "/setup", "/auth"];
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

export type RouteDecision =
  | { do: "pass" }
  | { do: "redirect"; to: string }
  | { do: "landing" }
  | { do: "signOutAndShowLogin" };

export function routeFor(o: { path: string; signedIn: boolean; role?: string; active: boolean; mustChangePassword: boolean }): RouteDecision {
  const { path, role } = o;
  const isPublic = PUBLIC_PATHS.some((p) => under(path, p));
  if (!o.signedIn) return isPublic ? { do: "pass" } : { do: "redirect", to: "/login" };
  if (!o.active) return under(path, "/auth") ? { do: "pass" } : { do: "signOutAndShowLogin" };
  if (o.mustChangePassword) return path === "/change-password" || under(path, "/auth") ? { do: "pass" } : { do: "redirect", to: "/change-password" };
  if (path === "/login") return { do: "landing" };

  if ((path.startsWith("/admin") || path.startsWith("/dashboard/admin")) && role !== "admin") return { do: "landing" };
  if ((path.startsWith("/dashboard/department") || path === "/performance") && role !== "admin" && role !== "dept_head") return { do: "landing" };
  if (path.startsWith("/dashboard/projects") && role === "engineer") return { do: "redirect", to: "/dashboard" };
  return { do: "pass" };
}

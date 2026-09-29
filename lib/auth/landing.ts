/** Landing page per role (Frontend Blueprint §5). Safe for middleware (no server-only imports). */
export function landingForRole(role?: string | null): string {
  switch (role) {
    case "admin": return "/dashboard/admin";
    case "dept_head": return "/dashboard/department";
    case "pm": return "/dashboard/projects";
    default: return "/dashboard";
  }
}

import type { Session } from "@/lib/auth/session";

export type NavItem = { href: string; label: string; group?: "admin" };

/** Sidebar by role (Frontend Blueprint §5): built from the same rules as the route guards. */
export function navFor(s: Session): NavItem[] {
  const isHead = s.headedDepartmentIds.length > 0;
  const isPm = s.pmProjectIds.length > 0;
  if (s.isAdmin) {
    return [
      { href: "/dashboard/admin", label: "Admin dashboard" },
      { href: "/dashboard/department", label: "Department" },
      { href: "/dashboard/projects", label: "My Projects" },
      { href: "/projects", label: "Projects" },
      { href: "/daily-reports", label: "Daily Reports" },
      { href: "/performance", label: "Performance" },
      { href: "/notifications", label: "Notifications" },
      { href: "/admin/users", label: "Users", group: "admin" },
      { href: "/admin/departments", label: "Departments", group: "admin" },
      { href: "/admin/settings", label: "Rules and settings", group: "admin" },
      { href: "/admin/log", label: "Log", group: "admin" },
      { href: "/admin/reports", label: "Reports", group: "admin" },
      { href: "/admin/data", label: "Data and jobs", group: "admin" },
      { href: "/help", label: "Help" },
    ];
  }
  const items: NavItem[] = [];
  if (isHead) items.push({ href: "/dashboard/department", label: "Department" });
  if (isHead || isPm) items.push({ href: "/dashboard/projects", label: "My Projects" });
  items.push({ href: "/dashboard", label: "My Dashboard" });
  if (!isHead) items.push({ href: "/my-tasks", label: "My Tasks" });
  items.push({ href: "/daily-reports", label: "Daily Reports" }, { href: "/projects", label: "Projects" });
  if (isHead) items.push({ href: "/performance", label: "Performance" });
  items.push({ href: "/notifications", label: "Notifications" });
  if (!isHead) items.push({ href: "/my-performance", label: "My Performance" });
  items.push({ href: "/help", label: "Help" });
  return items;
}

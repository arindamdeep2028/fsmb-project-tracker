import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";

/** "/" → landing page by role; a PM is a PM of at least one project (v2). */
export default async function Landing() {
  const s = await requireSession();
  if (s.isAdmin) redirect("/dashboard/admin");
  if (s.headedDepartmentIds.length) redirect("/dashboard/department");
  if (s.pmProjectIds.length) redirect("/dashboard/projects");
  redirect("/dashboard");
}

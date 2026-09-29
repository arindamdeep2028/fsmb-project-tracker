import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProject } from "@/lib/data/projects";
import { canManageProject } from "@/lib/auth/capabilities";
import { Badge } from "@/components/ui/misc";
import { ProjectTabs } from "./project-tabs";

/** Project area. RLS decides visibility: a project the viewer can't see is a 404 (v2). */
export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const s = await requireSession();
  const p = await getProject(projectId);
  if (!p) notFound();
  const manages = canManageProject(s, p);
  const tabs = [
    { href: "", label: "Overview" }, { href: "/tasks", label: "Responsibilities" }, { href: "/daily-reports", label: "Daily reports" },
    { href: "/members", label: "Members" },
    ...(manages ? [{ href: "/report", label: "Report" }, { href: "/log", label: "Log" }, { href: "/settings", label: "Settings" }] : []),
  ];
  return (
    <>
      <div className="mb-6 border-b border-line">
        <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight"><span className="text-ink-soft">{p.code}</span> {p.name}</h1>
          {p.archived ? <Badge signal="done">Archived</Badge> : p.status !== "Active" ? <Badge>{p.status}</Badge> : null}
          <span className="text-sm text-ink-soft">{p.department?.name}{p.pm ? ` · Lead PM ${p.pm.full_name}` : ""}</span>
        </div>
        <ProjectTabs base={`/projects/${projectId}`} tabs={tabs} />
      </div>
      {children}
    </>
  );
}

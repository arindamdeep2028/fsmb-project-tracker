import { projectContext } from "@/lib/auth/project-guard";
import { getAssignableUsers, getMembers } from "@/lib/data/projects";
import { createClient } from "@/lib/supabase/server";
import { MemberTable } from "@/components/projects/member-table";

export default async function MembersPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project, manages } = await projectContext(projectId);
  const supabase = await createClient();
  const [members, contrib, candidates] = await Promise.all([
    getMembers(projectId),
    supabase.rpc("member_contribution", { p_project: projectId }),
    manages ? getAssignableUsers(projectId) : Promise.resolve([]),
  ]);
  const c = new Map((contrib.data ?? []).map((r) => [r.user_id, r]));
  return (
    <MemberTable projectId={projectId} canManage={manages && !project.archived} leadPmId={project.pm_id} candidates={candidates}
      members={members.map((m) => ({ ...m, open_tasks: c.get(m.user_id)?.open_tasks, share_pct: c.get(m.user_id)?.share_pct }))} />
  );
}

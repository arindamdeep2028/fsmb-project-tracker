import { projectContext } from "@/lib/auth/project-guard";
import { listActivity } from "@/lib/data/admin";
import { LogTable } from "@/components/data/log-table";

export default async function ProjectLogPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { project } = await projectContext(projectId, { manager: true });
  const rows = await listActivity({}, { projectId });
  return <LogTable rows={rows} csvName={`${project.code}-log`} />;
}

import "server-only";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { getProject } from "@/lib/data/projects";
import { canManageProject } from "@/lib/auth/capabilities";

/** Project page context; `manager: true` pages 404 for anyone who doesn't manage the project. */
export async function projectContext(projectId: string, opts: { manager?: boolean } = {}) {
  const s = await requireSession();
  const project = await getProject(projectId);
  if (!project) notFound();
  const manages = canManageProject(s, project);
  if (opts.manager && !manages) notFound();
  return { s, project, manages };
}

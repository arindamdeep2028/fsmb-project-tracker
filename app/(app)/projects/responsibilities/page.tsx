import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import { listProjects } from "@/lib/data/projects";
import { PageHeader } from "@/components/ui/misc";
import { ResponsibilitiesSection } from "@/components/projects/responsibilities-section";

export const metadata: Metadata = { title: "Responsibilities" };

/**
 * Responsibilities (the sidebar bar under "Submit today's report"): choose a running project, then fill in its
 * Responsibilities sheet in place.
 */
export default async function ResponsibilitiesPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const s = await requireSession();
  const { project } = await searchParams;
  const visible = await listProjects();
  return (
    <>
      <PageHeader title="Responsibilities" lead="Choose a running project to see and fill in its responsibilities. Cells save as you edit them." />
      <ResponsibilitiesSection s={s} visible={visible} wanted={project} />
    </>
  );
}

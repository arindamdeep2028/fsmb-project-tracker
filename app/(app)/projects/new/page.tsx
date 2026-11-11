import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canCreateProject } from "@/lib/auth/capabilities";
import { getDepartments, getPmCandidates } from "@/lib/data/projects";
import { parseCategory } from "@/lib/project-status";
import { PageHeader, Section } from "@/components/ui/misc";
import { ProjectForm } from "@/components/projects/project-form";

export const metadata: Metadata = { title: "New project" };

/** Opened from a category tab on the Projects page (?category=embedded); the new project goes into that category. */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  const s = await requireSession();
  if (!canCreateProject(s)) redirect("/projects");
  const category = parseCategory((await searchParams).category) ?? "Software";
  const [departments, pms] = await Promise.all([getDepartments(), getPmCandidates()]);
  const mine = departments.filter((d) => d.active && (s.isAdmin || s.headedDepartmentIds.includes(d.id)));
  return (
    <>
      <PageHeader title={`New ${category} project`} lead="The lead PM becomes a project member automatically. New projects start as Running." />
      <Section title="Project details"><ProjectForm departments={mine} pms={pms} canEditStructure category={category} /></Section>
    </>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/session";
import { canCreateProject } from "@/lib/auth/capabilities";
import { getDepartments, getPmCandidates } from "@/lib/data/projects";
import { PageHeader, Section } from "@/components/ui/misc";
import { ProjectForm } from "@/components/projects/project-form";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage() {
  const s = await requireSession();
  if (!canCreateProject(s)) redirect("/projects");
  const [departments, pms] = await Promise.all([getDepartments(), getPmCandidates()]);
  const mine = departments.filter((d) => d.active && (s.isAdmin || s.headedDepartmentIds.includes(d.id)));
  return (
    <>
      <PageHeader title="New project" lead="The lead PM becomes a project member automatically." />
      <Section title="Project details"><ProjectForm departments={mine} pms={pms} canEditStructure /></Section>
    </>
  );
}

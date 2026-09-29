import { projectContext } from "@/lib/auth/project-guard";
import { canEditProjectStructure } from "@/lib/auth/capabilities";
import { getDepartments, getPmCandidates } from "@/lib/data/projects";
import { Section } from "@/components/ui/misc";
import { ProjectForm } from "@/components/projects/project-form";
import { ProjectDangerZone } from "@/components/projects/project-danger";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { s, project } = await projectContext(projectId, { manager: true });
  const structure = canEditProjectStructure(s, project);
  const [departments, pms] = await Promise.all([getDepartments(), getPmCandidates()]);
  const deptOptions = departments.filter((d) => d.id === project.department_id || s.isAdmin || s.headedDepartmentIds.includes(d.id));
  return (
    <div className="space-y-6">
      <Section title="Project details">
        {!structure ? <p className="mb-4 text-sm text-ink-soft">Code, department and lead PM are changed by the Department Head or an Admin.</p> : null}
        <ProjectForm project={project} departments={deptOptions} pms={pms} canEditStructure={structure} />
      </Section>
      {structure ? (
        <Section title="Archive or delete">
          <ProjectDangerZone id={project.id} code={project.code} archived={project.archived} canArchive={structure} canDelete={s.isAdmin} />
        </Section>
      ) : null}
    </div>
  );
}

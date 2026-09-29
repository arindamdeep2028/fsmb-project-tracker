"use client";
import { useRouter } from "next/navigation";
import { deleteProject, setProjectArchived } from "@/lib/actions/projects";
import { useAction } from "@/components/toast";
import { Button } from "@/components/ui/button";

export function ProjectDangerZone({ id, code, archived, canArchive, canDelete }: { id: string; code: string; archived: boolean; canArchive: boolean; canDelete: boolean }) {
  const { pending, run } = useAction();
  const router = useRouter();
  return (
    <div className="space-y-4">
      {canArchive ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[15px]">{archived ? "Restore the project to dashboards and lists." : "Archive hides the project from dashboards and lists. Everything is kept."}</p>
          <Button variant="secondary" pending={pending} onClick={() => run(() => setProjectArchived(id, !archived))}>{archived ? "Restore project" : "Archive project"}</Button>
        </div>
      ) : null}
      {canDelete ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
          <p className="text-[15px]">Delete permanently, with its tasks and members. Only possible while it has no daily reports; otherwise archive it.</p>
          <Button variant="danger" pending={pending}
            onClick={() => prompt(`Type ${code} to delete this project permanently`) === code && run(() => deleteProject(id), () => router.push("/projects"))}>Delete project</Button>
        </div>
      ) : null}
    </div>
  );
}

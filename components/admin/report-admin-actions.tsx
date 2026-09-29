"use client";
import { useRouter } from "next/navigation";
import { deleteReport, setReportLock } from "@/lib/actions/reports";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/toast";

export function ReportAdminActions({ id, locked }: { id: string; locked: boolean }) {
  const { pending, run } = useAction();
  const router = useRouter();
  return (
    <div className="flex gap-2">
      <Button variant="secondary" size="sm" pending={pending} onClick={() => run(() => setReportLock(id, !locked))}>{locked ? "Unlock report" : "Lock report"}</Button>
      <Button variant="danger" size="sm" pending={pending}
        onClick={() => confirm("Delete this report, its task updates list and its files? Task progress already recorded stays.") && run(() => deleteReport(id), () => router.push("/daily-reports"))}>Delete report</Button>
    </div>
  );
}

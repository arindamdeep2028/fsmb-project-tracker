"use client";
import { DataTable, type ColumnDef } from "@/components/data/data-table";
import { Badge } from "@/components/ui/misc";
import { fmt } from "@/lib/time";
import type { Tables } from "@/types/database";

type Row = Tables<"activity_log">;
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: "ts", header: "When", cell: ({ getValue }) => <span className="whitespace-nowrap">{fmt(getValue() as string)}</span> },
  { accessorKey: "action", header: "Action", cell: ({ getValue }) => { const a = getValue() as string; return <Badge signal={a === "Red mark" ? "red" : a === "Deleted" ? "amber" : "neutral"}>{a}</Badge>; } },
  { accessorKey: "project_code", header: "Project" },
  { accessorKey: "task_code", header: "Task" },
  { accessorKey: "subject_name", header: "Person" },
  { accessorKey: "actor_name", header: "By" },
  { accessorKey: "details", header: "Details", cell: ({ getValue }) => <span className="text-ink-soft">{(getValue() as string) ?? ""}</span> },
];

/** Excel layout: the time as shown on screen (Dhaka), the action centred, details wide and wrapped. */
const EXPORT = {
  ts: { width: 130, align: "center" as const, format: (v: unknown) => fmt(v as string) },
  action: { width: 130, align: "center" as const }, project_code: { width: 80, align: "center" as const }, task_code: { width: 100, align: "center" as const },
  subject_name: { width: 150 }, actor_name: { width: 150 }, details: { width: 420 },
};

/** The audit log is append-only (security protection S1): read and export only. */
export function LogTable({ rows, exportName }: { rows: Row[]; exportName?: string }) {
  return <DataTable data={rows} columns={columns} exportName={exportName} exportTitle="Activity log" exportColumns={EXPORT} filterPlaceholder="Filter the log" empty="No entries for these filters." />;
}

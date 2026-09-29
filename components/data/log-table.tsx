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

/** The audit log is append-only (security protection S1): read and export only. */
export function LogTable({ rows, csvName }: { rows: Row[]; csvName?: string }) {
  return <DataTable data={rows} columns={columns} csvName={csvName} filterPlaceholder="Filter the log" empty="No entries for these filters." />;
}

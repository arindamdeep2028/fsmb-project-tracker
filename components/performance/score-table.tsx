"use client";
import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/data/data-table";
import { Badge } from "@/components/ui/misc";
import { scoreBand } from "@/lib/labels";
import { pct } from "@/lib/utils";

type Row = { user_id: string; full_name: string; department?: string | null; member_role?: string | null; assigned: number; completed: number; late: number; on_time_pct: number | null; red_events: number; daily_updates: number; score: number | null };

/** Scores come from the database (performance_summary / project_performance); the table only presents them. */
export function ScoreTable({ rows, csvName, logBase }: { rows: Row[]; csvName?: string; logBase?: string }) {
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "full_name", header: "Person", cell: ({ row }) => logBase ? <Link href={`${logBase}${row.original.user_id}`} className="font-medium hover:text-steel hover:underline">{row.original.full_name}</Link> : row.original.full_name },
    ...(rows.some((r) => r.department !== undefined) ? [{ accessorKey: "department", header: "Department" } as ColumnDef<Row, unknown>] : []),
    { accessorKey: "assigned", header: "Assigned" },
    { accessorKey: "completed", header: "Completed" },
    { accessorKey: "late", header: "Late" },
    { accessorKey: "on_time_pct", header: "On time", cell: ({ getValue }) => pct(getValue() as number | null) },
    { accessorKey: "red_events", header: "Red marks" },
    { accessorKey: "daily_updates", header: "Daily updates" },
    { accessorKey: "score", header: "Score", cell: ({ getValue }) => { const v = getValue() as number | null; const b = scoreBand(v); return <span className="inline-flex items-center gap-2"><span className="font-semibold">{v ?? "—"}</span><Badge signal={b.signal}>{b.label}</Badge></span>; } },
  ];
  return <DataTable data={rows} columns={columns} csvName={csvName} filterPlaceholder="Find a person" empty="No activity in this window." />;
}

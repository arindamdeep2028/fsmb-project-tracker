"use client";
import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/data/data-table";
import { Badge, CountLink } from "@/components/ui/misc";
import { scoreBand } from "@/lib/labels";
import { pct } from "@/lib/utils";

type Row = { user_id: string; full_name: string; department?: string | null; member_role?: string | null; assigned: number; completed: number; late: number; on_time_pct: number | null; red_events: number; daily_updates: number; score: number | null };

/**
 * Scores come from the database (performance_summary / project_performance); the table only presents them.
 * `drill` (dashboards): every count opens that person's records for the window — tasks (assigned, completed,
 * late, on time, red-marked) on My Tasks, daily reports on Daily Reports — limited to what the viewer may see.
 */
export function ScoreTable({ rows, csvName, logBase, drill }: { rows: Row[]; csvName?: string; logBase?: string; drill?: { from: string; to: string } }) {
  const tasks = (r: Row, filter: string) => `/my-tasks?filter=${filter}&user=${r.user_id}&from=${drill?.from}&to=${drill?.to}`;
  const count = (key: "assigned" | "completed" | "late" | "red_events", filter: string, label: string): ColumnDef<Row, unknown> => ({
    accessorKey: key, header: label,
    cell: ({ row }) => (drill ? <CountLink href={tasks(row.original, filter)} value={row.original[key]} label={`${row.original.full_name} ${label.toLowerCase()}`} /> : row.original[key]),
  });
  const personHref = logBase ? `${logBase}` : drill ? "/my-tasks?user=" : null;
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "full_name", header: "Person", cell: ({ row }) => personHref ? <Link href={`${personHref}${row.original.user_id}`} className="font-medium hover:text-steel hover:underline">{row.original.full_name}</Link> : row.original.full_name },
    ...(rows.some((r) => r.department !== undefined) ? [{ accessorKey: "department", header: "Department" } as ColumnDef<Row, unknown>] : []),
    count("assigned", "assigned", "Assigned"),
    count("completed", "done", "Completed"),
    count("late", "late", "Late"),
    { accessorKey: "on_time_pct", header: "On time", cell: ({ row, getValue }) => (drill
      ? <CountLink href={tasks(row.original, "ontime")} value={row.original.completed - row.original.late} label={`${row.original.full_name} on time`}>{pct(getValue() as number | null)}</CountLink>
      : pct(getValue() as number | null)) },
    count("red_events", "redmark", "Red marks"),
    { accessorKey: "daily_updates", header: "Daily updates", cell: ({ row }) => (drill
      ? <CountLink href={`/daily-reports?user=${row.original.user_id}&from=${drill.from}&to=${drill.to}`} value={row.original.daily_updates} label={`${row.original.full_name} daily updates`} />
      : row.original.daily_updates) },
    { accessorKey: "score", header: "Score", cell: ({ getValue }) => { const v = getValue() as number | null; const b = scoreBand(v); return <span className="inline-flex items-center gap-2"><span className="font-semibold">{v ?? "—"}</span><Badge signal={b.signal}>{b.label}</Badge></span>; } },
  ];
  return <DataTable data={rows} columns={columns} csvName={csvName} filterPlaceholder="Find a person" empty="No activity in this window." />;
}

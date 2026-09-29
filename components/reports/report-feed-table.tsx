"use client";
import Link from "next/link";
import { DataTable, type ColumnDef } from "@/components/data/data-table";
import { fmtDay } from "@/lib/time";

export type FeedRow = { id: string; report_date: string; author: string; update_text: string; issues: string | null; next_task_text: string | null; items: number; files: number; locked: boolean };

const columns: ColumnDef<FeedRow, unknown>[] = [
  { accessorKey: "report_date", header: "Date", cell: ({ row }) => <Link href={`/daily-reports/${row.original.id}`} className="whitespace-nowrap font-medium hover:text-steel hover:underline">{fmtDay(row.original.report_date)}</Link> },
  { accessorKey: "author", header: "Engineer" },
  { accessorKey: "update_text", header: "Update", cell: ({ getValue }) => <span className="line-clamp-2 max-w-md">{getValue() as string}</span> },
  { accessorKey: "issues", header: "Issues", cell: ({ getValue }) => <span className="text-signal-amber">{(getValue() as string) ?? ""}</span> },
  { accessorKey: "items", header: "Tasks" },
  { accessorKey: "files", header: "Files" },
];

export function ReportFeedTable({ rows, csvName }: { rows: FeedRow[]; csvName?: string }) {
  return <DataTable data={rows} columns={columns} csvName={csvName} filterPlaceholder="Filter reports" empty="No reports match." />;
}

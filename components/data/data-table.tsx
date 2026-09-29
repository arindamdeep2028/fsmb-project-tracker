"use client";
import { useMemo, useState } from "react";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";

export type { ColumnDef };

/** Sortable, filterable table. CSV export only when `csvName` is given — pages pass it to managers only (v2 §14.8). */
export function DataTable<T extends Record<string, unknown>>({ data, columns, csvName, filterPlaceholder = "Filter", empty = "Nothing to show." }: {
  data: T[]; columns: ColumnDef<T, unknown>[]; csvName?: string; filterPlaceholder?: string; empty?: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filter, setFilter] = useState("");
  const table = useReactTable({
    data, columns, state: { sorting, globalFilter: filter }, onSortingChange: setSorting, onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const csv = useMemo(() => () => {
    const cols = table.getAllLeafColumns().filter((c) => c.id !== "actions");
    const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const head = cols.map((c) => esc(typeof c.columnDef.header === "string" ? c.columnDef.header : c.id)).join(",");
    const body = table.getFilteredRowModel().rows.map((r) => cols.map((c) => esc(r.getValue(c.id))).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${head}\n${body}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${csvName}.csv`; a.click(); URL.revokeObjectURL(url);
  }, [table, csvName]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={filterPlaceholder} aria-label={filterPlaceholder} className="max-w-xs" />
        {csvName ? <Button variant="secondary" size="sm" onClick={csv}>Export CSV</Button> : null}
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full border-collapse text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b border-line px-3 py-2 text-left font-medium text-ink-soft">
                    {h.column.getCanSort() ? (
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === "asc" ? <ArrowUp size={14} /> : h.column.getIsSorted() === "desc" ? <ArrowDown size={14} /> : null}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-ink-soft">{empty}</td></tr>
            ) : rows.map((r) => (
              <tr key={r.id} className="hover:bg-paper">
                {r.getVisibleCells().map((c) => <td key={c.id} className="border-b border-line-soft px-3 py-2.5 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-faint">{rows.length} of {data.length} rows</p>
    </div>
  );
}

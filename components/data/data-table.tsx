"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { flexRender, getCoreRowModel, getFilteredRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { useToast } from "@/components/toast";
import { downloadXlsx, type XCell, type XKind } from "@/lib/xlsx";
import { cn } from "@/lib/utils";

export type { ColumnDef };

/** How one column is written to Excel: width in pixels, kind (colours / number format), alignment, value. */
export type ExportColumn = { width?: number; kind?: XKind; align?: "left" | "center" | "right"; format?: (value: unknown) => XCell };
/** A preset order offered next to the filter (e.g. Name A–Z / Z–A). An empty `sorting` is the table's own order. */
export type SortOption = { label: string; sorting: SortingState };

/**
 * Sortable, filterable table. Excel export only when `exportName` is given — pages pass it to managers only
 * (v2 §14.8). The workbook holds exactly the rows shown (filter and order applied), formatted like the table.
 * `rowHref`: a click anywhere on the row opens that page (Ctrl/⌘-click: a new tab). Links and buttons inside the
 * row keep their own target; the page should also link one cell to the same address for keyboard users.
 */
export function DataTable<T extends Record<string, unknown>>({ data, columns, exportName, exportTitle, exportColumns, filterPlaceholder = "Filter", empty = "Nothing to show.", rowHref, sortOptions, initialSorting = [] }: {
  data: T[]; columns: ColumnDef<T, unknown>[]; exportName?: string; exportTitle?: string; exportColumns?: Record<string, ExportColumn>;
  filterPlaceholder?: string; empty?: string;
  rowHref?: (row: T) => string | undefined;
  sortOptions?: SortOption[]; initialSorting?: SortingState;
}) {
  const router = useRouter();
  const toast = useToast();
  const openRow = (href: string | undefined) => (e: React.MouseEvent<HTMLTableRowElement>) => {
    if (!href || (e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
    if (window.getSelection()?.toString()) return;        // selecting text in a row is not a click on it
    if (e.ctrlKey || e.metaKey) window.open(href, "_blank", "noopener");
    else router.push(href);
  };
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  const [filter, setFilter] = useState("");
  const [exporting, setExporting] = useState(false);
  const table = useReactTable({
    data, columns, state: { sorting, globalFilter: filter }, onSortingChange: setSorting, onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), getFilteredRowModel: getFilteredRowModel(),
  });
  const rows = table.getRowModel().rows;
  const sortKey = (s: SortingState) => s.map((x) => `${x.id}:${x.desc ? "d" : "a"}`).join(",");
  const currentSort = sortOptions?.findIndex((o) => sortKey(o.sorting) === sortKey(sorting)) ?? -1;

  async function exportExcel() {
    setExporting(true);
    try {
      const cols = table.getAllLeafColumns().filter((c) => c.id !== "actions");
      const header = (c: (typeof cols)[number]) => (typeof c.columnDef.header === "string" ? c.columnDef.header : c.id);
      const values = rows.map((r) => cols.map((c) => {
        const v = r.getValue(c.id);
        const f = exportColumns?.[c.id]?.format;
        return f ? f(v) : v == null ? null : typeof v === "number" ? v : String(v);
      }));
      await downloadXlsx(exportName!, [{
        name: exportTitle ?? exportName!, title: exportTitle,
        columns: cols.map((c, i) => {
          const spec = exportColumns?.[c.id] ?? {};
          // width: what the column needs on screen, within 80–420 px
          const longest = Math.max(header(c).length, ...values.slice(0, 200).map((v) => String(v[i] ?? "").split("\n").reduce((m, l) => Math.max(m, l.length), 0)));
          return { header: header(c), width: spec.width ?? Math.min(420, Math.max(80, longest * 7.2 + 24)), kind: spec.kind, align: spec.align };
        }),
        rows: values,
        headerFill: "#e9efe9",
      }]);
    } catch {
      toast({ ok: false, message: "The Excel file couldn't be made. Try again." });
    } finally { setExporting(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={filterPlaceholder} aria-label={filterPlaceholder} className="max-w-xs" type="search" />
          {sortOptions?.length ? (
            <label className="flex items-center gap-2 text-sm text-ink-soft">Sort
              <select aria-label="Sort" className="h-9 rounded-md border border-line bg-panel px-2 text-ink" value={currentSort < 0 ? "custom" : String(currentSort)}
                onChange={(e) => { const o = sortOptions[Number(e.target.value)]; if (o) setSorting(o.sorting); }}>
                {currentSort < 0 ? <option value="custom">By column</option> : null}
                {sortOptions.map((o, i) => <option key={o.label} value={i}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
        </div>
        {exportName ? <Button variant="secondary" size="sm" onClick={exportExcel} pending={exporting}><Download size={16} className="mr-1" />Export Excel</Button> : null}
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
            ) : rows.map((r) => {
              const href = rowHref?.(r.original);
              return (
              <tr key={r.id} className={cn("hover:bg-paper", href && "cursor-pointer")} onClick={href ? openRow(href) : undefined} data-row-href={href}>
                {r.getVisibleCells().map((c) => <td key={c.id} className="border-b border-line-soft px-3 py-2.5 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-faint">{rows.length} of {data.length} rows</p>
    </div>
  );
}

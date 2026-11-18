/**
 * Formatted Excel (.xlsx) downloads, made in the browser (exceljs, loaded only when an export is clicked). Every
 * export of the app goes through here, so the workbooks look like the tables on screen: the same columns and
 * widths, a shaded bold header, thin borders, wrapped text with row heights that fit it, the UI font, and the
 * coloured Status / Priority / Score cells. Only the data the viewer already sees is written.
 */
import { PRIORITY_TONE, SHEET_STATUS, STATUS_TONE } from "@/lib/sheet";

export type XCell = string | number | null | undefined;
export type XKind = "text" | "number" | "hours" | "percent" | "status" | "priority" | "score" | "date";
export type XCol = {
  header: string;
  /** on-screen width in pixels; converted to Excel character widths */
  width: number;
  align?: "left" | "center" | "right";
  kind?: XKind;
};
export type XFill = { fill?: string; color?: string; bold?: boolean };
export type XSheet = {
  name: string;
  /** a title line above the table (e.g. project and date range); optional */
  title?: string;
  columns: XCol[];
  rows: XCell[][];
  /** whole-row colours (e.g. the brown non-working days of the Daily Reports sheet) */
  rowStyle?: (row: number) => XFill | undefined;
  /** per-column background (e.g. the beige Date column) */
  columnFill?: (string | undefined)[];
  headerFill?: string;
};

export const FONT = "IBM Plex Sans";
const BORDER = "FFC9D1CB";
const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`;

/** Excel column width (characters) for a width in pixels at the default font. */
export const excelWidth = (px: number) => Math.max(6, Math.round(((px - 10) / 7) * 100) / 100);

/** Lines a text needs in a column `px` wide (wrapped), at about 7 px per character. */
export function linesFor(text: XCell, px: number): number {
  if (text == null || text === "") return 1;
  const perLine = Math.max(4, Math.floor((px - 14) / 6.6));
  return String(text).split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(line.length / perLine)), 0);
}

/** Row height in points that fits the tallest wrapped cell (one line = 15 pt, plus cell padding). */
export function rowHeight(cells: XCell[], cols: XCol[]): number {
  const lines = Math.max(1, ...cells.map((c, i) => linesFor(c, cols[i]?.width ?? 100)));
  return Math.min(409, 9 + lines * 14.5);
}

/** Colours a cell gets from its kind and value (status, priority, score band). */
export function toneFor(kind: XKind | undefined, value: XCell): XFill | undefined {
  if (value == null || value === "") return undefined;
  if (kind === "status") {
    const db = Object.entries(SHEET_STATUS).find(([, label]) => label === value)?.[0] ?? String(value);
    const t = STATUS_TONE[db];
    return t ? { fill: t[0], color: t[1], bold: true } : undefined;
  }
  if (kind === "priority") {
    const t = PRIORITY_TONE[String(value)];
    return t ? { fill: t[0], color: t[1], bold: true } : undefined;
  }
  if (kind === "score" && typeof value === "number") {
    return value >= 80 ? { fill: "#d9efdf", color: "#1d6b40", bold: true } : value >= 60 ? { fill: "#fbe8b4", color: "#6f4a00", bold: true } : { fill: "#f6d5d3", color: "#9b1c17", bold: true };
  }
  return undefined;
}

/** Builds the workbook and starts the download as `${fileName}.xlsx`. */
export async function downloadXlsx(fileName: string, sheets: XSheet[]): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "FSMB Project Tracker";
  wb.created = new Date();
  for (const sh of sheets) {
    const ws = wb.addWorksheet(sh.name.slice(0, 31).replace(/[\\/?*[\]:]/g, " "), { views: [{ state: "frozen", ySplit: sh.title ? 2 : 1 }] });
    ws.columns = sh.columns.map((c) => ({ width: excelWidth(c.width) }));
    const border = { style: "thin" as const, color: { argb: BORDER } };
    const borders = { top: border, left: border, bottom: border, right: border };
    let at = 1;
    if (sh.title) {
      ws.mergeCells(1, 1, 1, sh.columns.length);
      const t = ws.getCell(1, 1);
      t.value = sh.title;
      t.font = { name: FONT, size: 12, bold: true, color: { argb: argb("#26332b") } };
      t.alignment = { vertical: "middle" };
      ws.getRow(1).height = 22;
      at = 2;
    }
    const head = ws.getRow(at);
    sh.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.header;
      cell.font = { name: FONT, size: 10, bold: true, color: { argb: argb("#26332b") } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(sh.headerFill ?? "#efeadf") } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = borders;
    });
    head.height = Math.max(20, rowHeight(sh.columns.map((c) => c.header), sh.columns));
    sh.rows.forEach((cells, r) => {
      const row = ws.getRow(at + 1 + r);
      const rs = sh.rowStyle?.(r);
      sh.columns.forEach((c, i) => {
        const cell = row.getCell(i + 1);
        const v = cells[i];
        cell.value = v == null || v === "" ? null : v;
        if (c.kind === "hours" && typeof v === "number") cell.numFmt = '0.0#" hrs"';
        if (c.kind === "percent" && typeof v === "number") cell.numFmt = '0"%"';
        const tone = rs?.fill ? undefined : toneFor(c.kind, v);
        const fill = rs?.fill ?? tone?.fill ?? sh.columnFill?.[i];
        cell.font = { name: FONT, size: 10, bold: Boolean(tone?.bold ?? rs?.bold), color: { argb: argb(rs?.color ?? tone?.color ?? "#26332b") } };
        if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: argb(fill) } };
        cell.alignment = { horizontal: c.align ?? (c.kind && c.kind !== "text" ? "center" : "left"), vertical: "middle", wrapText: true, indent: c.align === "left" || !c.align ? 0 : undefined };
        cell.border = borders;
      });
      row.height = rowHeight(cells, sh.columns);
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url; a.download = `${fileName}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

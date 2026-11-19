/**
 * Keyboard rules of the spreadsheet cells (Responsibilities and Tasklist), kept free of React so they can be tested.
 *
 *   Ctrl+Enter (⌘+Enter on a Mac)  in EVERY editable cell: back to the start of the cell — a text cell's caret to
 *                                  the start of its first line; a dropdown, date or number keeps the focus. Nothing
 *                                  is inserted, saved or submitted. Read-only cells: nothing happens.
 *   Enter                          save the cell and go to the same column in the next row
 *   Shift+Enter                    a new line inside a multi-line cell (Remarks, Task text)
 *   Escape                         put the saved text back and leave the cell
 *   Arrow Up / Down                on the first / last line of a cell: the same column in the row above / below
 */
export type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
export type CellKeyAction = "caret-start" | "commit-down" | "newline" | "cancel" | "up" | "down" | null;

export function cellKeyAction(e: KeyLike, caret: { atFirstLine: boolean; atLastLine: boolean } = { atFirstLine: true, atLastLine: true }): CellKeyAction {
  if (e.key === "Enter") {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) return "caret-start";
    if (e.shiftKey && !e.ctrlKey && !e.metaKey) return "newline";
    if (!e.ctrlKey && !e.metaKey && !e.altKey) return "commit-down";
    return null;
  }
  if (e.key === "Escape") return "cancel";
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  if (e.key === "ArrowUp" && caret.atFirstLine) return "up";
  if (e.key === "ArrowDown" && caret.atLastLine) return "down";
  return null;
}

/** Ctrl+Enter (or ⌘+Enter), without Alt or Shift. */
export function isCtrlEnter(e: KeyLike): boolean {
  return e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const TEXT_INPUTS = new Set(["text", "search", "url", "tel", "password", "email", ""]);

/** The editable sheet cell an event came from: an enabled, writable input, text area or dropdown; else null. */
export function editableField(target: EventTarget | null): Field | null {
  const el = target as Field | null;
  if (!el || typeof (el as HTMLElement).tagName !== "string") return null;
  const tag = (el as HTMLElement).tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") return null;
  if (el.disabled || (tag !== "SELECT" && (el as HTMLInputElement).readOnly)) return null;
  if (tag === "INPUT" && ["button", "submit", "reset", "checkbox", "radio", "file", "hidden"].includes((el as HTMLInputElement).type)) return null;
  return el;
}

/** Back to the start of a cell: a text field's caret to the start of its first line; other fields keep the focus. */
export function toCellStart(el: Field): void {
  const tag = (el as HTMLElement).tagName;
  if (tag === "TEXTAREA" || (tag === "INPUT" && TEXT_INPUTS.has((el as HTMLInputElement).type))) {
    caretToStart(el as HTMLInputElement);
  }
}

/** Where the caret is in a text: on its first line, on its last line. */
export function caretLines(value: string, start: number, end: number): { atFirstLine: boolean; atLastLine: boolean } {
  return { atFirstLine: !value.slice(0, start).includes("\n"), atLastLine: !value.slice(end).includes("\n") };
}

/** Moves the caret of a text field to the beginning of its first line and scrolls it there. */
export function caretToStart(el: { setSelectionRange: (a: number, b: number) => void; scrollTop: number; scrollLeft?: number }): void {
  el.setSelectionRange(0, 0);
  el.scrollTop = 0;
  if (el.scrollLeft !== undefined) el.scrollLeft = 0;
}

/**
 * The cell to go to from `from` (an element inside a sheet), `dir` rows away in the same column: cells carry
 * data-col (column name) and sit inside an element with data-sheet. Disabled cells are skipped.
 */
export function cellInColumn(from: HTMLElement, dir: 1 | -1): HTMLElement | null {
  const sheet = from.closest<HTMLElement>("[data-sheet]");
  const col = from.getAttribute("data-col");
  if (!sheet || !col) return null;
  const cells = Array.from(sheet.querySelectorAll<HTMLElement>(`[data-col="${CSS.escape(col)}"]`))
    .filter((c) => !(c as HTMLInputElement).disabled);
  const i = cells.indexOf(from);
  return i < 0 ? null : cells[i + dir] ?? null;
}

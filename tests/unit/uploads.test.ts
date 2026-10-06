import { describe, expect, it, vi } from "vitest";
import { checkUploadClaim, checkUploadContent, deleteRowThenFiles, sniffFileType, type UploadClaim } from "@/lib/uploads";

const PROJECT = "aaaaaaaa-0000-4000-8000-000000000002", REPORT = "cccccccc-0000-4000-8000-000000000001", FILE = "dddddddd-0000-4000-8000-000000000009";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)));
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], "\u0000\u0010JFIF");
const PNG = bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "\u0000\u0000\u0000\rIHDR");
const WEBP = bytes("RIFF", [0x24, 0, 0, 0], "WEBPVP8 ");
const HEIC = bytes([0, 0, 0, 0x18], "ftypheic", [0, 0, 0, 0]);
const PDF = bytes("%PDF-1.7\n%âãÏÓ\n1 0 obj");
const OOXML = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0x06, 0], "\u0000".repeat(18), "[Content_Types].xml");
const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0], "\u0000".repeat(18), "payload.exe");
const HTML = bytes("<!doctype html><script>alert(1)</script>");
const EXE = bytes("MZ", [0x90, 0, 3, 0, 0, 0]);
const SVG = bytes("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>");

const claim = (over: Partial<UploadClaim> = {}): UploadClaim => ({
  report_id: REPORT, storage_path: `${PROJECT}/${REPORT}/${FILE}-site-photo.jpg`, file_name: "Site photo.jpg", mime_type: "image/jpeg", size_bytes: 345678, ...over,
});

describe("SEC-14: a file is what its first bytes say it is", () => {
  it("recognises the kinds the app accepts", () => {
    expect(sniffFileType(JPEG)).toBe("image/jpeg");
    expect(sniffFileType(PNG)).toBe("image/png");
    expect(sniffFileType(WEBP)).toBe("image/webp");
    expect(sniffFileType(HEIC)).toBe("image/heic");
    expect(sniffFileType(PDF)).toBe("application/pdf");
    expect(sniffFileType(OOXML)).toBe("ooxml");
  });
  it("recognises nothing else", () => {
    for (const b of [HTML, EXE, SVG, ZIP, bytes("GIF89a"), bytes("RIFF", [0, 0, 0, 0], "AVI "), bytes([0, 0, 0, 0x18], "ftypmp42"), bytes(" %PDF-1.7"), new Uint8Array(0), bytes([0xff, 0xd8])]) {
      expect(sniffFileType(b)).toBeNull();
    }
  });
  it("REGRESSION: a script or page renamed to a photo or a PDF is refused", () => {
    expect(checkUploadContent(claim(), HTML)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim(), EXE)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim({ mime_type: "application/pdf", file_name: "report.pdf" }), HTML)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim({ mime_type: "image/png", file_name: "x.png" }), SVG)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim({ mime_type: DOCX, file_name: "x.docx" }), ZIP)).toMatchObject({ ok: false });       // a plain zip is not a Word file
  });
  it("a real file of another accepted kind than declared is refused too", () => {
    expect(checkUploadContent(claim(), PNG)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim({ mime_type: "application/pdf" }), JPEG)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim({ mime_type: DOCX }), PDF)).toMatchObject({ ok: false });
  });
  it("a file that cannot be read back is refused, never assumed fine", () => {
    expect(checkUploadContent(claim(), null)).toMatchObject({ ok: false });
    expect(checkUploadContent(claim(), new Uint8Array(0))).toMatchObject({ ok: false });
  });
  it("genuine files pass", () => {
    expect(checkUploadContent(claim(), JPEG)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: "image/png" }), PNG)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: "image/webp" }), WEBP)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: "image/heic" }), HEIC)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: "application/pdf" }), PDF)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: DOCX }), OOXML)).toEqual({ ok: true });
    expect(checkUploadContent(claim({ mime_type: XLSX }), OOXML)).toEqual({ ok: true });
  });
});

describe("SEC-14: what an upload may claim", () => {
  it("accepts a normal upload and returns the project from the path", () => {
    expect(checkUploadClaim(claim())).toEqual({ ok: true, projectId: PROJECT });
    expect(checkUploadClaim(claim({ mime_type: "application/pdf", storage_path: `${PROJECT}/${REPORT}/${FILE}-plan.pdf`, file_name: "Plan.pdf" }))).toMatchObject({ ok: true });
    // a resized photo is stored as .jpg whatever it was called
    expect(checkUploadClaim(claim({ file_name: "IMG_0042.PNG" }))).toMatchObject({ ok: true });
  });
  it("refuses types outside the list", () => {
    for (const mime_type of ["text/html", "image/svg+xml", "application/x-msdownload", "application/zip", "application/javascript", "", "image/jpeg; charset=x"]) {
      expect(checkUploadClaim(claim({ mime_type }))).toMatchObject({ ok: false });
    }
  });
  it("refuses empty, oversized and non-numeric sizes", () => {
    for (const size_bytes of [0, -1, 10 * 1024 * 1024 + 1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkUploadClaim(claim({ size_bytes }))).toMatchObject({ ok: false });
    }
    expect(checkUploadClaim(claim({ size_bytes: 10 * 1024 * 1024 }))).toMatchObject({ ok: true });
  });
  it("REGRESSION: refuses a path outside the report's own folder", () => {
    const other = "cccccccc-0000-4000-8000-0000000000ff";
    for (const storage_path of [
      `${PROJECT}/${other}/${FILE}-a.jpg`,                      // another report
      `${PROJECT}/${REPORT}/../${other}/${FILE}-a.jpg`,         // traversal
      `${PROJECT}/${REPORT}/sub/${FILE}-a.jpg`,                 // nested folder
      `${REPORT}/${FILE}-a.jpg`, `/${PROJECT}/${REPORT}/${FILE}-a.jpg`, `${PROJECT}/${REPORT}/a.jpg`, "", `${PROJECT}/${REPORT}/${FILE}-a b.jpg`,
    ]) {
      expect(checkUploadClaim(claim({ storage_path })), storage_path).toMatchObject({ ok: false });
    }
  });
  it("refuses a stored name whose extension does not match the declared type", () => {
    expect(checkUploadClaim(claim({ storage_path: `${PROJECT}/${REPORT}/${FILE}-photo.html` }))).toMatchObject({ ok: false });
    expect(checkUploadClaim(claim({ storage_path: `${PROJECT}/${REPORT}/${FILE}-photo.jpg.exe` }))).toMatchObject({ ok: false });
    expect(checkUploadClaim(claim({ storage_path: `${PROJECT}/${REPORT}/${FILE}-photo` }))).toMatchObject({ ok: false });
    expect(checkUploadClaim(claim({ mime_type: "application/pdf" }))).toMatchObject({ ok: false });          // .jpg path, PDF type
  });
  it("refuses unusable display names", () => {
    for (const file_name of ["", "x".repeat(256), "a/b.jpg", "a\\b.jpg", "a\u0000.jpg", "line\nbreak.jpg"]) {
      expect(checkUploadClaim(claim({ file_name }))).toMatchObject({ ok: false });
    }
  });
});

describe("SEC-14: deleting something that has stored files fails safely", () => {
  const paths = ["p/r/a.jpg", "p/r/b.pdf"];
  it("REGRESSION: a refused row delete touches no file", async () => {
    const removeFiles = vi.fn(async () => 2);
    expect(await deleteRowThenFiles({ deleteRow: async () => ({ error: null, count: 0 }), paths, removeFiles })).toEqual({ result: "refused" });
    expect(await deleteRowThenFiles({ deleteRow: async () => ({ error: null, count: null }), paths, removeFiles })).toEqual({ result: "refused" });
    expect(removeFiles).not.toHaveBeenCalled();
  });
  it("a database error touches no file and is reported", async () => {
    const removeFiles = vi.fn(async () => 2);
    const error = { code: "23503", message: "still referenced" };
    expect(await deleteRowThenFiles({ deleteRow: async () => ({ error, count: null }), paths, removeFiles })).toEqual({ result: "failed", error });
    expect(removeFiles).not.toHaveBeenCalled();
  });
  it("the row goes first, then exactly its files", async () => {
    const order: string[] = [];
    const out = await deleteRowThenFiles({
      deleteRow: async () => { order.push("row"); return { error: null, count: 1 }; }, paths,
      removeFiles: async (p) => { order.push(`files:${p.join(",")}`); return p.length; },
    });
    expect(out).toEqual({ result: "done" });
    expect(order).toEqual(["row", "files:p/r/a.jpg,p/r/b.pdf"]);
  });
  it("a file that cannot be removed afterwards is reported, never passed off as done", async () => {
    const del = async () => ({ error: null, count: 1 });
    expect(await deleteRowThenFiles({ deleteRow: del, paths, removeFiles: async () => 1 })).toEqual({ result: "files-left", left: 1 });
    expect(await deleteRowThenFiles({ deleteRow: del, paths, removeFiles: async () => 0 })).toEqual({ result: "files-left", left: 2 });
    expect(await deleteRowThenFiles({ deleteRow: del, paths, removeFiles: async () => { throw new Error("storage down"); } })).toEqual({ result: "files-left", left: 2 });
  });
  it("nothing stored: only the row", async () => {
    const removeFiles = vi.fn(async () => 0);
    expect(await deleteRowThenFiles({ deleteRow: async () => ({ error: null, count: 1 }), paths: [], removeFiles })).toEqual({ result: "done" });
    expect(removeFiles).not.toHaveBeenCalled();
  });
});

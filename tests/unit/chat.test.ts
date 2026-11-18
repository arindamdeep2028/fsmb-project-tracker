import { describe, expect, it } from "vitest";
import {
  activeMentionQuery, chatFilePath, chatMimeFor, checkChatClaim, checkChatContent, checkChatFile, dayLabel, encodeMentions,
  filterMentionable, formatBytes, initials, listTime, mentionMarkup, parseBody, plainBody,
} from "@/lib/chat";

const A = "11111111-0000-0000-0000-000000000001";
const B = "11111111-0000-0000-0000-000000000002";
const CONV = "22222222-0000-0000-0000-000000000009";
const masrur = { user_id: A, full_name: "Masrur" };
const masrurBH = { user_id: B, full_name: "Masrur Bin Habib" };

describe("mentions", () => {
  it("encodes picked people; the longer name wins", () => {
    expect(encodeMentions("@Masrur Bin Habib and @Masrur please check", [masrur, masrurBH]))
      .toBe(`@[Masrur Bin Habib](${B}) and @[Masrur](${A}) please check`);
  });
  it("does not mention someone whose @Name was deleted, or a partial word", () => {
    expect(encodeMentions("hello team", [masrur])).toBe("hello team");
    expect(encodeMentions("@Masrurx no", [masrur])).toBe("@Masrurx no");
  });
  it("strips markup characters from names", () => {
    expect(mentionMarkup({ user_id: A, full_name: "A [x] (y)" })).toBe(`@[A x y](${A})`);
  });
  it("parses a stored body into segments and plain text", () => {
    const body = `Hi @[Masrur](${A}), see @[Imam](${B.toUpperCase()}).`;
    const seg = parseBody(body);
    expect(seg).toEqual([
      { kind: "text", text: "Hi " }, { kind: "mention", name: "Masrur", userId: A }, { kind: "text", text: ", see " },
      { kind: "mention", name: "Imam", userId: B }, { kind: "text", text: "." },
    ]);
    expect(plainBody(body)).toBe("Hi @Masrur, see @Imam.");
  });
  it("leaves look-alike text that is not valid markup alone", () => {
    expect(parseBody("@[x](not-a-uuid)")).toEqual([{ kind: "text", text: "@[x](not-a-uuid)" }]);
  });
  it("finds the @query at the caret", () => {
    expect(activeMentionQuery("hello @ma", 9)).toEqual({ start: 6, query: "ma" });
    expect(activeMentionQuery("@", 1)).toEqual({ start: 0, query: "" });
    expect(activeMentionQuery("mail@host", 9)).toBeNull();
    expect(activeMentionQuery("@ma\nx", 5)).toBeNull();
  });
  it("filters mentionable people: word starts first, then contains, never yourself", () => {
    const people = [{ user_id: "1", full_name: "Imam Hossain" }, { user_id: "2", full_name: "Araf" }, { user_id: "3", full_name: "Rahim Mamun" }];
    expect(filterMentionable(people, "ma").map((p) => p.user_id)).toEqual(["3", "1"]);
    expect(filterMentionable(people, "", "2").map((p) => p.user_id)).toEqual(["1", "3"]);
  });
});

describe("files", () => {
  it("types come from the extension; unknown types are refused", () => {
    expect(chatMimeFor("Report.PDF")).toBe("application/pdf");
    expect(chatMimeFor("data.csv")).toBe("text/csv");
    expect(chatMimeFor("sheet.xlsx")).toContain("spreadsheetml");
    expect(checkChatFile({ name: "run.exe", size: 10 }).ok).toBe(false);
    expect(checkChatFile({ name: "big.pdf", size: 26 * 1024 * 1024 }).ok).toBe(false);
    expect(checkChatFile({ name: "empty.pdf", size: 0 }).ok).toBe(false);
    expect(checkChatFile({ name: "ok.png", size: 100 })).toEqual({ ok: true, mime: "image/png" });
  });
  it("paths live in the conversation folder with a safe name", () => {
    const p = chatFilePath(CONV, "Inspection Report (v2).PDF", A);
    expect(p).toBe(`${CONV}/${A}/inspection-report-v2.pdf`);
    expect(checkChatClaim(CONV, { storage_path: p, file_name: "Inspection Report (v2).PDF" })).toEqual({ ok: true, mime: "application/pdf" });
    expect(checkChatClaim(B, { storage_path: p, file_name: "x.pdf" }).ok).toBe(false);
    expect(checkChatClaim(CONV, { storage_path: `${CONV}/../x.pdf`, file_name: "x.pdf" }).ok).toBe(false);
    expect(checkChatClaim(CONV, { storage_path: `${CONV}/${A}/x.exe`, file_name: "x.exe" }).ok).toBe(false);
  });
  it("stored bytes must match the type", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(checkChatContent("application/pdf", enc("%PDF-1.7 ..."))).toBe(true);
    expect(checkChatContent("application/pdf", enc("<html>"))).toBe(false);
    expect(checkChatContent("image/png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(checkChatContent("image/gif", enc("GIF89a"))).toBe(true);
    expect(checkChatContent("text/csv", enc("a,b\n1,2"))).toBe(true);
    expect(checkChatContent("text/plain", enc("<script>alert(1)</script>"))).toBe(false);
    expect(checkChatContent("text/plain", new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(checkChatContent("application/msword", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(true);
    expect(checkChatContent("application/pdf", null)).toBe(false);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
  });
});

describe("people and time", () => {
  it("initials", () => {
    expect(initials("Masrur Bin Habib")).toBe("MH");
    expect(initials("deep")).toBe("D");
    expect(initials("")).toBe("?");
  });
  it("day and list labels use Dhaka time", () => {
    const now = new Date("2026-11-18T08:00:00Z");                       // 14:00 in Dhaka
    expect(dayLabel("2026-11-18T03:00:00Z", now)).toBe("Today, 18 Nov 2026");
    expect(dayLabel("2026-11-17T18:30:00Z", now)).toBe("Today, 18 Nov 2026"); // 00:30 on 18 Nov in Dhaka (UTC+6)
    expect(dayLabel("2026-11-17T17:30:00Z", now)).toBe("Yesterday, 17 Nov 2026"); // 23:30 on 17 Nov in Dhaka
    expect(dayLabel("2026-11-17T05:00:00Z", now)).toBe("Yesterday, 17 Nov 2026");
    expect(listTime("2026-11-16T05:00:00Z", now)).toBe("Nov 16");
    expect(listTime(null, now)).toBe("");
  });
});

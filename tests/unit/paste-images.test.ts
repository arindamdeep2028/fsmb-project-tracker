import { describe, expect, it } from "vitest";
import { genericName, namePasted, pastedImages, screenshotName } from "@/lib/paste-images";

const file = (name: string, type: string, bytes = 10) => new File([new Uint8Array(bytes)], name, { type });

describe("Ctrl+V screenshots: what is taken", () => {
  const png = file("image.png", "image/png");
  it("takes a pasted screenshot, also when pasted into a text field (a screenshot carries no text)", () => {
    expect(pastedImages({ files: [png], hasText: false, inTextField: false })).toEqual([png]);
    expect(pastedImages({ files: [png], hasText: false, inTextField: true })).toEqual([png]);
  });
  it("takes several images from one paste, in order, and drops non-images", () => {
    const b = file("image.jpg", "image/jpeg"), pdf = file("a.pdf", "application/pdf");
    expect(pastedImages({ files: [png, pdf, b], hasText: false, inTextField: false })).toEqual([png, b]);
  });
  it("leaves text pasted into a text field alone, even if the clipboard also has a picture of it", () => {
    expect(pastedImages({ files: [png], hasText: true, inTextField: true })).toBeNull();
  });
  it("takes the image when text + image are pasted outside a text field", () => {
    expect(pastedImages({ files: [png], hasText: true, inTextField: false })).toEqual([png]);
  });
  it("never touches a paste without images", () => {
    expect(pastedImages({ files: [], hasText: true, inTextField: true })).toBeNull();
    expect(pastedImages({ files: [file("a.pdf", "application/pdf")], hasText: false, inTextField: false })).toBeNull();
  });
});

describe("Ctrl+V screenshots: names", () => {
  const at = new Date(2026, 10, 16, 14, 5, 9);
  it("names a screenshot by the time it was pasted; several get -2, -3", () => {
    expect(screenshotName(at, 0, "image/png")).toBe("screenshot-2026-11-16-14-05-09.png");
    expect(screenshotName(at, 1, "image/png")).toBe("screenshot-2026-11-16-14-05-09-2.png");
    expect(screenshotName(at, 0, "image/jpeg")).toBe("screenshot-2026-11-16-14-05-09.jpg");
  });
  it("renames only the browser's placeholder names, keeping type and bytes", () => {
    expect(genericName("image.png")).toBe(true);
    expect(genericName("blob")).toBe(true);
    expect(genericName("site-photo.png")).toBe(false);
    const renamed = namePasted(file("image.png", "image/png", 42), at, 0);
    expect(renamed.name).toBe("screenshot-2026-11-16-14-05-09.png");
    expect(renamed.type).toBe("image/png");
    expect(renamed.size).toBe(42);
    const kept = file("rig-panel.png", "image/png");
    expect(namePasted(kept, at, 0)).toBe(kept);
  });
});

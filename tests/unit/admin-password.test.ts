import { describe, expect, it } from "vitest";
import { setPasswordInput } from "@/lib/validation";

const id = "11111111-0000-0000-0000-000000000012";

describe("admin sets another user's password", () => {
  it("needs a target user, 10–72 characters and a matching confirmation", () => {
    expect(setPasswordInput.safeParse({ user_id: id, password: "NewPass@2026", confirm_password: "NewPass@2026" }).success).toBe(true);
    expect(setPasswordInput.safeParse({ user_id: id, password: "NewPass@2026", confirm_password: "NewPass@2027" }).success).toBe(false);
    expect(setPasswordInput.safeParse({ user_id: id, password: "short", confirm_password: "short" }).success).toBe(false);
    expect(setPasswordInput.safeParse({ user_id: id, password: "x".repeat(73), confirm_password: "x".repeat(73) }).success).toBe(false);
    expect(setPasswordInput.safeParse({ user_id: "not-a-user", password: "NewPass@2026", confirm_password: "NewPass@2026" }).success).toBe(false);
  });
});

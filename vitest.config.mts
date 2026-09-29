import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { "@": here("./"), "server-only": here("./tests/unit/empty.ts") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});

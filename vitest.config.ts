import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests cover the pure, deterministic, zero-cost logic only — the control
// gate, alert parsers, cost math, secret scan, rubric scoring. The LLM-in-the-loop
// behaviour is covered separately by `npm run agent --selftest` and the eval batch.
export default defineConfig({
  // Resolve the `@/*` → `./src/*` path alias from tsconfig natively (Vite 6+).
  resolve: {
    tsconfigPaths: true,
    // Next.js resolves this marker with the `react-server` condition. Vitest
    // does not, so point unit tests at the marker's intentional no-op export.
    alias: {
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

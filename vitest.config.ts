import { defineConfig } from "vitest/config";

// Unit tests cover the pure, deterministic, zero-cost logic only — the control
// gate, alert parsers, cost math, secret scan, rubric scoring. The LLM-in-the-loop
// behaviour is covered separately by `npm run agent --selftest` and the eval batch.
export default defineConfig({
  // Resolve the `@/*` → `./src/*` path alias from tsconfig natively (Vite 6+).
  resolve: { tsconfigPaths: true },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});

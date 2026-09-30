import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { hash } from "./artifacts";

/** Same source identity for generation, report replay and run comparisons. */
export function sourceHash() {
  const paths: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (/\.(ts|tsx|json)$/.test(path)) paths.push(path);
    }
  }
  scan("src"); scan("scripts");
  return hash([...paths.sort(), "package-lock.json", "evals/protocol-v2.json"].map(path => [path, readFileSync(path, "utf8")]));
}

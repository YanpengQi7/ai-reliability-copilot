const switches = new Set(["mock", "live", "export-public"]);
const creationFlags = new Set(["dataset", "split", "limit", "modes", "languages", "repeats", "seed", "max-usd", "max-minutes", "per-call-usd", "max-calls", "max-output-tokens", "input-price", "output-price", "model", "ablation", "calibration"]);
const scoringFlags = new Set(["judge-model", "judge-input-price", "judge-output-price"]);
const commands = new Set(["validate", "generate", "score", "report", "check", "run", "calibrate", "calibration-report"]);
const allowed = new Set(["id", "judge-run", ...switches, ...creationFlags, ...scoringFlags]);

export function parseEvalFlags(args: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (const arg of args) {
    if (!arg.startsWith("--")) throw new Error("Use --name=value flags");
    const [key, ...rest] = arg.slice(2).split("=");
    if (!allowed.has(key)) throw new Error(`Unknown flag ${key}`);
    if (flags.has(key)) throw new Error(`Duplicate flag ${key}`);
    const value = rest.length ? rest.join("=") : "true";
    if (switches.has(key) ? value !== "true" : !rest.length || !value.trim()) throw new Error(`Invalid value for --${key}`);
    flags.set(key, value);
  }
  if (flags.has("mock") && flags.has("live")) throw new Error("Choose only one execution mode");
  return flags;
}

export function validateEvalFlags(command: string, flags: Map<string, string>, existing: boolean) {
  if (!commands.has(command)) throw new Error(`Unknown evaluation command: ${command}`);
  for (const key of flags.keys()) {
    if (command === "validate") {
      if (key !== "dataset") throw new Error(`validate does not accept --${key}`);
      continue;
    }
    if (creationFlags.has(key) && (existing || !["generate", "run"].includes(command))) throw new Error(`--${key} is for new runs only; existing runs use their saved manifest`);
    if (scoringFlags.has(key) && (!["generate", "run", "score", "calibrate"].includes(command) || existing && command === "generate")) throw new Error(`--${key} is not used by ${command}; select a saved --judge-run instead`);
    if (key === "export-public" && !["run", "report", "check"].includes(command)) throw new Error(`${command} does not export reports`);
  }
}

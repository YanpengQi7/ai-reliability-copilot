import {
  RESPONSE_LIMITS,
  sanitizeResponseProgress,
  type ActionStatus,
  type ResponseAction,
  type ResponseProgress,
} from "./responseActions";

/** Injected so these operations remain browser-safe and independently testable. */
export type ResponseWorkspaceStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

export type ResponseWorkspaceReadResult =
  | { kind: "empty" }
  | { kind: "restored"; progress: ResponseProgress }
  | { kind: "invalid" }
  | { kind: "unavailable" };

const STATUSES = new Set<ActionStatus>(["todo", "in_progress", "blocked", "done"]);
const PAYLOAD_FIELDS = new Set(["schema_version", "workspace_id", "progress"]);
const ROW_FIELDS = new Set(["status", "owner", "outcome"]);
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

function plainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The caller supplies the incident, analysis, and normalized-content identity. */
export function responseWorkspaceStorageKey(workspaceId: string): string {
  return `copilot:response:v1:${workspaceId}`;
}

/** Reading a saved opt-in is read-only; corrupt or unavailable storage is never rewritten. */
export function readResponseWorkspace(
  storage: ResponseWorkspaceStorage,
  workspaceId: string,
  actions: readonly ResponseAction[],
): ResponseWorkspaceReadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(responseWorkspaceStorageKey(workspaceId));
  } catch {
    return { kind: "unavailable" };
  }
  if (raw === null) return { kind: "empty" };
  if (typeof raw !== "string" || raw.length > RESPONSE_LIMITS.storageChars) return { kind: "invalid" };

  try {
    const payload: unknown = JSON.parse(raw);
    if (!plainRecord(payload)
      || Object.keys(payload).some(key => !PAYLOAD_FIELDS.has(key))
      || !own(payload, "schema_version") || payload.schema_version !== 1
      || !own(payload, "workspace_id") || payload.workspace_id !== workspaceId
      || !own(payload, "progress") || !plainRecord(payload.progress)) {
      return { kind: "invalid" };
    }

    const known: ResponseProgress = Object.create(null);
    for (const action of actions) {
      if (!own(payload.progress, action.id)) continue;
      const row = payload.progress[action.id];
      if (!plainRecord(row)
        || Object.keys(row).some(key => !ROW_FIELDS.has(key))
        || !own(row, "status") || typeof row.status !== "string" || !STATUSES.has(row.status as ActionStatus)
        || !own(row, "owner") || typeof row.owner !== "string" || row.owner.length > RESPONSE_LIMITS.owner
        || !own(row, "outcome") || typeof row.outcome !== "string" || row.outcome.length > RESPONSE_LIMITS.outcome) {
        return { kind: "invalid" };
      }
      known[action.id] = { status: row.status as ActionStatus, owner: row.owner, outcome: row.outcome };
    }
    return { kind: "restored", progress: sanitizeResponseProgress(actions, known) };
  } catch {
    return { kind: "invalid" };
  }
}

/** Persist only sanitized progress after the caller's explicit opt-in. */
export function writeResponseWorkspace(
  storage: ResponseWorkspaceStorage,
  workspaceId: string,
  actions: readonly ResponseAction[],
  progress: ResponseProgress,
): boolean {
  try {
    const entries: Array<[string, Record<string, unknown>]> = [];
    if (plainRecord(progress)) {
      for (const action of actions) {
        if (!own(progress, action.id)) continue;
        const row: unknown = progress[action.id];
        if (!plainRecord(row)) continue;
        entries.push([action.id, Object.fromEntries(
          [...ROW_FIELDS].filter(field => own(row, field)).map(field => [field, row[field]]),
        )]);
      }
    }
    const payload = JSON.stringify({
      schema_version: 1,
      workspace_id: workspaceId,
      progress: sanitizeResponseProgress(actions, Object.fromEntries(entries)),
    });
    if (payload.length > RESPONSE_LIMITS.storageChars) return false;
    storage.setItem(responseWorkspaceStorageKey(workspaceId), payload);
    return true;
  } catch {
    return false;
  }
}

/** Revocation deletes this workspace's saved record without inspecting other keys. */
export function clearResponseWorkspace(storage: ResponseWorkspaceStorage, workspaceId: string): boolean {
  try {
    storage.removeItem(responseWorkspaceStorageKey(workspaceId));
    return true;
  } catch {
    return false;
  }
}

import { describe, expect, it, vi } from "vitest";
import { RESPONSE_LIMITS, type ActionStatus, type ResponseAction, type ResponseProgress } from "./responseActions";
import {
  clearResponseWorkspace,
  readResponseWorkspace,
  responseWorkspaceStorageKey,
  writeResponseWorkspace,
  type ResponseWorkspaceStorage,
} from "./responseWorkspaceStorage";

const workspaceId = "incident-id:analysis-id:source-hash";
const action: ResponseAction = {
  id: "investigation:0", category: "investigation", title: "Check connection saturation",
  command: "SOURCE_COMMAND_NOT_FOR_STORAGE", expected: "SOURCE_EXPECTED_NOT_FOR_STORAGE",
  risk: "SOURCE_RISK_NOT_FOR_STORAGE", rollback: "SOURCE_ROLLBACK_NOT_FOR_STORAGE",
  suggestedOwner: "SOURCE_OWNER_NOT_FOR_STORAGE", priority: "P1",
};
const actions = [action];
const progress: ResponseProgress = {
  [action.id]: { status: "in_progress", owner: "On-call SRE", outcome: "Connection pool saturated" },
};

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: vi.fn((key: string) => items.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { items.set(key, value); }),
    removeItem: vi.fn((key: string) => { items.delete(key); }),
  };
}

function savedPayload(value: unknown = progress, id: unknown = workspaceId, version: unknown = 1): string {
  return JSON.stringify({ schema_version: version, workspace_id: id, progress: value });
}

describe("responseWorkspaceStorageKey", () => {
  it("namespaces exact workspace identities and separates incidents, versions, and source content", () => {
    expect(responseWorkspaceStorageKey(workspaceId)).toBe(`copilot:response:v1:${workspaceId}`);
    const ids = [workspaceId, "other-incident:analysis-id:source-hash", "incident-id:other-analysis:source-hash", "incident-id:analysis-id:reordered-source-hash"];
    expect(new Set(ids.map(responseWorkspaceStorageKey)).size).toBe(ids.length);
  });
});

describe("readResponseWorkspace", () => {
  it("reports missing storage as empty without writing", () => {
    const storage = memoryStorage();
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "empty" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it("restores a saved opt-in without changing the stored record", () => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload());
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "restored", progress });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each(["todo", "in_progress", "blocked", "done"] as ActionStatus[])("accepts a recorded %s status", status => {
    const storage = memoryStorage();
    const value = { [action.id]: { status, owner: "Owner", outcome: "Outcome" } };
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload(value));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "restored", progress: value });
  });

  it("ignores stale IDs even when their rows are malformed", () => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload({ ...progress, "old-action:0": null, "old-action:1": { source: "ignored" } }));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "restored", progress });
  });

  it("isolates saved records and rejects moving another workspace's payload under this key", () => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload());
    expect(readResponseWorkspace(storage, "another-workspace", actions)).toEqual({ kind: "empty" });
    storage.items.set(responseWorkspaceStorageKey("another-workspace"), savedPayload());
    expect(readResponseWorkspace(storage, "another-workspace", actions)).toEqual({ kind: "invalid" });
  });

  it.each([undefined, null, 0, 2, "1"])("rejects unsupported schema version %j", version => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), JSON.stringify({ schema_version: version, workspace_id: workspaceId, progress }));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
  });

  it.each([null, 12, "another-workspace"])("rejects a mismatched workspace identity %j", id => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload(progress, id));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
  });

  it.each(["", "{", "null", "[]", "1", '"text"', '{}'])("rejects corrupt or non-object storage %j without rewriting", raw => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), raw);
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it.each([null, [], "rows", 7])("rejects a non-object progress map %j", value => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload(value));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
  });

  it.each([
    null, [], "row",
    { status: "unknown", owner: "Owner", outcome: "Outcome" },
    { status: 1, owner: "Owner", outcome: "Outcome" },
    { owner: "Owner", outcome: "Outcome" },
    { status: "done", outcome: "Outcome" },
    { status: "done", owner: "Owner" },
    { status: "done", owner: 5, outcome: "Outcome" },
    { status: "done", owner: "Owner", outcome: [] },
    { status: "done", owner: "x".repeat(RESPONSE_LIMITS.owner + 1), outcome: "Outcome" },
    { status: "done", owner: "Owner", outcome: "x".repeat(RESPONSE_LIMITS.outcome + 1) },
    { status: "done", owner: "Owner", outcome: "Outcome", command: "Never restore source commands" },
  ])("rejects malformed known rows %j", row => {
    const storage = memoryStorage();
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload({ [action.id]: row }));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
  });

  it("rejects unknown top-level fields and oversized raw payloads before restoring", () => {
    const storage = memoryStorage();
    const key = responseWorkspaceStorageKey(workspaceId);
    storage.items.set(key, JSON.stringify({ schema_version: 1, workspace_id: workspaceId, progress, raw_context: "DO_NOT_STORE_CONTEXT" }));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
    storage.items.set(key, " ".repeat(RESPONSE_LIMITS.storageChars + 1));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "invalid" });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("ignores prototype-shaped unknown IDs without polluting object prototypes", () => {
    const storage = memoryStorage();
    const rows = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload({ ...rows, ...progress }));
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "restored", progress });
    expect(Object.prototype).not.toHaveProperty("polluted");
  });

  it("redacts supported credentials from restored owner and outcome text", () => {
    const storage = memoryStorage();
    const secret = "sk-" + "a".repeat(30);
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload({
      [action.id]: { status: "blocked", owner: `Owner ${secret}`, outcome: "-----BEGIN PRIVATE KEY-----\nPRIVATE_BODY_TO_REMOVE\n-----END PRIVATE KEY-----" },
    }));
    const restored = readResponseWorkspace(storage, workspaceId, actions);
    expect(restored.kind).toBe("restored");
    expect(JSON.stringify(restored)).not.toContain(secret);
    expect(JSON.stringify(restored)).not.toContain("PRIVATE_BODY_TO_REMOVE");
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("classifies getItem access failures as unavailable", () => {
    const storage = memoryStorage();
    storage.getItem.mockImplementation(() => { throw new Error("Storage blocked"); });
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "unavailable" });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});

describe("writeResponseWorkspace", () => {
  it("persists only schema version, workspace identity, and sanitized progress", () => {
    const storage = memoryStorage();
    expect(writeResponseWorkspace(storage, workspaceId, actions, progress)).toBe(true);
    expect(JSON.parse(storage.items.get(responseWorkspaceStorageKey(workspaceId))!)).toEqual({
      schema_version: 1, workspace_id: workspaceId, progress,
    });
    const persisted = storage.items.get(responseWorkspaceStorageKey(workspaceId))!;
    for (const source of [action.title, action.command, action.expected, action.risk, action.rollback, action.suggestedOwner]) {
      expect(persisted).not.toContain(source);
    }
    expect(storage.getItem).not.toHaveBeenCalled();
  });

  it("redacts complete and truncated private keys and credential tokens before writing", () => {
    const storage = memoryStorage();
    const secret = "sk-" + "a".repeat(30);
    const original: ResponseProgress = {
      [action.id]: { status: "blocked", owner: `Owner ${secret}`, outcome: "Failure\n-----BEGIN RSA PRIVATE KEY-----\nTRUNCATED_BODY_TO_REMOVE" },
    };
    expect(writeResponseWorkspace(storage, workspaceId, actions, original)).toBe(true);
    const persisted = storage.items.get(responseWorkspaceStorageKey(workspaceId))!;
    expect(persisted).not.toContain(secret);
    expect(persisted).not.toContain("TRUNCATED_BODY_TO_REMOVE");
    expect(persisted).toContain("[REDACTED: Private key (PEM)]");
    expect(original[action.id].owner).toContain(secret);
  });

  it("bounds notes, normalizes invalid statuses, and strips stale IDs and extra fields", () => {
    const storage = memoryStorage();
    const input = {
      [action.id]: { status: "not-a-status", owner: "o".repeat(RESPONSE_LIMITS.owner + 50), outcome: "n".repeat(RESPONSE_LIMITS.outcome + 100), raw_context: "PRIVATE_CONTEXT" },
      "stale:0": { status: "done", owner: "Stale owner", outcome: "Stale note" },
    } as unknown as ResponseProgress;
    expect(writeResponseWorkspace(storage, workspaceId, actions, input)).toBe(true);
    const payload = JSON.parse(storage.items.get(responseWorkspaceStorageKey(workspaceId))!);
    expect(payload.progress[action.id]).toEqual({ status: "todo", owner: "o".repeat(RESPONSE_LIMITS.owner), outcome: "n".repeat(RESPONSE_LIMITS.outcome) });
    expect(Object.keys(payload.progress)).toEqual([action.id]);
    expect(JSON.stringify(payload)).not.toContain("PRIVATE_CONTEXT");
  });

  it("never treats inherited progress as saved user state", () => {
    const storage = memoryStorage();
    const inherited = Object.create(progress) as ResponseProgress;
    expect(writeResponseWorkspace(storage, workspaceId, actions, inherited)).toBe(true);
    const payload = JSON.parse(storage.items.get(responseWorkspaceStorageKey(workspaceId))!);
    expect(payload.progress[action.id]?.status ?? "todo").toBe("todo");
    expect(JSON.stringify(payload)).not.toContain("Connection pool saturated");
  });

  it("never serializes progress fields inherited from a row prototype", () => {
    const storage = memoryStorage();
    const inheritedRow = Object.create({ status: "done", owner: "INHERITED_OWNER", outcome: "INHERITED_OUTCOME" });
    expect(writeResponseWorkspace(storage, workspaceId, actions, { [action.id]: inheritedRow })).toBe(true);
    const payload = JSON.parse(storage.items.get(responseWorkspaceStorageKey(workspaceId))!);
    expect(payload.progress[action.id]?.status ?? "todo").toBe("todo");
    expect(JSON.stringify(payload)).not.toContain("INHERITED_OWNER");
    expect(JSON.stringify(payload)).not.toContain("INHERITED_OUTCOME");
  });

  it("rejects oversized serialized progress without overwriting an existing saved record", () => {
    const storage = memoryStorage();
    const key = responseWorkspaceStorageKey(workspaceId);
    const original = savedPayload();
    storage.items.set(key, original);
    const manyActions = Array.from({ length: 70 }, (_, index) => ({ ...action, id: `investigation:${index}` }));
    const manyRows = Object.fromEntries(manyActions.map(item => [item.id, { status: "done", owner: "o".repeat(RESPONSE_LIMITS.owner), outcome: "n".repeat(RESPONSE_LIMITS.outcome) }])) as ResponseProgress;
    expect(writeResponseWorkspace(storage, workspaceId, manyActions, manyRows)).toBe(false);
    expect(storage.items.get(key)).toBe(original);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("reports quota/access failures without throwing", () => {
    const storage: ResponseWorkspaceStorage = {
      getItem: () => null,
      setItem: () => { throw new Error("Quota exceeded"); },
      removeItem: () => undefined,
    };
    expect(writeResponseWorkspace(storage, workspaceId, actions, progress)).toBe(false);
  });
});

describe("clearResponseWorkspace", () => {
  it("revokes saved state for exactly one identity", () => {
    const storage = memoryStorage();
    const otherId = "incident-id:older-analysis:other-hash";
    storage.items.set(responseWorkspaceStorageKey(workspaceId), savedPayload());
    storage.items.set(responseWorkspaceStorageKey(otherId), savedPayload(progress, otherId));
    expect(clearResponseWorkspace(storage, workspaceId)).toBe(true);
    expect(readResponseWorkspace(storage, workspaceId, actions)).toEqual({ kind: "empty" });
    expect(readResponseWorkspace(storage, otherId, actions)).toEqual({ kind: "restored", progress });
    expect(storage.removeItem).toHaveBeenCalledExactlyOnceWith(responseWorkspaceStorageKey(workspaceId));
  });

  it("handles already-empty records and failed deletion", () => {
    const storage = memoryStorage();
    expect(clearResponseWorkspace(storage, workspaceId)).toBe(true);
    storage.removeItem.mockImplementation(() => { throw new Error("Removal blocked"); });
    expect(clearResponseWorkspace(storage, workspaceId)).toBe(false);
  });
});

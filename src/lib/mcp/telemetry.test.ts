import { describe, expect, it } from "vitest";
import { getTelemetryClientIp, withClientIp } from "./telemetry";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("MCP telemetry request context", () => {
  it("keeps client IPs isolated across overlapping requests", async () => {
    const firstCanRead = deferred();
    const secondCanRead = deferred();
    const firstStarted = deferred();
    const secondStarted = deferred();

    const first = withClientIp("client-a", async () => {
      firstStarted.resolve();
      await firstCanRead.promise;
      return getTelemetryClientIp();
    });
    await firstStarted.promise;

    const second = withClientIp("client-b", async () => {
      secondStarted.resolve();
      await secondCanRead.promise;
      return getTelemetryClientIp();
    });
    await secondStarted.promise;

    firstCanRead.resolve();
    await expect(first).resolves.toBe("client-a");
    secondCanRead.resolve();
    await expect(second).resolves.toBe("client-b");
    expect(getTelemetryClientIp()).toBeNull();
  });

  it("restores an outer request context after nested work", async () => {
    await withClientIp("outer", async () => {
      await withClientIp("inner", async () => {
        expect(getTelemetryClientIp()).toBe("inner");
      });
      expect(getTelemetryClientIp()).toBe("outer");
    });
  });
});

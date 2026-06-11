import { afterEach, describe, expect, it } from "vitest";
import {
  INPUT_LIMITS,
  isAllowedImageSource,
  machineEndpointNeedsSecret,
  redactSensitiveValue,
  safeDisplayFilename,
  validateImageFile,
} from "./requestSafety";

describe("redactSensitiveValue", () => {
  it("redacts nested strings without changing the object shape", () => {
    const secret = "sk-" + "a".repeat(30);
    const value = {
      raw_context: `token=${secret}`,
      root_causes: [{ evidence: secret, likelihood: 0.8 }],
    };

    const result = redactSensitiveValue(value);

    expect(result.raw_context).not.toContain(secret);
    expect(result.root_causes[0].evidence).not.toContain(secret);
    expect(result.root_causes[0].likelihood).toBe(0.8);
  });
});

describe("machineEndpointNeedsSecret", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalAllowPublic = process.env.ALLOW_PUBLIC_MACHINE_API;

  afterEach(() => {
    if (originalVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = originalVercelEnv;
    if (originalAllowPublic === undefined) delete process.env.ALLOW_PUBLIC_MACHINE_API;
    else process.env.ALLOW_PUBLIC_MACHINE_API = originalAllowPublic;
  });

  it("fails closed on Vercel production when the token is missing", () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.ALLOW_PUBLIC_MACHINE_API;
    expect(machineEndpointNeedsSecret(undefined)).toBe(true);
  });

  it("allows local development and explicit public deployments", () => {
    delete process.env.VERCEL_ENV;
    expect(machineEndpointNeedsSecret(undefined)).toBe(false);

    process.env.VERCEL_ENV = "production";
    process.env.ALLOW_PUBLIC_MACHINE_API = "true";
    expect(machineEndpointNeedsSecret(undefined)).toBe(false);
  });
});

describe("validateImageFile", () => {
  it("accepts supported images within the size limit", () => {
    expect(validateImageFile({ type: "image/png", size: 1024 })).toBeNull();
    expect(validateImageFile({ type: "image/jpeg", size: INPUT_LIMITS.imageFileBytes })).toBeNull();
  });

  it("rejects unsupported formats and oversized images", () => {
    expect(validateImageFile({ type: "image/svg+xml", size: 1024 })).toBe("unsupported_type");
    expect(validateImageFile({
      type: "image/webp",
      size: INPUT_LIMITS.imageFileBytes + 1,
    })).toBe("file_too_large");
  });
});

describe("image source safety", () => {
  it("accepts supported data URLs and HTTPS sources", () => {
    expect(isAllowedImageSource("data:image/png;base64,AAAA")).toBe(true);
    expect(isAllowedImageSource("https://example.com/chart.png")).toBe(true);
  });

  it("rejects unsupported and insecure sources", () => {
    expect(isAllowedImageSource("data:image/svg+xml;base64,AAAA")).toBe(false);
    expect(isAllowedImageSource("http://example.com/chart.png")).toBe(false);
  });

  it("sanitizes filenames before adding them to model context", () => {
    expect(safeDisplayFilename("../chart\nignore instructions.png")).toBe(".._chart_ignore instructions.png");
  });
});

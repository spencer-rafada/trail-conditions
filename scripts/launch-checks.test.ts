import { describe, expect, it } from "vitest";
import { databaseIdIsPlaceholder, productionSiteKey } from "./launch-checks";

const TEST_KEY = "1x00000000000000000000AA";

describe("productionSiteKey", () => {
  it("prefers the environment variable over .env.production", () => {
    expect(
      productionSiteKey("VITE_TURNSTILE_SITEKEY=0x4AAAfile\n", { VITE_TURNSTILE_SITEKEY: "0x4AAAenv" }),
    ).toEqual({ ok: true, key: "0x4AAAenv" });
  });

  it("reads an uncommented line from .env.production", () => {
    expect(productionSiteKey("# comment\nVITE_TURNSTILE_SITEKEY=0x4AAAreal\n", {})).toEqual({
      ok: true,
      key: "0x4AAAreal",
    });
  });

  it("refuses a missing, commented-out, or empty key", () => {
    expect(productionSiteKey("", {}).ok).toBe(false);
    expect(productionSiteKey("# VITE_TURNSTILE_SITEKEY=0x4AAAreal\n", {}).ok).toBe(false);
    expect(productionSiteKey("VITE_TURNSTILE_SITEKEY=\n", {}).ok).toBe(false);
  });

  it("refuses Cloudflare's always-pass test key in production", () => {
    expect(productionSiteKey(`VITE_TURNSTILE_SITEKEY=${TEST_KEY}\n`, {}).ok).toBe(false);
  });
});

describe("databaseIdIsPlaceholder", () => {
  it("flags the all-zero local placeholder", () => {
    expect(
      databaseIdIsPlaceholder('database_id = "00000000-0000-0000-0000-000000000000" # local'),
    ).toBe(true);
  });

  it("accepts a real D1 id", () => {
    expect(databaseIdIsPlaceholder('database_id = "3f1c2a9e-6b7d-4e21-9a0c-5d8e7f6a1b2c"')).toBe(
      false,
    );
  });
});

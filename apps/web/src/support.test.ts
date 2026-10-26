import { describe, expect, it } from "vitest";
import { supportUrl } from "./support";

describe("supportUrl", () => {
  it("accepts an https link (e.g. a Ko-fi page)", () => {
    expect(supportUrl("https://ko-fi.com/srafada")).toBe("https://ko-fi.com/srafada");
    expect(supportUrl("  https://ko-fi.com/srafada  ")).toBe("https://ko-fi.com/srafada");
  });

  it("hides the link when unset, empty, or not a safe https URL", () => {
    expect(supportUrl(undefined)).toBeNull();
    expect(supportUrl("")).toBeNull();
    expect(supportUrl("ko-fi.com/srafada")).toBeNull(); // no scheme
    expect(supportUrl("http://ko-fi.com/srafada")).toBeNull(); // not https
    expect(supportUrl("javascript:alert(1)")).toBeNull();
  });
});

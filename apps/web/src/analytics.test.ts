import { describe, expect, it } from "vitest";
import { startAnalytics } from "./analytics";

function fakeDocument() {
  const added: Array<{ src: string; defer: boolean; attrs: Record<string, string> }> = [];
  return {
    added,
    createElement: () => {
      const el = {
        src: "",
        defer: false,
        attrs: {} as Record<string, string>,
        setAttribute(name: string, value: string) {
          this.attrs[name] = value;
        },
      };
      return el;
    },
    body: {
      appendChild: (el: (typeof added)[number]) => {
        added.push(el);
        return el;
      },
    },
  };
}

describe("startAnalytics", () => {
  it("adds Cloudflare's cookieless beacon with the token, tracking app routes", () => {
    const doc = fakeDocument();
    startAnalytics("abc123", doc as unknown as Document);
    expect(doc.added).toHaveLength(1);
    expect(doc.added[0]!.src).toBe("https://static.cloudflareinsights.com/beacon.min.js");
    expect(doc.added[0]!.defer).toBe(true);
    expect(JSON.parse(doc.added[0]!.attrs["data-cf-beacon"]!)).toEqual({
      token: "abc123",
      spa: true,
    });
  });

  it("does nothing without a token", () => {
    const doc = fakeDocument();
    startAnalytics("", doc as unknown as Document);
    startAnalytics(undefined, doc as unknown as Document);
    expect(doc.added).toHaveLength(0);
  });
});

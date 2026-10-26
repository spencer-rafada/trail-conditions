import { describe, expect, it } from "vitest";
import { MAP_STYLE_KEY, readMapStyle, saveMapStyle } from "./mapStyle";

function memory(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

describe("map style preference", () => {
  it("defaults to the simple map", () => {
    expect(readMapStyle(memory())).toBe("simple");
  });

  it("remembers topo once chosen", () => {
    const s = memory();
    saveMapStyle("topo", s);
    expect(s.getItem(MAP_STYLE_KEY)).toBe("topo");
    expect(readMapStyle(s)).toBe("topo");
  });

  it("falls back to simple when storage throws (private mode, blocked storage)", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readMapStyle(broken)).toBe("simple");
    expect(() => saveMapStyle("topo", broken)).not.toThrow();
  });
});

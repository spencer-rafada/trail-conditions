import { describe, expect, it } from "vitest";
import { getDeviceId, DEVICE_ID_KEY } from "./device";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    map,
  };
}

describe("getDeviceId", () => {
  it("mints a UUID once and stores it", () => {
    const storage = fakeStorage();
    let minted = 0;
    const mint = () => {
      minted += 1;
      return "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    };
    const first = getDeviceId(storage, mint);
    const second = getDeviceId(storage, mint);
    expect(first).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(second).toBe(first);
    expect(minted).toBe(1);
    expect(storage.map.get(DEVICE_ID_KEY)).toBe(first);
  });

  it("reuses an id that is already stored", () => {
    const storage = fakeStorage({ [DEVICE_ID_KEY]: "existing-device-id" });
    expect(getDeviceId(storage, () => "never-called")).toBe("existing-device-id");
  });
});

import { describe, expect, it } from "vitest";
import { POPUP_WIDTH, popupPlacement } from "./mapPopup";

const MAP = { width: 900, height: 700 };

describe("popupPlacement", () => {
  it("centers the card above the pin when there is room", () => {
    expect(popupPlacement({ x: 450, y: 400 }, MAP)).toEqual({
      left: 450 - POPUP_WIDTH / 2,
      top: 378,
      above: true,
    });
  });

  it("drops below the pin near the top of the map", () => {
    const p = popupPlacement({ x: 450, y: 120 }, MAP);
    expect(p?.above).toBe(false);
    expect(p?.top).toBe(142);
  });

  it("keeps the card inside the map at the left and right edges", () => {
    expect(popupPlacement({ x: 20, y: 400 }, MAP)?.left).toBe(12);
    expect(popupPlacement({ x: 890, y: 400 }, MAP)?.left).toBe(900 - POPUP_WIDTH - 12);
  });

  it("hides the card when the pin is panned off the map", () => {
    expect(popupPlacement({ x: -5, y: 400 }, MAP)).toBeNull();
    expect(popupPlacement({ x: 450, y: 701 }, MAP)).toBeNull();
  });
});

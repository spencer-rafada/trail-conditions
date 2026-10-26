// Where the desktop pin preview sits (pure): centered over the pin, above
// it when there is room (as Airbnb does), else below; kept inside the map
// horizontally, and hidden once the pin is panned out of view.

export const POPUP_WIDTH = 300;
/** Space between the pin's center and the card. */
const GAP_PX = 22;
/** Margin kept between the card and the map's left/right edges. */
const EDGE_PX = 12;
/** Below this distance from the top, the card would be cut off above. */
const ROOM_ABOVE_PX = 240;

export interface PopupPlacement {
  left: number;
  /** The card's bottom edge when above, its top edge when below. */
  top: number;
  above: boolean;
}

export function popupPlacement(
  pin: { x: number; y: number },
  map: { width: number; height: number },
): PopupPlacement | null {
  if (pin.x < 0 || pin.y < 0 || pin.x > map.width || pin.y > map.height) return null;
  const maxLeft = Math.max(EDGE_PX, map.width - POPUP_WIDTH - EDGE_PX);
  const left = Math.min(Math.max(pin.x - POPUP_WIDTH / 2, EDGE_PX), maxLeft);
  const above = pin.y >= ROOM_ABOVE_PX;
  return { left, top: above ? pin.y - GAP_PX : pin.y + GAP_PX, above };
}

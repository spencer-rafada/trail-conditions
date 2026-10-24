// Phone bottom sheet over the map, with three heights: peek (just the
// summary), half (default — results visible at once), and full. Drag the
// handle, or tap it to step between heights. Desktop does not use this.

import { useEffect, useRef, useState, type ReactNode } from "react";

export type Snap = "peek" | "half" | "full";

const PEEK_PX = 92;
/** Room kept above a full sheet for the floating search and chips. */
const TOP_GAP_PX = 128;

export function snapHeights(viewportPx: number): Record<Snap, number> {
  const full = Math.max(PEEK_PX + 40, viewportPx - TOP_GAP_PX);
  const half = Math.min(full, Math.max(PEEK_PX + 120, Math.round(viewportPx * 0.48)));
  return { peek: PEEK_PX, half, full };
}

export function nearestSnap(heightPx: number, heights: Record<Snap, number>): Snap {
  const order: Snap[] = ["peek", "half", "full"];
  return order.reduce((best, s) =>
    Math.abs(heights[s] - heightPx) < Math.abs(heights[best] - heightPx) ? s : best,
  );
}

export function BottomSheet({
  snap,
  onSnapChange,
  onHeightChange,
  header,
  children,
}: {
  snap: Snap;
  onSnapChange: (snap: Snap) => void;
  onHeightChange: (px: number) => void;
  header: ReactNode;
  children: ReactNode;
}) {
  const [viewport, setViewport] = useState(() => window.innerHeight);
  const [dragPx, setDragPx] = useState<number | null>(null);
  const drag = useRef<{ startY: number; startH: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onResize = () => setViewport(window.innerHeight);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const heights = snapHeights(viewport);
  const height = dragPx ?? heights[snap];

  useEffect(() => {
    if (dragPx === null) onHeightChange(heights[snap]);
  }, [snap, viewport, dragPx]); // eslint-disable-line react-hooks/exhaustive-deps

  const nextOnTap: Record<Snap, Snap> = { peek: "half", half: "full", full: "half" };

  return (
    <section
      className={`sheet${dragPx !== null ? " is-dragging" : ""}`}
      style={{ height }}
      aria-label="Trail list"
    >
      <div
        className="sheet-grip"
        onPointerDown={(e) => {
          drag.current = { startY: e.clientY, startH: height, moved: false };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.startY - e.clientY;
          if (Math.abs(dy) > 4) d.moved = true;
          if (d.moved) {
            setDragPx(Math.min(heights.full, Math.max(heights.peek, d.startH + dy)));
          }
        }}
        onPointerUp={() => {
          const d = drag.current;
          drag.current = null;
          if (!d) return;
          // The grip holds pointer capture, so the handle button never gets
          // the click from a mouse or finger: a tap is handled right here.
          if (d.moved && dragPx !== null) onSnapChange(nearestSnap(dragPx, heights));
          else if (!d.moved) onSnapChange(nextOnTap[snap]);
          setDragPx(null);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragPx(null);
        }}
      >
        <button
          type="button"
          className="sheet-handle"
          aria-label={snap === "full" ? "Show more map" : "Show more of the list"}
          onClick={(e) => {
            // Keyboard only (Enter/Space report detail 0); pointer taps are
            // handled in the grip's onPointerUp.
            if (e.detail === 0) onSnapChange(nextOnTap[snap]);
          }}
        >
          <span aria-hidden="true" />
        </button>
        {header}
      </div>
      <div className="sheet-body" hidden={snap === "peek" && dragPx === null}>
        {children}
      </div>
    </section>
  );
}

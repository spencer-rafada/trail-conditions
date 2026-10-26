// Map type switch, the way Google Maps does it.
// Desktop: a thumbnail in the map's bottom-left corner previewing the OTHER
//   style at the current spot; click to switch.
// Phone: a round layers button under the floating search; it opens a small
//   "Map type" card with a picture of each style; tap one to switch.

import { useEffect, useRef, useState } from "react";
import type { LatLon } from "../geo";
import type { MapStyle } from "../mapStyle";
import { lonLatToTile, previewTileUrl } from "../tileSources";
import { CARTO_KEY } from "./mapTiles";

const LABEL: Record<MapStyle, string> = { simple: "Default", topo: "Topo" };

/** Preview tiles one zoom out from the map, so a thumbnail shows context. */
function previewUrl(style: MapStyle, center: LatLon, zoom: number): string {
  const z = Math.max(3, Math.min(17, Math.round(zoom) - 1));
  return previewTileUrl(style, lonLatToTile(center.lat, center.lon, z), CARTO_KEY);
}

export function MapTypeControl({
  style,
  onChange,
  layout,
  center,
  zoom,
  top,
}: {
  style: MapStyle;
  onChange: (style: MapStyle) => void;
  layout: "desktop" | "phone";
  center: LatLon;
  zoom: number;
  /** Phone: pixels from the map's top to place the button (below the search). */
  top: number;
}) {
  const other: MapStyle = style === "topo" ? "simple" : "topo";

  if (layout === "desktop") {
    return (
      <button
        type="button"
        className="maptype-thumb"
        style={{ backgroundImage: `url("${previewUrl(other, center, zoom)}")` }}
        aria-label={`Switch to the ${LABEL[other].toLowerCase()} map`}
        onClick={() => onChange(other)}
      >
        <span className="maptype-thumb-label">
          <LayersIcon /> {LABEL[other]}
        </span>
      </button>
    );
  }
  return <PhoneMapType style={style} onChange={onChange} center={center} zoom={zoom} top={top} />;
}

function PhoneMapType({
  style,
  onChange,
  center,
  zoom,
  top,
}: {
  style: MapStyle;
  onChange: (style: MapStyle) => void;
  center: LatLon;
  zoom: number;
  top: number;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (refocus: boolean) => {
      setOpen(false);
      if (refocus) buttonRef.current?.focus();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const choose = (s: MapStyle) => {
    onChange(s);
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="maptype-phone" ref={wrapRef} style={{ top }}>
      <button
        ref={buttonRef}
        type="button"
        className="maptype-btn"
        aria-label="Map type"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <LayersIcon />
      </button>
      {open && (
        <div className="maptype-menu" role="group" aria-label="Map type">
          <p className="maptype-menu-title">Map type</p>
          <div className="maptype-options">
            {(["simple", "topo"] as const).map((s) => (
              <button
                key={s}
                type="button"
                className="maptype-option"
                aria-pressed={style === s}
                onClick={() => choose(s)}
              >
                <span
                  className="maptype-option-img"
                  style={{ backgroundImage: `url("${previewUrl(s, center, zoom)}")` }}
                  aria-hidden="true"
                />
                {LABEL[s]}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Two stacked squares, like Google's layers icon. */
function LayersIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 2 1 8l11 6 11-6-11-6Zm0 14.2L3.3 11.4 1 12.7l11 6 11-6-2.3-1.3-8.7 4.8Zm0 4.6-8.7-4.8L1 17.3l11 6 11-6-2.3-1.3-8.7 4.8Z"
      />
    </svg>
  );
}

// Small map on the trail page: every sample point (Trailhead, Top), so a
// rider sees where the trail is and which end is worst. Lazy chunk.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ConditionLevel } from "@trail-conditions/model";
import type { TrailPin } from "../api";
import { addBaseLayer, levelIcon } from "./mapTiles";

export default function TrailMap({
  points,
  level,
}: {
  points: readonly TrailPin[];
  level: ConditionLevel | null;
}) {
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
    const map = L.map(elRef.current!, {
      scrollWheelZoom: false,
      // On phones a one-finger drag would trap the page scroll; zoom buttons
      // and pinch still work.
      dragging: !touch,
    });
    addBaseLayer(map);
    // Trailhead label below its pin, the others above, so labels of two
    // close points don't sit on top of each other.
    points.forEach((p, i) => {
      L.marker([p.lat, p.lon], { icon: levelIcon(level), keyboard: false, title: p.label })
        .addTo(map)
        .bindTooltip(p.label, {
          permanent: true,
          direction: i === 0 ? "bottom" : "top",
          offset: i === 0 ? [0, 16] : [0, -16],
        });
    });
    const bounds = L.latLngBounds(points.map((p) => [p.lat, p.lon] as [number, number]));
    if (points.length > 1) map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
    else map.setView(bounds.getCenter(), 13);
    return () => {
      map.remove();
    };
  }, [points, level]);

  return (
    <div
      ref={elRef}
      className="trail-map"
      role="img"
      aria-label={`Map showing ${points.map((p) => p.label).join(" and ")}`}
    />
  );
}

// Small map on the trail page: the trail's own lines (from OpenStreetMap)
// and every sample point (Trailhead, Top), so a rider sees where the trail
// goes and which end is worst. Uses the rider's Simple/Topo choice. Lazy chunk.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ConditionLevel } from "@trail-conditions/model";
import type { TrailPin } from "../api";
import { levelColor } from "../helpers";
import { readMapStyle } from "../mapStyle";
import { addBaseLayer, levelIcon } from "./mapTiles";

export default function TrailMap({
  trailId,
  points,
  level,
}: {
  trailId: string;
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
    addBaseLayer(map, readMapStyle());
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
    const frame = () => {
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) map.setView(bounds.getCenter(), 13);
      else map.fitBounds(bounds, { padding: [56, 56], maxZoom: 15 });
    };
    frame();

    let cancelled = false;
    import("../trailLines").then(
      ({ trailLines }) => {
        if (cancelled) return;
        const lines = trailLines(trailId);
        if (lines.length === 0) return;
        const latLngs = lines.map((l) => l.map((p) => [p.lat, p.lon] as [number, number]));
        L.polyline(latLngs, {
          color: levelColor(level ?? "dry"),
          weight: 4,
          opacity: 0.9,
          interactive: false,
        }).addTo(map);
        for (const l of latLngs) for (const p of l) bounds.extend(p);
        frame();
      },
      () => {},
    );
    return () => {
      cancelled = true;
      map.remove();
    };
  }, [trailId, points, level]);

  return (
    <div
      ref={elRef}
      className="trail-map"
      role="img"
      aria-label={`Map of the trail, showing ${points.map((p) => p.label).join(" and ")}`}
    />
  );
}

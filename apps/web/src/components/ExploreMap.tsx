// The explore map (lazy chunk, so search results never wait for Leaflet).
// One pin per trail at its trailhead, colored and lettered by today's level.
// The parent owns all state; this component mirrors it onto Leaflet and
// reports the visible area back.

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrailScore } from "../api";
import { trailhead, type Bounds, type LatLon, type MapView } from "../geo";
import { today } from "../helpers";
import { addBaseLayer, levelIcon, pinLabel } from "./mapTiles";

export type CameraMove =
  | { kind: "bounds"; bounds: Bounds; maxZoom: number }
  | { kind: "view"; view: MapView };

/** A camera move plus a key; a new key re-applies the same move. */
export type CameraRequest = CameraMove & { key: number };

export interface ExploreMapProps {
  trails: readonly TrailScore[];
  /** Pins to show; others are hidden (search results, Rideable now). */
  visibleIds: ReadonlySet<string>;
  selectedId: string | null;
  hoveredId: string | null;
  origin: LatLon | null;
  initial: CameraRequest;
  camera: CameraRequest | null;
  /** Map pixels covered by the floating search (top) and sheet (bottom). */
  insets: { top: number; bottom: number };
  onSelect: (id: string) => void;
  onViewChange: (bounds: Bounds, view: MapView) => void;
}

/** Below this zoom pins are small dots without letters. */
const FAR_ZOOM = 11;

const toLatLngBounds = (b: Bounds) => L.latLngBounds([b.south, b.west], [b.north, b.east]);

function applyCamera(map: L.Map, cam: CameraRequest, insets: ExploreMapProps["insets"]) {
  if (cam.kind === "view") {
    map.setView([cam.view.lat, cam.view.lon], cam.view.zoom);
    return;
  }
  map.fitBounds(toLatLngBounds(cam.bounds), {
    paddingTopLeft: [24, insets.top + 24],
    paddingBottomRight: [24, insets.bottom + 24],
    maxZoom: cam.maxZoom,
  });
}

export default function ExploreMap(props: ExploreMapProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const originRef = useRef<L.CircleMarker | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // Create the map once.
  useEffect(() => {
    const map = L.map(elRef.current!, { zoomControl: true, worldCopyJump: false });
    addBaseLayer(map);
    map.zoomControl.setPosition("bottomright");
    const report = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      latest.current.onViewChange(
        { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() },
        { lat: c.lat, lon: c.lng, zoom: map.getZoom() },
      );
    };
    map.on("moveend", report);
    // Far out, 188 lettered pins pile up; show small dots until zoom 11.
    const markZoom = () =>
      elRef.current?.classList.toggle("is-far", map.getZoom() < FAR_ZOOM);
    map.on("zoomend", markZoom);
    applyCamera(map, latest.current.initial, latest.current.insets);
    mapRef.current = map;
    markZoom();
    report();
    // The container can change size (sheet, desktop resize); keep tiles right.
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current!);
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // One marker per trail with pins.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const trail of props.trails) {
      const head = trailhead(trail);
      if (!head) continue;
      seen.add(trail.id);
      const level = today(trail)?.level ?? null;
      const label = pinLabel(trail.name, level);
      let marker = markers.get(trail.id);
      if (!marker) {
        marker = L.marker([head.lat, head.lon], { keyboard: true, title: label, alt: label });
        marker.on("click", () => latest.current.onSelect(trail.id));
        marker.addTo(map);
        markers.set(trail.id, marker);
      } else {
        marker.setLatLng([head.lat, head.lon]);
      }
      marker.setIcon(levelIcon(level));
      marker.options.title = label;
      const el = marker.getElement();
      el?.setAttribute("aria-label", label);
      el?.setAttribute("role", "button");
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
  }, [props.trails]);

  // Visibility + highlight, without recreating markers.
  useEffect(() => {
    for (const [id, marker] of markersRef.current) {
      const el = marker.getElement();
      if (!el) continue;
      const visible = props.visibleIds.has(id);
      const active = id === props.selectedId || id === props.hoveredId;
      el.classList.toggle("is-hidden", !visible);
      el.classList.toggle("is-active", active);
      el.tabIndex = visible ? 0 : -1;
      marker.setZIndexOffset(active ? 1000 : 0);
    }
  }, [props.visibleIds, props.selectedId, props.hoveredId, props.trails]);

  // Camera requests (county jump, search results, Near me).
  const cameraKey = props.camera?.key;
  useEffect(() => {
    const map = mapRef.current;
    const cam = latest.current.camera;
    if (map && cam) applyCamera(map, cam, latest.current.insets);
  }, [cameraKey]);

  // The rider's location dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    originRef.current?.remove();
    originRef.current = null;
    if (props.origin) {
      originRef.current = L.circleMarker([props.origin.lat, props.origin.lon], {
        radius: 8,
        color: "#fff",
        weight: 3,
        fillColor: "#1a73e8",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
    }
  }, [props.origin]);

  return <div ref={elRef} className="map" role="region" aria-label="Map of trails" />;
}

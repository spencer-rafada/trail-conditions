// The explore map (lazy chunk, so search results never wait for Leaflet).
// One pin per trail at its trailhead, colored and lettered by today's level.
// The parent owns all state; this component mirrors it onto Leaflet and
// reports the visible area back. On desktop it also floats the selected
// pin's preview card over that pin and keeps it there as the map moves.

import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { TrailScore } from "../api";
import { trailhead, type Bounds, type LatLon, type MapView } from "../geo";
import { levelColor, today } from "../helpers";
import { POPUP_WIDTH, popupPlacement, type PopupPlacement } from "../mapPopup";
import type { MapStyle } from "../mapStyle";
import { addBaseLayer, levelIcon, pinLabel, swapBaseLayer } from "./mapTiles";

export type CameraMove =
  | { kind: "bounds"; bounds: Bounds; maxZoom: number }
  | { kind: "view"; view: MapView };

/** A camera move plus a key; a new key re-applies the same move. */
export type CameraRequest = CameraMove & { key: number };

export interface ExploreMapProps {
  trails: readonly TrailScore[];
  /** Pins to show; others are hidden (search results, Rideable now). */
  visibleIds: ReadonlySet<string>;
  /** The pin whose preview is open; stays highlighted. */
  selectedId: string | null;
  hoveredId: string | null;
  origin: LatLon | null;
  initial: CameraRequest;
  camera: CameraRequest | null;
  /** Map pixels covered by the floating search (top) and sheet (bottom). */
  insets: { top: number; bottom: number };
  /** A pin was clicked (the parent opens its preview). */
  onSelect: (id: string) => void;
  /** The map itself (not a pin) was clicked; the parent closes the preview. */
  onMapClick: () => void;
  onViewChange: (bounds: Bounds, view: MapView) => void;
  /** Desktop: the preview card, floated over the selected pin. */
  popup?: ReactNode;
  /** Base map: Google-style street map or USGS topo. */
  mapStyle: MapStyle;
}

/** Below this zoom pins are small dots without letters, and trail lines
 *  are hidden (hundreds of them would bury the map). */
const FAR_ZOOM = 11;

const LINE_WEIGHT = 3;
const LINE_WEIGHT_ACTIVE = 6;

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
  const baseRef = useRef<L.TileLayer | null>(null);
  const linesRef = useRef(new Map<string, L.Polyline>());
  const rendererRef = useRef<L.Canvas | null>(null);
  /** Where the open preview points: its pin, or the spot a line was tapped. */
  const anchorRef = useRef<{ id: string; at: L.LatLng } | null>(null);
  const [zoom, setZoom] = useState(0);
  const [lineData, setLineData] = useState<((id: string) => LatLon[][]) | null>(null);
  const latest = useRef(props);
  latest.current = props;

  // Trail lines load after the map so pins and tiles never wait for them.
  useEffect(() => {
    let cancelled = false;
    import("../trailLines").then(
      (m) => {
        if (!cancelled) setLineData(() => m.trailLines);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Create the map once.
  useEffect(() => {
    const map = L.map(elRef.current!, { zoomControl: true, worldCopyJump: false });
    baseRef.current = addBaseLayer(map, latest.current.mapStyle);
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
    // Marker clicks don't bubble to the map, so this is a click on the map.
    map.on("click", () => latest.current.onMapClick());
    // Far out, 188 lettered pins pile up; show small dots until zoom 11.
    const markZoom = () => {
      elRef.current?.classList.toggle("is-far", map.getZoom() < FAR_ZOOM);
      setZoom(map.getZoom());
    };
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
      linesRef.current.clear();
      rendererRef.current = null;
    };
  }, []);

  // Simple / Topo base map.
  useEffect(() => {
    const map = mapRef.current;
    if (map && baseRef.current) baseRef.current = swapBaseLayer(map, baseRef.current, props.mapStyle);
  }, [props.mapStyle]);

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
        marker.on("click", () => {
          anchorRef.current = null; // anchor on the pin itself
          latest.current.onSelect(trail.id);
        });
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
      const selected = id === props.selectedId;
      const active = selected || id === props.hoveredId;
      el.classList.toggle("is-hidden", !visible);
      el.classList.toggle("is-active", active);
      el.classList.toggle("is-selected", selected);
      el.tabIndex = visible ? 0 : -1;
      marker.setZIndexOffset(selected ? 2000 : active ? 1000 : 0);
    }
  }, [props.visibleIds, props.selectedId, props.hoveredId, props.trails]);

  // One canvas-drawn line set per trail (canvas: hundreds of lines stay fast),
  // colored by today's level. Tapping a line opens the same preview as its pin.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !lineData) return;
    rendererRef.current ??= L.canvas({ padding: 0.5, tolerance: 8 });
    const renderer = rendererRef.current;
    const lines = linesRef.current;
    for (const trail of props.trails) {
      const coords = lineData(trail.id);
      if (coords.length === 0) continue;
      const color = levelColor(today(trail)?.level ?? "dry");
      let line = lines.get(trail.id);
      if (!line) {
        line = L.polyline(
          coords.map((l) => l.map((p) => [p.lat, p.lon] as [number, number])),
          { renderer, color, weight: LINE_WEIGHT, opacity: 0.9, bubblingMouseEvents: false },
        );
        line.on("click", (e: L.LeafletMouseEvent) => {
          anchorRef.current = { id: trail.id, at: e.latlng };
          latest.current.onSelect(trail.id);
        });
        lines.set(trail.id, line);
      } else {
        line.setStyle({ color });
      }
    }
  }, [lineData, props.trails]);

  // Lines follow the pins (search, Rideable now) and hide when zoomed far out.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const near = zoom >= FAR_ZOOM;
    for (const [id, line] of linesRef.current) {
      const show = near && props.visibleIds.has(id);
      if (show && !map.hasLayer(line)) line.addTo(map);
      if (!show && map.hasLayer(line)) line.remove();
      const active = id === props.selectedId || id === props.hoveredId;
      line.setStyle({ weight: active ? LINE_WEIGHT_ACTIVE : LINE_WEIGHT });
      if (active && show) line.bringToFront();
    }
  }, [zoom, lineData, props.visibleIds, props.selectedId, props.hoveredId, props.trails]);

  // Keep the desktop preview over its pin while the map pans and zooms.
  const [placement, setPlacement] = useState<PopupPlacement | null>(null);
  const hasPopup = props.popup != null;
  useEffect(() => {
    const map = mapRef.current;
    const id = props.selectedId;
    if (!map || !id || !hasPopup) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const anchor = anchorRef.current?.id === id ? anchorRef.current.at : null;
      const at = anchor ?? markersRef.current.get(id)?.getLatLng();
      if (!at) return setPlacement(null);
      const pin = map.latLngToContainerPoint(at);
      const size = map.getSize();
      setPlacement(popupPlacement(pin, { width: size.x, height: size.y }));
    };
    update();
    map.on("move zoom resize", update);
    return () => {
      map.off("move zoom resize", update);
    };
  }, [props.selectedId, hasPopup]);

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

  return (
    <>
      <div ref={elRef} className="map" role="region" aria-label="Map of trails" />
      {placement && hasPopup && (
        <div
          className="map-popup"
          style={{
            left: placement.left,
            top: placement.top,
            width: POPUP_WIDTH,
            transform: placement.above ? "translateY(-100%)" : undefined,
          }}
        >
          {props.popup}
        </div>
      )}
    </>
  );
}

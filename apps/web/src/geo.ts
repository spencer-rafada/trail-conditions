// Map and distance helpers (pure). Everything here works on plain numbers so
// the list logic stays testable without Leaflet or a DOM.

import type { TrailPin, TrailScore } from "./api";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const EARTH_RADIUS_MI = 3958.8;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in miles (straight line, not driving distance). */
export function distanceMiles(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "0.4 mi", "6.2 mi", "23 mi". */
export function formatMiles(miles: number): string {
  if (miles < 0.1) return "< 0.1 mi";
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

/** The pin a rider drives to: the first one (the worker sends the
 *  Trailhead first). Null for a trail without pins. */
export function trailhead(trail: TrailScore): TrailPin | null {
  return trail.points?.[0] ?? null;
}

export const hasPins = (trail: TrailScore): boolean => (trail.points?.length ?? 0) > 0;

/** Straight-line miles from `from` to the trailhead; null without pins. */
export function milesTo(trail: TrailScore, from: LatLon): number | null {
  const head = trailhead(trail);
  return head ? distanceMiles(from, head) : null;
}

export function inBounds(p: LatLon, b: Bounds): boolean {
  return p.lat >= b.south && p.lat <= b.north && p.lon >= b.west && p.lon <= b.east;
}

/** A trail is "in this area" when its trailhead (its map pin) is on
 *  screen — so the list always matches the pins the rider sees. */
export function trailInBounds(trail: TrailScore, b: Bounds): boolean {
  const head = trailhead(trail);
  return head !== null && inBounds(head, b);
}

/** Smallest box around these trails' trailheads (the pins); null when none
 *  has pins. "Top" points are left out: some sit kilometers away and would
 *  zoom the map far out. */
export function boundsOfTrails(trails: readonly TrailScore[]): Bounds | null {
  let box: Bounds | null = null;
  for (const trail of trails) {
    const p = trailhead(trail);
    if (p) {
      box = box
        ? {
            south: Math.min(box.south, p.lat),
            west: Math.min(box.west, p.lon),
            north: Math.max(box.north, p.lat),
            east: Math.max(box.east, p.lon),
          }
        : { south: p.lat, west: p.lon, north: p.lat, east: p.lon };
    }
  }
  return box;
}

/** Map view in the URL: "lat,lon,zoom" with 4 decimals (~10 m). */
export interface MapView extends LatLon {
  zoom: number;
}

export function formatView(view: MapView): string {
  return `${view.lat.toFixed(4)},${view.lon.toFixed(4)},${Math.round(view.zoom)}`;
}

export function parseView(value: string | null): MapView | null {
  if (!value) return null;
  const parts = value.split(",").map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lon, zoom] = parts as [number, number, number];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || zoom < 1 || zoom > 20) return null;
  return { lat, lon, zoom };
}

/** Google Maps directions to a point; opens the app on phones that have it
 *  and the website everywhere else. Nothing goes through our server. */
export function directionsUrl(p: LatLon): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`;
}

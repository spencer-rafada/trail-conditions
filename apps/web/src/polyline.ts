// Google polyline decoding (precision 5): the trail lines in
// data/trail-lines.json are stored this way by scripts/trail-lines.ts.

import type { LatLon } from "./geo";

export function decodePolyline(encoded: string): LatLon[] {
  const points: LatLon[] = [];
  let i = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(i++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lon += next();
    points.push({ lat: lat / 1e5, lon: lon / 1e5 });
  }
  return points;
}

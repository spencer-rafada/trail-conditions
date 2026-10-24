// Shared Leaflet setup for both maps: USGS Topo tiles (public domain, no
// key) and the pin markup. Imported only from the lazy map chunks.

import L from "leaflet";
import type { ConditionLevel } from "@trail-conditions/model";
import { levelColor, levelLabel, levelSymbol } from "../helpers";

const USGS_TOPO =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";

export function addBaseLayer(map: L.Map): void {
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.tileLayer(USGS_TOPO, {
    maxNativeZoom: 16,
    maxZoom: 18,
    attribution: 'Map: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
  }).addTo(map);
}

/** A round pin with the level's color and one-letter mark. Null level =
 *  not scored yet (grey "?"). */
export function levelIcon(level: ConditionLevel | null, extraClass = ""): L.DivIcon {
  const color = level ? levelColor(level) : "#6b6257";
  const mark = level ? levelSymbol(level) : "?";
  return L.divIcon({
    className: `pin-wrap ${extraClass}`.trim(),
    html: `<span class="pin" style="background:${color}">${mark}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

export const pinLabel = (name: string, level: ConditionLevel | null): string =>
  `${name}: ${level ? levelLabel(level) : "not scored yet"}`;

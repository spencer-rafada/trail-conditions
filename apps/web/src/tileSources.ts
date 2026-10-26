// Base-map tile sources (pure — no Leaflet, so tests and the map-type
// preview can use them). mapTiles.ts builds the Leaflet layers from these.

import type { MapStyle } from "./mapStyle";

export const USGS_TOPO_TEMPLATE =
  "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
/** USGS serves real tiles to zoom 16; Leaflet upscales beyond it. */
export const USGS_MAX_NATIVE_ZOOM = 16;
export const OSM_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const cartoTemplate = (key: string): string =>
  `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`;

export interface Tile {
  z: number;
  x: number;
  y: number;
}

/** The standard (slippy-map) tile containing a point at a zoom level. */
export function lonLatToTile(lat: number, lon: number, z: number): Tile {
  const n = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
}

/** One tile image of a style, for the map-type preview thumbnail. */
export function previewTileUrl(style: MapStyle, tile: Tile, cartoKey: string): string {
  if (style === "topo") {
    const drop = Math.max(0, tile.z - USGS_MAX_NATIVE_ZOOM);
    const { z, x, y } = { z: tile.z - drop, x: tile.x >> drop, y: tile.y >> drop };
    return USGS_TOPO_TEMPLATE.replace("{z}", String(z))
      .replace("{y}", String(y))
      .replace("{x}", String(x));
  }
  const fill = (t: string) =>
    t
      .replace("{s}", "a")
      .replace("{z}", String(tile.z))
      .replace("{x}", String(tile.x))
      .replace("{y}", String(tile.y))
      .replace("{r}", "");
  return cartoKey ? fill(cartoTemplate(cartoKey)) : fill(OSM_TEMPLATE);
}

// Shared Leaflet setup for both maps: the base map (simple street style or
// USGS Topo) and the pin markup. Imported only from the lazy map chunks.

import L from "leaflet";
import type { ConditionLevel } from "@trail-conditions/model";
import { levelColor, levelLabel, levelSymbol } from "../helpers";
import type { MapStyle } from "../mapStyle";
import {
  OSM_TEMPLATE,
  USGS_MAX_NATIVE_ZOOM,
  USGS_TOPO_TEMPLATE,
  cartoTemplate,
} from "../tileSources";

// CARTO Voyager, the Google-style map, needs a free key (5M tiles/month
// non-commercial; https://carto.com/basemaps/apikey). Without one, "simple"
// falls back to OpenStreetMap's own tiles (no key; light use with
// attribution, per the OSM tile usage policy).
export const CARTO_KEY = (import.meta.env.VITE_CARTO_KEY as string | undefined) || "";

const OSM_CREDIT =
  '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function tileLayer(style: MapStyle): L.TileLayer {
  if (style === "topo") {
    return L.tileLayer(USGS_TOPO_TEMPLATE, {
      maxNativeZoom: USGS_MAX_NATIVE_ZOOM,
      maxZoom: 18,
      attribution:
        'Map: <a href="https://www.usgs.gov/programs/national-geospatial-program/national-map">USGS The National Map</a>',
    });
  }
  if (CARTO_KEY) {
    return L.tileLayer(cartoTemplate(CARTO_KEY), {
      subdomains: "abcd",
      maxZoom: 19,
      attribution: `${OSM_CREDIT} © <a href="https://carto.com/attributions">CARTO</a>`,
    });
  }
  return L.tileLayer(OSM_TEMPLATE, {
    maxZoom: 19,
    attribution: OSM_CREDIT,
  });
}

/** Adds the base map; returns its layer so a style change can swap it. */
export function addBaseLayer(map: L.Map, style: MapStyle): L.TileLayer {
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  return tileLayer(style).addTo(map);
}

/** Replaces the current base layer with another style; returns the new one. */
export function swapBaseLayer(map: L.Map, current: L.TileLayer, style: MapStyle): L.TileLayer {
  current.remove();
  const next = tileLayer(style).addTo(map);
  next.bringToBack();
  return next;
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

// Which base map a rider prefers: "simple" (a Google-style street map, the
// default) or "topo" (USGS topographic). A per-browser convenience in
// localStorage; any storage failure just means the default.

export type MapStyle = "simple" | "topo";

export const MAP_STYLE_KEY = "tc_map_style";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMapStyle(storage: Store | null = browserStorage()): MapStyle {
  try {
    return storage?.getItem(MAP_STYLE_KEY) === "topo" ? "topo" : "simple";
  } catch {
    return "simple";
  }
}

export function saveMapStyle(style: MapStyle, storage: Store | null = browserStorage()): void {
  try {
    storage?.setItem(MAP_STYLE_KEY, style);
  } catch {
    // Not remembered; the toggle still works for this visit.
  }
}

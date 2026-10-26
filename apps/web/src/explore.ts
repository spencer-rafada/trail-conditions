// What the explore list shows (pure): search results across every county,
// or — when not searching — the trails in the map area, best first, or
// closest first once the rider asked for Near me.

import type { TrailScore } from "./api";
import { hasPins, milesTo, trailInBounds, type Bounds, type LatLon } from "./geo";
import { isRideable, sortBestFirst } from "./helpers";
import { searchTrails, type TrailNames } from "./search";

export interface ExploreInput {
  trails: readonly TrailScore[];
  query: string;
  rideableOnly: boolean;
  /** Visible map area; null = no map (list-only mode) or not drawn yet. */
  bounds: Bounds | null;
  /** The rider's location after tapping Near me; null otherwise. */
  origin: LatLon | null;
  /** Member trail names for search; {} until loaded. */
  names?: TrailNames;
}

export interface ExploreResult {
  mode: "search" | "area" | "all";
  trails: TrailScore[];
  rideableCount: number;
}

function byDistance(trails: readonly TrailScore[], origin: LatLon): TrailScore[] {
  const miles = (t: TrailScore) => milesTo(t, origin) ?? Number.MAX_SAFE_INTEGER;
  return [...trails].sort((a, b) => miles(a) - miles(b) || a.name.localeCompare(b.name));
}

export function exploreList(input: ExploreInput): ExploreResult {
  const { trails, query, rideableOnly, bounds, origin, names = {} } = input;

  const searched = searchTrails(trails, query, names);
  let mode: ExploreResult["mode"];
  let list: TrailScore[];
  if (searched !== null) {
    mode = "search";
    // Relevance first; Near me only reorders when not searching, so the
    // trail the rider named stays on top.
    list = searched;
  } else if (bounds !== null) {
    mode = "area";
    const inArea = trails.filter((t) => hasPins(t) && trailInBounds(t, bounds));
    list = origin ? byDistance(inArea, origin) : sortBestFirst(inArea);
  } else {
    mode = "all";
    list = origin ? byDistance(trails, origin) : sortBestFirst(trails);
  }

  const rideableCount = list.filter(isRideable).length;
  return {
    mode,
    trails: rideableOnly ? list.filter(isRideable) : list,
    rideableCount,
  };
}

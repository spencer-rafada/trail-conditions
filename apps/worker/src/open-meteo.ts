// Batched Open-Meteo forecast calls: many locations per call, hourly
// variables only (repo rule — daily totals proved unreliable). Units match
// scripts/backtest.ts: °F, inches, UTC hour labels where a label T describes
// the hour ending at T for precipitation/snowfall; snow_depth comes back in
// feet (only > 0 matters).

export const OM_PAST_DAYS = 10; // the 240 h wetness walk
export const OM_FORECAST_DAYS = 4; // now + 48 h target still inside the range
export const OM_HOURLY_VARS = "temperature_2m,precipitation,snowfall,snow_depth";
export const OM_MAX_LOCATIONS_PER_CALL = 50;

export interface OmPoint {
  id: string;
  lat: number;
  lon: number;
  /** Elevation in meters; Open-Meteo adjusts temperature to it. */
  elevM: number | null;
}

/** One URL per OM_MAX_LOCATIONS_PER_CALL points, preserving point order. */
export function openMeteoUrls(points: readonly OmPoint[]): string[] {
  const urls: string[] = [];
  for (let i = 0; i < points.length; i += OM_MAX_LOCATIONS_PER_CALL) {
    const batch = points.slice(i, i + OM_MAX_LOCATIONS_PER_CALL);
    urls.push(
      "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${batch.map((p) => p.lat).join(",")}` +
        `&longitude=${batch.map((p) => p.lon).join(",")}` +
        `&elevation=${batch.map((p) => p.elevM ?? "nan").join(",")}` +
        `&hourly=${OM_HOURLY_VARS}` +
        "&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC" +
        `&past_days=${OM_PAST_DAYS}&forecast_days=${OM_FORECAST_DAYS}`,
    );
  }
  return urls;
}

export interface OmHour {
  tempF: number | null;
  precipIn: number | null;
  snowfallIn: number | null;
  snowDepthFt: number | null;
}

interface OmLocationResponse {
  hourly: {
    time: string[];
    temperature_2m: (number | null)[];
    precipitation: (number | null)[];
    snowfall: (number | null)[];
    snow_depth: (number | null)[];
  };
}

/** Hours keyed by UTC hour-ending stamp ("YYYY-MM-DDTHH:00:00Z"). */
function byHour(loc: OmLocationResponse): Map<string, OmHour> {
  const h = loc.hourly;
  const map = new Map<string, OmHour>();
  h.time.forEach((label, i) => {
    map.set(`${label}:00Z`, {
      tempF: h.temperature_2m[i] ?? null,
      precipIn: h.precipitation[i] ?? null,
      snowfallIn: h.snowfall[i] ?? null,
      snowDepthFt: h.snow_depth[i] ?? null,
    });
  });
  return map;
}

/** Parse one batched response body (an array for several locations, a bare
 *  object for one) into pointId -> hour map, for the batch of points the
 *  matching openMeteoUrls() call was built from. */
export function parseOpenMeteo(
  batchPoints: readonly OmPoint[],
  body: unknown,
): Map<string, Map<string, OmHour>> {
  const locations = (Array.isArray(body) ? body : [body]) as OmLocationResponse[];
  if (locations.length !== batchPoints.length) {
    throw new Error(
      `Open-Meteo returned ${locations.length} locations for ${batchPoints.length} points`,
    );
  }
  const map = new Map<string, Map<string, OmHour>>();
  batchPoints.forEach((p, i) => map.set(p.id, byHour(locations[i]!)));
  return map;
}

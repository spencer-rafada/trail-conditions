// Chunked score job (spec §7.2): the 179 Stage IV cells are split into
// NUM_CHUNKS deterministic chunks; each 10-minute cron run handles one chunk,
// so a full cycle covers every cell in NUM_CHUNKS * 10 minutes (3 hours).
// Small chunks (~10 cells) keep every run well under the 50-subrequest limit,
// including the after-midnight runs that fetch two Stage IV days per cell.
//
// A trail belongs to the chunk of its FIRST point's cell (the "Trailhead"
// point; ticket decision). Its other point's cell is read from the
// rain_hourly cache when fresh, else fetched as an extra cell.

export const NUM_CHUNKS = 18;
export const CHUNK_PERIOD_MS = 10 * 60_000;

/** Which chunk a cron run handles. Cron fires on 10-minute boundaries, so
 *  consecutive runs walk the chunks in order and any NUM_CHUNKS consecutive
 *  runs cover every chunk exactly once. */
export function chunkIndexForTime(ms: number): number {
  return Math.floor(ms / CHUNK_PERIOD_MS) % NUM_CHUNKS;
}

/** Deterministic partition of the distinct cell ids into NUM_CHUNKS chunks:
 *  sort, then stripe round-robin (sizes differ by at most 1). Every cell
 *  lands in exactly one chunk for a given cell set. */
export function cellChunks(cellIds: readonly string[]): string[][] {
  const sorted = [...new Set(cellIds)].sort();
  const chunks: string[][] = Array.from({ length: NUM_CHUNKS }, () => []);
  sorted.forEach((cell, i) => chunks[i % NUM_CHUNKS]!.push(cell));
  return chunks;
}

export interface PointRow {
  id: string;
  trail_id: string;
  label: string | null;
  lat: number;
  lon: number;
  elev_m: number | null;
  cell_id: string;
}

/** The trail's first point: the "Trailhead" when labeled, else the lowest
 *  point id — stable for a given row set. */
export function firstPoint(points: readonly PointRow[]): PointRow {
  const sorted = [...points].sort((a, b) => a.id.localeCompare(b.id));
  const first = sorted.find((p) => p.label === "Trailhead") ?? sorted[0];
  if (!first) throw new Error("firstPoint needs at least one point");
  return first;
}

export function pointsByTrail(points: readonly PointRow[]): Map<string, PointRow[]> {
  const map = new Map<string, PointRow[]>();
  for (const p of points) {
    const list = map.get(p.trail_id);
    if (list) list.push(p);
    else map.set(p.trail_id, [p]);
  }
  return map;
}

/** Trail ids whose first point's cell is in the chunk, sorted. */
export function trailIdsForChunk(
  chunkCells: readonly string[],
  byTrail: ReadonlyMap<string, PointRow[]>,
): string[] {
  const cells = new Set(chunkCells);
  const ids: string[] = [];
  for (const [trailId, points] of byTrail) {
    if (cells.has(firstPoint(points).cell_id)) ids.push(trailId);
  }
  return ids.sort();
}

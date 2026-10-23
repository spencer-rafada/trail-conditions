import { describe, expect, it } from "vitest";
import {
  cellChunks,
  chunkIndexForTime,
  firstPoint,
  pointsByTrail,
  trailIdsForChunk,
  CHUNK_PERIOD_MS,
  NUM_CHUNKS,
  type PointRow,
} from "./chunking";

/** 179 synthetic cell ids shaped like the real "gridi:gridj" ones. */
const CELLS = Array.from({ length: 179 }, (_, i) => `${200 + (i % 90)}:${400 + i}`);

const point = (over: Partial<PointRow>): PointRow => ({
  id: "t#trailhead",
  trail_id: "t",
  label: "Trailhead",
  lat: 40,
  lon: -111,
  elev_m: 2000,
  cell_id: "200:400",
  ...over,
});

describe("chunkIndexForTime", () => {
  it("is deterministic and advances one chunk per 10-minute slot", () => {
    const base = Date.UTC(2026, 9, 23, 14, 0); // minute 0 of an hour
    expect(chunkIndexForTime(base)).toBe(chunkIndexForTime(base));
    for (let run = 0; run < NUM_CHUNKS; run++) {
      const next = chunkIndexForTime(base + (run + 1) * CHUNK_PERIOD_MS);
      const curr = chunkIndexForTime(base + run * CHUNK_PERIOD_MS);
      expect(next).toBe((curr + 1) % NUM_CHUNKS);
    }
  });

  it("covers every chunk exactly once over NUM_CHUNKS consecutive runs", () => {
    const base = Date.UTC(2026, 9, 23, 0, 0);
    const seen = new Set<number>();
    for (let run = 0; run < NUM_CHUNKS; run++) {
      seen.add(chunkIndexForTime(base + run * CHUNK_PERIOD_MS));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual(
      Array.from({ length: NUM_CHUNKS }, (_, i) => i),
    );
  });
});

describe("cellChunks", () => {
  it("puts all 179 cells in exactly one chunk each, at most 10 per chunk", () => {
    const chunks = cellChunks(CELLS);
    expect(chunks).toHaveLength(NUM_CHUNKS);
    const all = chunks.flat();
    expect(all).toHaveLength(179);
    expect(new Set(all).size).toBe(179);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(Math.ceil(179 / NUM_CHUNKS));
    }
  });

  it("is deterministic regardless of input order and duplicates", () => {
    const shuffled = [...CELLS, ...CELLS.slice(0, 7)].reverse();
    expect(cellChunks(shuffled)).toEqual(cellChunks(CELLS));
  });
});

describe("trailIdsForChunk", () => {
  // A trail whose two points sit in cells of DIFFERENT chunks: it belongs to
  // the chunk of its first (Trailhead) point's cell only.
  const chunks = cellChunks(CELLS);
  const cellA = chunks[0]![0]!; // in chunk 0
  const cellB = chunks[5]![0]!; // in chunk 5
  const twoCellTrail = [
    point({ id: "split#trailhead", trail_id: "split", cell_id: cellA }),
    point({ id: "split#top", trail_id: "split", label: "Top", cell_id: cellB }),
  ];

  it("assigns a two-cell trail to its first point's chunk only", () => {
    const byTrail = pointsByTrail(twoCellTrail);
    expect(trailIdsForChunk(chunks[0]!, byTrail)).toEqual(["split"]);
    expect(trailIdsForChunk(chunks[5]!, byTrail)).toEqual([]);
  });

  it("the first point is the Trailhead even when ids sort the other way", () => {
    // "#top" < "#trailhead" lexicographically; the label must win.
    expect(firstPoint(twoCellTrail).id).toBe("split#trailhead");
  });

  it("covers every trail exactly once across a full cycle", () => {
    // One trail per cell pair: first point in cell i, second in cell (i+40)%179.
    const points = CELLS.flatMap((cell, i) => [
      point({ id: `t${i}#trailhead`, trail_id: `t${i}`, cell_id: cell }),
      point({
        id: `t${i}#top`,
        trail_id: `t${i}`,
        label: "Top",
        cell_id: CELLS[(i + 40) % CELLS.length]!,
      }),
    ]);
    const byTrail = pointsByTrail(points);
    const seen = chunks.flatMap((chunk) => trailIdsForChunk(chunk, byTrail));
    expect(seen).toHaveLength(179);
    expect(new Set(seen).size).toBe(179);
  });
});

// Trail search (pure): forgiving matching for typed and spoken queries.
// Riders type "lamberts park", dictation hears "lamber park", and trail
// system names carry filler like "trail network" — so both sides are
// normalized the same way, and each query word may match a name word
// exactly, as a prefix (mid-typing), or within a small edit distance.
// Every query word must match something, or the trail is not a result.
//
// Systems also carry the names of the trails inside them (from OSM, via the
// hand-run scripts/trail-names.ts), so "Clark's" finds Corner Canyon.

import type { TrailScore } from "./api";

/** Words that carry no meaning for finding a trail. */
const FILLER = new Set([
  "a",
  "and",
  "area",
  "at",
  "county",
  "in",
  "network",
  "of",
  "system",
  "the",
  "trail",
  "trails",
]);

/** Trailing plural/possessive "s" is dropped on both sides, so
 *  "lamberts" and "lambert" meet ("springs" vs "spring" too). */
const stem = (word: string): string =>
  word.length > 4 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;

export function searchTokens(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0 && !FILLER.has(w))
    .map(stem);
}

/** Optimal-string-alignment distance (adjacent swaps cost 1), stopping
 *  early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) {
    rows.push([i]);
  }
  for (let j = 1; j <= b.length; j++) rows[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Number.MAX_SAFE_INTEGER;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(
        rows[i - 1]![j]! + 1,
        rows[i]![j - 1]! + 1,
        rows[i - 1]![j - 1]! + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = d;
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length]![b.length]!;
}

/** Typos allowed for a query word of this length. */
const allowedTypos = (length: number): number => (length >= 7 ? 2 : length >= 4 ? 1 : 0);

/** 3 exact, 2 prefix, 1 fuzzy, 0 no match. */
export function wordScore(queryWord: string, candidates: readonly string[]): number {
  let best = 0;
  for (const word of candidates) {
    if (word === queryWord) return 3;
    if (queryWord.length >= 2 && word.startsWith(queryWord)) {
      best = Math.max(best, 2);
      continue;
    }
    const typos = allowedTypos(queryWord.length);
    if (typos > 0 && editDistance(queryWord, word, typos) <= typos) {
      best = Math.max(best, 1);
    }
  }
  return best;
}

/** Trail id -> names of the trails inside that system. */
export type TrailNames = Readonly<Record<string, readonly string[]>>;

/** Member-trail words count a bit less than the system's own name, so
 *  "Corner Canyon" outranks a system that merely has a "Corner" trail. */
const MEMBER_WEIGHT = 0.8;

const memberWordCache = new WeakMap<TrailNames, Map<string, string[]>>();

function memberWords(names: TrailNames, id: string): string[] {
  let byId = memberWordCache.get(names);
  if (!byId) {
    byId = new Map();
    memberWordCache.set(names, byId);
  }
  let words = byId.get(id);
  if (!words) {
    words = [...new Set((names[id] ?? []).flatMap(searchTokens))];
    byId.set(id, words);
  }
  return words;
}

/** Score of a trail for the query words; 0 = not a result. Name words
 *  count fully, member-trail words 0.8, county words ("utah", "wasatch")
 *  half, so a county-only query lists that county and name hits rank
 *  first. */
export function trailMatchScore(
  queryWords: readonly string[],
  trail: TrailScore,
  names: TrailNames = {},
): number {
  const nameWords = searchTokens(trail.name);
  const members = memberWords(names, trail.id);
  const countyWords = trail.county ? searchTokens(trail.county) : [];
  let total = 0;
  for (const q of queryWords) {
    const score = Math.max(
      wordScore(q, nameWords),
      wordScore(q, members) * MEMBER_WEIGHT,
      wordScore(q, countyWords) / 2,
    );
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

/** Trails matching the query, best match first (ties by name). An empty
 *  or filler-only query returns null: "not searching". */
export function searchTrails(
  trails: readonly TrailScore[],
  query: string,
  names: TrailNames = {},
): TrailScore[] | null {
  const words = searchTokens(query);
  if (words.length === 0) return null;
  return trails
    .map((trail) => ({ trail, score: trailMatchScore(words, trail, names) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.trail.name.localeCompare(b.trail.name))
    .map((r) => r.trail);
}

/** The member trail that explains a result ("Includes Clark's Trail"):
 *  the one that matches the query better than the system name does. Null
 *  when the system name alone explains it. */
export function memberMatch(
  trail: TrailScore,
  query: string,
  names: TrailNames,
): string | null {
  const words = searchTokens(query);
  const members = names[trail.id];
  if (words.length === 0 || !members?.length) return null;
  const nameWords = searchTokens(trail.name);
  let best: { name: string; score: number } | null = null;
  for (const member of members) {
    const mWords = searchTokens(member);
    let score = 0;
    for (const q of words) {
      const m = wordScore(q, mWords);
      if (m > wordScore(q, nameWords)) score += m;
    }
    if (score > 0 && (!best || score > best.score)) best = { name: member, score };
  }
  return best?.name ?? null;
}

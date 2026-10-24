import { describe, expect, it } from "vitest";
import type { TrailScore } from "./api";
import { editDistance, memberMatch, searchTokens, searchTrails, wordScore } from "./search";

const trail = (id: string, name: string, county?: string): TrailScore => ({
  id,
  name,
  ...(county !== undefined && { county }),
  days: [],
  scored_utc: "2026-10-24T12:00:00Z",
});

// Real system names from data/trails.json.
const TRAILS = [
  trail("lambert", "Lambert Park", "Utah County"),
  trail("corner", "Corner Canyon Regional Park", "Salt Lake County"),
  trail("bst-draper", "Bonneville Shoreline Trail - Draper Section", "Salt Lake County"),
  trail("crestwood", "Crestwood Park Trail", "Salt Lake County"),
  trail("wmsp", "Wasatch Mountain State Park", "Wasatch County"),
  trail("jordanelle", "Jordanelle trail network", "Wasatch County"),
  trail("eagle", "Eagle Mountain trails", "Utah County"),
];
const ids = (list: TrailScore[] | null) => list?.map((t) => t.id) ?? null;

describe("searchTokens", () => {
  it("lowercases, strips accents, punctuation, possessives and filler words", () => {
    expect(searchTokens("  Lambert's PARK trail!! ")).toEqual(["lambert", "park"]);
    expect(searchTokens("Bonneville Shoreline Trail - Draper Section")).toEqual([
      "bonneville",
      "shoreline",
      "draper",
      "section",
    ]);
    expect(searchTokens("Café")).toEqual(["cafe"]);
  });

  it("drops a trailing plural s on longer words, but not double s", () => {
    expect(searchTokens("lamberts springs pass")).toEqual(["lambert", "spring", "pass"]);
  });
});

describe("editDistance", () => {
  it("counts edits and adjacent swaps, stopping past the max", () => {
    expect(editDistance("lambert", "lambert", 2)).toBe(0);
    expect(editDistance("lamber", "lambert", 2)).toBe(1);
    expect(editDistance("lmabert", "lambert", 2)).toBe(1);
    expect(editDistance("canyon", "corner", 1)).toBeGreaterThan(1);
  });
});

describe("wordScore", () => {
  it("ranks exact over prefix over fuzzy", () => {
    expect(wordScore("park", ["park"])).toBe(3);
    expect(wordScore("lamb", ["lambert"])).toBe(2);
    expect(wordScore("lamber", ["lambert"])).toBe(2); // still a prefix
    expect(wordScore("lambret", ["lambert"])).toBe(1);
    expect(wordScore("xyz", ["lambert"])).toBe(0);
  });

  it("does not fuzzy-match very short words", () => {
    expect(wordScore("pak", ["park"])).toBe(0);
  });
});

describe("searchTrails", () => {
  it("returns null for an empty or filler-only query (not searching)", () => {
    expect(searchTrails(TRAILS, "")).toBeNull();
    expect(searchTrails(TRAILS, "   ")).toBeNull();
    expect(searchTrails(TRAILS, "trail network")).toBeNull();
  });

  it("finds a trail from typed, misspelled, or dictated names", () => {
    expect(ids(searchTrails(TRAILS, "lambert park"))).toEqual(["lambert"]);
    expect(ids(searchTrails(TRAILS, "lamberts park"))).toEqual(["lambert"]);
    expect(ids(searchTrails(TRAILS, "lambret"))).toEqual(["lambert"]);
    expect(ids(searchTrails(TRAILS, "corner canyon"))).toEqual(["corner"]);
    expect(ids(searchTrails(TRAILS, "jordanel"))).toEqual(["jordanelle"]);
  });

  it("needs every query word to match", () => {
    expect(ids(searchTrails(TRAILS, "lambert canyon"))).toEqual([]);
  });

  it("matches while typing (prefix)", () => {
    expect(ids(searchTrails(TRAILS, "bonn"))).toEqual(["bst-draper"]);
  });

  it("lists a county by name, with name hits ranked above county hits", () => {
    expect(ids(searchTrails(TRAILS, "wasatch"))).toEqual(["wmsp", "jordanelle"]);
    expect(ids(searchTrails(TRAILS, "utah"))).toEqual(["eagle", "lambert"]);
  });

  it("ranks an exact word above a prefix match", () => {
    const list = [trail("a", "Crestwood Park Trail"), trail("b", "Wasatch Crest")];
    expect(ids(searchTrails(list, "crest"))).toEqual(["b", "a"]);
  });
});

describe("member trail names", () => {
  const names = {
    corner: ["Clark's Trail", "Ghost Falls", "Rush"],
    lambert: ["Ridge Trail"],
  };

  it("finds a system from a trail inside it", () => {
    expect(ids(searchTrails(TRAILS, "clarks", names))).toEqual(["corner"]);
    expect(ids(searchTrails(TRAILS, "ghost falls", names))).toEqual(["corner"]);
    expect(ids(searchTrails(TRAILS, "clarks", {}))).toEqual([]);
  });

  it("ranks the system's own name above a member-trail hit", () => {
    const list = [trail("a", "Ridge Park"), trail("b", "Other Park")];
    expect(ids(searchTrails(list, "ridge", { b: ["Ridge Trail"] }))).toEqual(["a", "b"]);
  });

  it("names the member trail that explains the result", () => {
    const corner = TRAILS[1]!;
    expect(memberMatch(corner, "clark", names)).toBe("Clark's Trail");
    expect(memberMatch(corner, "corner canyon", names)).toBeNull();
    expect(memberMatch(corner, "", names)).toBeNull();
  });
});

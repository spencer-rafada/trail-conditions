import { describe, expect, it } from "vitest";
import { lonLatToTile, previewTileUrl } from "./tileSources";

describe("lonLatToTile", () => {
  it("finds the standard web-map tile under a point", () => {
    expect(lonLatToTile(40.7608, -111.891, 10)).toEqual({ z: 10, x: 193, y: 384 });
    expect(lonLatToTile(40.493, -111.835, 14)).toEqual({ z: 14, x: 3102, y: 6173 });
  });
});

describe("previewTileUrl", () => {
  const tile = { z: 14, x: 3102, y: 6173 };

  it("uses USGS Topo for topo (z/y/x order)", () => {
    expect(previewTileUrl("topo", tile, "")).toBe(
      "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/14/6173/3102",
    );
  });

  it("uses CARTO Voyager for simple when a key is set, else OpenStreetMap", () => {
    expect(previewTileUrl("simple", tile, "k1")).toBe(
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/14/3102/6173.png?key=k1",
    );
    expect(previewTileUrl("simple", tile, "")).toBe(
      "https://tile.openstreetmap.org/14/3102/6173.png",
    );
  });

  it("caps topo previews at USGS's deepest native zoom", () => {
    const deep = lonLatToTile(40.493, -111.835, 18);
    expect(previewTileUrl("topo", deep, "")).toContain("/tile/16/");
  });
});

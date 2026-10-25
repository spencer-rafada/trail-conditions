import { describe, expect, it } from "vitest";
import { exploreReturnUrl, rememberExploreUrl } from "./exploreReturn";

describe("exploreReturnUrl", () => {
  it("returns the last explore view, so the Trails breadcrumb restores it", () => {
    rememberExploreUrl("/?q=ghost+falls&at=40.4414%2C-111.7842%2C13");
    expect(exploreReturnUrl()).toBe("/?q=ghost+falls&at=40.4414%2C-111.7842%2C13");
    rememberExploreUrl("/");
    expect(exploreReturnUrl()).toBe("/");
  });
});

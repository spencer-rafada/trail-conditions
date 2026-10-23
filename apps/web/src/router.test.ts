import { afterEach, describe, expect, it, vi } from "vitest";
import { navigate } from "./router";

// Node test env has no window; navigate() only touches window inside the call,
// so a stub is enough — no DOM environment needed.
function stubWindow() {
  const win = {
    history: { pushState: vi.fn(), replaceState: vi.fn() },
    dispatchEvent: vi.fn(),
    scrollTo: vi.fn(),
  };
  vi.stubGlobal("window", win);
  return win;
}

afterEach(() => vi.unstubAllGlobals());

describe("navigate scroll behavior", () => {
  it("resets scroll to the top on push navigation (pushState is scroll-preserving by spec)", () => {
    const win = stubWindow();
    navigate("/trails/demo");
    expect(win.history.pushState).toHaveBeenCalledWith(null, "", "/trails/demo");
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves scroll alone on replace navigation (in-page state like the tab query)", () => {
    const win = stubWindow();
    navigate("/?tab=Utah", { replace: true });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/?tab=Utah");
    expect(win.scrollTo).not.toHaveBeenCalled();
  });
});

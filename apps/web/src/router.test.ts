import { afterEach, describe, expect, it, vi } from "vitest";
import { initScrollRestoration, navigate } from "./router";

// Node test env has no window; the router only touches window/document inside
// calls, so stubs are enough — no DOM environment needed. The history stub
// mirrors the real one far enough for scroll restoration: pushState and
// replaceState update history.state, and a captured popstate handler plays the
// browser's traversal (the browser swaps history.state BEFORE firing popstate).
function stubWindow() {
  const popstateHandlers: Array<() => void> = [];
  const win = {
    history: {
      state: null as unknown,
      scrollRestoration: "auto",
      pushState: vi.fn((state: unknown) => {
        win.history.state = state;
      }),
      replaceState: vi.fn((state: unknown) => {
        win.history.state = state;
      }),
    },
    location: { pathname: "/", search: "" },
    innerHeight: 844,
    scrollY: 0,
    scrollTo: vi.fn(),
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn((type: string, handler: () => void) => {
      if (type === "popstate") popstateHandlers.push(handler);
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("window", win);
  const firePopstate = () => popstateHandlers.forEach((h) => h());
  return { win, firePopstate };
}

function stubRendering(initialScrollHeight: number) {
  const doc = { documentElement: { scrollHeight: initialScrollHeight } };
  vi.stubGlobal("document", doc);
  const rafQueue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  const runFrame = () => {
    const cb = rafQueue.shift();
    if (cb) cb(0);
  };
  return { doc, runFrame, rafQueue };
}

afterEach(() => vi.unstubAllGlobals());

describe("navigate scroll behavior", () => {
  it("resets scroll to the top on push navigation (pushState is scroll-preserving by spec)", () => {
    const { win } = stubWindow();
    navigate("/trails/demo");
    expect(win.history.pushState).toHaveBeenCalledWith(
      expect.objectContaining({ entryId: expect.any(String) }),
      "",
      "/trails/demo",
    );
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("leaves scroll alone on replace navigation (in-page state like the tab query)", () => {
    const { win } = stubWindow();
    navigate("/?tab=Utah", { replace: true });
    expect(win.history.replaceState).toHaveBeenCalledWith(null, "", "/?tab=Utah");
    expect(win.scrollTo).not.toHaveBeenCalled();
  });

  it("replace navigation keeps the entry's id so its saved scroll position survives", () => {
    const { win } = stubWindow();
    initScrollRestoration();
    const stamped = win.history.state as { entryId: string };
    navigate("/?tab=Utah", { replace: true });
    expect((win.history.state as { entryId: string }).entryId).toBe(stamped.entryId);
  });
});

describe("scroll restoration on history traversal", () => {
  it("switches the browser to manual scroll restoration (its auto restore clamps to 0 while the remounted list is still short)", () => {
    const { win } = stubWindow();
    initScrollRestoration();
    expect(win.history.scrollRestoration).toBe("manual");
  });

  it("restores the saved home scroll position on back, waiting until the list has rendered tall enough", () => {
    const { win, firePopstate } = stubWindow();
    const { doc, runFrame } = stubRendering(10309);
    initScrollRestoration();
    const homeState = win.history.state;

    // User scrolls deep on home, then taps a card.
    win.scrollY = 4800;
    navigate("/trails/demo");
    win.scrollY = 0; // trail page opened at the top
    doc.documentElement.scrollHeight = 2000; // trail page is short
    win.scrollTo.mockClear();

    // Browser back: history.state swaps, then popstate fires. The remounted
    // home document is still short (data not fetched yet).
    win.history.state = homeState;
    firePopstate();
    expect(win.scrollTo).not.toHaveBeenCalled();

    runFrame(); // still short — keep waiting
    expect(win.scrollTo).not.toHaveBeenCalled();

    doc.documentElement.scrollHeight = 10309; // home list rendered
    runFrame();
    expect(win.scrollTo).toHaveBeenCalledWith(0, 4800);
  });

  it("on back to a page that was at the top, scrolls to 0 immediately", () => {
    const { win, firePopstate } = stubWindow();
    stubRendering(2000);
    initScrollRestoration();
    const homeState = win.history.state;
    navigate("/trails/demo"); // left home at scrollY 0
    win.scrollTo.mockClear();
    win.history.state = homeState;
    firePopstate();
    expect(win.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  it("saves the position of the entry being left on popstate, so forward/back round-trips restore it", () => {
    const { win, firePopstate } = stubWindow();
    const { doc } = stubRendering(10309);
    initScrollRestoration();
    const homeState = win.history.state;
    win.scrollY = 4800;
    navigate("/trails/demo");
    const trailState = win.history.state;

    // Back to home: the handler must record the trail entry's position (300)
    // before restoring home's. scrollRestoration is manual, so scrollY still
    // sits where the trail page had it when popstate fires.
    win.scrollY = 300;
    win.history.state = homeState;
    firePopstate();
    expect(win.scrollTo).toHaveBeenCalledWith(0, 4800);
    win.scrollTo.mockClear();

    // Forward to the trail page again: its 300 comes back.
    win.scrollY = 4800;
    doc.documentElement.scrollHeight = 2000;
    win.history.state = trailState;
    firePopstate();
    expect(win.scrollTo).toHaveBeenCalledWith(0, 300);
  });

  it("cancels a pending restore when the user navigates again before the list is tall enough", () => {
    const { win, firePopstate } = stubWindow();
    const { doc, runFrame, rafQueue } = stubRendering(10309);
    initScrollRestoration();
    const homeState = win.history.state;
    win.scrollY = 4800;
    navigate("/trails/demo");
    win.scrollY = 0;
    doc.documentElement.scrollHeight = 2000;
    win.scrollTo.mockClear();

    win.history.state = homeState;
    firePopstate(); // restore to 4800 pending (list still short)
    expect(rafQueue.length).toBe(1);
    navigate("/trails/other"); // user taps another card while it loads
    win.scrollTo.mockClear();

    doc.documentElement.scrollHeight = 10309;
    runFrame(); // the stale restore wakes up — it must do nothing
    expect(win.scrollTo).not.toHaveBeenCalled();
  });
});

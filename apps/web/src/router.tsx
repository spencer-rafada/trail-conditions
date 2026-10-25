// Hand-rolled history router (zero new deps, per the ticket's lean-deps
// constraint): pushState for navigation, replaceState for in-page state like
// the selected tab, and a popstate listener so the back button works.
//
// Scroll restoration is manual. The page components unmount on route change,
// so the browser's own same-document restoration fires while the remounted
// document is still short (data not fetched yet) and clamps the offset to 0.
// Instead, each history entry carries an id in history.state, a module map
// remembers scrollY per id, and after a traversal the saved offset is
// re-applied once the document has grown tall enough to hold it.

import { useEffect, useState, type MouseEvent, type ReactNode, type Ref } from "react";

export interface AppLocation {
  pathname: string;
  search: string;
}

const NAVIGATE_EVENT = "app:navigate";

interface EntryState {
  entryId?: string;
}

// scrollY per history entry id. Module-level on purpose: it must survive the
// page components unmounting, and a plain reload starts it empty, which is
// also the correct empty history of a fresh pageview.
const scrollPositions = new Map<string, number>();
let activeEntryId: string | null = null;
// Bumped by every navigation; a pending restore that no longer matches is stale.
let restoreGeneration = 0;
let idCounter = 0;
// How long a traversal waits for the async-loaded list to reach the saved
// offset before giving up and scrolling as far as the document allows.
const RESTORE_WAIT_MS = 5000;

const newEntryId = () => `entry-${++idCounter}-${Date.now().toString(36)}`;

// Read the current entry's id, stamping one via replaceState if this entry
// predates the router (first load, external navigation).
function ensureEntryId(): string {
  const state = window.history.state as EntryState | null;
  if (state?.entryId) return state.entryId;
  const entryId = newEntryId();
  window.history.replaceState(
    { ...state, entryId },
    "",
    window.location.pathname + window.location.search,
  );
  return entryId;
}

// Re-apply a saved offset once the document can hold it. The target page
// fetches its data after mounting, so right after popstate the document is
// usually too short and an immediate scrollTo would clamp to 0 — poll layout
// each frame until the offset is reachable (or the deadline passes, then
// scroll as far as the browser allows).
function restoreScroll(y: number, generation: number): void {
  const deadline = Date.now() + RESTORE_WAIT_MS;
  const attempt = () => {
    if (generation !== restoreGeneration) return; // superseded by a newer navigation
    const reachable = document.documentElement.scrollHeight - window.innerHeight;
    if (y <= Math.max(reachable, 0) || Date.now() >= deadline) {
      window.scrollTo(0, y);
      return;
    }
    requestAnimationFrame(attempt);
  };
  attempt();
}

// Call once at startup, before the first render. Returns a teardown (for tests).
export function initScrollRestoration(): () => void {
  scrollPositions.clear();
  restoreGeneration++;
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  activeEntryId = ensureEntryId();
  const onPopstate = () => {
    restoreGeneration++;
    // scrollRestoration is manual, so when popstate fires the viewport still
    // sits where the entry we are LEAVING had it — record it for a later
    // forward/back to that entry.
    if (activeEntryId !== null) {
      scrollPositions.set(activeEntryId, window.scrollY);
    }
    activeEntryId = ensureEntryId();
    restoreScroll(scrollPositions.get(activeEntryId) ?? 0, restoreGeneration);
  };
  window.addEventListener("popstate", onPopstate);
  return () => window.removeEventListener("popstate", onPopstate);
}

const readLocation = (): AppLocation => ({
  pathname: window.location.pathname,
  search: window.location.search,
});

export function useAppLocation(): AppLocation {
  const [location, setLocation] = useState(readLocation);
  useEffect(() => {
    const onChange = () => setLocation(readLocation());
    window.addEventListener("popstate", onChange);
    window.addEventListener(NAVIGATE_EVENT, onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener(NAVIGATE_EVENT, onChange);
    };
  }, []);
  return location;
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (opts.replace) {
    // Same history entry (in-page state like the tab query): keep its state,
    // and with it the entry id its saved scroll position is keyed on.
    window.history.replaceState(window.history.state, "", to);
  } else {
    restoreGeneration++; // a pending traversal restore is now stale
    // Remember where this entry was left, for when the user comes back.
    scrollPositions.set(ensureEntryId(), window.scrollY);
    activeEntryId = newEntryId();
    window.history.pushState({ entryId: activeEntryId }, "", to);
    // pushState is scroll-preserving by spec (scrollRestoration only covers
    // history traversal), so a new page starts at the top explicitly.
    window.scrollTo(0, 0);
  }
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

export function Link({
  to,
  className,
  children,
  ref,
}: {
  to: string;
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    // Keep cmd/ctrl-click (new tab) and middle-click native.
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a ref={ref} href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

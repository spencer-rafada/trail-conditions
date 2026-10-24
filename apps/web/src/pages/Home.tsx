// Home = explore (search first; map and list for going deeper).
//
// Phone: floating search + chips over a full-screen map, results in a
//   bottom sheet (peek / half / full).
// Desktop (>= 900px): sidebar with search, chips, and the list; map on the
//   right. Hovering a card highlights its pin; clicking a pin highlights the
//   card.
// No pins in the snapshot yet (worker not redeployed): list-only layout.
//
// URL query (replaceState, so back from a trail page restores it):
//   q        search text            rideable=1   Rideable now
//   at       map view "lat,lon,z"   tab          legacy county link -> jump

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { fetchScores, type Snapshot, type TrailScore } from "../api";
import { BottomSheet, type Snap } from "../components/BottomSheet";
import type { CameraMove, CameraRequest } from "../components/ExploreMap";
import { Footer } from "../components/Footer";
import { SearchBar } from "../components/SearchBar";
import { TrailCard, cardDomId } from "../components/TrailCard";
import { exploreList } from "../explore";
import {
  boundsOfTrails,
  formatMiles,
  formatView,
  hasPins,
  milesTo,
  parseView,
  type Bounds,
  type LatLon,
  type MapView,
} from "../geo";
import { TABS, isRideable, tabForCounty, type Tab } from "../helpers";
import { navigate } from "../router";
import { memberMatch, type TrailNames } from "../search";
import { useMediaQuery } from "../useMediaQuery";

const ExploreMap = lazy(() => import("../components/ExploreMap"));

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; snapshot: Snapshot };

// Survive Home unmounting (trail page and back) without new URL params.
let savedSnap: Snap = "half";
let savedOrigin: LatLon | null = null;

/** Member trail names for search (data/trail-names.json); loaded after the
 *  first paint so search on system names works immediately. */
function useTrailNames(): TrailNames {
  const [names, setNames] = useState<TrailNames>({});
  useEffect(() => {
    let cancelled = false;
    import("../trailNames").then(
      (m) => {
        if (!cancelled) setNames(m.TRAIL_NAMES);
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return names;
}

export function Home({ search }: { search: string }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetchScores().then(
      (snapshot) => {
        if (!cancelled) setState({ status: "ready", snapshot });
      },
      () => {
        if (!cancelled) setState({ status: "error" });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== "ready") {
    return (
      <main className="explore no-map">
        <Brand />
        <p className="status-screen" role="status">
          {state.status === "loading"
            ? "Loading conditions…"
            : "Couldn't load conditions. Check your connection and reload."}
        </p>
        <Footer />
      </main>
    );
  }
  return <Explore snapshot={state.snapshot} search={search} />;
}

function Brand() {
  return (
    <header className="brand">
      <h1>Trail Conditions</h1>
      <p className="tagline">Mountain bike trail conditions around the Wasatch</p>
    </header>
  );
}

function Explore({ snapshot, search }: { snapshot: Snapshot; search: string }) {
  const params = new URLSearchParams(search);
  const rideableOnly = params.get("rideable") === "1";
  const legacyTab = TABS.find((t) => t === params.get("tab")) ?? null;

  const trails = useMemo(() => Object.values(snapshot.trails), [snapshot]);
  const mapTrails = useMemo(() => trails.filter(hasPins), [trails]);
  const showMap = mapTrails.length > 0;
  const isDesktop = useMediaQuery("(min-width: 900px)");
  const trailNames = useTrailNames();

  // The input is local state (no cursor jumps); the URL follows, debounced.
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [origin, setOrigin] = useState<LatLon | null>(savedOrigin);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [snap, setSnapState] = useState<Snap>(savedSnap);
  const [sheetPx, setSheetPx] = useState(0);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const cameraKey = useRef(0);
  const viewRef = useRef<MapView | null>(parseView(params.get("at")));

  const setSnap = (s: Snap) => {
    savedSnap = s;
    setSnapState(s);
  };

  const writeUrl = (next: { q?: string; rideable?: boolean; view?: MapView | null }) => {
    const p = new URLSearchParams();
    const q = next.q ?? query;
    if (q.trim()) p.set("q", q.trim());
    if (next.rideable ?? rideableOnly) p.set("rideable", "1");
    const view = next.view === undefined ? viewRef.current : next.view;
    if (view) p.set("at", formatView(view));
    const qs = p.toString();
    navigate(qs ? `/?${qs}` : "/", { replace: true });
  };

  useEffect(() => {
    const t = setTimeout(() => writeUrl({ q: query }), 300);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveCamera = (move: CameraMove) => {
    cameraKey.current += 1;
    setCamera({ ...move, key: cameraKey.current });
  };

  // First map view: the URL's, else a legacy ?tab= county, else everything.
  const initialCamera = useMemo<CameraRequest>(() => {
    const fromUrl = viewRef.current;
    if (fromUrl) return { kind: "view", view: fromUrl, key: 0 };
    const county = legacyTab
      ? boundsOfTrails(mapTrails.filter((t) => tabForCounty(t.county) === legacyTab))
      : null;
    const all = boundsOfTrails(mapTrails)!;
    return { kind: "bounds", bounds: county ?? all, maxZoom: 13, key: 0 };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const result = exploreList({
    trails,
    query,
    rideableOnly,
    bounds: showMap ? bounds : null,
    origin,
    names: trailNames,
  });

  // Pins: search results, or everything (minus non-rideable with the filter).
  const visibleIds = useMemo(() => {
    const ids =
      result.mode === "search"
        ? result.trails.map((t) => t.id)
        : mapTrails.filter((t) => !rideableOnly || isRideable(t)).map((t) => t.id);
    return new Set(ids);
  }, [result.mode, result.trails, mapTrails, rideableOnly]);

  // Fit the map to search results once typing settles.
  const resultKey = result.mode === "search" ? result.trails.map((t) => t.id).join(",") : "";
  useEffect(() => {
    if (!showMap || !resultKey) return;
    const t = setTimeout(() => {
      const box = boundsOfTrails(result.trails);
      if (box) moveCamera({ kind: "bounds", bounds: box, maxZoom: 13 });
    }, 450);
    return () => clearTimeout(t);
  }, [resultKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A tapped pin: highlight its card and bring it into view.
  useEffect(() => {
    if (!selectedId) return;
    if (!isDesktop && snap === "peek") setSnap("half");
    const t = setTimeout(() => {
      document
        .getElementById(cardDomId(selectedId))
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 60);
    return () => clearTimeout(t);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToCounty = (tab: Tab) => {
    const box = boundsOfTrails(mapTrails.filter((t) => tabForCounty(t.county) === tab));
    if (!box) return;
    setQuery("");
    setSelectedId(null);
    moveCamera({ kind: "bounds", bounds: box, maxZoom: 13 });
  };

  const toggleNearMe = () => {
    setGeoError(null);
    if (origin) {
      savedOrigin = null;
      setOrigin(null);
      return;
    }
    if (!("geolocation" in navigator)) {
      setGeoError("This browser can't share your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        savedOrigin = here;
        setOrigin(here);
        setQuery("");
        if (showMap) moveCamera({ kind: "view", view: { ...here, zoom: 11 } });
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? "Location is off. Allow it in your browser settings to use Near me."
            : "Couldn't find your location. Try again.",
        );
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };

  const searching = result.mode === "search";
  const total = result.trails.length;
  const summary = searching
    ? total === 0
      ? `No trails match “${query.trim()}”`
      : `${total} trail${total === 1 ? "" : "s"} match “${query.trim()}”`
    : `${total} trail${total === 1 ? "" : "s"}${result.mode === "area" ? " in this area" : ""}${
        rideableOnly ? " rideable now" : ` · ${result.rideableCount} rideable now`
      }`;

  const nowMs = Date.now();
  const list = (
    <>
      {total === 0 ? (
        <div className="empty">
          {searching ? (
            <p>Check the spelling, or search for the area or park name.</p>
          ) : rideableOnly ? (
            <p>Nothing here is rideable right now.</p>
          ) : (
            <p>No trails in this map area.</p>
          )}
          {!searching && showMap && (
            <button
              type="button"
              className="text-btn"
              onClick={() =>
                moveCamera({ kind: "bounds", bounds: boundsOfTrails(mapTrails)!, maxZoom: 13 })
              }
            >
              Show all trails
            </button>
          )}
        </div>
      ) : (
        <ul className="cards">
          {result.trails.map((t: TrailScore) => {
            const miles = origin ? milesTo(t, origin) : null;
            return (
              <TrailCard
                key={t.id}
                trail={t}
                nowMs={nowMs}
                distance={miles === null ? undefined : formatMiles(miles)}
                showCounty={searching}
                matchedName={searching ? memberMatch(t, query, trailNames) : null}
                selected={t.id === selectedId}
                {...(isDesktop && showMap && { onHover: setHoveredId })}
              />
            );
          })}
        </ul>
      )}
      <Footer />
    </>
  );

  const summaryLine = (
    <h2 className="summary" aria-live="polite">
      {summary}
    </h2>
  );

  const top = (
    <div className="explore-top">
      {(isDesktop || !showMap) && <Brand />}
      {!isDesktop && showMap && <h1 className="sr-only">Trail Conditions</h1>}
      <SearchBar value={query} onChange={setQuery} />
      <div className="chips" role="group" aria-label="Filters">
        <button
          type="button"
          className="chip-btn"
          aria-pressed={rideableOnly}
          onClick={() => writeUrl({ rideable: !rideableOnly })}
        >
          Rideable now
        </button>
        <button
          type="button"
          className="chip-btn"
          aria-pressed={origin !== null}
          disabled={locating}
          onClick={toggleNearMe}
        >
          {locating ? "Locating…" : "Near me"}
        </button>
        {showMap &&
          TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className="chip-btn chip-jump"
              onClick={() => jumpToCounty(tab)}
              aria-label={`Show ${tab} County on the map`}
            >
              {tab}
            </button>
          ))}
      </div>
      {geoError && (
        <p className="search-error" role="alert">
          {geoError}
        </p>
      )}
    </div>
  );

  if (!showMap) {
    return (
      <main className="explore no-map">
        {top}
        <section className="explore-panel">
          {summaryLine}
          {list}
        </section>
      </main>
    );
  }

  const insets = isDesktop ? { top: 0, bottom: 0 } : { top: 120, bottom: sheetPx };

  return (
    <main className={`explore has-map ${isDesktop ? "is-desktop" : "is-phone"}`}>
      {top}
      <div className="explore-map">
        <Suspense fallback={<p className="map-loading">Loading map…</p>}>
          <ExploreMap
            trails={mapTrails}
            visibleIds={visibleIds}
            selectedId={selectedId}
            hoveredId={hoveredId}
            origin={origin}
            initial={initialCamera}
            camera={camera}
            insets={insets}
            onSelect={setSelectedId}
            onViewChange={(b, view) => {
              setBounds(b);
              viewRef.current = view;
              writeUrl({ view });
            }}
          />
        </Suspense>
      </div>
      {isDesktop ? (
        <section className="explore-panel" aria-label="Trail list">
          {summaryLine}
          {list}
        </section>
      ) : (
        <BottomSheet snap={snap} onSnapChange={setSnap} onHeightChange={setSheetPx} header={summaryLine}>
          {list}
        </BottomSheet>
      )}
    </main>
  );
}

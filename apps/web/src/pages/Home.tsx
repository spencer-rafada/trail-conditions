// Home (spec §10): county tabs, best-conditions-first trail cards, and the
// "Rideable now" filter. Tab and filter live in the URL query (replaceState)
// so back from a trail page restores them and tabs are deep-linkable.

import { useEffect, useState } from "react";
import { fetchScores, type Snapshot, type TrailScore } from "../api";
import {
  BAND_LABELS,
  TABS,
  isRideable,
  levelColor,
  levelLabel,
  ridersConfirmed,
  sortBestFirst,
  tabForCounty,
  today,
  updatedAgo,
  type Tab,
} from "../helpers";
import { Link, navigate } from "../router";

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; snapshot: Snapshot };

const DAY_NAMES = ["Today", "Tomorrow", "Day after"] as const;

function TrailCard({ trail, nowMs }: { trail: TrailScore; nowMs: number }) {
  const day = today(trail);
  const riders = day ? ridersConfirmed(day.confidence) : 0;
  return (
    <li>
      <Link to={`/trails/${encodeURIComponent(trail.id)}`} className="card">
        <div className="card-head">
          <h2>{trail.name}</h2>
          {day && (
            <span className="chip" style={{ backgroundColor: levelColor(day.level) }}>
              {levelLabel(day.level)}
            </span>
          )}
        </div>
        {day && <p className="card-meta">{BAND_LABELS[day.confidence.band]} confidence</p>}
        {riders > 0 && (
          <p className="riders">
            ✔ {riders} rider{riders === 1 ? "" : "s"} confirmed today
          </p>
        )}
        {day?.note && <p className="note">{day.note}</p>}
        <ol className="strip">
          {trail.days.map((d) => (
            <li key={d.offset}>
              <span className="strip-day">{DAY_NAMES[d.offset]}</span>
              <span
                className="strip-chip"
                style={{ backgroundColor: levelColor(d.level) }}
              >
                {levelLabel(d.level)}
              </span>
            </li>
          ))}
        </ol>
        <p className="updated">Updated {updatedAgo(trail.scored_utc, nowMs)}</p>
      </Link>
    </li>
  );
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

  const params = new URLSearchParams(search);
  const tab: Tab = TABS.find((t) => t === params.get("tab")) ?? "Salt Lake";
  const rideableOnly = params.get("rideable") === "1";

  const setQuery = (nextTab: Tab, nextRideable: boolean) => {
    const next = new URLSearchParams();
    next.set("tab", nextTab);
    if (nextRideable) next.set("rideable", "1");
    navigate(`/?${next.toString()}`, { replace: true });
  };

  return (
    <main className="home">
      <header className="page-header">
        <h1>Trail Conditions</h1>
        <p className="tagline">Mountain bike trail conditions around the Wasatch</p>
      </header>

      <nav className="tabs" aria-label="County">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={t === tab}
            onClick={() => setQuery(t, rideableOnly)}
          >
            {t}
          </button>
        ))}
      </nav>

      <label className="filter">
        <input
          type="checkbox"
          checked={rideableOnly}
          onChange={(e) => setQuery(tab, e.target.checked)}
        />
        Rideable now
      </label>

      {state.status === "loading" && (
        <p className="status-screen" role="status">
          Loading conditions…
        </p>
      )}
      {state.status === "error" && (
        <p className="status-screen">
          Couldn't load conditions. Check your connection and reload.
        </p>
      )}
      {state.status === "ready" && <CardList snapshot={state.snapshot} tab={tab} rideableOnly={rideableOnly} />}
    </main>
  );
}

function CardList({
  snapshot,
  tab,
  rideableOnly,
}: {
  snapshot: Snapshot;
  tab: Tab;
  rideableOnly: boolean;
}) {
  const all = Object.values(snapshot.trails);
  if (all.length === 0) {
    return (
      <p className="status-screen">
        No conditions yet — scores appear after the first scheduled run.
      </p>
    );
  }
  const onTab = all.filter((t) => tabForCounty(t.county) === tab);
  const shown = sortBestFirst(rideableOnly ? onTab.filter(isRideable) : onTab);
  if (shown.length === 0) {
    return (
      <p className="status-screen">
        {rideableOnly
          ? `Nothing rideable in ${tab} right now.`
          : `No scored trails in ${tab} yet.`}
      </p>
    );
  }
  const nowMs = Date.now();
  return (
    <ul className="cards">
      {shown.map((t) => (
        <TrailCard key={t.id} trail={t} nowMs={nowMs} />
      ))}
    </ul>
  );
}

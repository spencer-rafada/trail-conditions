// Trail page (spec §10): level, confidence, the "why" factors (last rain,
// soil, drying speed, worst section), reports since the last rain, and the
// "Is this right?" button, which opens the §6.1 report modal (M5).

import { useEffect, useRef, useState } from "react";
import { WETNESS } from "@trail-conditions/model";
import { ApiError, fetchTrail, type TrailDetail } from "../api";
import { ReportModal } from "../components/ReportModal";
import { BAND_LABELS, levelColor, levelLabel, updatedAgo } from "../helpers";
import { Link } from "../router";

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "notfound" }
  | { status: "ready"; detail: TrailDetail };

const DAY_NAMES = ["Today", "Tomorrow", "Day after"] as const;

const SOIL_COPY = {
  sandy: "Sandy — drains fast",
  clay: "Clay — dries slowly",
  loam: "Loam",
} as const;

export function Trail({ id }: { id: string }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [reporting, setReporting] = useState(false);
  // The element that opened the modal; focus returns to it on close
  // (ARIA dialog pattern — otherwise Tab lands in the footer).
  const openerRef = useRef<HTMLElement | null>(null);

  const openReport = () => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReporting(true);
  };

  const closeReport = () => {
    setReporting(false);
    openerRef.current?.focus();
  };

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchTrail(id).then(
      (detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({
          status: err instanceof ApiError && err.status === 404 ? "notfound" : "error",
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  // After a submit: refetch past the 5-minute HTTP cache so the new report
  // count shows. On a refetch error keep the current view — the modal
  // already confirmed the save.
  const refresh = () => {
    fetchTrail(id, { fresh: true }).then(
      (detail) => setState({ status: "ready", detail }),
      () => {},
    );
  };

  return (
    <main className="trail">
      <Link to="/" className="back">
        ← All trails
      </Link>
      {state.status === "loading" && (
        <p className="status-screen" role="status">
          Loading trail…
        </p>
      )}
      {state.status === "error" && (
        <p className="status-screen">
          Couldn't load this trail. Check your connection and reload.
        </p>
      )}
      {state.status === "notfound" && (
        <p className="status-screen">No trail with this address.</p>
      )}
      {state.status === "ready" && (
        <Detail detail={state.detail} onReport={openReport} />
      )}
      {reporting && (
        <ReportModal trailId={id} onClose={closeReport} onSubmitted={refresh} />
      )}
    </main>
  );
}

function Detail({ detail, onReport }: { detail: TrailDetail; onReport: () => void }) {
  const nowMs = Date.now();
  const day = detail.days.find((d) => d.offset === 0);
  return (
    <>
      <header className="page-header">
        <h1>{detail.name}</h1>
        {detail.county && <p className="tagline">{detail.county}</p>}
      </header>

      {day ? (
        <section className="trail-now">
          <span className="chip chip-lg" style={{ backgroundColor: levelColor(day.level) }}>
            {levelLabel(day.level)}
          </span>
          <span className="card-meta">{BAND_LABELS[day.confidence.band]} confidence</span>
          {day.note && <p className="note">{day.note}</p>}
          <ol className="strip">
            {detail.days.map((d) => (
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
          {detail.scored_utc && (
            <p className="updated">Updated {updatedAgo(detail.scored_utc, nowMs)}</p>
          )}
        </section>
      ) : (
        <p className="status-screen">Not scored yet — check back after the next run.</p>
      )}

      <section>
        <h2>Why</h2>
        <dl className="why">
          <dt>Last rain</dt>
          <dd>
            {detail.last_rain
              ? `${detail.last_rain.precip_in.toFixed(2)} in, ${updatedAgo(detail.last_rain.ts_utc, nowMs)}`
              : `No rain in the last ${WETNESS.windowHours / 24} days`}
          </dd>
          <dt>Soil</dt>
          <dd>{detail.soil ? SOIL_COPY[detail.soil] : "Unknown"}</dd>
          <dt>Drying speed</dt>
          <dd>
            {detail.drying_hours !== null
              ? `~${Math.round(detail.drying_hours)} h to dry after rain`
              : "Unknown"}
          </dd>
          <dt>Worst section</dt>
          <dd>{day?.worst_point ?? "—"}</dd>
        </dl>
      </section>

      <section>
        <h2>Rider reports</h2>
        <p>
          {detail.reports_since_rain === 0
            ? "No reports since the last rain."
            : `${detail.reports_since_rain} report${
                detail.reports_since_rain === 1 ? "" : "s"
              } since the last rain.`}
        </p>
        <button type="button" className="report-btn" onClick={onReport}>
          Is this right?
        </button>
      </section>
    </>
  );
}

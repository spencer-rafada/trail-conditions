// One trail in the list: today's condition is the headline, so a rider gets
// the answer without opening the trail page.

import type { TrailScore } from "../api";
import {
  BAND_LABELS,
  levelColor,
  levelLabel,
  ridersConfirmed,
  tabForCounty,
  today,
  updatedAgo,
} from "../helpers";
import { Link } from "../router";

const DAY_NAMES = ["Today", "Tomorrow", "Day after"] as const;

export const cardDomId = (trailId: string): string => `trail-card-${trailId}`;

export function TrailCard({
  trail,
  nowMs,
  distance,
  showCounty,
  matchedName,
  selected,
  onHover,
}: {
  trail: TrailScore;
  nowMs: number;
  /** "6.2 mi" after Near me. */
  distance?: string | undefined;
  showCounty?: boolean;
  /** The trail inside this system that the search matched. */
  matchedName?: string | null;
  selected?: boolean;
  onHover?: (id: string | null) => void;
}) {
  const day = today(trail);
  const riders = day ? ridersConfirmed(day.confidence) : 0;
  const county = showCounty ? tabForCounty(trail.county) : null;
  const meta = [
    day ? `${BAND_LABELS[day.confidence.band]} confidence` : null,
    county,
    distance,
  ].filter((x): x is string => Boolean(x));

  return (
    <li
      id={cardDomId(trail.id)}
      className={selected ? "is-selected" : undefined}
      onMouseEnter={onHover ? () => onHover(trail.id) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onFocus={onHover ? () => onHover(trail.id) : undefined}
      onBlur={onHover ? () => onHover(null) : undefined}
    >
      <Link to={`/trails/${encodeURIComponent(trail.id)}`} className="card">
        <div className="card-head">
          <h3>{trail.name}</h3>
          {day && (
            <span className="chip" style={{ backgroundColor: levelColor(day.level) }}>
              {levelLabel(day.level)}
            </span>
          )}
        </div>
        {matchedName && <p className="card-match">Includes {matchedName}</p>}
        {meta.length > 0 && <p className="card-meta">{meta.join(" · ")}</p>}
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
              <span className="strip-chip" style={{ backgroundColor: levelColor(d.level) }}>
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

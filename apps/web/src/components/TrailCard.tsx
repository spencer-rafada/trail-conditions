// One trail in the list: today's condition is the headline, so a rider gets
// the answer without opening the trail page.

import type { TrailScore } from "../api";
import { levelColor, levelLabel, tabForCounty, today, updatedAgo } from "../helpers";
import { ConfidenceMeter, Reasons, VerdictLine } from "./Confidence";
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
  const county = showCounty ? tabForCounty(trail.county) : null;
  const meta = [county, distance].filter((x): x is string => Boolean(x));

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
          {meta.length > 0 && <span className="card-meta">{meta.join(" · ")}</span>}
        </div>
        {matchedName && <p className="card-match">Includes {matchedName}</p>}
        {day ? (
          <>
            <VerdictLine level={day.level} />
            <ConfidenceMeter conf={day.confidence} />
            <Reasons conf={day.confidence} />
          </>
        ) : (
          <p className="card-meta">Not scored yet</p>
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

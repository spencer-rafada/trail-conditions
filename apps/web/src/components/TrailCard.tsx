// One trail in the list: today's condition is the headline, so a rider gets
// the answer without opening the trail page.

import type { TrailScore } from "../api";
import { tabForCounty, today, updatedAgo } from "../helpers";
import { ConfidenceMeter, Reasons, VerdictLine } from "./Confidence";
import { DayStrip } from "./DayStrip";
import { Link } from "../router";

export function TrailCard({
  trail,
  nowMs,
  distance,
  showCounty,
  matchedName,
  onHover,
}: {
  trail: TrailScore;
  nowMs: number;
  /** "6.2 mi" after Near me. */
  distance?: string | undefined;
  showCounty?: boolean;
  /** The trail inside this system that the search matched. */
  matchedName?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const day = today(trail);
  const county = showCounty ? tabForCounty(trail.county) : null;
  const meta = [county, distance].filter((x): x is string => Boolean(x));

  return (
    <li
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
        <DayStrip days={trail.days} />
        <p className="updated">Updated {updatedAgo(trail.scored_utc, nowMs)}</p>
      </Link>
    </li>
  );
}

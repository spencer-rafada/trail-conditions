// The card a pin opens on the map (Airbnb-style): the trail's answer at a
// glance, and one tap to its full page. On desktop it floats over its pin;
// on phones it sits at the bottom of the map, above the sheet.

import { useEffect, useRef } from "react";
import type { TrailScore } from "../api";
import { today, updatedAgo } from "../helpers";
import { Link } from "../router";
import { ConfidenceMeter, VerdictLine } from "./Confidence";
import { DayStrip } from "./DayStrip";

export function TrailPreview({
  trail,
  nowMs,
  distance,
  onClose,
}: {
  trail: TrailScore;
  nowMs: number;
  /** "6.2 mi" after Near me. */
  distance?: string | undefined;
  onClose: () => void;
}) {
  const day = today(trail);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const meta = [trail.county, distance].filter((x): x is string => Boolean(x));

  // Keyboard users opened this with Enter on a pin; take them to the card,
  // and when it closes, back to that pin instead of the top of the page.
  useEffect(() => {
    const opener = document.activeElement;
    const card = linkRef.current?.closest(".preview") ?? null;
    linkRef.current?.focus({ preventScroll: true });
    return () => {
      // By cleanup the card is gone from the DOM, so focus has fallen to body.
      const active = document.activeElement;
      const focusWasInCard = !active || active === document.body || card?.contains(active);
      if (focusWasInCard && opener instanceof HTMLElement && opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    };
  }, [trail.id]);

  return (
    <article className="preview" aria-label={`${trail.name} preview`}>
      <Link
        ref={linkRef}
        to={`/trails/${encodeURIComponent(trail.id)}`}
        className="preview-link"
      >
        <h3>{trail.name}</h3>
        {meta.length > 0 && <p className="card-meta">{meta.join(" · ")}</p>}
        {day ? (
          <>
            <VerdictLine level={day.level} />
            <ConfidenceMeter conf={day.confidence} />
          </>
        ) : (
          <p className="card-meta">Not scored yet</p>
        )}
        <DayStrip days={trail.days} />
        <p className="preview-foot">
          <span className="updated">Updated {updatedAgo(trail.scored_utc, nowMs)}</span>
          <span className="preview-more" aria-hidden="true">
            Details ›
          </span>
        </p>
      </Link>
      <button type="button" className="preview-close" aria-label="Close preview" onClick={onClose}>
        ×
      </button>
    </article>
  );
}

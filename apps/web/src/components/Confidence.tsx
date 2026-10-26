// The answer and how sure it is: a plain verdict ("✓ Rideable"), a
// confidence score out of 100 with words and a bar, and the facts behind
// it, so riders can judge for themselves.

import type { Confidence as ConfidenceData, ConditionLevel } from "@trail-conditions/model";
import {
  BAND_LABELS,
  BAND_WORDS,
  LEVEL_DETAILS,
  VERDICT_ICONS,
  VERDICT_LABELS,
  confidenceBreakdown,
  levelColor,
  levelLabel,
  topReasons,
  verdictFor,
} from "../helpers";

export function VerdictLine({ level, large }: { level: ConditionLevel; large?: boolean }) {
  const v = verdictFor(level);
  const color = levelColor(level);
  return (
    <p className={`verdict${large ? " verdict-lg" : ""}`}>
      <span className="verdict-icon" style={{ backgroundColor: color }} aria-hidden="true">
        {VERDICT_ICONS[v]}
      </span>
      <strong style={{ color }}>{VERDICT_LABELS[v]}</strong>
      <span className="verdict-level">
        <span className="verdict-dot" aria-hidden="true">
          ·{" "}
        </span>
        {levelLabel(level)}
        {LEVEL_DETAILS[level] ? ` (${LEVEL_DETAILS[level]})` : ""}
      </span>
    </p>
  );
}

export function ConfidenceMeter({ conf }: { conf: ConfidenceData }) {
  const words = `${BAND_LABELS[conf.band]}: ${BAND_WORDS[conf.band]}`;
  return (
    <div className="conf">
      <span className="conf-label">Confidence</span>
      <span className="conf-num">
        <strong>{conf.score}</strong>/100
      </span>
      <span
        className="conf-bar"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={conf.score}
        aria-label={`Confidence ${conf.score} out of 100, ${words}`}
      >
        <span style={{ width: `${conf.score}%` }} />
      </span>
      <span className={`conf-band conf-${conf.band}`}>{words}</span>
    </div>
  );
}

export function Reasons({ conf, max = 2 }: { conf: ConfidenceData; max?: number }) {
  const reasons = topReasons(conf, max);
  if (reasons.length === 0) return null;
  return (
    <ul className="reasons">
      {reasons.map((r) => (
        <li key={r.text} className={r.good ? "is-good" : "is-bad"}>
          <span aria-hidden="true">{r.good ? "✔" : "⚠"}</span> {r.text}
        </li>
      ))}
    </ul>
  );
}

/** Trail page: every factor with its points, adding up to the score. */
export function ConfidenceBreakdown({ conf }: { conf: ConfidenceData }) {
  const b = confidenceBreakdown(conf);
  const sign = (n: number) => (n > 0 ? `+${n}` : `−${Math.abs(n)}`);
  return (
    <>
      <table className="breakdown">
        <tbody>
          <tr>
            <th scope="row">Starting point</th>
            <td>{b.start}</td>
          </tr>
          {b.rows.map((r) => (
            <tr key={r.text} className={r.delta > 0 ? "is-good" : "is-bad"}>
              <th scope="row">{r.text}</th>
              <td>{sign(r.delta)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">Confidence</th>
            <td>
              {b.score}/100{b.capped ? "*" : ""}
            </td>
          </tr>
        </tfoot>
      </table>
      {b.capped && <p className="fine">* The score stays between 0 and 100.</p>}
      <p className="fine">
        Confidence is how sure this estimate is, not the chance the trail is dry. Low
        confidence? Check the last rain above and recent rider reports, or ask riders who
        were out today.
      </p>
    </>
  );
}

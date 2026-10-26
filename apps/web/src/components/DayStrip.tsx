// Today · Tomorrow · Day after, each as a level chip.

import type { ConditionLevel } from "@trail-conditions/model";
import { levelColor, levelLabel } from "../helpers";

const DAY_NAMES = ["Today", "Tomorrow", "Day after"] as const;

export function DayStrip({
  days,
}: {
  days: readonly { offset: number; level: ConditionLevel }[];
}) {
  return (
    <ol className="strip">
      {days.map((d) => (
        <li key={d.offset}>
          <span className="strip-day">{DAY_NAMES[d.offset]}</span>
          <span className="strip-chip" style={{ backgroundColor: levelColor(d.level) }}>
            {levelLabel(d.level)}
          </span>
        </li>
      ))}
    </ol>
  );
}

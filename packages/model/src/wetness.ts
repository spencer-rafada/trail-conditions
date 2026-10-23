// Hourly wetness walk, spec §4.2. Generic over past and future hours: the
// caller supplies one merged hour axis (Stage IV precip for past hours,
// Open-Meteo filling gaps and the forecast) in chronological order.

import { WETNESS } from "./config";

export interface HourSample {
  /** Temperature at the sample point's elevation, °F. */
  tempF: number;
  /** Precipitation during the hour, inches. */
  precipIn: number;
}

export function tauEff(tauTrailHours: number, tempF: number): number {
  return (
    tauTrailHours *
    (1 + Math.max(0, WETNESS.coldRefTempF - tempF) / WETNESS.coldSlowdownDivisor)
  );
}

export function walkWetness(
  hours: readonly HourSample[],
  tauTrailHours: number,
  initialWetness = 0,
): number {
  let w = initialWetness;
  for (const hour of hours) {
    w = w * Math.exp(-1 / tauEff(tauTrailHours, hour.tempF)) + hour.precipIn;
  }
  return w;
}

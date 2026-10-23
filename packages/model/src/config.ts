// Every tunable number in the mud model and confidence marker lives in this
// one module (spec docs/projects/trail-conditions/spec.md §4.1–§4.3, §5).
// These are starting values; rider reports tune tau_mult only (§6.4).

// §4.1 Drying time (tau) per trail, hours.
export const TAU = {
  sandPctMin: 60, // sand >= 60% -> sandyHours
  sandyHours: 12,
  clayPctMin: 30, // clay >= 30% -> clayHours
  clayHours: 48,
  defaultHours: 24,
  rockFragPctMin: 15, // fraggt10 + frag3to10 >= 15% -> rockFragMult
  rockFragMult: 0.75,
  hydrogroupDMult: 1.2, // hydrologic group D
  hydrogroupAMult: 0.8, // hydrologic group A
} as const;

// §4.2 Wetness walk.
export const WETNESS = {
  windowHours: 240, // walk the last 240 hours (10 days), then the forecast
  coldRefTempF: 55, // below this, drying slows:
  coldSlowdownDivisor: 10, // tau_eff = tau * (1 + max(0, 55 - tempF) / 10)
} as const;

// §4.3 Levels. Half-open intervals; >= on the upper threshold wins.
export const LEVEL_THRESHOLDS = {
  prime: 0.05,
  soft: 0.15,
  muddy: 0.35,
} as const;

// §4.3 Overrides.
export const OVERRIDES = {
  snowfallWindowHours: 48, // Snow: snowfall >= snowfallMinIn during this window
  snowfallMinIn: 0.5,
  // Snow: snow depth > 0 at the point (no tunable threshold; any depth counts)
  freezeTempF: 32, // Freeze note: temp < freezeTempF and w >= freezeWetnessMin
  freezeWetnessMin: 0.15,
} as const;

export const FREEZE_NOTE = "Frozen early, muddy when it thaws.";

// Worst-point rule (§4.3): "use the worst point". Snow outranks everything —
// a snowed-in section closes the trail regardless of the dirt elsewhere.
export const LEVEL_SEVERITY = {
  dry: 0,
  prime: 1,
  soft: 2,
  muddy: 3,
  snow: 4,
} as const;

// §5 Confidence marker. Score 0–100, start at 60.
export const CONFIDENCE = {
  start: 60,
  agreePerReport: 20, // each agreeing rider report since the last rain, last 24 h
  agreeMaxBonus: 40, // ... capped at +40 total
  disagreePenalty: -20, // a rider report that disagrees with the model
  reportsConflictPenalty: -15, // reports disagree with each other
  sourceDivergenceMinIn: 0.25, // Stage IV vs Open-Meteo differ by > 0.25 in ...
  sourceDivergenceWindowHours: 72, // ... over the last 72 h
  sourceDivergencePenalty: -15,
  highElevationMinMeters: 2400, // radar beam is blocked more in the mountains
  highElevationPenalty: -15,
  rainEventMinIn: 0.1, // "rain" for the since-rain factors means > 0.1 in in an hour
  recentRainMaxHours: 12, // less than 12 h since rain -> penalty
  recentRainPenalty: -10,
  longDryMinHours: 72, // more than 72 h since rain -> bonus
  longDryBonus: 10,
  tunedMinReports: 5, // trail is tuned: 5+ reports used in tau_mult
  tunedBonus: 10,
  forecastDayPenalty: -10, // per forecast day (tomorrow / day after)
  bands: { high: 70, medium: 40 }, // High >= 70, Medium 40–69, Low < 40
} as const;

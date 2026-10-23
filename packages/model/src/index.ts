// Pure mud-model functions. The Worker, the backtest, and the tests all
// import from this package — no I/O, no Date.now(), no environment access.
// Every tunable number lives in ./config.

export {
  TAU,
  WETNESS,
  LEVEL_THRESHOLDS,
  OVERRIDES,
  FREEZE_NOTE,
  LEVEL_SEVERITY,
  CONFIDENCE,
} from "./config";
export { tauBase, tauTrail, type SoilProfile } from "./tau";
export { tauEff, walkWetness, type HourSample } from "./wetness";
export {
  levelFromWetness,
  pointCondition,
  worstPoint,
  type Level,
  type ConditionLevel,
  type PointConditionInput,
  type PointCondition,
  type NamedPointCondition,
} from "./level";
export {
  confidence,
  type Confidence,
  type ConfidenceBand,
  type ConfidenceFactor,
  type ConfidenceInput,
} from "./confidence";

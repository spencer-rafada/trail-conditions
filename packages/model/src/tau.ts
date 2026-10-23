// Drying time (tau) per trail, spec §4.1. Pure functions; soil values come
// from the USDA SDA query in spec §3.1.

export interface SoilProfile {
  /** sandtotal_r, percent. null when SDA has no surface horizon data. */
  sandPct: number | null;
  /** claytotal_r, percent. */
  clayPct: number | null;
  /** fraggt10_r, percent. */
  fragGt10Pct: number | null;
  /** frag3to10_r, percent. */
  frag3to10Pct: number | null;
  /** hydgrp, e.g. "A", "C", "D". Dual classes like "A/D" use the first
   *  (drained) letter. */
  hydrologicGroup: string | null;
}

import { TAU } from "./config";

export function tauBase(soil: SoilProfile): number {
  let tau: number;
  if (soil.sandPct !== null && soil.sandPct >= TAU.sandPctMin) {
    tau = TAU.sandyHours;
  } else if (soil.clayPct !== null && soil.clayPct >= TAU.clayPctMin) {
    tau = TAU.clayHours;
  } else {
    tau = TAU.defaultHours;
  }

  const fragPct = (soil.fragGt10Pct ?? 0) + (soil.frag3to10Pct ?? 0);
  if (fragPct >= TAU.rockFragPctMin) tau *= TAU.rockFragMult;

  // SDA dual classes ("A/D") name the drained condition first; use it.
  const group = soil.hydrologicGroup?.trim().toUpperCase().charAt(0);
  if (group === "D") tau *= TAU.hydrogroupDMult;
  if (group === "A") tau *= TAU.hydrogroupAMult;

  return tau;
}

export function tauTrail(soil: SoilProfile, tauMult = 1): number {
  return tauBase(soil) * tauMult;
}

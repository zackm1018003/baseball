// International amateur signing-bonus projection (pitchers).
//
// This is a TRANSPARENT, TUNABLE model — not trained on data (international bonus +
// measurable pairs barely exist publicly). Everything keys off PROJECTED stuff,
// age-adjusted, then maps a future-value (FV) grade to a bonus band. Every constant
// below is a calibration knob; adjust them as real comps come in.

// ─── Calibration constants ──────────────────────────────────────────────────
export const TUNING = {
  // Velo projection: young arms gain velo toward a peak age. Gains taper with age and
  // get a bump for tall/projectable frames.
  peakAge: 21.0,           // age fastball velo is assumed to peak
  veloGainPerYear: 0.45,   // mph gained per year of remaining runway (linear, capped)
  maxRunwayYears: 4.5,     // cap on years of projected growth
  frameBumpTall: 0.6,      // +mph projection for 6'4"+ (>=76 in)
  frameBumpMed:  0.3,      // +mph projection for 6'2"-6'3" (74-75 in)

  // FV weights (must sum to 1).
  wVelo: 0.55, wSecondary: 0.27, wCommand: 0.18,

  // FV grade (20-80) -> projected bonus band in USD. Point is the central estimate.
  // Calibrated to the top international PITCHER signings, 2021-2025:
  //   Luis Morales  (CUB RHP 94-97, #5)  $3.0M  (record for a pitcher; Cuban outlier) -> ~FV65
  //   Branneli Franco (DR, best arm)     $0.80M (top-of-class projectable)            -> ~FV55
  //   Jun-Seok Shim (KOR RHP 94-96 t100) $0.75M (#10 overall)                         -> ~FV55
  //   Kevin DeFrank (DR RHP)             $0.56M                                        -> ~FV50
  //   Sadbiel Delzine (VEN RHP)          $0.50M                                        -> ~FV50
  //   Villoria/Tiburcio (VEN/DR RHP)     $0.43M                                        -> ~FV47
  //   Omar Damian / De La Rosa (DR RHP)  $0.30-0.40M                                   -> ~FV45
  // Even a 94-96 top-10 arm only reached ~$0.75M, so amateur DR/VEN arms top out <~$1M.
  // Anchored so the comps reproduce: DeFrank (sits ~95 -> FV ~59) = $560K, Delzine
  // (sits ~94, 16yo) = $500K. Bermudez (sits 90/tops 93 -> FV ~50) therefore lands
  // ~$300K, a clear step below the mid-90s arms. Franco ($800K) and Morales ($3M) sit
  // ABOVE the curve — pedigree/advanced premiums the measurables can't see.
  fvBands: [
    { fv: 65, low:   700_000, point: 1_000_000, high: 1_600_000 },
    { fv: 60, low:   450_000, point:   600_000, high:   850_000 },
    { fv: 55, low:   300_000, point:   420_000, high:   600_000 },
    { fv: 50, low:   200_000, point:   300_000, high:   450_000 },
    { fv: 45, low:   100_000, point:   160_000, high:   260_000 },
    { fv: 40, low:    40_000, point:    80_000, high:   150_000 },
    { fv: 35, low:    10_000, point:    30_000, high:    70_000 },
  ] as { fv: number; low: number; point: number; high: number }[],
};

export interface PitcherProfile {
  age: number;            // years (e.g. 17.67)
  heightIn?: number | null;
  throws?: 'L' | 'R' | null;
  fbVelo: number | null;  // avg fastball velo (mph)
  fbMax?: number | null;
  strikePct?: number | null;     // overall strike %
  // best secondary pitch summary
  secondaryWhiffPct?: number | null;   // whiff% of best secondary
  secondaryCount?: number | null;      // # of that secondary (sample-size gate)
}

export interface BonusProjection {
  projVelo: number | null;
  veloGrade: number | null;
  secondaryGrade: number | null;
  commandGrade: number | null;
  fv: number | null;
  bonusLow: number | null;
  bonusPoint: number | null;
  bonusHigh: number | null;
  notes: string[];
}

// Map a number through breakpoints (piecewise-linear).
function lerpTable(x: number, pts: [number, number][]): number {
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * ((x - x0) / (x1 - x0));
  }
  return pts[pts.length - 1][1];
}

// Projected peak fastball velo from current velo + age runway + frame.
export function projectVelo(fbVelo: number, age: number, heightIn?: number | null): number {
  const runway = Math.max(0, Math.min(TUNING.maxRunwayYears, TUNING.peakAge - age));
  const growth = runway * TUNING.veloGainPerYear;
  const frame = (heightIn ?? 0) >= 76 ? TUNING.frameBumpTall : (heightIn ?? 0) >= 74 ? TUNING.frameBumpMed : 0;
  return Math.round((fbVelo + growth + frame) * 10) / 10;
}

// Projected-velo (mph) -> 20-80 grade. Anchored so the real signing tier lines up:
// the $500K+ international arms (DeFrank/Delzine/Shim) all sat mid-90s, so 94-96 has
// to grade in the upper-50s/low-60s and low-90s (sits 90, tops 93) lands ~50.
function veloToGrade(projVelo: number): number {
  return Math.round(lerpTable(projVelo, [
    [86, 38], [88, 42], [90, 46], [92, 50], [94, 55], [95, 58], [96, 61], [98, 67], [100, 74],
  ]));
}

// Best-secondary whiff% -> 20-80 grade (sample-gated by caller).
function secondaryToGrade(whiffPct: number): number {
  return Math.round(lerpTable(whiffPct, [
    [10, 40], [20, 45], [30, 50], [40, 55], [50, 60], [60, 65],
  ]));
}

// Strike% -> command grade (amateur scale; ~63% avg).
function strikeToGrade(strikePct: number): number {
  return Math.round(lerpTable(strikePct, [
    [55, 40], [60, 45], [63, 50], [67, 55], [71, 60], [75, 65],
  ]));
}

export function projectPitcherBonus(p: PitcherProfile): BonusProjection {
  const notes: string[] = [];
  if (p.fbVelo == null) {
    return { projVelo: null, veloGrade: null, secondaryGrade: null, commandGrade: null, fv: null, bonusLow: null, bonusPoint: null, bonusHigh: null, notes: ['no fastball velo'] };
  }
  const projVelo = projectVelo(p.fbVelo, p.age, p.heightIn);
  const veloGrade = veloToGrade(projVelo);
  notes.push(`proj velo ${projVelo} (now ${p.fbVelo}, age ${p.age.toFixed(1)}${p.heightIn ? `, ${Math.floor(p.heightIn/12)}'${p.heightIn%12}"` : ''})`);

  // Secondary: gate on sample size; default to a 45 (fringe) if too few thrown.
  let secondaryGrade = 45;
  if (p.secondaryWhiffPct != null && (p.secondaryCount ?? 0) >= 5) {
    secondaryGrade = secondaryToGrade(p.secondaryWhiffPct);
  } else {
    notes.push('secondary graded conservatively (small sample)');
  }

  const commandGrade = p.strikePct != null ? strikeToGrade(p.strikePct) : 45;

  const fvRaw = TUNING.wVelo * veloGrade + TUNING.wSecondary * secondaryGrade + TUNING.wCommand * commandGrade;
  const fv = Math.round(fvRaw);

  // FV -> bonus band (piecewise-linear). lerpTable needs ascending x, so sort by fv.
  const bands = [...TUNING.fvBands].sort((a, b) => a.fv - b.fv);
  const low  = Math.round(lerpTable(fv, bands.map(b => [b.fv, b.low]   as [number, number])));
  const point = Math.round(lerpTable(fv, bands.map(b => [b.fv, b.point] as [number, number])));
  const high = Math.round(lerpTable(fv, bands.map(b => [b.fv, b.high]  as [number, number])));

  return { projVelo, veloGrade, secondaryGrade, commandGrade, fv, bonusLow: low, bonusPoint: point, bonusHigh: high, notes };
}

// Per-level league baselines (mean/std) used to convert a raw stat into a percentile
// rank (1-99) for the little percentile bars shown throughout the player cards.
// Extracted from app/player/[id]/season/page.tsx so app/player/[id]/daily/page.tsx
// (and any other card) can share the exact same baselines/percentile math.

// Approximate normal CDF → percentile rank (1–99)
export function calcPct(value: number | null, mean: number, std: number, invert = false): number | null {
  if (value == null) return null;
  const z  = (value - mean) / std;
  const az = Math.abs(z) / Math.SQRT2;  // standard normal CDF = 0.5*(1+erf(z/√2))
  const t  = 1 / (1 + 0.3275911 * az);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-az * az);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const p = Math.round(Math.min(99, Math.max(1, cdf * 100)));
  return invert ? 100 - p : p;
}

// Per-level baselines for percentile calculation.
// MLB Statcast metrics sourced from Baseball Savant leaderboard 2025 (min 50 BBE):
//   avg_hit_speed mean=88.6 std=2.27, max_hit_speed mean=111.0 std=3.61, brl_percent mean=9.4 std=4.78
//   avg_bat_speed mean=71.8 std=3.45, ev50 (top-50% avg EV) mean=100.0, ev95percent mean=42.6%
//   avg_hit_angle (all balls) mean=13.92 std=6.87
// ev90 (top-10% avg EV): derived from ev50=100 + max=111 distribution → ~107 mph for season.
// avgLaHard (avg LA on 95+ mph balls): includes hard grounders (negative LA), so population mean
//   is ~13-14°, similar to all-ball avg. std ~8° accounts for the wide range (grounders to fly balls).
//   17° avg LA on 95+ is genuinely good (line-drive/FB contact); mean=13.5, std=8.
// AAA reads essentially identical to MLB in Statcast hardware — confirmed by Savant data.
// AA/High-A/Low-A: estimated ~1.5/3/4.5 mph below MLB for avgEv; maxEv/ev90 scaled proportionally.
export type LGBaselines = Record<string, { mean: number; std: number; inv?: boolean }>;

export const LG_MLB: LGBaselines = {
  avg:         { mean: 0.243, std: 0.032 },
  obp:         { mean: 0.312, std: 0.038 },
  slg:         { mean: 0.390, std: 0.065 },
  ops:         { mean: 0.702, std: 0.098 },
  xwoba:       { mean: 0.297, std: 0.044 },
  xba:         { mean: 0.243, std: 0.032 },
  xslg:        { mean: 0.388, std: 0.068 },
  avgEv:       { mean: 88.6,  std: 2.5  },  // Savant 2025: mean=88.59 std=2.27
  barrelPct:   { mean: 9.4,   std: 4.8  },  // Savant 2025: mean=9.44 std=4.78
  avgLaHard:   { mean: 13.5,  std: 8.0  },  // incl. hard grounders → true pop mean ~13-14°; 17° ≈ 67th pct (good LD/FB contact)
  sweetSpotPct:{ mean: 31.0,  std: 8.5  },
  avgBatSpeed: { mean: 71.5,  std: 3.5  },  // Savant bat-tracking 2025: mean=71.81 std=3.45
  fastSwingPct:{ mean: 40.0,  std: 13.0 },
  maxEv:       { mean: 111.0, std: 3.6  },  // Savant 2025: mean=111.00 std=3.61
  ev90:        { mean: 107.0, std: 3.5  },  // Savant 2025: derived from ev50=100, ev95pct=42.6%, max=111 → top-10% avg ~107
  swingPct:    { mean: 47.0,  std: 5.5  },
  zSwingPct:   { mean: 68.0,  std: 8.5  },
  chasePct:    { mean: 27.5,  std: 6.5,  inv: true },
  zContactPct: { mean: 84.0,  std: 7.0  },
  ozContactPct:{ mean: 59.0,  std: 9.0  },
  whiffPct:    { mean: 24.5,  std: 6.5,  inv: true },
  contactPct:  { mean: 75.5,  std: 6.5  },  // = 100 - whiffPct
  kPct:        { mean: 22.5,  std: 6.5,  inv: true },
  bbPct:       { mean: 8.2,   std: 3.2  },
};

// AAA: Statcast hardware identical to MLB — EV readings confirmed equal by Savant data
export const LG_AAA: LGBaselines = {
  avg:         { mean: 0.255, std: 0.034 },
  obp:         { mean: 0.328, std: 0.042 },
  slg:         { mean: 0.415, std: 0.072 },
  ops:         { mean: 0.743, std: 0.108 },
  xwoba:       { mean: 0.315, std: 0.048 },
  xba:         { mean: 0.255, std: 0.034 },
  xslg:        { mean: 0.412, std: 0.075 },
  avgEv:       { mean: 88.5,  std: 2.6  },  // ≈ MLB (Savant data shows 88.65)
  barrelPct:   { mean: 9.0,   std: 4.8  },  // slightly below MLB
  avgLaHard:   { mean: 13.0,  std: 8.0  },
  sweetSpotPct:{ mean: 30.5,  std: 9.0  },
  avgBatSpeed: { mean: 71.0,  std: 3.8  },
  fastSwingPct:{ mean: 38.0,  std: 13.5 },
  maxEv:       { mean: 110.5, std: 3.8  },  // ≈ MLB (Savant data shows 111.15)
  ev90:        { mean: 106.5, std: 3.7  },
  swingPct:    { mean: 47.5,  std: 6.0  },
  zSwingPct:   { mean: 67.0,  std: 9.0  },
  chasePct:    { mean: 28.5,  std: 7.0,  inv: true },
  zContactPct: { mean: 82.0,  std: 8.0  },
  ozContactPct:{ mean: 57.0,  std: 10.0 },
  whiffPct:    { mean: 25.5,  std: 7.0,  inv: true },
  contactPct:  { mean: 74.5,  std: 7.0  },
  kPct:        { mean: 23.5,  std: 7.0,  inv: true },
  bbPct:       { mean: 9.0,   std: 3.5  },
};

// Double-A: ~1.5 mph below MLB avg EV; proportional drop in maxEv/ev90
export const LG_AA: LGBaselines = {
  avg:         { mean: 0.248, std: 0.038 },
  obp:         { mean: 0.322, std: 0.044 },
  slg:         { mean: 0.400, std: 0.075 },
  ops:         { mean: 0.722, std: 0.112 },
  xwoba:       { mean: 0.308, std: 0.050 },
  xba:         { mean: 0.248, std: 0.038 },
  xslg:        { mean: 0.400, std: 0.077 },
  avgEv:       { mean: 87.0,  std: 2.8  },
  barrelPct:   { mean: 8.0,   std: 4.5  },
  avgLaHard:   { mean: 12.5,  std: 8.5  },
  sweetSpotPct:{ mean: 30.0,  std: 9.2  },
  avgBatSpeed: { mean: 70.5,  std: 3.9  },
  fastSwingPct:{ mean: 37.0,  std: 13.8 },
  maxEv:       { mean: 109.5, std: 4.0  },
  ev90:        { mean: 105.0, std: 3.8  },
  swingPct:    { mean: 47.0,  std: 6.5  },
  zSwingPct:   { mean: 66.0,  std: 9.0  },
  chasePct:    { mean: 29.0,  std: 7.2,  inv: true },
  zContactPct: { mean: 81.5,  std: 8.0  },
  ozContactPct:{ mean: 56.0,  std: 10.5 },
  whiffPct:    { mean: 26.0,  std: 7.2,  inv: true },
  contactPct:  { mean: 74.0,  std: 7.2  },
  kPct:        { mean: 24.0,  std: 7.2,  inv: true },
  bbPct:       { mean: 8.8,   std: 3.5  },
};

// High-A: ~3 mph below MLB avg EV
export const LG_HIGH_A: LGBaselines = {
  avg:         { mean: 0.247, std: 0.040 },
  obp:         { mean: 0.321, std: 0.046 },
  slg:         { mean: 0.392, std: 0.078 },
  ops:         { mean: 0.713, std: 0.115 },
  xwoba:       { mean: 0.306, std: 0.052 },
  xba:         { mean: 0.247, std: 0.040 },
  xslg:        { mean: 0.392, std: 0.080 },
  avgEv:       { mean: 85.5,  std: 3.0  },
  barrelPct:   { mean: 7.5,   std: 4.5  },
  avgLaHard:   { mean: 12.0,  std: 8.5  },
  sweetSpotPct:{ mean: 29.8,  std: 9.5  },
  avgBatSpeed: { mean: 70.0,  std: 4.0  },
  fastSwingPct:{ mean: 36.5,  std: 14.0 },
  maxEv:       { mean: 108.0, std: 4.3  },
  ev90:        { mean: 103.5, std: 4.0  },
  swingPct:    { mean: 46.5,  std: 7.0  },
  zSwingPct:   { mean: 65.5,  std: 9.2  },
  chasePct:    { mean: 29.5,  std: 7.5,  inv: true },
  zContactPct: { mean: 81.0,  std: 8.5  },
  ozContactPct:{ mean: 55.5,  std: 10.8 },
  whiffPct:    { mean: 26.5,  std: 7.5,  inv: true },
  contactPct:  { mean: 73.5,  std: 7.5  },
  kPct:        { mean: 24.5,  std: 7.5,  inv: true },
  bbPct:       { mean: 9.0,   std: 3.7  },
};

// Low-A: avgEv ~3 mph below MLB; top-end EV (ev90/maxEv) closer to MLB because
// Low-A rosters are filled with high-ceiling prospects whose raw power rivals upper levels.
export const LG_LOW_A: LGBaselines = {
  avg:         { mean: 0.245, std: 0.040 },
  obp:         { mean: 0.320, std: 0.048 },
  slg:         { mean: 0.390, std: 0.080 },
  ops:         { mean: 0.710, std: 0.118 },
  xwoba:       { mean: 0.305, std: 0.054 },
  xba:         { mean: 0.245, std: 0.040 },
  xslg:        { mean: 0.390, std: 0.082 },
  avgEv:       { mean: 85.5,  std: 3.2  },
  barrelPct:   { mean: 7.0,   std: 4.5  },
  avgLaHard:   { mean: 11.5,  std: 9.0  },
  sweetSpotPct:{ mean: 29.5,  std: 9.5  },
  avgBatSpeed: { mean: 69.5,  std: 4.0  },
  fastSwingPct:{ mean: 36.0,  std: 14.0 },
  maxEv:       { mean: 107.0, std: 4.5  },
  ev90:        { mean: 103.0, std: 4.0  },
  swingPct:    { mean: 46.0,  std: 7.5  },
  zSwingPct:   { mean: 66.0,  std: 9.5  },
  chasePct:    { mean: 29.5,  std: 7.5,  inv: true },
  zContactPct: { mean: 80.0,  std: 9.0  },
  ozContactPct:{ mean: 55.0,  std: 11.0 },
  whiffPct:    { mean: 27.0,  std: 7.5,  inv: true },
  contactPct:  { mean: 73.0,  std: 7.5  },
  kPct:        { mean: 25.0,  std: 7.5,  inv: true },
  bbPct:       { mean: 9.5,   std: 4.0  },
};

// ACL + FCL combined: rookie/complex level
export const LG_ROOKIE: LGBaselines = {
  avg:         { mean: 0.238, std: 0.045 },
  obp:         { mean: 0.315, std: 0.052 },
  slg:         { mean: 0.375, std: 0.088 },
  ops:         { mean: 0.690, std: 0.130 },
  xwoba:       { mean: 0.300, std: 0.058 },
  xba:         { mean: 0.238, std: 0.045 },
  xslg:        { mean: 0.375, std: 0.090 },
  avgEv:       { mean: 83.5,  std: 3.5  },
  barrelPct:   { mean: 6.5,   std: 5.0  },
  avgLaHard:   { mean: 11.0,  std: 9.0  },
  sweetSpotPct:{ mean: 29.0,  std: 10.0 },
  avgBatSpeed: { mean: 69.0,  std: 4.2  },
  fastSwingPct:{ mean: 35.0,  std: 14.5 },
  maxEv:       { mean: 104.0, std: 5.0  },
  ev90:        { mean: 99.0,  std: 4.5  },
  swingPct:    { mean: 45.5,  std: 8.0  },
  zSwingPct:   { mean: 64.5,  std: 9.5  },
  chasePct:    { mean: 30.5,  std: 8.0,  inv: true },
  zContactPct: { mean: 79.0,  std: 9.5  },
  ozContactPct:{ mean: 54.0,  std: 11.5 },
  whiffPct:    { mean: 28.0,  std: 8.0,  inv: true },
  contactPct:  { mean: 72.0,  std: 8.0  },
  kPct:        { mean: 26.0,  std: 8.0,  inv: true },
  bbPct:       { mean: 10.0,  std: 4.2  },
};

// Map level strings from the MLB Stats API to the correct baseline set.
// PCL (Pacific Coast League) and IL (International League) are both Triple-A.
// ACL (Arizona Complex League) and FCL (Florida Complex League) are both Rookie complex level.
export function getLG(level: string | null | undefined): LGBaselines {
  if (!level) return LG_MLB;
  const l = level.toLowerCase();
  if (l.includes('aaa') || l.includes('triple') || l.includes('pcl') || l.includes('international')) return LG_AAA;
  if (l.includes(' aa') || l.includes('double-a') || l.includes('double a') || l === 'aa') return LG_AA;
  if (l.includes('high') || l.includes('a+') || l.includes('high-a') || l.includes('florida state')) return LG_HIGH_A;
  if (l.includes('low') || l.includes('single-a') || l.includes('single a')) return LG_LOW_A;
  if (l.includes('acl') || l.includes('fcl') || l.includes('rookie') || l.includes('complex') || l.includes('arizona') || l.includes('florida')) return LG_ROOKIE;
  return LG_MLB;
}

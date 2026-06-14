import { Pitcher, PitchTypeData } from '@/types/pitcher';

const PITCH_KEYS = ['ff','si','fc','sl','st','sv','cu','kc','ch','fs'] as const;
type PitchKey = typeof PITCH_KEYS[number];

export interface PitcherComp {
  pitcher: Pitcher;
  dataset: string;
  score: number;         // Euclidean distance — lower = more similar
  avgIvb: number;
  avgHb: number;
}

// Build a [arm_angle, wavg_ivb, wavg_hb] feature vector.
// Returns null if the pitcher lacks arm angle or movement data.
function buildVector(p: Pitcher): [number, number, number] | null {
  const armAngle = p.arm_angle;
  if (armAngle == null) return null;

  let totalUsage = 0;
  let wIvb = 0;
  let wHb = 0;

  for (const key of PITCH_KEYS) {
    const pt = p[key as PitchKey] as PitchTypeData | undefined;
    if (!pt?.usage || pt.movement_v == null || pt.movement_h == null) continue;
    wIvb += pt.movement_v * pt.usage;
    wHb  += pt.movement_h * pt.usage;
    totalUsage += pt.usage;
  }

  if (totalUsage === 0) return null;

  const avgIvb = wIvb / totalUsage;
  const avgHb  = wHb  / totalUsage;

  // Scale arm angle so a 5° diff ≈ 3" movement diff in distance units
  return [armAngle * 0.6, avgIvb * 1.2, avgHb];
}

export function getMovementProfile(p: Pitcher): { avgIvb: number; avgHb: number } | null {
  const v = buildVector(p);
  if (!v) return null;
  const armAngle = p.arm_angle!;
  return { avgIvb: v[1] / 1.2, avgHb: v[2] };
}

// Target can come from the API (spring-summary page) as a plain object with
// arm_angle, and pitchTypes array. We accept either a full Pitcher or a
// lightweight descriptor.
export interface MovementTarget {
  player_id?: number;
  arm_angle: number;
  pitchTypes: { name: string; usage: number; v_movement: number | null; h_movement: number | null }[];
}

const NAME_TO_KEY: Record<string, PitchKey> = {
  '4-Seam Fastball': 'ff', 'Sinker': 'si', 'Cutter': 'fc',
  'Changeup': 'ch', 'Splitter': 'fs', 'Curveball': 'cu',
  'Knuckle Curve': 'kc', 'Slider': 'sl', 'Sweeper': 'st', 'Slurve': 'sv',
};

function buildVectorFromTarget(t: MovementTarget): [number, number, number] | null {
  let totalUsage = 0, wIvb = 0, wHb = 0;
  for (const pt of t.pitchTypes) {
    if (!pt.usage || pt.v_movement == null || pt.h_movement == null) continue;
    wIvb += pt.v_movement * pt.usage;
    wHb  += pt.h_movement * pt.usage;
    totalUsage += pt.usage;
  }
  if (totalUsage === 0) return null;
  return [t.arm_angle * 0.6, (wIvb / totalUsage) * 1.2, wHb / totalUsage];
}

export function findSimilarPitchers(
  target: MovementTarget,
  allPitchers: { pitcher: Pitcher; dataset: string }[],
  limit = 10,
): PitcherComp[] {
  const tv = buildVectorFromTarget(target);
  if (!tv) return [];

  const results: PitcherComp[] = [];

  for (const { pitcher, dataset } of allPitchers) {
    if (pitcher.player_id != null && pitcher.player_id === target.player_id) continue;
    const pv = buildVector(pitcher);
    if (!pv) continue;

    const score = Math.sqrt(
      (tv[0] - pv[0]) ** 2 +
      (tv[1] - pv[1]) ** 2 +
      (tv[2] - pv[2]) ** 2,
    );

    // Recompute readable avg ivb/hb for display
    let totalUsage = 0, wIvb = 0, wHb = 0;
    for (const key of PITCH_KEYS) {
      const pt = pitcher[key as PitchKey] as PitchTypeData | undefined;
      if (!pt?.usage || pt.movement_v == null || pt.movement_h == null) continue;
      wIvb += pt.movement_v * pt.usage;
      wHb  += pt.movement_h * pt.usage;
      totalUsage += pt.usage;
    }

    results.push({
      pitcher,
      dataset,
      score,
      avgIvb: totalUsage > 0 ? wIvb / totalUsage : 0,
      avgHb:  totalUsage > 0 ? wHb  / totalUsage : 0,
    });
  }

  results.sort((a, b) => a.score - b.score);
  return results.slice(0, limit);
}

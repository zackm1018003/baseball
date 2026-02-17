import { Player } from '@/types/player';

/**
 * Calculate percentile for a value in an array
 * @param value - The value to find percentile for
 * @param sortedArray - Sorted array of values
 * @returns Percentile (0-100)
 */
function calculatePercentile(value: number | null, sortedArray: number[]): number | null {
  if (value === null || value === undefined || sortedArray.length === 0) {
    return null;
  }

  // Count how many values are less than or equal to this value
  let count = 0;
  for (const v of sortedArray) {
    if (v <= value) {
      count++;
    }
  }

  return Math.round((count / sortedArray.length) * 100);
}

/**
 * Get sorted array of non-null values for a stat
 */
function getSortedValues(players: Player[], statKey: keyof Player): number[] {
  const values = players
    .map(p => p[statKey])
    .filter(v => v !== null && v !== undefined && typeof v === 'number') as number[];

  return values.sort((a, b) => a - b);
}

/**
 * Stats where higher is better
 */
const HIGHER_IS_BETTER = [
  'bat_speed',
  'fast_swing_%',
  'avg_ev',
  'max_ev',
  'barrel_%',
  'hard_hit%',
  'ev90',
  'ideal_angle_%',
  'bb%',
  'z-swing%',
  'bb_percent',
  'zone_swing_percent',
  'zone_contact_percent',
  'woba_percent',
  'xwoba_percent',
];

/**
 * Stats where lower is better
 */
const LOWER_IS_BETTER = [
  'swing_length',
  'k%',
  'z-whiff%',
  'chase%',
  'o-whiff%',
  'k_percent',
  'chase_percent',
];

/**
 * Calculate all percentiles for a player
 */
export function calculatePlayerPercentiles(
  player: Player,
  allPlayers: Player[]
): Record<string, number | null> {
  const percentiles: Record<string, number | null> = {};

  // List of stats to calculate percentiles for
  const stats: (keyof Player)[] = [
    'bat_speed',
    'fast_swing_%',
    'swing_length',
    'ideal_angle_%',
    'avg_ev',
    'max_ev',
    'barrel_%',
    'hard_hit%',
    'ev90',
    'bb%',
    'k%',
    'z-swing%',
    'z-whiff%',
    'chase%',
    'o-whiff%',
    'pull_air%',
    // Minor league field names
    'bb_percent',
    'k_percent',
    'zone_swing_percent',
    'zone_contact_percent',
    'chase_percent',
    'xwoba_percent',
    'woba_percent',
  ];

  for (const stat of stats) {
    const sortedValues = getSortedValues(allPlayers, stat);
    const rawPercentile = calculatePercentile(player[stat] as number | null, sortedValues);

    // Invert percentile for stats where lower is better
    if (rawPercentile !== null && LOWER_IS_BETTER.includes(stat as string)) {
      percentiles[stat as string] = 100 - rawPercentile;
    } else {
      percentiles[stat as string] = rawPercentile;
    }
  }

  return percentiles;
}

/**
 * Get color class based on percentile
 * @param percentile - Percentile value (0-100)
 * @returns Tailwind color class
 */
export function getPercentileColor(percentile: number | null): string {
  if (percentile === null) return 'text-gray-500';

  if (percentile >= 90) return 'text-white font-bold'; // Dark red bg needs white text
  if (percentile >= 75) return 'text-red-800';
  if (percentile >= 50) return 'text-gray-700';
  if (percentile >= 25) return 'text-blue-800';
  return 'text-white'; // Dark blue bg needs white text
}

/**
 * Get background color class for percentile badge
 */
export function getPercentileBgColor(percentile: number | null): string {
  if (percentile === null) return 'bg-gray-100';

  if (percentile >= 90) return 'bg-red-700'; // Best: dark red
  if (percentile >= 75) return 'bg-red-200'; // Good: light red
  if (percentile >= 50) return 'bg-gray-50'; // Middle: white
  if (percentile >= 25) return 'bg-blue-300'; // Below avg: light blue
  return 'bg-blue-700'; // Worst: dark blue
}

/**
 * Get percentile label
 */
export function getPercentileLabel(percentile: number | null): string {
  if (percentile === null) return 'N/A';

  if (percentile >= 90) return 'Elite';
  if (percentile >= 75) return 'Great';
  if (percentile >= 50) return 'Above Avg';
  if (percentile >= 25) return 'Below Avg';
  return 'Poor';
}

/**
 * Format percentile for display
 */
export function formatPercentile(percentile: number | null): string {
  if (percentile === null) return 'N/A';

  // Get the correct ordinal suffix (st, nd, rd, th)
  const suffix = getOrdinalSuffix(percentile);
  return `${percentile}${suffix}`;
}

/**
 * Get ordinal suffix for a number (st, nd, rd, th)
 */
function getOrdinalSuffix(num: number): string {
  const lastDigit = num % 10;
  const lastTwoDigits = num % 100;

  // Special cases for 11th, 12th, 13th
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return 'th';
  }

  // 1st, 2nd, 3rd
  if (lastDigit === 1) return 'st';
  if (lastDigit === 2) return 'nd';
  if (lastDigit === 3) return 'rd';

  // Everything else uses 'th'
  return 'th';
}

/**
 * Calculate Decision+ for a player (OPS+-style, 100 = league average)
 * Formula: 100 × (playerZSwing/lgZSwing + lgChase/playerChase - 1)
 * Higher is better: swings at strikes more than avg + chases less than avg
 */
export function calculateDecisionPlus(player: Player, allPlayers: Player[]): number | null {
  const playerZSwing = (player as any)['z-swing%'] ?? (player as any)['zone_swing_percent'];
  const playerChase = (player as any)['chase%'] ?? (player as any)['chase_percent'];

  if (playerZSwing == null || playerChase == null || playerChase === 0) return null;

  // Calculate league averages using only qualified players (300+ ABs)
  const qualifiedPlayers = allPlayers.filter(p => (p.ab ?? 0) >= 300);
  const zSwingValues = qualifiedPlayers
    .map(p => (p as any)['z-swing%'] ?? (p as any)['zone_swing_percent'])
    .filter((v: any) => v != null && typeof v === 'number') as number[];
  const chaseValues = qualifiedPlayers
    .map(p => (p as any)['chase%'] ?? (p as any)['chase_percent'])
    .filter((v: any) => v != null && typeof v === 'number') as number[];

  if (zSwingValues.length === 0 || chaseValues.length === 0) return null;

  const lgZSwing = zSwingValues.reduce((a, b) => a + b, 0) / zSwingValues.length;
  const lgChase = chaseValues.reduce((a, b) => a + b, 0) / chaseValues.length;

  if (lgZSwing === 0) return null;

  return Math.round(100 * (playerZSwing / lgZSwing + lgChase / playerChase - 1));
}

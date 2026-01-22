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
  'ev50',
  'ideal_angle_%',
  'z-swing%',
];

/**
 * Stats where lower is better
 */
const LOWER_IS_BETTER = [
  'swing_length',
  'z-whiff%',
  'chase%',
  'o-whiff%',
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
    'ev50',
    'z-swing%',
    'z-whiff%',
    'chase%',
    'o-whiff%',
    'pull_air%',
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

  if (percentile >= 90) return 'text-amber-700 font-bold';
  if (percentile >= 75) return 'text-yellow-700';
  if (percentile >= 50) return 'text-orange-600';
  if (percentile >= 25) return 'text-red-600';
  return 'text-red-700';
}

/**
 * Get background color class for percentile badge
 */
export function getPercentileBgColor(percentile: number | null): string {
  if (percentile === null) return 'bg-gray-100';

  if (percentile >= 90) return 'bg-amber-100';
  if (percentile >= 75) return 'bg-yellow-100';
  if (percentile >= 50) return 'bg-orange-50';
  if (percentile >= 25) return 'bg-red-100';
  return 'bg-red-200';
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
  return `${percentile}th`;
}

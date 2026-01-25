import { Player } from '@/types/player';

// Swing decision metrics to compare
const SWING_METRICS = ['z-swing%', 'z-whiff%', 'chase%', 'o-whiff%'] as const;
const MLB_METRICS = [...SWING_METRICS, 'bat_speed', 'avg_la'] as const;
const AAA_METRICS = [...SWING_METRICS, 'max_ev', 'avg_la'] as const;
const AA_APLUS_METRICS = ['z-swing%', 'z-whiff%', 'chase%', 'o-whiff%'] as const; // Common metrics for cross-dataset comparison
const A_METRICS = ['z-swing%', 'z-whiff%', 'chase%', 'o-whiff%', 'avg_la', 'max_ev'] as const; // A dataset with optional o-whiff%, avg_la, and max_ev

interface SimilarPlayer {
  player: Player;
  score: number; // Lower is more similar (distance)
}

type DatasetType = 'mlb' | 'aaa' | 'aa_aplus' | 'a' | 'other';

/**
 * Calculate Euclidean distance between two players based on swing decision metrics
 * For MLB: includes bat_speed
 * For AAA: includes max_ev
 * For AA/A+: only z-swing%, z-whiff%, chase%
 */
function calculateSwingDecisionDistance(
  player1: Player,
  player2: Player,
  datasetType: DatasetType = 'mlb'
): number {
  let sumSquaredDifferences = 0;
  let validMetricsCount = 0;

  // Choose metrics based on dataset type
  let metrics: readonly string[];
  let minRequiredMetrics: number;

  switch (datasetType) {
    case 'mlb':
      metrics = MLB_METRICS;
      minRequiredMetrics = 5;
      break;
    case 'aaa':
      metrics = AAA_METRICS;
      minRequiredMetrics = 5;
      break;
    case 'aa_aplus':
      metrics = AA_APLUS_METRICS;
      minRequiredMetrics = 3; // Require at least z-swing%, z-whiff%, chase% (o-whiff% optional)
      break;
    case 'a':
      metrics = A_METRICS;
      minRequiredMetrics = 3; // At minimum, require z-swing%, z-whiff%, chase%
      break;
    default:
      metrics = AAA_METRICS;
      minRequiredMetrics = 5;
  }

  for (const metric of metrics) {
    const val1 = player1[metric as keyof Player];
    const val2 = player2[metric as keyof Player];

    // Only calculate if both players have valid values for this metric
    if (val1 !== null && val1 !== undefined &&
        val2 !== null && val2 !== undefined &&
        typeof val1 === 'number' && typeof val2 === 'number') {
      let diff = val1 - val2;

      // Normalize bat_speed, max_ev, and avg_la to be on similar scale as percentages
      // Bat speed typically varies by 5-10 mph, max EV by 10-15 mph, avg LA by 10-15 degrees
      // Scale them so they don't dominate the distance calculation
      if (metric === 'bat_speed') {
        diff = diff * 2; // Weight bat speed more heavily (typically smaller variance)
      } else if (metric === 'max_ev') {
        // For A dataset, weight max_ev heavily to find players with similar power potential
        diff = diff * (datasetType === 'a' ? 3 : 1);
      } else if (metric === 'avg_la') {
        // For A dataset, weight avg_la as heavily as max_ev for power/contact quality comparison
        diff = diff * (datasetType === 'a' ? 3 : 2);
      }

      sumSquaredDifferences += diff * diff;
      validMetricsCount++;
    }
  }

  // If we don't have enough valid metrics, return infinity (incomparable)
  if (validMetricsCount < minRequiredMetrics) {
    return Infinity;
  }

  // Return the Euclidean distance
  return Math.sqrt(sumSquaredDifferences);
}

/**
 * Find players with similar swing decision metrics
 * @param targetPlayer - The player to compare against
 * @param allPlayers - All players to search through
 * @param limit - Maximum number of similar players to return (default 5)
 * @param datasetType - Type of dataset (mlb, aaa, aa_aplus, other)
 * @returns Array of similar players sorted by similarity (most similar first)
 */
export function findSimilarPlayersBySwingDecision(
  targetPlayer: Player,
  allPlayers: Player[],
  limit: number = 5,
  datasetType: DatasetType = 'mlb'
): SimilarPlayer[] {
  // Calculate distance for each player
  const playersWithScores: SimilarPlayer[] = allPlayers
    .filter(p => p.player_id !== targetPlayer.player_id && p.full_name !== targetPlayer.full_name) // Exclude the target player
    .map(player => ({
      player,
      score: calculateSwingDecisionDistance(targetPlayer, player, datasetType)
    }))
    .filter(item => item.score !== Infinity); // Remove incomparable players

  // Sort by score (ascending - lower is more similar)
  playersWithScores.sort((a, b) => a.score - b.score);

  // Return top N most similar players
  return playersWithScores.slice(0, limit);
}

/**
 * Calculate percentage difference for display
 */
export function getMetricDifference(
  targetPlayer: Player,
  comparedPlayer: Player,
  metric: typeof SWING_METRICS[number]
): number | null {
  const val1 = targetPlayer[metric];
  const val2 = comparedPlayer[metric];

  if (val1 === null || val1 === undefined ||
      val2 === null || val2 === undefined) {
    return null;
  }

  return val2 - val1;
}

export { SWING_METRICS, MLB_METRICS, AAA_METRICS, AA_APLUS_METRICS, A_METRICS };
export type { DatasetType };

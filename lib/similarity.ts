import { Player } from '@/types/player';

// Swing decision metrics to compare
const SWING_METRICS = ['z-swing%', 'z-whiff%', 'chase%', 'o-whiff%'] as const;
const MLB_METRICS = [...SWING_METRICS, 'bat_speed'] as const;
const AAA_METRICS = [...SWING_METRICS, 'max_ev'] as const;

interface SimilarPlayer {
  player: Player;
  score: number; // Lower is more similar (distance)
}

/**
 * Calculate Euclidean distance between two players based on swing decision metrics
 * For MLB: includes bat_speed
 * For AAA: includes max_ev
 */
function calculateSwingDecisionDistance(
  player1: Player,
  player2: Player,
  isMLB: boolean = true
): number {
  let sumSquaredDifferences = 0;
  let validMetricsCount = 0;

  // Choose metrics based on player type
  const metrics = isMLB ? MLB_METRICS : AAA_METRICS;

  for (const metric of metrics) {
    const val1 = player1[metric];
    const val2 = player2[metric];

    // Only calculate if both players have valid values for this metric
    if (val1 !== null && val1 !== undefined &&
        val2 !== null && val2 !== undefined) {
      let diff = val1 - val2;

      // Normalize bat_speed and max_ev to be on similar scale as percentages
      // Bat speed typically varies by 5-10 mph, max EV by 10-15 mph
      // Scale them down so they don't dominate the distance calculation
      if (metric === 'bat_speed') {
        diff = diff * 2; // Weight bat speed more heavily (typically smaller variance)
      } else if (metric === 'max_ev') {
        diff = diff * 1; // Keep max_ev at similar weight
      }

      sumSquaredDifferences += diff * diff;
      validMetricsCount++;
    }
  }

  // If we don't have at least 4 valid metrics, return infinity (incomparable)
  if (validMetricsCount < 4) {
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
 * @param isMLB - Whether the target player is MLB (includes bat_speed) or AAA (includes max_ev)
 * @returns Array of similar players sorted by similarity (most similar first)
 */
export function findSimilarPlayersBySwingDecision(
  targetPlayer: Player,
  allPlayers: Player[],
  limit: number = 5,
  isMLB: boolean = true
): SimilarPlayer[] {
  // Calculate distance for each player
  const playersWithScores: SimilarPlayer[] = allPlayers
    .filter(p => p.player_id !== targetPlayer.player_id) // Exclude the target player
    .map(player => ({
      player,
      score: calculateSwingDecisionDistance(targetPlayer, player, isMLB)
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

export { SWING_METRICS, MLB_METRICS, AAA_METRICS };

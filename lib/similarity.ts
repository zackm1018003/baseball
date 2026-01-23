import { Player } from '@/types/player';

// Swing decision metrics to compare
const SWING_METRICS = ['z-swing%', 'z-whiff%', 'chase%', 'o-whiff%'] as const;

interface SimilarPlayer {
  player: Player;
  score: number; // Lower is more similar (distance)
}

/**
 * Calculate Euclidean distance between two players based on swing decision metrics
 */
function calculateSwingDecisionDistance(player1: Player, player2: Player): number {
  let sumSquaredDifferences = 0;
  let validMetricsCount = 0;

  for (const metric of SWING_METRICS) {
    const val1 = player1[metric];
    const val2 = player2[metric];

    // Only calculate if both players have valid values for this metric
    if (val1 !== null && val1 !== undefined &&
        val2 !== null && val2 !== undefined) {
      const diff = val1 - val2;
      sumSquaredDifferences += diff * diff;
      validMetricsCount++;
    }
  }

  // If we don't have at least 3 valid metrics, return infinity (incomparable)
  if (validMetricsCount < 3) {
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
 * @returns Array of similar players sorted by similarity (most similar first)
 */
export function findSimilarPlayersBySwingDecision(
  targetPlayer: Player,
  allPlayers: Player[],
  limit: number = 5
): SimilarPlayer[] {
  // Calculate distance for each player
  const playersWithScores: SimilarPlayer[] = allPlayers
    .filter(p => p.player_id !== targetPlayer.player_id) // Exclude the target player
    .map(player => ({
      player,
      score: calculateSwingDecisionDistance(targetPlayer, player)
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

export { SWING_METRICS };

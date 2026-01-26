/**
 * Fangraphs Stats Fetcher
 * Fetches player stats from Fangraphs.com using player IDs
 */

const FANGRAPHS_BASE = 'https://www.fangraphs.com';

interface FangraphsStats {
  ba?: number;
  obp?: number;
  slg?: number;
  hr?: number;
}

/**
 * Fetch player stats from Fangraphs
 * @param fangraphsId - The Fangraphs player ID (e.g., "sa3011578")
 * @param season - The season year (default: 2025)
 */
export async function fetchFangraphsStats(
  fangraphsId: string,
  season: number = 2025
): Promise<FangraphsStats | null> {
  try {
    // Fangraphs uses playerid format in URLs
    const playerIdNumber = fangraphsId.replace('sa', '');
    const url = `${FANGRAPHS_BASE}/api/players/stats?playerid=${playerIdNumber}&position=all`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch Fangraphs stats for ${fangraphsId}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Find the stats for the requested season
    const seasonStats = data.find((s: any) => s.Season === season.toString());

    if (!seasonStats) {
      console.warn(`No ${season} stats found for ${fangraphsId}`);
      return null;
    }

    return {
      ba: seasonStats.AVG ? parseFloat(seasonStats.AVG) : undefined,
      obp: seasonStats.OBP ? parseFloat(seasonStats.OBP) : undefined,
      slg: seasonStats.SLG ? parseFloat(seasonStats.SLG) : undefined,
      hr: seasonStats.HR ? parseInt(seasonStats.HR) : undefined,
    };
  } catch (error) {
    console.error(`Error fetching Fangraphs stats for ${fangraphsId}:`, error);
    return null;
  }
}

/**
 * Fetch stats for multiple players with rate limiting
 * @param playerIds - Array of Fangraphs player IDs
 * @param season - The season year (default: 2025)
 * @param delayMs - Delay between requests in milliseconds (default: 500ms)
 */
export async function fetchBatchFangraphsStats(
  playerIds: string[],
  season: number = 2025,
  delayMs: number = 500
): Promise<Map<string, FangraphsStats>> {
  const results = new Map<string, FangraphsStats>();

  for (const playerId of playerIds) {
    const stats = await fetchFangraphsStats(playerId, season);
    if (stats) {
      results.set(playerId, stats);
    }

    // Rate limiting to avoid overwhelming Fangraphs
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return results;
}

/**
 * Alternative method: Scrape from player page HTML
 * Use this if the API method doesn't work
 */
export async function scrapeFangraphsPlayerPage(
  fangraphsId: string,
  season: number = 2025
): Promise<FangraphsStats | null> {
  try {
    const playerIdNumber = fangraphsId.replace('sa', '');
    const url = `${FANGRAPHS_BASE}/statss.aspx?playerid=${playerIdNumber}&position=OF`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();

    // Parse HTML to extract stats
    // This is a simplified version - may need adjustment based on actual HTML structure
    const stats: FangraphsStats = {};

    // Look for the season stats table
    const seasonRegex = new RegExp(`>${season}<.*?<td[^>]*>([\\d.]+)</td>.*?<td[^>]*>([\\d.]+)</td>.*?<td[^>]*>([\\d.]+)</td>.*?<td[^>]*>(\\d+)</td>`, 'gs');
    const match = seasonRegex.exec(html);

    if (match) {
      stats.ba = parseFloat(match[1]);
      stats.obp = parseFloat(match[2]);
      stats.slg = parseFloat(match[3]);
      stats.hr = parseInt(match[4]);
    }

    return Object.keys(stats).length > 0 ? stats : null;
  } catch (error) {
    console.error(`Error scraping Fangraphs page for ${fangraphsId}:`, error);
    return null;
  }
}

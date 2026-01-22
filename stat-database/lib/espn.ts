/**
 * Get ESPN player headshot URL
 * ESPN provides player headshots via their CDN
 * Format: https://a.espncdn.com/i/headshots/mlb/players/full/{playerId}.png
 */
export function getESPNPlayerImage(playerId: number | null): string {
  if (!playerId) {
    return '/placeholder-player.png';
  }

  return `https://a.espncdn.com/i/headshots/mlb/players/full/${playerId}.png`;
}

/**
 * Get ESPN team logo URL
 * Format: https://a.espncdn.com/i/teamlogos/mlb/500/{teamAbbr}.png
 */
export function getESPNTeamLogo(teamAbbr: string | null): string {
  if (!teamAbbr || teamAbbr === 'FA') {
    return '/placeholder-team.png';
  }

  // Convert team abbreviations to ESPN format
  const teamMap: Record<string, string> = {
    'ATH': 'oak', // Athletics (Oakland)
    'CHW': 'chw', // Chicago White Sox
    'CHC': 'chc', // Chicago Cubs
    'NYY': 'nyy', // New York Yankees
    'NYM': 'nym', // New York Mets
    'LAA': 'laa', // Los Angeles Angels
    'LAD': 'lad', // Los Angeles Dodgers
    'SF': 'sf',   // San Francisco Giants
    'STL': 'stl', // St. Louis Cardinals
    'BOS': 'bos', // Boston Red Sox
    'TB': 'tb',   // Tampa Bay Rays
    'MIN': 'min', // Minnesota Twins
    'PHI': 'phi', // Philadelphia Phillies
    'BAL': 'bal', // Baltimore Orioles
    'MIL': 'mil', // Milwaukee Brewers
    'SEA': 'sea', // Seattle Mariners
    'COL': 'col', // Colorado Rockies
    'ARI': 'ari', // Arizona Diamondbacks
    'CLE': 'cle', // Cleveland Guardians
    'WSH': 'wsh', // Washington Nationals
    'PIT': 'pit', // Pittsburgh Pirates
    'MIA': 'mia', // Miami Marlins
    'CIN': 'cin', // Cincinnati Reds
    'KC': 'kc',   // Kansas City Royals
    'HOU': 'hou', // Houston Astros
    'TEX': 'tex', // Texas Rangers
    'ATL': 'atl', // Atlanta Braves
  };

  const espnTeam = teamMap[teamAbbr] || teamAbbr.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/mlb/500/${espnTeam}.png`;
}

/**
 * Fallback image component props
 */
export const PLAYER_IMAGE_FALLBACK = '/api/placeholder/200/200';
export const TEAM_LOGO_FALLBACK = '/api/placeholder/100/100';

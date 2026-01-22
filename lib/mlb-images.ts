/**
 * MLB Player Image Utilities
 * Multiple sources for player headshots and action shots
 */

/**
 * Image sources for MLB players
 */
export enum ImageSource {
  MLB_STATIC = 'mlb_static',
  ESPN = 'espn',
  MLB_GAMEDAY = 'mlb_gameday',
  MLB_TEAM = 'mlb_team',
}

/**
 * Image size options
 */
export interface ImageOptions {
  width?: number;
  height?: number;
  quality?: 'best' | 'good' | 'low';
  fallback?: boolean;
}

/**
 * Get MLB player headshot from MLBStatic CDN (Primary source)
 * This is the official MLB image CDN
 *
 * @param playerId - MLB Stats API player ID
 * @param options - Image size and quality options
 */
export function getMLBStaticPlayerImage(
  playerId: number | null,
  options: ImageOptions = {}
): string {
  if (!playerId) {
    return getPlaceholderImage(options);
  }

  const {
    width = 213,
    quality = 'best',
  } = options;

  // MLB Static CDN URL format
  // Includes fallback to generic headshot if player image not found
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_${width},q_auto:${quality}/v1/people/${playerId}/headshot/67/current`;
}

/**
 * Get high-resolution MLB player headshot
 *
 * @param playerId - MLB Stats API player ID
 */
export function getMLBHighResHeadshot(playerId: number | null): string {
  if (!playerId) {
    return getPlaceholderImage({ width: 500 });
  }

  // High-res version (up to 500px)
  return `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_500,q_auto:best/v1/people/${playerId}/headshot/67/current`;
}

/**
 * Get ESPN player headshot (Alternative source)
 *
 * @param playerId - MLB Stats API player ID
 */
export function getESPNPlayerImage(playerId: number | null): string {
  if (!playerId) {
    return getPlaceholderImage();
  }

  return `https://a.espncdn.com/i/headshots/mlb/players/full/${playerId}.png`;
}

/**
 * Get MLB Gameday player mugshot (4x resolution)
 *
 * @param playerId - MLB Stats API player ID
 */
export function getMLBGamedayMugshot(playerId: number | null): string {
  if (!playerId) {
    return getPlaceholderImage();
  }

  return `http://gdx.mlb.com/images/gameday/mugshots/mlb/${playerId}@4x.jpg`;
}

/**
 * Get MLB player action shot
 * Note: Team-specific, may not be available for all players
 *
 * @param playerId - MLB Stats API player ID
 * @param teamDomain - Team subdomain (e.g., 'losangeles.angels', 'newyork.yankees')
 */
export function getMLBActionShot(
  playerId: number | null,
  teamDomain: string = 'mlb'
): string {
  if (!playerId) {
    return getPlaceholderImage({ width: 525, height: 330 });
  }

  return `http://${teamDomain}.mlb.com/images/players/525x330/${playerId}.jpg`;
}

/**
 * Get player image with automatic fallback
 * Tries multiple sources in order: MLB Static -> ESPN -> Placeholder
 *
 * @param playerId - MLB Stats API player ID
 * @param options - Image options
 */
export function getPlayerImageWithFallback(
  playerId: number | null,
  options: ImageOptions = {}
): string[] {
  if (!playerId) {
    return [getPlaceholderImage(options)];
  }

  return [
    getMLBStaticPlayerImage(playerId, options),
    getESPNPlayerImage(playerId),
    getPlaceholderImage(options),
  ];
}

/**
 * Generate placeholder image SVG
 */
export function getPlaceholderImage(options: ImageOptions = {}): string {
  const { width = 200, height = 200 } = options;
  return `/api/placeholder/${width}/${height}`;
}

/**
 * Team logo from MLB Static CDN
 *
 * @param teamId - MLB team ID
 * @param size - Logo size (small, medium, large)
 */
export function getMLBTeamLogo(
  teamId: number,
  size: 'small' | 'medium' | 'large' = 'medium'
): string {
  const sizeMap = {
    small: 68,
    medium: 135,
    large: 270,
  };

  const width = sizeMap[size];
  return `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
}

/**
 * Team abbreviation to ID mapping
 * Used for converting team codes to IDs for image URLs
 */
export const TEAM_ABBREVIATION_TO_ID: Record<string, number> = {
  'ARI': 109, // Arizona Diamondbacks
  'ATL': 144, // Atlanta Braves
  'BAL': 110, // Baltimore Orioles
  'BOS': 111, // Boston Red Sox
  'CHC': 112, // Chicago Cubs
  'CHW': 145, // Chicago White Sox
  'CIN': 113, // Cincinnati Reds
  'CLE': 114, // Cleveland Guardians
  'COL': 115, // Colorado Rockies
  'DET': 116, // Detroit Tigers
  'HOU': 117, // Houston Astros
  'KC': 118,  // Kansas City Royals
  'LAA': 108, // Los Angeles Angels
  'LAD': 119, // Los Angeles Dodgers
  'MIA': 146, // Miami Marlins
  'MIL': 158, // Milwaukee Brewers
  'MIN': 142, // Minnesota Twins
  'NYM': 121, // New York Mets
  'NYY': 147, // New York Yankees
  'OAK': 133, // Oakland Athletics
  'PHI': 143, // Philadelphia Phillies
  'PIT': 134, // Pittsburgh Pirates
  'SD': 135,  // San Diego Padres
  'SEA': 136, // Seattle Mariners
  'SF': 137,  // San Francisco Giants
  'STL': 138, // St. Louis Cardinals
  'TB': 139,  // Tampa Bay Rays
  'TEX': 140, // Texas Rangers
  'TOR': 141, // Toronto Blue Jays
  'WSH': 120, // Washington Nationals
};

/**
 * Get team ID from abbreviation
 */
export function getTeamIdFromAbbreviation(abbr: string | null): number | null {
  if (!abbr || abbr === 'FA') return null;
  return TEAM_ABBREVIATION_TO_ID[abbr.toUpperCase()] || null;
}

/**
 * Image preload helper for better UX
 */
export function preloadPlayerImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
}

// MLB team abbreviations to ESPN team IDs
const MLB_TEAM_ESPN_IDS: Record<string, number> = {
  'ARI': 29,   // Arizona Diamondbacks
  'ATL': 15,   // Atlanta Braves
  'BAL': 1,    // Baltimore Orioles
  'BOS': 2,    // Boston Red Sox
  'CHC': 16,   // Chicago Cubs
  'CHW': 4,    // Chicago White Sox
  'CIN': 17,   // Cincinnati Reds
  'CLE': 5,    // Cleveland Guardians
  'COL': 27,   // Colorado Rockies
  'DET': 6,    // Detroit Tigers
  'HOU': 18,   // Houston Astros
  'KC': 7,     // Kansas City Royals
  'LAA': 3,    // Los Angeles Angels
  'LAD': 19,   // Los Angeles Dodgers
  'MIA': 28,   // Miami Marlins
  'MIL': 8,    // Milwaukee Brewers
  'MIN': 9,    // Minnesota Twins
  'NYM': 21,   // New York Mets
  'NYY': 10,   // New York Yankees
  'OAK': 11,   // Oakland Athletics
  'PHI': 22,   // Philadelphia Phillies
  'PIT': 23,   // Pittsburgh Pirates
  'SD': 25,    // San Diego Padres
  'SF': 26,    // San Francisco Giants
  'SEA': 12,   // Seattle Mariners
  'STL': 24,   // St. Louis Cardinals
  'TB': 30,    // Tampa Bay Rays
  'TEX': 13,   // Texas Rangers
  'TOR': 14,   // Toronto Blue Jays
  'WSH': 20,   // Washington Nationals
  // Alternative abbreviations
  'CWS': 4,    // Chicago White Sox
  'KCR': 7,    // Kansas City Royals
  'SDP': 25,   // San Diego Padres
  'SFG': 26,   // San Francisco Giants
  'TBR': 30,   // Tampa Bay Rays
  'WSN': 20,   // Washington Nationals
};

export function getMLBTeamLogoUrl(teamAbbr: string | null | undefined, size: number = 100): string | null {
  if (!teamAbbr) return null;

  const espnId = MLB_TEAM_ESPN_IDS[teamAbbr.toUpperCase()];
  if (espnId) {
    return `https://a.espncdn.com/i/teamlogos/mlb/500/${espnId}.png`;
  }

  return null;
}

export function hasMLBTeamLogo(teamAbbr: string | null | undefined): boolean {
  if (!teamAbbr) return false;
  return teamAbbr.toUpperCase() in MLB_TEAM_ESPN_IDS;
}

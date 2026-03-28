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

// AAA team abbreviations → parent MLB organization abbreviation
const AAA_TO_MLB_PARENT: Record<string, string> = {
  // International League
  'BUF': 'TOR',   // Buffalo Bisons        → Blue Jays
  'ROC': 'WSH',   // Rochester Red Wings   → Nationals
  'SYR': 'NYM',   // Syracuse Mets         → Mets
  'SWB': 'NYY',   // Scranton/WB RailRiders → Yankees
  'NOR': 'BAL',   // Norfolk Tides         → Orioles
  'DUR': 'TB',    // Durham Bulls          → Rays
  'CLT': 'CWS',   // Charlotte Knights     → White Sox
  'GWN': 'ATL',   // Gwinnett Stripers     → Braves
  'JAX': 'MIA',   // Jacksonville Jumbo Shrimp → Marlins
  'WOR': 'BOS',   // Worcester Red Sox     → Red Sox
  'LHV': 'PHI',   // Lehigh Valley IronPigs → Phillies
  'TOL': 'DET',   // Toledo Mud Hens       → Tigers
  'LOU': 'CIN',   // Louisville Bats       → Reds
  'IND': 'PIT',   // Indianapolis Indians  → Pirates
  'NAS': 'MIL',   // Nashville Sounds      → Brewers
  'MEM': 'STL',   // Memphis Redbirds      → Cardinals
  'CLB': 'CLE',   // Columbus Clippers     → Guardians
  // Pacific Coast League
  'LV':  'OAK',   // Las Vegas Aviators    → Athletics
  'SLC': 'LAA',   // Salt Lake Bees        → Angels
  'SAC': 'SF',    // Sacramento River Cats → Giants
  'TAC': 'SEA',   // Tacoma Rainiers       → Mariners
  'RNO': 'ARI',   // Reno Aces             → Diamondbacks
  'ELP': 'SD',    // El Paso Chihuahuas    → Padres
  'ABQ': 'COL',   // Albuquerque Isotopes  → Rockies
  'OKC': 'LAD',   // OKC Baseball Club     → Dodgers
  'RR':  'TEX',   // Round Rock Express    → Rangers
  'SUG': 'HOU',   // Sugar Land Space Cowboys → Astros
  'OMA': 'KC',    // Omaha Storm Chasers   → Royals
  'IOW': 'CHC',   // Iowa Cubs             → Cubs
};

export function getMLBTeamLogoUrl(teamAbbr: string | null | undefined, size: number = 100): string | null {
  if (!teamAbbr) return null;
  const upper = teamAbbr.toUpperCase();

  // Direct MLB team lookup
  let espnId = MLB_TEAM_ESPN_IDS[upper];

  // Fall back to parent MLB org for AAA teams
  if (!espnId) {
    const parentAbbr = AAA_TO_MLB_PARENT[upper];
    if (parentAbbr) {
      espnId = MLB_TEAM_ESPN_IDS[parentAbbr];
    }
  }

  if (espnId) {
    return `https://a.espncdn.com/i/teamlogos/mlb/500/${espnId}.png`;
  }

  return null;
}

export function hasMLBTeamLogo(teamAbbr: string | null | undefined): boolean {
  if (!teamAbbr) return false;
  return teamAbbr.toUpperCase() in MLB_TEAM_ESPN_IDS;
}

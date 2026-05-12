// MLB official team IDs → used for cap/primary mark logos from mlbstatic.com
const MLB_TEAM_IDS: Record<string, number> = {
  'ARI': 109,  // Arizona Diamondbacks
  'ATL': 144,  // Atlanta Braves
  'BAL': 110,  // Baltimore Orioles
  'BOS': 111,  // Boston Red Sox
  'CHC': 112,  // Chicago Cubs
  'CHW': 145,  // Chicago White Sox
  'CIN': 113,  // Cincinnati Reds
  'CLE': 114,  // Cleveland Guardians
  'COL': 115,  // Colorado Rockies
  'DET': 116,  // Detroit Tigers
  'HOU': 117,  // Houston Astros
  'KC':  118,  // Kansas City Royals
  'LAA': 108,  // Los Angeles Angels
  'LAD': 119,  // Los Angeles Dodgers
  'MIA': 146,  // Miami Marlins
  'MIL': 158,  // Milwaukee Brewers
  'MIN': 142,  // Minnesota Twins
  'NYM': 121,  // New York Mets
  'NYY': 147,  // New York Yankees
  'OAK': 133,  // Oakland/Las Vegas Athletics
  'PHI': 143,  // Philadelphia Phillies
  'PIT': 134,  // Pittsburgh Pirates
  'SD':  135,  // San Diego Padres
  'SF':  137,  // San Francisco Giants
  'SEA': 136,  // Seattle Mariners
  'STL': 138,  // St. Louis Cardinals
  'TB':  139,  // Tampa Bay Rays
  'TEX': 140,  // Texas Rangers
  'TOR': 141,  // Toronto Blue Jays
  'WSH': 120,  // Washington Nationals
  // Alternative abbreviations
  'CWS': 145,
  'KCR': 118,
  'SDP': 135,
  'SFG': 137,
  'TBR': 139,
  'WSN': 120,
};

// FCL / ACL team abbreviations → parent MLB organization abbreviation
const FCL_ACL_TO_MLB_PARENT: Record<string, string> = {
  // FCL (Florida Complex League) — prefix F-
  'F-ARI': 'ARI', 'F-ATL': 'ATL', 'F-BAL': 'BAL', 'F-BOS': 'BOS',
  'F-CHC': 'CHC', 'F-CWS': 'CHW', 'F-CIN': 'CIN', 'F-CLE': 'CLE',
  'F-COL': 'COL', 'F-DET': 'DET', 'F-HOU': 'HOU', 'F-KC':  'KC',
  'F-LAA': 'LAA', 'F-LAD': 'LAD', 'F-MET': 'NYM', 'F-MIA': 'MIA',
  'F-MIL': 'MIL', 'F-MIN': 'MIN', 'F-NYM': 'NYM', 'F-NYY': 'NYY',
  'F-OAK': 'OAK', 'F-PHI': 'PHI', 'F-PIT': 'PIT', 'F-SD':  'SD',
  'F-SDP': 'SD',  'F-SF':  'SF',  'F-SFG': 'SF',  'F-SEA': 'SEA',
  'F-STL': 'STL', 'F-TB':  'TB',  'F-TBR': 'TB',  'F-TEX': 'TEX',
  'F-TOR': 'TOR', 'F-WSH': 'WSH',
  // ACL (Arizona Complex League) — prefix A-
  'A-ARI': 'ARI', 'A-CHC': 'CHC', 'A-CIN': 'CIN', 'A-RED': 'CIN',
  'A-COL': 'COL', 'A-CWS': 'CHW', 'A-HOU': 'HOU', 'A-KC':  'KC',
  'A-LAA': 'LAA', 'A-LAD': 'LAD', 'A-MIL': 'MIL', 'A-MIN': 'MIN',
  'A-OAK': 'OAK', 'A-PHI': 'PHI', 'A-PIT': 'PIT', 'A-SD':  'SD',
  'A-SDP': 'SD',  'A-SF':  'SF',  'A-SFG': 'SF',  'A-SEA': 'SEA',
  'A-STL': 'STL', 'A-TEX': 'TEX',
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
  'CLT': 'CHW',   // Charlotte Knights     → White Sox
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
  let mlbId = MLB_TEAM_IDS[upper];

  // Fall back to FCL/ACL parent mapping
  if (!mlbId) {
    const parentAbbr = FCL_ACL_TO_MLB_PARENT[upper];
    if (parentAbbr) mlbId = MLB_TEAM_IDS[parentAbbr];
  }

  // Fall back to AAA parent mapping
  if (!mlbId) {
    const parentAbbr = AAA_TO_MLB_PARENT[upper];
    if (parentAbbr) mlbId = MLB_TEAM_IDS[parentAbbr];
  }

  // Generic prefix fallback: strip F- or A- and try remaining chars directly
  if (!mlbId && (upper.startsWith('F-') || upper.startsWith('A-'))) {
    const suffix = upper.slice(2);
    mlbId = MLB_TEAM_IDS[suffix];
    if (!mlbId) {
      const parentAbbr = AAA_TO_MLB_PARENT[suffix];
      if (parentAbbr) mlbId = MLB_TEAM_IDS[parentAbbr];
    }
  }

  if (mlbId) {
    return `https://www.mlbstatic.com/team-logos/${mlbId}.svg`;
  }

  return null;
}

export function hasMLBTeamLogo(teamAbbr: string | null | undefined): boolean {
  if (!teamAbbr) return false;
  const upper = teamAbbr.toUpperCase();
  if (upper in MLB_TEAM_IDS || upper in AAA_TO_MLB_PARENT || upper in FCL_ACL_TO_MLB_PARENT) return true;
  // Generic prefix fallback
  if (upper.startsWith('F-') || upper.startsWith('A-')) {
    const suffix = upper.slice(2);
    return suffix in MLB_TEAM_IDS || suffix in AAA_TO_MLB_PARENT;
  }
  return false;
}

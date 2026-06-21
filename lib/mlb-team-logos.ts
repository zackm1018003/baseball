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

// FCL / ACL / DSL team abbreviations → parent MLB organization abbreviation
const FCL_ACL_TO_MLB_PARENT: Record<string, string> = {
  // ── FCL (Florida Complex League) ─────────────────────────────────────────
  // MLB-org style (legacy / alternate)
  'F-ARI': 'ARI', 'F-ATL': 'ATL', 'F-BAL': 'BAL', 'F-BOS': 'BOS',
  'F-CHC': 'CHC', 'F-CWS': 'CHW', 'F-CIN': 'CIN', 'F-CLE': 'CLE',
  'F-COL': 'COL', 'F-DET': 'DET', 'F-HOU': 'HOU', 'F-KC':  'KC',
  'F-LAA': 'LAA', 'F-LAD': 'LAD', 'F-MIA': 'MIA', 'F-MIL': 'MIL',
  'F-MIN': 'MIN', 'F-NYM': 'NYM', 'F-NYY': 'NYY', 'F-OAK': 'OAK',
  'F-PHI': 'PHI', 'F-PIT': 'PIT', 'F-SD':  'SD',  'F-SDP': 'SD',
  'F-SF':  'SF',  'F-SFG': 'SF',  'F-SEA': 'SEA', 'F-STL': 'STL',
  'F-TB':  'TB',  'F-TBR': 'TB',  'F-TEX': 'TEX', 'F-TOR': 'TOR',
  'F-WSH': 'WSH',
  // Nickname style (actual MLB Stats API abbreviations as of 2025-26)
  'F-AST': 'HOU', // FCL Astros
  'F-BRV': 'ATL', // FCL Braves
  'F-BLU': 'TOR', // FCL Blue Jays
  'F-CAR': 'STL', // FCL Cardinals
  'F-CUB': 'CHC', // FCL Cubs
  'F-MET': 'NYM', // FCL Mets
  'F-MRL': 'MIA', // FCL Marlins
  'F-NAT': 'WSH', // FCL Nationals
  'F-ORI': 'BAL', // FCL Orioles
  'F-PIR': 'PIT', // FCL Pirates
  'F-RAY': 'TB',  // FCL Rays
  'F-ROY': 'KC',  // FCL Royals
  'F-RSX': 'BOS', // FCL Red Sox
  'F-TIG': 'DET', // FCL Tigers
  'F-TWI': 'MIN', // FCL Twins
  'F-YAN': 'NYY', // FCL Yankees
  // ── ACL (Arizona Complex League) ─────────────────────────────────────────
  // MLB-org style (legacy / alternate)
  'A-ARI': 'ARI', 'A-CHC': 'CHC', 'A-CIN': 'CIN', 'A-COL': 'COL',
  'A-CWS': 'CHW', 'A-HOU': 'HOU', 'A-KC':  'KC',  'A-LAA': 'LAA',
  'A-LAD': 'LAD', 'A-MIL': 'MIL', 'A-MIN': 'MIN', 'A-OAK': 'OAK',
  'A-PHI': 'PHI', 'A-PIT': 'PIT', 'A-SD':  'SD',  'A-SDP': 'SD',
  'A-SF':  'SF',  'A-SFG': 'SF',  'A-SEA': 'SEA', 'A-STL': 'STL',
  'A-TEX': 'TEX',
  // Nickname style (actual MLB Stats API abbreviations as of 2025-26)
  'A-ANG': 'LAA', // ACL Angels
  'A-ATH': 'OAK', // ACL Athletics
  'A-BRW': 'MIL', // ACL Brewers
  'A-CUB': 'CHC', // ACL Cubs
  'A-DBA': 'ARI', // ACL D-backs
  'A-DOD': 'LAD', // ACL Dodgers
  'A-GIA': 'SF',  // ACL Giants
  'A-GUA': 'CLE', // ACL Guardians
  'A-MRN': 'SEA', // ACL Mariners
  'A-PAD': 'SD',  // ACL Padres
  'A-RAN': 'TEX', // ACL Rangers
  'A-RCK': 'COL', // ACL Rockies
  'A-RED': 'CIN', // ACL Reds
  'A-ROY': 'KC',  // ACL Royals
  'A-WSX': 'CHW', // ACL White Sox
  // ── DSL (Dominican Summer League) ────────────────────────────────────────
  'D-ANG': 'LAA', 'D-ARB': 'ARI', 'D-ARR': 'ARI',
  'D-ASB': 'HOU', 'D-ASO': 'HOU',
  'D-ATH': 'OAK',
  'D-BJB': 'TOR', 'D-BJR': 'TOR',
  'D-BRV': 'ATL',
  'D-BWB': 'MIL', 'D-BWG': 'MIL',
  'D-CAR': 'STL',
  'D-CLG': 'CLE', 'D-CLM': 'CLE',
  'D-COL': 'COL',
  'D-CUB': 'CHC', 'D-CUR': 'CHC',
  'D-GIB': 'SF',  'D-GIO': 'SF',
  'D-LAB': 'LAD', 'D-LAM': 'LAD',
  'D-MEO': 'NYM', 'D-MEB': 'NYM',
  'D-MIA': 'MIA', 'D-MRL': 'MIA',
  'D-MRN': 'SEA',
  'D-NAT': 'WSH',
  'D-NYB': 'NYY', 'D-NYY': 'NYY',
  'D-ORB': 'BAL', 'D-ORO': 'BAL',
  'D-PAB': 'SD',  'D-PAG': 'SD',
  'D-PHI': 'PHI',
  'D-PIB': 'PIT', 'D-PIG': 'PIT',
  'D-RAY': 'TB',  'D-TAM': 'TB',
  'D-RCK': 'COL',
  'D-RED': 'CIN',
  'D-RNB': 'TEX', 'D-RNR': 'TEX',
  'D-ROF': 'KC',  'D-ROJ': 'KC',  'D-ROV': 'KC',
  'D-RSB': 'BOS', 'D-RSR': 'BOS',
  'D-TI1': 'DET', 'D-TI2': 'DET',
  'D-TWI': 'MIN',
  'D-WSX': 'CHW',
};

// Double-A affiliates → MLB parent
const DOUBLE_A_TO_MLB_PARENT: Record<string, string> = {
  // Eastern League
  'ALT': 'PIT', 'AKR': 'CLE', 'BOW': 'BAL', 'ERE': 'DET', 'HFD': 'COL',
  'NH':  'TOR', 'POR': 'BOS', 'REA': 'PHI', 'SOM': 'NYY', 'BNG': 'NYM',
  'HBG': 'WSH', 'RCT': 'LAA',
  // Southern League
  'TEN': 'CHC', 'BIR': 'CHW', 'MIS': 'ATL', 'MTG': 'TB',  'PNS': 'MIA',
  'CHA': 'CIN', 'BHM': 'CHW', 'CHT': 'CIN',
  // Texas League
  'ARK': 'SEA', 'CC':  'HOU', 'MID': 'OAK', 'NWA': 'KC',  'SA':  'SD',
  'SPR': 'STL', 'TUL': 'LAD', 'WIC': 'MIL', 'AMA': 'COL', 'FRI': 'TEX',
};

// High-A affiliates → MLB parent
const HIGH_A_TO_MLB_PARENT: Record<string, string> = {
  // South Atlantic League (High-A East)
  'ABD': 'BAL', 'BRK': 'NYM', 'HV':  'NYY', 'JS':  'PHI', 'JSG': 'PHI',
  'WLM': 'WSH', 'WS':  'CHW', 'CLR': 'PHI', 'DUN': 'TOR', 'ROM': 'ATL',
  // Midwest League (High-A Central)
  'BLN': 'LAD', 'DAY': 'CIN', 'FTW': 'SD',  'LKC': 'CLE', 'LNS': 'OAK',
  'QC':  'KC',  'SBN': 'CHC', 'WM':  'DET', 'BEL': 'MIA', 'PEO': 'STL',
  'KNG': 'CHW', 'WIN': 'CHW',
  // California / Northwest League (High-A West)
  'EV':  'SEA', 'EVE': 'SEA', 'SPO': 'COL', 'TRI': 'LAA', 'VAN': 'TOR',
  'RC':  'LAA', 'IE':  'LAA', 'STK': 'OAK', 'MOD': 'OAK', 'VIS': 'ARI',
  'FRS': 'SF',  'SJG': 'SF',  'LK':  'CHC', 'RCU': 'LAD', 'SS':  'MIN',
};

// Low-A affiliates → MLB parent
const LOW_A_TO_MLB_PARENT: Record<string, string> = {
  // Low-A Southeast (Florida)
  'BRD': 'PIT', 'DYT': 'CIN', 'FTM': 'MIN', 'JUP': 'MIA', 'LAK': 'DET',
  'PMB': 'STL', 'SLU': 'NYM', 'TAM': 'NYY', 'CL':  'PHI', 'SLP': 'STL',
  // Low-A East (South Atlantic / Carolina)
  'COL': 'KC',  'DEL': 'BAL', 'FAY': 'HOU', 'FBG': 'WSH', 'GVL': 'BOS',
  'HIC': 'TEX', 'KAN': 'CHW', 'LYN': 'CLE', 'MB':  'CHC', 'MBC': 'CHC',
  'ROM': 'ATL', 'AUG': 'ATL', 'CHR': 'TB',  'WIL': 'WSH', 'WLG': 'WSH',
  // Low-A Central (Midwest League lower)
  'QCS': 'HOU', 'ELI': 'DET', 'DSM': 'CHC',
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
  'STP': 'MIN',   // St. Paul Saints       → Twins
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

// MiLB name fragments → MLB parent org (fallback for full team names, e.g. "Memphis Redbirds")
// Only used when the abbreviation lookup fails — prevents college logo false-positives.
const MILB_NAME_FRAGMENT_TO_PARENT: Record<string, string> = {
  // AAA International League
  'buffalo':         'TOR',   'rochester':       'WSH',   'syracuse':      'NYM',
  'scranton':        'NYY',   'norfolk':         'BAL',   'durham':        'TB',
  'charlotte':       'CHW',   'gwinnett':        'ATL',   'jacksonville':  'MIA',
  'worcester':       'BOS',   'lehigh valley':   'PHI',   'toledo':        'DET',
  'louisville':      'CIN',   'indianapolis':    'PIT',   'nashville':     'MIL',
  'memphis':         'STL',   'columbus':        'CLE',   'st. paul':      'MIN',
  // AAA Pacific Coast League
  'las vegas':       'OAK',   'salt lake':       'LAA',   'sacramento':    'SF',
  'tacoma':          'SEA',   'reno':            'ARI',   'el paso':       'SD',
  'albuquerque':     'COL',   'oklahoma city':   'LAD',   'round rock':    'TEX',
  'sugar land':      'HOU',   'omaha':           'KC',    'iowa':          'CHC',
  // Double-A
  'altoona':         'PIT',   'akron':           'CLE',   'bowie':         'BAL',
  'erie':            'DET',   'hartford':        'COL',   'new hampshire': 'TOR',
  'portland':        'BOS',   'reading':         'PHI',   'somerset':      'NYY',
  'binghamton':      'NYM',   'harrisburg':      'WSH',   'rocket city':   'LAA',
  'tennessee':       'CHC',   'birmingham':      'CHW',   'mississippi':   'ATL',
  'montgomery':      'TB',    'pensacola':       'MIA',   'chattanooga':   'CIN',
  'arkansas':        'SEA',   'corpus christi':  'HOU',   'midland':       'OAK',
  'northwest arkansas': 'KC', 'san antonio':     'SD',    'springfield':   'STL',
  'tulsa':           'LAD',   'wichita':         'MIL',   'amarillo':      'COL',
  'frisco':          'TEX',
};

/** Returns the MLB parent org abbreviation for any team abbr or full name, or the abbr itself if already MLB. */
export function getParentOrgAbbr(teamAbbr: string | null | undefined): string | null {
  if (!teamAbbr) return null;
  const upper = teamAbbr.toUpperCase();
  if (upper in MLB_TEAM_IDS) return upper; // already MLB

  // Abbreviation-based lookups (fast path)
  const byAbbr =
    FCL_ACL_TO_MLB_PARENT[upper] ??
    AAA_TO_MLB_PARENT[upper] ??
    DOUBLE_A_TO_MLB_PARENT[upper] ??
    HIGH_A_TO_MLB_PARENT[upper] ??
    LOW_A_TO_MLB_PARENT[upper] ??
    (() => {
      if (upper.startsWith('F-') || upper.startsWith('A-')) {
        const suffix = upper.slice(2);
        return FCL_ACL_TO_MLB_PARENT[suffix] ?? AAA_TO_MLB_PARENT[suffix] ?? null;
      }
      return null;
    })();
  if (byAbbr) return byAbbr;

  // Name-fragment lookup — handles full team names like "Memphis Redbirds" → "STL".
  // This fires when resolveTeamAbbr fails and the raw team name is passed in.
  const lower = teamAbbr.toLowerCase();
  for (const [fragment, parent] of Object.entries(MILB_NAME_FRAGMENT_TO_PARENT)) {
    if (lower.includes(fragment)) return parent;
  }

  return null;
}

export function getMLBTeamLogoUrl(teamAbbr: string | null | undefined, size: number = 100): string | null {
  if (!teamAbbr) return null;
  const upper = teamAbbr.toUpperCase();

  // Direct MLB team lookup
  let mlbId = MLB_TEAM_IDS[upper];

  if (!mlbId) {
    const parent = getParentOrgAbbr(upper);
    if (parent) mlbId = MLB_TEAM_IDS[parent];
  }

  if (mlbId) {
    return `https://www.mlbstatic.com/team-logos/${mlbId}.svg`;
  }

  return null;
}

export function hasMLBTeamLogo(teamAbbr: string | null | undefined): boolean {
  return getMLBTeamLogoUrl(teamAbbr) !== null;
}

// Primary brand color for each MLB team, used for card banners.
const MLB_TEAM_COLORS: Record<string, string> = {
  'ARI': '#A71930', // Diamondbacks red
  'ATL': '#CE1141', // Braves red
  'BAL': '#DF4601', // Orioles orange
  'BOS': '#BD3039', // Red Sox red
  'CHC': '#0E3386', // Cubs blue
  'CHW': '#27251F', // White Sox black
  'CIN': '#C6011F', // Reds red
  'CLE': '#00385D', // Guardians navy
  'COL': '#33006F', // Rockies purple
  'DET': '#0C2340', // Tigers navy
  'HOU': '#002D62', // Astros navy
  'KC':  '#004687', // Royals blue
  'LAA': '#BA0021', // Angels red
  'LAD': '#005A9C', // Dodgers blue
  'MIA': '#00A3E0', // Marlins blue
  'MIL': '#12284B', // Brewers navy
  'MIN': '#002B5C', // Twins navy
  'NYM': '#002D72', // Mets blue
  'NYY': '#003087', // Yankees navy
  'OAK': '#003831', // Athletics green
  'PHI': '#E81828', // Phillies red
  'PIT': '#27251F', // Pirates black
  'SD':  '#2F241D', // Padres brown
  'SF':  '#FD5A1E', // Giants orange
  'SEA': '#005C5C', // Mariners teal
  'STL': '#C41E3A', // Cardinals red
  'TB':  '#092C5C', // Rays navy
  'TEX': '#003278', // Rangers blue
  'TOR': '#134A8E', // Blue Jays blue
  'WSH': '#AB0003', // Nationals red
};

/** Returns the primary brand color for a team (MLB or any affiliate). Falls back to charcoal. */
export function getMLBTeamColor(teamAbbr: string | null | undefined): string {
  if (!teamAbbr) return '#374151';
  const upper = teamAbbr.toUpperCase();
  if (MLB_TEAM_COLORS[upper]) return MLB_TEAM_COLORS[upper];
  const parent = getParentOrgAbbr(upper);
  return (parent && MLB_TEAM_COLORS[parent]) ? MLB_TEAM_COLORS[parent] : '#374151';
}

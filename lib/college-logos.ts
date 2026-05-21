// ESPN college team IDs for logo URLs
// Used for college pitcher/hitter daily cards when no MLB team logo applies.

const COLLEGE_ESPN_IDS: Record<string, number> = {
  // ── ACC ─────────────────────────────────────────────────────────────────────
  'Boston College':       103,
  'Clemson':              228,
  'Duke':                 150,
  'Florida State':         52,
  'Georgia Tech':          59,
  'Louisville':            97,
  'Miami':               2390,
  'NC State':             152,
  'North Carolina':       153,
  'Notre Dame':            87,
  'Pittsburgh':           221,
  'Stanford':              24,
  'Syracuse':             183,
  'Virginia':             258,
  'Virginia Tech':        259,
  'Wake Forest':          154,
  // ── SEC ─────────────────────────────────────────────────────────────────────
  'Alabama':              333,
  'Arkansas':               8,
  'Auburn':                 2,
  'Florida':               57,
  'Georgia':               61,
  'Kentucky':              96,
  'LSU':                   99,
  'Mississippi State':    344,
  'Missouri':             142,
  'Ole Miss':             145,
  'South Carolina':      2579,
  'Tennessee':           2633,
  'Texas A&M':            245,
  'Vanderbilt':           238,
  // ── Big 12 ──────────────────────────────────────────────────────────────────
  'Baylor':               239,
  'Kansas':              2305,
  'Kansas State':         2306,
  'Oklahoma':             201,
  'Oklahoma State':       197,
  'TCU':                 2628,
  'Texas':                251,
  'Texas Tech':          2641,
  'West Virginia':        277,
  // ── Big Ten ─────────────────────────────────────────────────────────────────
  'Illinois':             356,
  'Indiana':               84,
  'Iowa':                2294,
  'Maryland':             120,
  'Michigan':             130,
  'Michigan State':       127,
  'Minnesota':            135,
  'Nebraska':             158,
  'Northwestern':          77,
  'Ohio State':           194,
  'Penn State':           213,
  'Purdue':              2509,
  'Rutgers':              164,
  // ── Pac-12 / Big West ───────────────────────────────────────────────────────
  'Arizona':               12,
  'Arizona State':          9,
  'Cal State Fullerton':  2239,
  'Long Beach State':        3,
  'Oregon':              2483,
  'Oregon State':         204,
  'San Diego State':       21,
  'UCLA':                  26,
  'USC':                   30,
  'Utah':                 254,
  'Washington':           264,
  // ── American Athletic / Others ───────────────────────────────────────────────
  'Central Florida':     2116,
  'Cincinnati':            41,
  'Connecticut':         2117,
  'Dallas Baptist':      2179,
  'East Carolina':        151,
  'Houston':              248,
  'Memphis':              235,
  'Rice':                 242,
  'South Florida':         58,
  'Tulane':              2655,
  'Wichita State':       2724,
  // ── Sun Belt / CUSA / Independents ──────────────────────────────────────────
  'Army':                  349,
  'Campbell':             2081,
  'Charlotte':            2429,
  'Coastal Carolina':    2103,
  'Florida Atlantic':    2226,
  'Florida International': 2229,
  'Georgia Southern':     290,
  'Jacksonville':        2289,
  'Liberty':             2335,
  'Louisiana':           309,
  'Louisiana Tech':      2348,
  'Marshall':            276,
  'New Orleans':         2440,
  'Stetson':             2574,
  'Texas State':          326,
  'Troy':                2653,
  'Southern Miss':       2572,
  'UNLV':                2439,
  'Western Kentucky':    2750,
  // ── Miscellaneous notable programs ─────────────────────────────────────────
  'Cal Poly':            2318,
  'Creighton':           156,
  'Elon':                2210,
  'Gonzaga':             2243,
  'High Point':          2272,
  'Lipscomb':            2337,
  'Louisville':            97,
  'Loyola Marymount':    2352,
  'NC State':             152,  // duplicate key keeps last — intentional alias
  'New Mexico State':     166,
  'Pepperdine':          2492,
  'Sacramento State':    2527,
  'Saint Mary\'s':       2608,
  'San Diego':            301,
  'Santa Clara':         2608,
  'Seton Hall':          2550,
  'UC Irvine':           2055,
  'UC Santa Barbara':    2062,
  'VCU':                 2670,
  'Xavier':              2752,
};

// Short abbreviations that might appear as team names in MLB Stats API responses
const COLLEGE_ABBR_MAP: Record<string, string> = {
  'ALA':   'Alabama',
  'ARIZ':  'Arizona',
  'ARK':   'Arkansas',
  'ASU':   'Arizona State',
  'AUB':   'Auburn',
  'BAY':   'Baylor',
  'BC':    'Boston College',
  'CLEM':  'Clemson',
  'CONN':  'Connecticut',
  'CU':    'Clemson',
  'DBU':   'Dallas Baptist',
  'DUKE':  'Duke',
  'ECU':   'East Carolina',
  'FIU':   'Florida International',
  'FSU':   'Florida State',
  'GEO':   'Georgia',
  'GT':    'Georgia Tech',
  'IU':    'Indiana',
  'ILL':   'Illinois',
  'KSU':   'Kansas State',
  'LSU':   'LSU',
  'LOU':   'Louisville',
  'MARQ':  'Marquette',
  'MD':    'Maryland',
  'MSU':   'Mississippi State',
  'MU':    'Missouri',
  'ND':    'Notre Dame',
  'NCST':  'NC State',
  'NEB':   'Nebraska',
  'NU':    'Northwestern',
  'ODU':   'Old Dominion',
  'OU':    'Oklahoma',
  'OSU':   'Ohio State',
  'PSU':   'Penn State',
  'PUR':   'Purdue',
  'RU':    'Rutgers',
  'RICE':  'Rice',
  'SC':    'South Carolina',
  'SDSU':  'San Diego State',
  'SEMO':  'Southeast Missouri State',
  'SMU':   'SMU',
  'STAN':  'Stanford',
  'SYR':   'Syracuse',
  'TAMU':  'Texas A&M',
  'TCU':   'TCU',
  'TENN':  'Tennessee',
  'TT':    'Texas Tech',
  'TUL':   'Tulane',
  'UA':    'Alabama',
  'UCF':   'Central Florida',
  'UF':    'Florida',
  'UGA':   'Georgia',
  'UK':    'Kentucky',
  'UL':    'Louisiana',
  'UNC':   'North Carolina',
  'UNLV':  'UNLV',
  'USC':   'USC',
  'USF':   'South Florida',
  'USM':   'Southern Miss',
  'UT':    'Tennessee',
  'UTAH':  'Utah',
  'UVA':   'Virginia',
  'VT':    'Virginia Tech',
  'VANDY': 'Vanderbilt',
  'VU':    'Vanderbilt',
  'WF':    'Wake Forest',
  'WKU':   'Western Kentucky',
  'WSU':   'Wichita State',
  'WVU':   'West Virginia',
};

export function getCollegeLogoUrl(teamName: string | null | undefined): string | null {
  if (!teamName) return null;
  const name = teamName.trim();

  // 1. Exact match (case-insensitive)
  const lc = name.toLowerCase();
  for (const [key, id] of Object.entries(COLLEGE_ESPN_IDS)) {
    if (key.toLowerCase() === lc) {
      return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
    }
  }

  // 2. Abbreviation lookup (upper-cased)
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const fullName = COLLEGE_ABBR_MAP[upper] ?? COLLEGE_ABBR_MAP[name.toUpperCase()];
  if (fullName) {
    const id = COLLEGE_ESPN_IDS[fullName];
    if (id) return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
  }

  // 3. Partial / prefix match — handles "Virginia Cavaliers" → "Virginia",
  //    "Georgia Tech Yellow Jackets" → "Georgia Tech", etc.
  for (const [key, id] of Object.entries(COLLEGE_ESPN_IDS)) {
    const keyLc = key.toLowerCase();
    if (lc.startsWith(keyLc) || keyLc.startsWith(lc)) {
      return `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;
    }
  }

  return null;
}

export function hasCollegeLogo(teamName: string | null | undefined): boolean {
  return getCollegeLogoUrl(teamName) !== null;
}

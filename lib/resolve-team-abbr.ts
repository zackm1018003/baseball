// MLB Stats API team ID → abbreviation (for when the API omits the abbreviation field)
const MLB_ID_TO_ABBR: Record<number, string> = {
  108: 'LAA', 109: 'ARI', 110: 'BAL', 111: 'BOS', 112: 'CHC',
  113: 'CIN', 114: 'CLE', 115: 'COL', 116: 'DET', 117: 'HOU',
  118: 'KC',  119: 'LAD', 120: 'WSH', 121: 'NYM', 133: 'OAK',
  134: 'PIT', 135: 'SD',  136: 'SEA', 137: 'SF',  138: 'STL',
  139: 'TB',  140: 'TEX', 141: 'TOR', 142: 'MIN', 143: 'PHI',
  144: 'ATL', 145: 'CHW', 146: 'MIA', 147: 'NYY', 158: 'MIL',
};

// MLB team name fragment → abbreviation
const MLB_NAME_TO_ABBR: Record<string, string> = {
  'angels':      'LAA', 'diamondbacks': 'ARI', 'orioles':    'BAL',
  'red sox':     'BOS', 'cubs':         'CHC', 'reds':       'CIN',
  'guardians':   'CLE', 'rockies':      'COL', 'tigers':     'DET',
  'astros':      'HOU', 'royals':       'KC',  'dodgers':    'LAD',
  'nationals':   'WSH', 'mets':         'NYM', 'athletics':  'OAK',
  'pirates':     'PIT', 'padres':       'SD',  'mariners':   'SEA',
  'giants':      'SF',  'cardinals':    'STL', 'rays':       'TB',
  'rangers':     'TEX', 'blue jays':    'TOR', 'twins':      'MIN',
  'phillies':    'PHI', 'braves':       'ATL', 'white sox':  'CHW',
  'marlins':     'MIA', 'yankees':      'NYY', 'brewers':    'MIL',
};

// MiLB team name fragment → MLB parent org abbreviation
const MILB_NAME_TO_PARENT: Record<string, string> = {
  'indianapolis':  'PIT',  'buffalo':       'TOR',  'rochester':  'WSH',
  'syracuse':      'NYM',  'scranton':      'NYY',  'norfolk':    'BAL',
  'durham':        'TB',   'charlotte':     'CHW',  'gwinnett':   'ATL',
  'jacksonville':  'MIA',  'worcester':     'BOS',  'lehigh valley': 'PHI',
  'toledo':        'DET',  'louisville':    'CIN',  'nashville':  'MIL',
  'memphis':       'STL',  'columbus':      'CLE',  'las vegas':  'OAK',
  'salt lake':     'LAA',  'sacramento':    'SF',   'tacoma':     'SEA',
  'reno':          'ARI',  'el paso':       'SD',   'albuquerque': 'COL',
  'oklahoma city': 'LAD',  'round rock':    'TEX',  'sugar land': 'HOU',
  'omaha':         'KC',   'iowa':          'CHC',  'st. paul':   'MIN',
};

export function resolveTeamAbbr(
  team?: { name?: string; abbreviation?: string; teamName?: string; id?: number } | null
): string | null {
  if (!team) return null;

  // 1. Direct abbreviation from API
  if (team.abbreviation) return team.abbreviation;

  // 2. Look up by MLB Stats API team ID
  if (team.id && MLB_ID_TO_ABBR[team.id]) return MLB_ID_TO_ABBR[team.id];

  // 3. Look up by name — try MLB teams first, then MiLB affiliates
  const name = (team.name || team.teamName || '').toLowerCase();
  if (name) {
    for (const [fragment, abbr] of Object.entries(MLB_NAME_TO_ABBR)) {
      if (name.includes(fragment)) return abbr;
    }
    for (const [fragment, parent] of Object.entries(MILB_NAME_TO_PARENT)) {
      if (name.includes(fragment)) return parent;
    }
  }

  return null;
}

// Maps MiLB team name fragments → MLB parent org abbreviation.
// Used when the Stats API omits the abbreviation field on minor-league splits.
const MILB_NAME_TO_PARENT: Record<string, string> = {
  'indianapolis':  'PIT',
  'buffalo':       'TOR',
  'rochester':     'WSH',
  'syracuse':      'NYM',
  'scranton':      'NYY',
  'norfolk':       'BAL',
  'durham':        'TB',
  'charlotte':     'CHW',
  'gwinnett':      'ATL',
  'jacksonville':  'MIA',
  'worcester':     'BOS',
  'lehigh valley': 'PHI',
  'toledo':        'DET',
  'louisville':    'CIN',
  'nashville':     'MIL',
  'memphis':       'STL',
  'columbus':      'CLE',
  'las vegas':     'OAK',
  'salt lake':     'LAA',
  'sacramento':    'SF',
  'tacoma':        'SEA',
  'reno':          'ARI',
  'el paso':       'SD',
  'albuquerque':   'COL',
  'oklahoma city': 'LAD',
  'round rock':    'TEX',
  'sugar land':    'HOU',
  'omaha':         'KC',
  'iowa':          'CHC',
  'st. paul':      'MIN',
};

export function resolveTeamAbbr(
  team?: { name?: string; abbreviation?: string; teamName?: string; id?: number } | null
): string | null {
  if (!team) return null;
  if (team.abbreviation) return team.abbreviation;
  const name = team.name || team.teamName || '';
  if (name) {
    const lower = name.toLowerCase();
    for (const [fragment, parent] of Object.entries(MILB_NAME_TO_PARENT)) {
      if (lower.includes(fragment)) return parent;
    }
  }
  return null;
}

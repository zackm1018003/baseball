/**
 * MLB Stats API Integration
 * Official API: https://statsapi.mlb.com/
 * Documentation: https://github.com/toddrob99/MLB-StatsAPI/wiki
 */

const MLB_STATS_API_BASE = 'https://statsapi.mlb.com/api/v1';
const MLB_LOOKUP_API_BASE = 'http://lookup-service-prod.mlb.com/json/named';

/**
 * MLB Stats API Endpoints
 */
export const MLB_API_ENDPOINTS = {
  // Player endpoints
  PEOPLE: '/people',
  PERSON: '/people/{id}',
  PERSON_STATS: '/people/{id}/stats',

  // Team endpoints
  TEAMS: '/teams',
  TEAM_ROSTER: '/teams/{id}/roster',
  TEAM_STATS: '/teams/{id}/stats',

  // Schedule endpoints
  SCHEDULE: '/schedule',
  SCHEDULE_POSTSEASON: '/schedule/postseason',

  // Stats endpoints
  STATS: '/stats',
  STATS_LEADERS: '/stats/leaders',

  // Game endpoints
  GAME: '/game/{gamePk}/feed/live',
  GAME_BOXSCORE: '/game/{gamePk}/boxscore',

  // Meta/lookup endpoints
  SPORTS: '/sports',
  VENUES: '/venues',
  STANDINGS: '/standings',
};

/**
 * Fetch player data from MLB Stats API
 */
export async function fetchMLBPlayer(playerId: number) {
  try {
    const url = `${MLB_STATS_API_BASE}/people/${playerId}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.people?.[0] || null;
  } catch (error) {
    console.error('Error fetching MLB player:', error);
    return null;
  }
}

/**
 * Fetch player stats from MLB Stats API
 */
export async function fetchMLBPlayerStats(
  playerId: number,
  season?: number,
  group: 'hitting' | 'pitching' | 'fielding' = 'hitting'
) {
  try {
    const params = new URLSearchParams({
      stats: 'season',
      group: group,
    });

    if (season) {
      params.append('season', season.toString());
    }

    const url = `${MLB_STATS_API_BASE}/people/${playerId}/stats?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.stats || [];
  } catch (error) {
    console.error('Error fetching MLB player stats:', error);
    return [];
  }
}

/**
 * Search players by name
 */
export async function searchMLBPlayers(query: string) {
  try {
    const url = `${MLB_STATS_API_BASE}/people/search?names=${encodeURIComponent(query)}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.people || [];
  } catch (error) {
    console.error('Error searching MLB players:', error);
    return [];
  }
}

/**
 * Get all teams
 */
export async function fetchMLBTeams(season?: number) {
  try {
    const params = season ? `?season=${season}` : '';
    const url = `${MLB_STATS_API_BASE}/teams${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.teams || [];
  } catch (error) {
    console.error('Error fetching MLB teams:', error);
    return [];
  }
}

/**
 * Get team roster
 */
export async function fetchTeamRoster(teamId: number, season?: number) {
  try {
    const params = season ? `?season=${season}` : '';
    const url = `${MLB_STATS_API_BASE}/teams/${teamId}/roster${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.roster || [];
  } catch (error) {
    console.error('Error fetching team roster:', error);
    return [];
  }
}

/**
 * Get schedule for a date range
 */
export async function fetchSchedule(
  startDate: string,
  endDate: string,
  teamId?: number
) {
  try {
    const params = new URLSearchParams({
      startDate,
      endDate,
    });

    if (teamId) {
      params.append('teamId', teamId.toString());
    }

    const url = `${MLB_STATS_API_BASE}/schedule?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.dates || [];
  } catch (error) {
    console.error('Error fetching schedule:', error);
    return [];
  }
}

/**
 * Get stat leaders for a category
 */
export async function fetchStatLeaders(
  leaderCategory: string,
  season?: number,
  limit: number = 10
) {
  try {
    const params = new URLSearchParams({
      leaderCategories: leaderCategory,
      limit: limit.toString(),
    });

    if (season) {
      params.append('season', season.toString());
    }

    const url = `${MLB_STATS_API_BASE}/stats/leaders?${params}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`MLB API error: ${response.status}`);
    }

    const data = await response.json();
    return data.leagueLeaders || [];
  } catch (error) {
    console.error('Error fetching stat leaders:', error);
    return [];
  }
}

/**
 * Common leader categories:
 * - homeRuns
 * - battingAverage
 * - earnedRunAverage
 * - strikeouts
 * - wins
 * - saves
 * - stolenBases
 * - runsBattedIn
 */

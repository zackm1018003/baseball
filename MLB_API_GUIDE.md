# MLB Stats API Integration Guide

Complete guide to integrating MLB's official Stats API into your application.

## Overview

The MLB Stats API provides access to:
- Real-time game data and play-by-play
- Player biographical information and statistics
- Team rosters and schedules
- Historical statistics and records
- Standings and leader boards

## Base URLs

- **Stats API**: `https://statsapi.mlb.com/api/v1`
- **Lookup API**: `http://lookup-service-prod.mlb.com/json/named`

## Authentication

The MLB Stats API is **publicly accessible** and does not require authentication or API keys.

## Major Endpoints

### 1. Player Data

#### Get Player Information
```
GET /api/v1/people/{playerId}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/people/545361
```

**Response includes:**
- Full name, birthdate, birthplace
- Physical attributes (height, weight, bat/throw)
- Draft information
- Current team
- Active status

#### Search Players
```
GET /api/v1/people/search?names={query}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/people/search?names=Mike%20Trout
```

#### Get Player Stats
```
GET /api/v1/people/{playerId}/stats?stats=season&group={hitting|pitching|fielding}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/people/545361/stats?stats=season&season=2024&group=hitting
```

**Available stat groups:**
- `hitting` - Batting statistics
- `pitching` - Pitching statistics
- `fielding` - Defensive statistics

### 2. Team Data

#### Get All Teams
```
GET /api/v1/teams?season={year}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/teams?season=2025
```

#### Get Team Roster
```
GET /api/v1/teams/{teamId}/roster?season={year}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/teams/147/roster?season=2025
```

#### Get Team Stats
```
GET /api/v1/teams/{teamId}/stats?season={year}
```

### 3. Schedule & Games

#### Get Schedule
```
GET /api/v1/schedule?startDate={YYYY-MM-DD}&endDate={YYYY-MM-DD}&teamId={id}
```

**Example:**
```
https://statsapi.mlb.com/api/v1/schedule?startDate=2025-04-01&endDate=2025-04-07&teamId=147
```

#### Get Live Game Data
```
GET /api/v1/game/{gamePk}/feed/live
```

**Provides:**
- Real-time score and inning
- Play-by-play events
- Player performance
- Win probability

#### Get Game Boxscore
```
GET /api/v1/game/{gamePk}/boxscore
```

### 4. Standings

```
GET /api/v1/standings?leagueId={103|104}&season={year}
```

**League IDs:**
- `103` - American League
- `104` - National League

### 5. Stats Leaders

```
GET /api/v1/stats/leaders?leaderCategories={category}&season={year}&limit={n}
```

**Popular Categories:**
- `homeRuns` - Home run leaders
- `battingAverage` - Batting average leaders
- `earnedRunAverage` - ERA leaders
- `strikeouts` - Strikeout leaders
- `wins` - Win leaders
- `saves` - Save leaders
- `stolenBases` - Stolen base leaders
- `runsBattedIn` - RBI leaders

**Example:**
```
https://statsapi.mlb.com/api/v1/stats/leaders?leaderCategories=homeRuns&season=2024&limit=10
```

## Player Images

### MLB Static CDN (Recommended)

**Primary source for player headshots:**
```
https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_{width},q_auto:{quality}/v1/people/{playerId}/headshot/67/current
```

**Parameters:**
- `{playerId}` - MLB Stats API player ID
- `{width}` - Image width (e.g., 213, 500)
- `{quality}` - Image quality: `best`, `good`, `low`

**Features:**
- Automatic fallback to generic headshot if player image unavailable
- Multiple size options
- High-quality images
- Fast CDN delivery

**Examples:**
```
// Standard size (213px)
https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/545361/headshot/67/current

// High resolution (500px)
https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_500,q_auto:best/v1/people/545361/headshot/67/current
```

### ESPN CDN (Alternative)

```
https://a.espncdn.com/i/headshots/mlb/players/full/{playerId}.png
```

**Example:**
```
https://a.espncdn.com/i/headshots/mlb/players/full/545361.png
```

### MLB Gameday (High Resolution)

```
http://gdx.mlb.com/images/gameday/mugshots/mlb/{playerId}@4x.jpg
```

### Team Logos

**SVG format (scalable):**
```
https://www.mlbstatic.com/team-logos/{teamId}.svg
```

**Example:**
```
https://www.mlbstatic.com/team-logos/147.svg
```

## Common Query Parameters

### Hydration
Enrich responses with related data:

```
?hydrate=person,team,stats
```

**Common hydrations:**
- `person` - Include person details
- `team` - Include team details
- `stats` - Include statistics
- `awards` - Include awards
- `currentTeam` - Include current team

### Fields
Filter response fields:

```
?fields=people,id,fullName,primaryPosition
```

### Date Formats

All dates use ISO 8601 format: `YYYY-MM-DD`

## Team IDs Reference

| Team | ID | Team | ID |
|------|-----|------|-----|
| Diamondbacks | 109 | Braves | 144 |
| Orioles | 110 | Red Sox | 111 |
| Cubs | 112 | White Sox | 145 |
| Reds | 113 | Guardians | 114 |
| Rockies | 115 | Tigers | 116 |
| Astros | 117 | Royals | 118 |
| Angels | 108 | Dodgers | 119 |
| Marlins | 146 | Brewers | 158 |
| Twins | 142 | Mets | 121 |
| Yankees | 147 | Athletics | 133 |
| Phillies | 143 | Pirates | 134 |
| Padres | 135 | Mariners | 136 |
| Giants | 137 | Cardinals | 138 |
| Rays | 139 | Rangers | 140 |
| Blue Jays | 141 | Nationals | 120 |

## Implementation Examples

### Fetching Player Data

```typescript
async function getPlayer(playerId: number) {
  const response = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${playerId}`
  );
  const data = await response.json();
  return data.people[0];
}
```

### Fetching Player Stats

```typescript
async function getPlayerStats(playerId: number, season: number) {
  const response = await fetch(
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&season=${season}&group=hitting`
  );
  const data = await response.json();
  return data.stats;
}
```

### Fetching Today's Games

```typescript
async function getTodaysGames() {
  const today = new Date().toISOString().split('T')[0];
  const response = await fetch(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${today}`
  );
  const data = await response.json();
  return data.dates[0]?.games || [];
}
```

### Player Image with Fallback

```typescript
function PlayerImage({ playerId }: { playerId: number }) {
  const [imageSrc, setImageSrc] = useState(
    `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_213,q_auto:best/v1/people/${playerId}/headshot/67/current`
  );

  const handleError = () => {
    setImageSrc(`https://a.espncdn.com/i/headshots/mlb/players/full/${playerId}.png`);
  };

  return <img src={imageSrc} onError={handleError} alt="Player" />;
}
```

## Rate Limiting

The MLB Stats API does not publicly document rate limits, but best practices:
- Cache responses when possible
- Avoid excessive concurrent requests
- Use reasonable polling intervals for live data (5-10 seconds)

## Error Handling

```typescript
async function fetchWithErrorHandling(url: string) {
  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('API Error:', error);
    return null;
  }
}
```

## Additional Resources

- **Official MLB API**: https://statsapi.mlb.com/
- **Community Documentation**: https://github.com/toddrob99/MLB-StatsAPI/wiki
- **Alternative Documentation**: https://appac.github.io/mlb-data-api-docs/

## Notes

1. **No API Key Required**: The MLB Stats API is free and open
2. **CORS Enabled**: Can be called from browser-side JavaScript
3. **Real-time Data**: Game feeds update in near real-time during games
4. **Historical Data**: Access to historical statistics back many decades
5. **Player IDs**: Use the same player IDs across all endpoints and image URLs

## Support

For issues or questions about the MLB Stats API:
- Check the community documentation on GitHub
- MLB does not provide official developer support for the public API
- Community forums and GitHub discussions are the best resources

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Zone layout (from catcher's view, as Savant shows it):
// Zone 1 | Zone 2 | Zone 3
// Zone 4 | Zone 5 | Zone 6
// Zone 7 | Zone 8 | Zone 9

interface ZoneContactData {
  zone: number;
  swings: number;
  contacts: number;
  contactPct: number | null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const season = searchParams.get('season') || '2025';

  if (!playerId) {
    return NextResponse.json({ error: 'playerId required' }, { status: 400 });
  }

  try {
    // Fetch all pitch-by-pitch data from Baseball Savant for the player
    // We use POST to get all pitch types and events
    const body = new URLSearchParams({
      hfSea: `${season}|`,
      player_type: 'batter',
      'batters_lookup[]': playerId,
      type: 'details',
      min_results: '0',
    });

    const response = await fetch('https://baseballsavant.mlb.com/statcast_search/csv', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/csv, */*',
        'Referer': 'https://baseballsavant.mlb.com/statcast_search',
        'Origin': 'https://baseballsavant.mlb.com',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch from Baseball Savant' }, { status: 502 });
    }

    const text = await response.text();
    const lines = text.replace(/^\uFEFF/, '').split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ zones: [] });
    }

    // Parse header
    const headers = parseCsvLine(lines[0]);
    const zoneIdx = headers.indexOf('zone');
    const descIdx = headers.indexOf('description');

    if (zoneIdx === -1 || descIdx === -1) {
      return NextResponse.json({ error: 'Could not find zone or description columns' }, { status: 500 });
    }

    // Tally swings and contacts per zone 1-9
    const swings: Record<number, number> = {};
    const contacts: Record<number, number> = {};
    for (let z = 1; z <= 9; z++) {
      swings[z] = 0;
      contacts[z] = 0;
    }

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCsvLine(lines[i]);
      const zone = parseInt(fields[zoneIdx]);
      const desc = fields[descIdx]?.trim();

      if (zone >= 1 && zone <= 9 && desc) {
        const isSwing = /swinging_strike|foul|hit_into_play|foul_tip|swinging_strike_blocked|bunt_foul_tip|missed_bunt/.test(desc);
        const isContact = /^foul$|^hit_into_play$|^foul_tip$|^bunt_foul_tip$/.test(desc);

        if (isSwing) {
          swings[zone]++;
          if (isContact) contacts[zone]++;
        }
      }
    }

    const zones: ZoneContactData[] = [];
    for (let z = 1; z <= 9; z++) {
      const sw = swings[z];
      const co = contacts[z];
      zones.push({
        zone: z,
        swings: sw,
        contacts: co,
        contactPct: sw >= 5 ? Math.round((co / sw) * 100) : null,
      });
    }

    return NextResponse.json(
      { zones },
      {
        headers: {
          'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (err) {
    console.error('Zone contact fetch error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

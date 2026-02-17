import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface ZoneContactData {
  zone: number;
  swings: number;
  contacts: number;
  contactPct: number | null;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // Quoted field
      let field = '';
      i++; // skip opening quote
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i++; // skip closing quote
          break;
        } else {
          field += line[i++];
        }
      }
      fields.push(field);
      if (line[i] === ',') i++; // skip comma
    } else {
      // Unquoted field
      const end = line.indexOf(',', i);
      if (end === -1) {
        fields.push(line.slice(i));
        break;
      } else {
        fields.push(line.slice(i, end));
        i = end + 1;
      }
    }
  }
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
    const url =
      `https://baseballsavant.mlb.com/statcast_search/csv?all=true&hfGT=R%7C&hfSea=${season}%7C` +
      `&player_type=batter&batters_lookup[]=${playerId}&min_pitches=0&min_results=0&min_pas=0&type=details`;

    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
      },
    });

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch from Baseball Savant' }, { status: 502 });
    }

    const text = await response.text();

    // Remove BOM and split lines
    const lines = text.replace(/^\uFEFF/, '').split('\n').filter((l) => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ zones: [] });
    }

    // Parse header to find zone and description column indices
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
      const zone = parseInt(fields[zoneIdx]?.trim() ?? '');
      const desc = fields[descIdx]?.trim() ?? '';

      if (zone >= 1 && zone <= 9) {
        const isSwing =
          desc === 'swinging_strike' ||
          desc === 'foul' ||
          desc === 'hit_into_play' ||
          desc === 'foul_tip' ||
          desc === 'swinging_strike_blocked' ||
          desc === 'bunt_foul_tip' ||
          desc === 'missed_bunt';

        const isContact =
          desc === 'foul' ||
          desc === 'hit_into_play' ||
          desc === 'foul_tip' ||
          desc === 'bunt_foul_tip';

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
        contactPct: sw >= 5 ? Math.round((co / sw) * 100 * 10) / 10 : null,
      });
    }

    return NextResponse.json(
      { zones, season },
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

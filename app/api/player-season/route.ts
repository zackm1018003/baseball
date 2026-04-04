import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const MLB_API    = 'https://statsapi.mlb.com/api/v1';
const SAVANT_CSV = 'https://baseballsavant.mlb.com/statcast_search/csv';

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values: string[] = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    values.push(cur.trim());
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const PITCH_TYPE_MAP: Record<string, string | null> = {
  FF: '4-Seam Fastball', FA: '4-Seam Fastball', SI: 'Sinker',    FC: 'Cutter',
  FS: 'Splitter',        FO: 'Splitter',         SL: 'Slider',   ST: 'Sweeper',
  SV: 'Slurve',          CH: 'Changeup',          CU: 'Curveball', CS: 'Curveball',
  KC: 'Knuckle Curve',   KN: null,                EP: null,       PO: null,
  IN: null,              AB: null,                NP: null,
};

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

interface RawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null;
}

interface HitDot {
  hcX: number; hcY: number; hitDistance: number | null;
  result: string; pitchType: string; exitVelo: number | null; isBarrel: boolean;
}

function aggregateCsv(rows: Record<string, string>[]): { rawDots: RawDot[]; hitDots: HitDot[] } {
  const rawDots: RawDot[] = [];
  const hitDots: HitDot[] = [];
  for (const row of rows) {
    const mapped = PITCH_TYPE_MAP[row.pitch_type];
    if (mapped === null || mapped === undefined) continue;
    const desc      = (row.description || '').toLowerCase();
    const isWhiff   = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    const isSwing   = isWhiff || desc.includes('foul') || desc.includes('hit_into_play');
    const isTake    = !isSwing;
    const ev        = parseFloat(row.launch_speed);
    const la        = parseFloat(row.launch_angle);
    const isBarrel  = isSwing && !isWhiff && (
      row.launch_speed_angle ? Number(row.launch_speed_angle) === 6 : checkBarrel(ev, la)
    );
    const px = parseFloat(row.plate_x);
    const pz = parseFloat(row.plate_z);
    if (!isNaN(px) && !isNaN(pz)) {
      rawDots.push({ pitchType: mapped, px, pz, isWhiff, isBarrel, isSwing, isTake, exitVelo: !isNaN(ev) ? ev : null });
    }
    if (desc === 'hit_into_play') {
      const hcX = parseFloat(row.hc_x);
      const hcY = parseFloat(row.hc_y);
      const hdist = parseFloat(row.hit_distance_sc);
      const events = (row.events || '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY)) {
        hitDots.push({ hcX, hcY, hitDistance: !isNaN(hdist) && hdist > 0 ? hdist : null, result: events, pitchType: mapped, exitVelo: !isNaN(ev) ? ev : null, isBarrel });
      }
    }
  }
  return { rawDots, hitDots };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('playerId');
  const season   = searchParams.get('season') ?? new Date().getFullYear().toString();

  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  try {
    // ── 1. Player bio ────────────────────────────────────────────────────────
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}`).catch(() => null);
    const person = personData?.people?.[0];

    // ── 2. Season totals (try MLB → AAA → Low-A) ────────────────────────────
    const [mlbSeason, aaaSeason, lowASeason] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=1`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=11`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=14`).catch(() => null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickSplit = (d: any) => d?.stats?.[0]?.splits?.[0];
    const seasonSplit = pickSplit(mlbSeason) ?? pickSplit(aaaSeason) ?? pickSplit(lowASeason);
    const seasonStat  = seasonSplit?.stat ?? null;
    const team: string | null = seasonSplit?.team?.abbreviation ?? seasonSplit?.team?.name ?? null;

    // ── 3. Game log (all levels) ─────────────────────────────────────────────
    const [mlbLog, aaaLog, lowALog] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=1`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=11`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=14`).catch(() => null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSplits: any[] = [
      ...(mlbLog?.stats?.[0]?.splits ?? []),
      ...(aaaLog?.stats?.[0]?.splits ?? []),
      ...(lowALog?.stats?.[0]?.splits ?? []),
    ];

    const games = allSplits.map(s => ({
      date:     s.date || s.game?.gameDate?.slice(0, 10) || '',
      opponent: s.opponent?.abbreviation ?? s.opponent?.name ?? '?',
      isHome:   s.isHome ?? false,
      ab:       Number(s.stat?.atBats       ?? 0),
      h:        Number(s.stat?.hits         ?? 0),
      hr:       Number(s.stat?.homeRuns     ?? 0),
      rbi:      Number(s.stat?.rbi          ?? 0),
      bb:       Number(s.stat?.baseOnBalls  ?? 0),
      k:        Number(s.stat?.strikeOuts   ?? 0),
      doubles:  Number(s.stat?.doubles      ?? 0),
      triples:  Number(s.stat?.triples      ?? 0),
      pa:       Number(s.stat?.plateAppearances ?? 0),
      sb:       Number(s.stat?.stolenBases  ?? 0),
      gamePk:   s.game?.gamePk ?? null,
    })).filter(g => g.date).sort((a, b) => b.date.localeCompare(a.date));

    // ── 4. Statcast season leaderboard metrics ───────────────────────────────
    let statcast: {
      avgEv: number|null; barrelPct: number|null; hardHitPct: number|null; avgBatSpeed: number|null;
      xwoba: number|null; xba: number|null; xslg: number|null;
      whiffPct: number|null; chasePct: number|null; sweetSpotPct: number|null;
    } | null = null;
    try {
      const selections = [
        'exit_velocity_avg','barrel_batted_rate','hard_hit_percent','bat_speed',
        'xwoba','xba','xslg','whiff_percent','oz_swing_percent','anglesweetspotpercent',
      ].join(',');
      const savantUrl = `https://baseballsavant.mlb.com/leaderboard/custom?year=${season}&type=batter&filter=&min=1&player_id=${playerId}&selections=${selections}&chart=false`;
      const savantJson = await fetchJSON(savantUrl, true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row: any = savantJson?.leaderboard?.[0];
      if (row) {
        const n = (v: unknown) => v != null ? Math.round(Number(v) * 10) / 10 : null;
        statcast = {
          avgEv:        n(row.exit_velocity_avg),
          barrelPct:    n(row.barrel_batted_rate),
          hardHitPct:   n(row.hard_hit_percent),
          avgBatSpeed:  n(row.bat_speed),
          xwoba:        n(row.xwoba),
          xba:          n(row.xba),
          xslg:         n(row.xslg),
          whiffPct:     n(row.whiff_percent),
          chasePct:     n(row.oz_swing_percent),
          sweetSpotPct: n(row.anglesweetspotpercent),
        };
      }
    } catch { /* non-fatal */ }

    // ── 5. Savant CSV — full season pitch-by-pitch for charts ────────────────
    let rawDots: RawDot[] = [];
    let hitDots: HitDot[] = [];
    try {
      const csvUrl = `${SAVANT_CSV}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
      const csvText = await fetchText(csvUrl);
      if (csvText.includes('pitch_type')) {
        const rows = parseCSV(csvText).filter(r => String(r.batter ?? '').trim() === String(playerId).trim());
        ({ rawDots, hitDots } = aggregateCsv(rows));
      }
    } catch { /* non-fatal — charts just won't render */ }

    // ── 6. Build totals ──────────────────────────────────────────────────────
    const ab  = Number(seasonStat?.atBats          ?? 0);
    const h   = Number(seasonStat?.hits            ?? 0);
    const bb  = Number(seasonStat?.baseOnBalls     ?? 0);
    const hbp = Number(seasonStat?.hitByPitch      ?? 0);
    const sf  = Number(seasonStat?.sacFlies        ?? 0);
    const pa  = Number(seasonStat?.plateAppearances ?? (ab + bb + hbp + sf));

    return NextResponse.json({
      playerId:        parseInt(playerId),
      playerName:      person?.fullName    ?? null,
      playerHeight:    person?.height      ?? null,
      playerWeight:    person?.weight      ?? null,
      playerBirthDate: person?.birthDate   ?? null,
      playerBatSide:   person?.batSide?.code   ?? null,
      playerPitchHand: person?.pitchHand?.code ?? null,
      season,
      team,
      totals: seasonStat ? {
        pa, ab, h,
        hr:      Number(seasonStat.homeRuns    ?? 0),
        rbi:     Number(seasonStat.rbi         ?? 0),
        bb,
        k:       Number(seasonStat.strikeOuts  ?? 0),
        doubles: Number(seasonStat.doubles     ?? 0),
        triples: Number(seasonStat.triples     ?? 0),
        sb:      Number(seasonStat.stolenBases ?? 0),
        avg:     seasonStat.avg ?? (ab > 0 ? (h / ab).toFixed(3) : '.000'),
        obp:     seasonStat.obp ?? null,
        slg:     seasonStat.slg ?? null,
        ops:     seasonStat.ops ?? null,
      } : null,
      games,
      statcast,
      rawDots,
      hitDots,
    });

  } catch (err) {
    console.error('player-season error:', err);
    return NextResponse.json({ error: 'Failed to fetch season data' }, { status: 500 });
  }
}

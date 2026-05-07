import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MLB_API = 'https://statsapi.mlb.com/api/v1';

async function fetchJSON(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function parseHeight(h: string): number {
  const m = h.match(/(\d+)' *(\d+)/);
  return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : 0;
}

export async function GET() {
  const data = await fetchJSON(
    `${MLB_API}/stats?stats=season&group=hitting&season=2025&sportId=1&playerPool=All&limit=5000`
  );
  const splits = (data?.stats?.[0]?.splits ?? []) as Array<Record<string, unknown>>;

  const playerStats: Record<number, { name: string; team: string; k: number; pa: number }> = {};

  for (const s of splits) {
    const player = s.player as Record<string, unknown>;
    const team   = s.team   as Record<string, unknown> | undefined;
    const stat   = s.stat   as Record<string, unknown>;
    const pid    = Number(player?.id);
    const pa     = Number(stat?.plateAppearances ?? 0);
    const k      = Number(stat?.strikeOuts ?? 0);
    if (!pid || pa < 1) continue;
    playerStats[pid] = { name: String(player?.fullName ?? ''), team: String(team?.abbreviation ?? ''), k, pa };
  }

  const pids = Object.keys(playerStats);
  const heightMap: Record<number, string> = {};

  for (let i = 0; i < pids.length; i += 200) {
    const batch = pids.slice(i, i + 200).join(',');
    const pData = await fetchJSON(`${MLB_API}/people?personIds=${batch}`);
    for (const p of (pData?.people ?? []) as Array<Record<string, unknown>>) {
      heightMap[Number(p.id)] = String(p.height ?? '');
    }
  }

  const players = pids.flatMap(pidStr => {
    const pid  = parseInt(pidStr);
    const s    = playerStats[pid];
    const h    = heightMap[pid];
    if (!h) return [];
    const heightIn = parseHeight(h);
    if (!heightIn) return [];
    return [{
      playerId: pid,
      name:     s.name,
      team:     s.team,
      height:   h,
      heightIn,
      pa:       s.pa,
      k:        s.k,
      kPct:     Math.round(s.k / s.pa * 1000) / 10,
    }];
  });

  // Group averages per height
  const groups: Record<number, { k: number; pa: number; height: string }> = {};
  for (const p of players) {
    if (!groups[p.heightIn]) groups[p.heightIn] = { k: 0, pa: 0, height: p.height };
    groups[p.heightIn].k  += p.k;
    groups[p.heightIn].pa += p.pa;
  }
  const averages = Object.entries(groups)
    .map(([hIn, g]) => ({
      heightIn: parseInt(hIn),
      height:   g.height,
      kPct:     g.pa > 0 ? Math.round(g.k / g.pa * 1000) / 10 : 0,
      pa:       g.pa,
    }))
    .sort((a, b) => a.heightIn - b.heightIn);

  return NextResponse.json({ players, averages });
}

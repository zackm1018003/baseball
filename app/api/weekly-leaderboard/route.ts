import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function computeStats(arr: number[]): { mean: number; std: number } | null {
  if (arr.length < 5) return null;
  const m = arr.reduce((s, v) => s + v, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length;
  const s = Math.sqrt(variance);
  if (s === 0) return null;
  return {
    mean: Math.round(m * 100000) / 100000,
    std:  Math.round(s * 100000) / 100000,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lastNParam = searchParams.get('lastN');
  const lastN = Math.min(Math.max(parseInt(lastNParam ?? '7') || 7, 7), 28);

  const today      = new Date().toISOString().slice(0, 10);
  const weekStart  = addDays(today, -(lastN - 1));
  const weekEnd    = today;
  const season     = today.slice(0, 4);

  try {
    // MLB Stats API — all hitters' stats over the date range
    const url = `https://statsapi.mlb.com/api/v1/stats?stats=byDateRange&group=hitting&season=${season}&startDate=${weekStart}&endDate=${weekEnd}&sportId=1&limit=2000&playerPool=All`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 300 },
    });
    if (!res.ok) throw new Error(`MLB API ${res.status}`);
    const data = await res.json();
    const splits = (data?.stats?.[0]?.splits ?? []) as Array<Record<string, unknown>>;

    // Minimum PA to be counted in the baselines
    const minPA = Math.max(3, Math.floor(lastN * 0.35));

    const hitters = splits
      .map(split => {
        const stat     = split.stat as Record<string, unknown>;
        const ab       = Number(stat.atBats           ?? 0);
        const h        = Number(stat.hits             ?? 0);
        const bb       = Number(stat.baseOnBalls      ?? 0);
        const hbp      = Number(stat.hitByPitch       ?? 0);
        const sf       = Number(stat.sacFlies         ?? 0);
        const sh       = Number(stat.sacBunts         ?? 0);
        const pa       = Number(stat.plateAppearances ?? (ab + bb + hbp + sf + sh));
        const k        = Number(stat.strikeOuts       ?? 0);
        const hr       = Number(stat.homeRuns         ?? 0);
        const doubles  = Number(stat.doubles          ?? 0);
        const triples  = Number(stat.triples          ?? 0);
        const singles  = Math.max(0, h - doubles - triples - hr);
        return { pa, ab, h, bb, k, hr, doubles, triples, singles };
      })
      .filter(h => h.pa >= minPA);

    // Rate stats
    const avgs  = hitters.filter(h => h.ab > 0).map(h => h.h / h.ab);
    const slgs  = hitters.filter(h => h.ab > 0).map(h =>
      (h.singles + 2 * h.doubles + 3 * h.triples + 4 * h.hr) / h.ab
    );
    const obps  = hitters.filter(h => (h.ab + h.bb) > 0).map(h =>
      (h.h + h.bb) / (h.ab + h.bb)
    );
    const opss  = hitters.filter(h => h.ab > 0 && (h.ab + h.bb) > 0).map(h => {
      const obp = (h.h + h.bb) / (h.ab + h.bb);
      const slg = (h.singles + 2 * h.doubles + 3 * h.triples + 4 * h.hr) / h.ab;
      return obp + slg;
    });
    const kPcts  = hitters.filter(h => h.pa > 0).map(h => (h.k  / h.pa) * 100);
    const bbPcts = hitters.filter(h => h.pa > 0).map(h => (h.bb / h.pa) * 100);

    const kStats  = computeStats(kPcts);
    const bbStats = computeStats(bbPcts);

    return NextResponse.json({
      weekStart,
      weekEnd,
      qualifiedCount: hitters.length,
      minPA,
      baselines: {
        avg:   computeStats(avgs),
        slg:   computeStats(slgs),
        obp:   computeStats(obps),
        ops:   computeStats(opss),
        kPct:  kStats  ? { ...kStats,  inv: true  } : null,
        bbPct: bbStats ? { ...bbStats, inv: false } : null,
      },
    });
  } catch (err) {
    console.error('[weekly-leaderboard]', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

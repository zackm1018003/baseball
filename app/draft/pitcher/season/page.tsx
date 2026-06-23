'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

const MLB_API = 'https://statsapi.mlb.com/api/v1';

interface GameLog {
  date: string;
  opponent: string;
  opponentLogo: string | null;
  isHome: boolean;
  ip: string;
  ipVal: number;
  h: number;
  er: number;
  bb: number;
  k: number;
  hr: number;
  pitches: number;
  bf: number;
  gamePk: number;
}

interface PlayerBio {
  name: string;
  team: string;
  teamLogoUrl: string | null;
  age: number | null;
  pitchHand: string | null;
  height: string | null;
  weight: number | null;
}

function parseIP(ip: string): number {
  const parts = ip.split('.');
  return (parseInt(parts[0]) || 0) + (parseInt(parts[1]) || 0) / 3;
}

function fmtERA(er: number, ipVal: number): string {
  if (ipVal === 0) return '—';
  return (er / ipVal * 9).toFixed(2);
}

function fmtWHIP(h: number, bb: number, ipVal: number): string {
  if (ipVal === 0) return '—';
  return ((h + bb) / ipVal).toFixed(2);
}

function fmtPct(num: number, denom: number): string {
  if (denom === 0) return '—';
  return (num / denom * 100).toFixed(1) + '%';
}

// ─── Main content (needs useSearchParams so wrapped in Suspense below) ─────────

function DraftPitcherSeasonContent() {
  const params = useSearchParams();
  const pitcherId = params.get('pitcherId') ?? '';
  const season = params.get('season') ?? String(new Date().getFullYear());

  const [bio, setBio] = useState<PlayerBio | null>(null);
  const [games, setGames] = useState<GameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!pitcherId) { setError('No pitcher ID provided'); setLoading(false); return; }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [peopleRes, statsRes] = await Promise.all([
          fetch(`${MLB_API}/people/${pitcherId}?hydrate=currentTeam`),
          fetch(`${MLB_API}/people/${pitcherId}/stats?stats=gameLog&group=pitching&season=${season}&sportId=22`),
        ]);

        if (!peopleRes.ok || !statsRes.ok) throw new Error('Failed to fetch player data');

        const [peopleData, statsData] = await Promise.all([peopleRes.json(), statsRes.json()]);

        const person = peopleData?.people?.[0];
        const teamAbbr: string = person?.currentTeam?.abbreviation ?? '';
        setBio({
          name: person?.fullName ?? 'Unknown',
          team: teamAbbr,
          teamLogoUrl: getMLBTeamLogoUrl(teamAbbr),
          age: person?.currentAge ?? null,
          pitchHand: person?.pitchHand?.code ?? null,
          height: person?.height ?? null,
          weight: person?.weight ?? null,
        });

        const splits: Record<string, unknown>[] = statsData?.stats?.[0]?.splits ?? [];
        const logs: GameLog[] = splits.map(s => {
          const stat = s.stat as Record<string, unknown>;
          const opp = (s.opponent as Record<string, unknown> | undefined)?.abbreviation as string ?? '?';
          const ip = String(stat?.inningsPitched ?? '0');
          return {
            date: String(s.date ?? ''),
            opponent: opp,
            opponentLogo: getMLBTeamLogoUrl(opp),
            isHome: Boolean(s.isHome),
            ip,
            ipVal: parseIP(ip),
            h:       Number(stat?.hits          ?? 0),
            er:      Number(stat?.earnedRuns     ?? 0),
            bb:      Number(stat?.baseOnBalls    ?? 0),
            k:       Number(stat?.strikeOuts     ?? 0),
            hr:      Number(stat?.homeRuns       ?? 0),
            pitches: Number(stat?.numberOfPitches ?? 0),
            bf:      Number(stat?.battersFaced   ?? 0),
            gamePk:  Number((s.game as Record<string, unknown> | undefined)?.gamePk ?? 0),
          };
        });

        setGames(logs);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [pitcherId, season]);

  // Season totals
  const totals = games.reduce(
    (acc, g) => ({
      g: acc.g + 1,
      ipVal: acc.ipVal + g.ipVal,
      h:  acc.h  + g.h,
      er: acc.er + g.er,
      bb: acc.bb + g.bb,
      k:  acc.k  + g.k,
      hr: acc.hr + g.hr,
      bf: acc.bf + g.bf,
    }),
    { g: 0, ipVal: 0, h: 0, er: 0, bb: 0, k: 0, hr: 0, bf: 0 }
  );

  // Convert total ipVal back to display string
  const totalInnings = Math.floor(totals.ipVal);
  const totalOuts = Math.round((totals.ipVal - totalInnings) * 3);
  const totalIPDisplay = `${totalInnings}.${totalOuts}`;

  if (loading) {
    return (
      <div className="min-h-screen bg-page text-ink flex items-center justify-center">
        <div className="flex items-center gap-3 text-ink-3">
          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent animate-spin" />
          Loading season summary…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-page text-ink flex items-center justify-center">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Header */}
      <div className="border-b border-ink/20 px-4 py-3 flex items-center gap-4 flex-wrap">
        <Link href="/whiffs" className="text-ink-3 hover:text-ink text-sm transition-colors">← Whiff Leaderboard</Link>
        <span className="text-ink-4 text-xs">·</span>
        <span className="text-xs text-ink-4">Draft League · {season} Season</span>
      </div>

      {/* Player bio */}
      {bio && (
        <div className="px-4 py-6 border-b border-ink/20">
          <div className="flex items-center gap-4">
            {bio.teamLogoUrl && (
              <img src={bio.teamLogoUrl} alt={bio.team} className="w-14 h-14 object-contain flex-shrink-0" />
            )}
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{bio.name}</h1>
              <div className="flex items-center gap-3 mt-1 text-sm text-ink-3">
                <span className="font-semibold text-purple-400">{bio.team}</span>
                {bio.age != null && <span>Age {bio.age}</span>}
                {bio.pitchHand && <span>{bio.pitchHand === 'L' ? 'LHP' : bio.pitchHand === 'R' ? 'RHP' : bio.pitchHand}</span>}
                {bio.height && <span>{bio.height}</span>}
                {bio.weight && <span>{bio.weight} lbs</span>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Season totals */}
      {games.length > 0 && (
        <div className="px-4 py-5 border-b border-ink/20">
          <h2 className="text-xs text-ink-3 uppercase tracking-wider mb-3">Season Totals</h2>
          <div className="grid grid-cols-5 sm:grid-cols-10 gap-3">
            {[
              { label: 'G',    value: totals.g },
              { label: 'IP',   value: totalIPDisplay },
              { label: 'K',    value: totals.k },
              { label: 'BB',   value: totals.bb },
              { label: 'HR',   value: totals.hr },
              { label: 'ERA',  value: fmtERA(totals.er, totals.ipVal) },
              { label: 'WHIP', value: fmtWHIP(totals.h, totals.bb, totals.ipVal) },
              { label: 'K%',   value: fmtPct(totals.k, totals.bf) },
              { label: 'BB%',  value: fmtPct(totals.bb, totals.bf) },
              { label: 'BF',   value: totals.bf },
            ].map(({ label, value }) => (
              <div key={label} className="bg-panel rounded p-3 text-center">
                <div className="text-xs text-ink-4 uppercase tracking-wider mb-1">{label}</div>
                <div className="text-lg font-bold tabular-nums">{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game log */}
      <div className="px-4 py-4">
        <h2 className="text-xs text-ink-3 uppercase tracking-wider mb-3">Game Log</h2>
        {games.length === 0 ? (
          <div className="text-ink-4 text-sm py-8 text-center">No appearances yet this season</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink/20 text-ink-3 text-xs uppercase tracking-wider">
                  <th className="py-2 pr-4 text-left">Date</th>
                  <th className="py-2 pr-4 text-left">Opponent</th>
                  <th className="py-2 px-3 text-right">IP</th>
                  <th className="py-2 px-3 text-right">H</th>
                  <th className="py-2 px-3 text-right">ER</th>
                  <th className="py-2 px-3 text-right">BB</th>
                  <th className="py-2 px-3 text-right">K</th>
                  <th className="py-2 px-3 text-right">HR</th>
                  <th className="py-2 px-3 text-right">PC</th>
                  <th className="py-2 px-3 text-right">BF</th>
                  <th className="py-2 pl-3 text-right">ERA</th>
                </tr>
              </thead>
              <tbody>
                {[...games].reverse().map((g, i) => {
                  const gameERA = fmtERA(g.er, g.ipVal);
                  const isQS = g.ipVal >= 6 && g.er <= 3;
                  const isRough = g.er >= 5;
                  return (
                    <tr key={i} className="border-b border-ink/20 hover:bg-panel transition-colors">
                      <td className="py-2 pr-4 text-ink-3 text-xs tabular-nums whitespace-nowrap">
                        {g.date ? new Date(g.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-ink-4 text-xs">{g.isHome ? 'vs' : '@'}</span>
                          {g.opponentLogo && <img src={g.opponentLogo} alt={g.opponent} className="w-4 h-4 object-contain" />}
                          <span className="text-xs font-medium">{g.opponent}</span>
                        </div>
                      </td>
                      <td className={`py-2 px-3 text-right tabular-nums font-medium ${isQS ? 'text-green-400' : ''}`}>{g.ip}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-ink-2">{g.h}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${isRough ? 'text-red-400' : 'text-ink-2'}`}>{g.er}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-ink-2">{g.bb}</td>
                      <td className="py-2 px-3 text-right tabular-nums font-medium">{g.k}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-ink-2">{g.hr || '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-ink-3 text-xs">{g.pitches || '—'}</td>
                      <td className="py-2 px-3 text-right tabular-nums text-ink-3 text-xs">{g.bf || '—'}</td>
                      <td className={`py-2 pl-3 text-right tabular-nums text-xs ${isRough ? 'text-red-400' : 'text-ink-3'}`}>{gameERA}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="px-4 pb-6 text-xs text-ink-4">
        IP highlighted green = quality start (6+ IP, ≤3 ER) · Data from MLB Stats API
      </div>
    </div>
  );
}

export default function DraftPitcherSeasonPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-page text-ink flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent animate-spin" />
      </div>
    }>
      <DraftPitcherSeasonContent />
    </Suspense>
  );
}

'use client';

import React, { use, useState, useEffect, useCallback } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeasonPageProps {
  params: Promise<{ id: string }>;
}

interface SeasonTotals {
  pa: number; ab: number; h: number; hr: number; rbi: number;
  bb: number; k: number; doubles: number; triples: number; sb: number;
  avg: string; obp: string | null; slg: string | null; ops: string | null;
}

interface GameLog {
  date: string; opponent: string; isHome: boolean;
  ab: number; h: number; hr: number; rbi: number;
  bb: number; k: number; doubles: number; triples: number;
  pa: number; sb: number; gamePk: number | null;
}

interface Statcast {
  avgEv: number | null; barrelPct: number | null;
  hardHitPct: number | null; avgBatSpeed: number | null;
}

interface SeasonData {
  playerId: number;
  playerName: string | null; playerHeight: string | null;
  playerWeight: number | null; playerBirthDate: string | null;
  playerBatSide: string | null; playerPitchHand: string | null;
  season: string; team: string | null;
  totals: SeasonTotals | null;
  games: GameLog[];
  statcast: Statcast | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now   = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

function fmtRate(v: string | null): string {
  if (!v) return '—';
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n.toFixed(3).replace(/^0\./, '.');
}

function hitColor(h: number): string {
  if (h >= 150) return 'text-green-300';
  if (h >= 100) return 'text-yellow-400';
  return '';
}

function hrColor(hr: number): string {
  if (hr >= 30) return 'text-green-400';
  if (hr >= 15) return 'text-yellow-400';
  return '';
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HitterSeasonPage({ params }: SeasonPageProps) {
  const { id } = use(params);

  const isNumeric = /^\d+$/.test(id);
  const player    = isNumeric ? getPlayerById(parseInt(id)) : getPlayerByName(decodeURIComponent(id));
  const playerId  = player?.player_id ?? (isNumeric ? parseInt(id) : null);

  const currentYear = new Date().getFullYear().toString();
  const [season, setSeason]       = useState<string>(currentYear);
  const [data, setData]           = useState<SeasonData | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [imageError, setImageError] = useState(0);
  const [filterHR, setFilterHR]   = useState(false);

  const fetchData = useCallback(async (s: string) => {
    if (!playerId) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/player-season?playerId=${playerId}&season=${s}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => { fetchData(season); }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeasonChange = (s: string) => {
    setSeason(s);
    fetchData(s);
  };

  const displayName = player?.full_name ?? data?.playerName ?? `Player ${id}`;
  const totals      = data?.totals;
  const statcast    = data?.statcast;

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const teamLogo =
    (data?.team  ? getMLBTeamLogoUrl(data.team)  : null) ??
    (player?.team ? getMLBTeamLogoUrl(player.team) : null);

  const yearOptions: string[] = [];
  for (let y = parseInt(currentYear); y >= 2015; y--) yearOptions.push(y.toString());

  const games = data?.games ?? [];

  return (
    <div className="min-h-screen bg-[#0a0b10] text-white">

      {/* Nav */}
      <header className="bg-[#0f1117] border-b border-white/[0.06]">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-gray-400 hover:text-white font-medium text-sm transition-colors">
              Hitters
            </Link>
            <Link
              href={`/player/${id}/daily`}
              className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide"
            >
              Daily Card
            </Link>
            <Link
              href={`/player/${id}/weekly`}
              className="px-3 py-1.5 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/20 text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide"
            >
              Weekly Card
            </Link>
            <Link href="/pitchers" className="text-gray-400 hover:text-white font-medium text-sm transition-colors">
              Pitchers
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>

        {/* ── MAIN CARD ── */}
        <div className="flex justify-center mb-6">
        <div className="bg-[#0f1117] p-6 inline-block border border-white/[0.05]">

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-400 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-[#171b24] p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* TOP ROW: photo + name/info/stats */}
          <div className="flex gap-4 items-start mb-4">

            {/* LEFT: photo */}
            <div className="flex-shrink-0 flex flex-col items-center w-[220px]">
              {(() => {
                const flag = getCountryFlagUrl(data?.team ?? player?.team ?? null, 80);
                return flag
                  ? <img src={flag} alt={data?.team ?? ''} className="w-8 h-[22px] object-cover mb-1" />
                  : null;
              })()}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={currentImage}
                alt={displayName}
                className="h-auto max-w-[165px] block mx-auto"
                onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
              />
              <div className="mt-1.5 text-center">
                <div className="text-[10px] font-semibold text-blue-400 tracking-wide">By @Piratefan003</div>
                <div className="text-[8.5px] text-gray-500 leading-tight mt-0.5">
                  Data: MLB Statcast<br />Baseball Savant · MLB Stats API
                </div>
              </div>
            </div>

            {/* CENTER: name / bio / stats */}
            <div className="flex flex-col items-center flex-1">
              <div className="flex flex-col items-center mb-4">

                {/* Name + logo */}
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="text-2xl font-bold">{displayName}</h1>
                  {teamLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamLogo} alt={data?.team || player?.team || ''} className="w-8 h-8 object-contain flex-shrink-0 drop-shadow-[0_0_6px_rgba(255,255,255,0.35)]" />
                  )}
                </div>

                {/* Bio */}
                {(() => {
                  const age = calcAge(data?.playerBirthDate ?? null);
                  const parts: string[] = [];
                  if (data?.playerHeight) parts.push(data.playerHeight);
                  if (data?.playerWeight) parts.push(`${data.playerWeight} lbs`);
                  if (age !== null) parts.push(`Age ${age}`);
                  if (data?.playerBatSide && data?.playerPitchHand) parts.push(`${data.playerBatSide}/${data.playerPitchHand}`);
                  return parts.length > 0
                    ? <p className="text-sm text-gray-300 mb-1">{parts.join(' • ')}</p>
                    : null;
                })()}

                {/* Season label + selector */}
                <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-gray-400 mb-2">
                  {(data?.team || player?.team) && (
                    <span className="font-bold text-white">{data?.team || player?.team}</span>
                  )}
                  <span>·</span>
                  <span className="font-semibold text-white">{season} Season</span>
                  <span>·</span>
                  <select
                    value={season}
                    onChange={e => handleSeasonChange(e.target.value)}
                    className="bg-[#171b24] border border-white/[0.08] text-white text-xs rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Stats grid */}
                {!loading && totals && (
                  <div className="border border-white/[0.08]">
                    {/* Row 1: main counting stats */}
                    <div className="grid grid-cols-6 divide-x divide-white/[0.08]">
                      {[
                        { label: 'AB',  value: String(totals.ab) },
                        { label: 'H',   value: String(totals.h),  cls: hitColor(totals.h) },
                        { label: 'HR',  value: String(totals.hr), cls: hrColor(totals.hr) },
                        { label: 'RBI', value: String(totals.rbi) },
                        { label: 'BB',  value: String(totals.bb) },
                        { label: 'OPS', value: fmtRate(totals.ops) },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1.5 py-1.5">
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide">{s.label}</div>
                          <div className={`text-sm font-bold tabular-nums ${s.cls ?? ''}`}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Row 2: rate + misc */}
                    <div className="grid grid-cols-6 divide-x divide-white/[0.08] border-t border-white/[0.08]">
                      {[
                        { label: 'K',   value: String(totals.k) },
                        { label: '2B',  value: String(totals.doubles) },
                        { label: 'PA',  value: String(totals.pa) },
                        { label: 'SB',  value: String(totals.sb) },
                        { label: 'OBP', value: fmtRate(totals.obp) },
                        { label: 'SLG', value: fmtRate(totals.slg) },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1.5 py-1.5">
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide">{s.label}</div>
                          <div className="text-sm font-bold tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>
                    {/* Row 3: AVG + Statcast (if available) */}
                    <div className="grid grid-cols-6 divide-x divide-white/[0.08] border-t border-white/[0.08]">
                      {[
                        { label: 'AVG',    value: fmtRate(totals.avg) },
                        { label: '3B',     value: String(totals.triples) },
                        { label: 'Avg EV', value: statcast?.avgEv   != null ? statcast.avgEv.toFixed(1)   : '—' },
                        { label: 'Brls%',  value: statcast?.barrelPct  != null ? statcast.barrelPct.toFixed(1) + '%'  : '—' },
                        { label: 'HH%',    value: statcast?.hardHitPct != null ? statcast.hardHitPct.toFixed(1) + '%' : '—' },
                        { label: 'Avg BS', value: statcast?.avgBatSpeed != null ? statcast.avgBatSpeed.toFixed(1) : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1.5 py-1.5">
                          <div className="text-[9px] text-gray-500 uppercase tracking-wide">{s.label}</div>
                          <div className="text-sm font-bold tabular-nums">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!loading && !totals && !error && (
                  <p className="text-gray-500 text-xs mt-2">No stats found for {season}.</p>
                )}
              </div>
            </div>
          </div>

        </div>
        </div>

        {/* ── Game Log ── */}
        {games.length > 0 && (
          <div className="bg-[#0f1117] p-4 mb-6 border border-white/[0.05]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase">
                Game Log
                <span className="ml-2 text-gray-600 font-normal normal-case">
                  {filterHR
                    ? `${games.filter(g => g.hr > 0).length} HR games`
                    : `${games.length} games`}
                </span>
              </h3>
              <button
                onClick={() => setFilterHR(v => !v)}
                className={`px-2.5 py-1 text-xs font-bold transition-colors border ${
                  filterHR
                    ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-300'
                    : 'bg-[#171b24] border-white/[0.08] text-gray-400 hover:border-yellow-500/60 hover:text-yellow-300'
                }`}
              >
                HR Only
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {games.filter(g => !filterHR || g.hr > 0).map((g, i) => (
                <Link
                  key={`${g.date}-${g.gamePk ?? i}`}
                  href={`/player/${id}/daily?date=${g.date}`}
                  className="px-3 py-1.5 text-xs font-medium transition-colors bg-[#171b24] text-gray-300 hover:bg-white/[0.06] hover:text-white border border-white/[0.08]"
                >
                  <span className="font-semibold">{g.date}</span>
                  <span className="text-gray-400 ml-1">{g.isHome ? 'vs' : '@'} {g.opponent}</span>
                  <span className="ml-1">{g.h}/{g.ab}</span>
                  {g.hr > 0 && <span className="ml-1 text-yellow-400">{g.hr}HR</span>}
                  {g.bb > 0 && <span className="ml-1 text-blue-400">{g.bb}BB</span>}
                  {g.k  > 0 && <span className="ml-1 text-red-400/70">{g.k}K</span>}
                </Link>
              ))}
              {filterHR && games.filter(g => g.hr > 0).length === 0 && (
                <p className="text-gray-600 text-xs italic">No home run games found.</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

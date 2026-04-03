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

interface RawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null;
}

interface HitDot {
  hcX: number; hcY: number; hitDistance: number | null;
  result: string; pitchType: string; exitVelo: number | null; isBarrel: boolean;
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
  rawDots: RawDot[];
  hitDots: HitDot[];
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

// ─── Pitch colours ────────────────────────────────────────────────────────────

const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Sinker':          { color: '#C75B12', bg: '#C75B12', text: '#fff' },
  'Cutter':          { color: '#933F2C', bg: '#933F2C', text: '#fff' },
  'Changeup':        { color: '#3BBB38', bg: '#3BBB38', text: '#fff' },
  'Splitter':        { color: '#1A8B6E', bg: '#1A8B6E', text: '#fff' },
  'Curveball':       { color: '#00D1ED', bg: '#00D1ED', text: '#333' },
  'Knuckle Curve':   { color: '#6236CD', bg: '#6236CD', text: '#fff' },
  'Slider':          { color: '#EFE514', bg: '#EFE514', text: '#333' },
  'Sweeper':         { color: '#FF6D00', bg: '#FF6D00', text: '#fff' },
  'Slurve':          { color: '#3B44CE', bg: '#3B44CE', text: '#fff' },
};
function pitchColors(name: string) { return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' }; }

// ─── Zone Chart ───────────────────────────────────────────────────────────────

function HitterZoneChart({ rawDots, heightIn }: { rawDots: RawDot[]; heightIn?: number }) {
  const size = 280, xMin = -1.8, xMax = 1.8, zMin = 0.5, zMax = 4.5, pad = 28;
  const w = size - pad * 2, h = size - pad * 2;
  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;
  const ht = heightIn ?? 72;
  const szLeft = toSvgX(-0.708), szRight = toSvgX(0.708);
  const szTop  = toSvgY((ht * 0.535) / 12), szBot = toSvgY((ht * 0.27) / 12);
  const thirdW = (szRight - szLeft) / 3, thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0)
    return <div style={{ width: size, height: size }} className="bg-[#d1d5db] flex items-center justify-center"><p className="text-gray-500 text-xs">No Statcast data</p></div>;

  return (
    <svg width={size} height={size} style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="sfireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      <text x={size/2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">Pitches Seen — {rawDots.length} pitches</text>
      <rect x={szLeft} y={szTop} width={szRight-szLeft} height={szBot-szTop} fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2"/>
      {[1,2].map(i=><line key={`v${i}`} x1={szLeft+thirdW*i} y1={szTop} x2={szLeft+thirdW*i} y2={szBot} stroke="#00000033" strokeWidth="0.75"/>)}
      {[1,2].map(i=><line key={`h${i}`} x1={szLeft} y1={szTop+thirdH*i} x2={szRight} y2={szTop+thirdH*i} stroke="#00000033" strokeWidth="0.75"/>)}
      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px), cy = toSvgY(dot.pz);
        const col = pitchColors(dot.pitchType).color;
        let visual: React.ReactNode;
        if (dot.isWhiff) {
          const s = 4;
          visual = (<><line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/></>);
        } else if (dot.isBarrel) {
          visual = (<><text x={cx} y={cy+5} textAnchor="middle" fontSize={12} fontWeight="bold" fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
            <text x={cx} y={cy+5} textAnchor="middle" fontSize={12} fontWeight="bold" fill="url(#sfireGrad)" opacity="0.95">B</text></>);
        } else if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95) {
          visual = <text x={cx} y={cy+5} textAnchor="middle" fontSize={12} opacity="0.95">🔥</text>;
        } else if (dot.isTake) {
          visual = <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={col} strokeWidth="1.5" opacity="0.75"/>;
        } else {
          visual = <circle cx={cx} cy={cy} r={3.5} fill={col} stroke="#000" strokeWidth="0.6" opacity="0.8"/>;
        }
        return <g key={i}>{visual}</g>;
      })}
      {(() => { const lx=(size-188)/2; return (<>
        <circle cx={lx+4} cy={size-10} r="3" fill="#555" opacity="0.8"/>
        <text x={lx+10} y={size-7} fontSize="7.5" fill="#000">swing</text>
        <circle cx={lx+42} cy={size-10} r="3" fill="none" stroke="#555" strokeWidth="1.5"/>
        <text x={lx+48} y={size-7} fontSize="7.5" fill="#000">take</text>
        <line x1={lx+75} y1={size-14} x2={lx+81} y2={size-7} stroke="#555" strokeWidth="1.5"/>
        <line x1={lx+81} y1={size-14} x2={lx+75} y2={size-7} stroke="#555" strokeWidth="1.5"/>
        <text x={lx+85} y={size-7} fontSize="7.5" fill="#000">whiff</text>
        <text x={lx+114} y={size-7} fontSize="7.5" fontWeight="bold" fill="url(#sfireGrad)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
        <text x={lx+122} y={size-7} fontSize="7.5" fill="#000">barrel</text>
        <text x={lx+152} y={size-7} fontSize="7.5">🔥</text>
        <text x={lx+160} y={size-7} fontSize="7.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Spray Chart ──────────────────────────────────────────────────────────────

function SprayChart({ hitDots, batSide, playerImageUrl }: { hitDots: HitDot[]; batSide?: string | null; playerImageUrl?: string }) {
  const HOME_X = 250, HOME_Y = 450, SCALE = 1.65, FT_TO_SVG = 0.6512;
  const RF_CORNER = { x: 402, y: 298 }, LF_CORNER = { x: 98, y: 298 };
  const RF_TOP = { x: 342, y: 220 }, LF_TOP = { x: 158, y: 220 };

  const toSvg = (hcX: number, hcY: number, hitDist?: number | null) => {
    const dx = hcX - 125, dy = 208 - hcY;
    const r = Math.sqrt(dx*dx + dy*dy);
    if (hitDist && hitDist > 0 && r > 0) {
      const svgDist = hitDist * FT_TO_SVG;
      return { x: HOME_X + (dx/r)*svgDist, y: HOME_Y - (dy/r)*svgDist };
    }
    return { x: HOME_X + dx*SCALE, y: HOME_Y + (hcY - 208)*SCALE };
  };

  return (
    <svg width={280} height={280} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="sscFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>
      <polygon points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`} fill="#f5f5f5"/>
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <text x={RF_CORNER.x-28} y={RF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={181} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x+28} y={LF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <circle cx={250} cy={186} r="3" fill="#000"/>
      <text x={RF_TOP.x+2} y={RF_TOP.y-6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <text x={LF_TOP.x-2} y={LF_TOP.y-6} fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <path d={`M ${RF_CORNER.x} ${RF_CORNER.y} L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1 L 250 186 L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5 L ${LF_CORNER.x} ${LF_CORNER.y}`} fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>
      <polygon points="250,450 291,409 250,367 209,409" fill="none" stroke="#000" strokeWidth="1.5"/>
      <circle cx="250" cy="411" r="12" fill="none" stroke="#000" strokeWidth="1"/>
      <rect x="246" y="408.5" width="8" height="3" rx="0.5" fill="#333"/>
      <rect x="287" y="405" width="8" height="8" fill="#333"/>
      <g transform="rotate(45,250,367)"><rect x="246" y="363" width="8" height="8" fill="#333"/></g>
      <rect x="205" y="405" width="8" height="8" fill="#333"/>
      <path d="M 243 453 L 257 453 L 257 447 L 250 442 L 243 447 Z" fill="#333"/>
      <rect x="308" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>
      <rect x="164" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>
      {playerImageUrl && (batSide === 'R' || batSide === 'S') && (
        <image href={playerImageUrl} x="164" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>
      )}
      {playerImageUrl && (batSide === 'L' || batSide === 'S') && (
        <image href={playerImageUrl} x="308" y="402" width="28" height="28" preserveAspectRatio="xMidYMid meet"/>
      )}
      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY, dot.hitDistance);
        const col = pitchColors(dot.pitchType).color;
        const isHit = ['single','double','triple','home_run'].includes(dot.result.toLowerCase().replace(/\s/g,'_'));
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={8} fill={isHit ? col : 'none'} fillOpacity={isHit ? 0.88 : 0} stroke={col} strokeWidth={isHit ? 1.2 : 2}/>
            {dot.isBarrel ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="bold" fill="url(#sscFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            ) : dot.exitVelo !== null && dot.exitVelo >= 95 ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fill={isHit ? '#fff' : col} fontWeight="bold">🔥</text>
            ) : null}
          </g>
        );
      })}
      {hitDots.length === 0 && <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No balls in play</text>}
      {(() => { const ly=474, lx=250-107; return (<>
        <circle cx={lx+5} cy={ly-4} r="4" fill="#888" opacity="0.88"/>
        <text x={lx+13} y={ly} fontSize="10.5" fill="#000">hit</text>
        <circle cx={lx+48} cy={ly-4} r="4" fill="none" stroke="#888" strokeWidth="2"/>
        <text x={lx+56} y={ly} fontSize="10.5" fill="#000">out</text>
        <text x={lx+95} y={ly} fontSize="10.5" fontWeight="bold" fill="url(#sscFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
        <text x={lx+106} y={ly} fontSize="10.5" fill="#000">barrel</text>
        <text x={lx+163} y={ly} fontSize="10.5">🔥</text>
        <text x={lx+175} y={ly} fontSize="10.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
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

          {/* BOTTOM ROW: zone chart + spray chart */}
          {!loading && (data?.rawDots?.length ?? 0) > 0 && (
            <div className="flex gap-4 items-start justify-center mt-0">
              <div className="flex flex-col items-center gap-2">
                <HitterZoneChart
                  rawDots={data!.rawDots}
                  heightIn={data?.playerHeight ? (() => {
                    const m = data.playerHeight!.match(/(\d+)'\s*(\d+)/);
                    return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : undefined;
                  })() : undefined}
                />
                <SprayChart
                  hitDots={data!.hitDots}
                  batSide={data?.playerBatSide}
                  playerImageUrl={currentImage}
                />
              </div>
            </div>
          )}
          {loading && (
            <div className="flex gap-4 items-start justify-center mt-0">
              <div className="flex flex-col items-center gap-2">
                <div className="w-[280px] h-[280px] bg-[#171b24]" />
                <div className="w-[280px] h-[280px] bg-[#171b24]" />
              </div>
            </div>
          )}

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

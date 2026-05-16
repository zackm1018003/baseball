'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SeasonStats {
  games: number; pa: number; ab: number; h: number; hr: number; rbi: number;
  bb: number; k: number; doubles: number; triples: number; sb: number;
  avg: string; obp: string; slg: string; ops: string;
}

interface BarrelStats {
  barrels: number; barrelPct: number | null;
  hardHit95: number; maxEv: number | null; avgEv: number | null; bip: number;
}

interface BarrelEvent {
  date: string; opponent: string; pitcherName: string; result: string;
  ev: number; la: number; distance: number | null;
  hitX: number | null; hitY: number | null; pitchType: string | null; gamePk: number;
}

interface BIPEvent {
  result: string; ev: number; la: number;
  hitX: number | null; hitY: number | null; distance: number | null;
  trajectory: string | null; pitchType: string | null; isBarrel: boolean;
}

interface PlayerData {
  batterId: number; playerName: string; teamAbbr?: string; league: string; season: string;
  bio: { height?: string; weight?: number; birthDate?: string; batSide?: string; pitchHand?: string };
  seasonStats: SeasonStats;
  barrelStats: BarrelStats;
  barrelEvents: BarrelEvent[];
  allBIP: BIPEvent[];
}

// ─── Pitch colors ─────────────────────────────────────────────────────────────

const PITCH_COLORS: Record<string, string> = {
  'Four-Seam Fastball': '#D22D49', '4-Seam Fastball': '#D22D49',
  'Sinker': '#C75B12', 'Cutter': '#933F2C',
  'Changeup': '#3BBB38', 'Splitter': '#1A8B6E',
  'Curveball': '#00D1ED', 'Knuckle Curve': '#6236CD',
  'Slider': '#EFE514', 'Sweeper': '#FF6D00', 'Slurve': '#3B44CE',
  'FF': '#D22D49', 'SI': '#C75B12', 'FC': '#933F2C',
  'CH': '#3BBB38', 'FS': '#1A8B6E', 'CU': '#00D1ED',
  'KC': '#6236CD', 'SL': '#EFE514', 'ST': '#FF6D00', 'SV': '#3B44CE',
};

function pitchColor(type: string | null): string {
  if (!type) return '#888';
  return PITCH_COLORS[type] || '#888';
}

// ─── Spray Chart ──────────────────────────────────────────────────────────────

function SeasonSprayChart({ bip, batSide, playerImageUrl }: {
  bip: BIPEvent[]; batSide?: string; playerImageUrl?: string;
}) {
  const HOME_X = 250, HOME_Y = 450, FT_TO_SVG = 0.6512, SCALE = 1.65;
  const RF_CORNER = { x: 402, y: 298 }, LF_CORNER = { x: 98, y: 298 };
  const RF_TOP = { x: 342, y: 220 }, LF_TOP = { x: 158, y: 220 };

  const toSvg = (hcX: number, hcY: number, hitDist?: number | null) => {
    const dx = hcX - 125, dy = 208 - hcY;
    const r = Math.sqrt(dx * dx + dy * dy);
    if (hitDist && hitDist > 0 && r > 0) {
      const svgDist = hitDist * FT_TO_SVG;
      return { x: HOME_X + (dx / r) * svgDist, y: HOME_Y - (dy / r) * svgDist };
    }
    return { x: HOME_X + dx * SCALE, y: HOME_Y + (hcY - 208) * SCALE };
  };

  const hits = bip.filter(d => ['single','double','triple','home run'].some(k => d.result.toLowerCase().includes(k)));
  const outs = bip.filter(d => !['single','double','triple','home run'].some(k => d.result.toLowerCase().includes(k)));

  return (
    <svg width={300} height={300} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="scSeasonFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/>
          <stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Season Spray Chart</text>
      <polygon
        points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`}
        fill="#f5f5f5"/>
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <text x={RF_CORNER.x-28} y={RF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={181} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x+28} y={LF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={RF_TOP.x+2}  y={RF_TOP.y-6}  fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <text x={LF_TOP.x-2}  y={LF_TOP.y-6}  fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <path
        d={`M ${RF_CORNER.x} ${RF_CORNER.y} L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1 L 250 186 L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5 L ${LF_CORNER.x} ${LF_CORNER.y}`}
        fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>
      {[{L:0,ox:341.9,oy:358.1,ix:329.9,iy:370.0,lx:354.6,ly:349.1},{L:45,ox:304.9,oy:332.2,ix:297.8,iy:347.8,lx:312.4,ly:319.5},{L:90,ox:250.0,oy:320.0,ix:250.0,iy:337.0,lx:250.0,ly:306.5},{L:135,ox:195.1,oy:332.2,ix:202.2,iy:347.8,lx:187.6,ly:319.5},{L:180,ox:158.1,oy:358.1,ix:170.1,iy:370.0,lx:145.4,ly:349.1}].map(({L,ox,oy,ix,iy,lx,ly}) => (
        <g key={L}>
          <line x1={ox} y1={oy} x2={ix} y2={iy} stroke="#000" strokeWidth={L===90?1.4:1}/>
          <text x={lx} y={ly} fontSize={L===90?9:8} fontWeight={L===90?'bold':undefined} textAnchor="middle" fill="#000">{90-L}</text>
        </g>
      ))}
      {/* Diamond */}
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

      {/* Out dots first (underneath) */}
      {outs.filter(d => d.hitX != null && d.hitY != null).map((d, i) => {
        const { x, y } = toSvg(d.hitX!, d.hitY!, d.distance);
        const col = pitchColor(d.pitchType);
        return (
          <circle key={`out-${i}`} cx={x} cy={y} r={5}
            fill="none" stroke={col} strokeWidth={1.5} opacity={0.65}/>
        );
      })}
      {/* Hit dots on top */}
      {hits.filter(d => d.hitX != null && d.hitY != null).map((d, i) => {
        const { x, y } = toSvg(d.hitX!, d.hitY!, d.distance);
        const col = pitchColor(d.pitchType);
        return (
          <g key={`hit-${i}`}>
            <circle cx={x} cy={y} r={5} fill={col} stroke="#000" strokeWidth={0.6} opacity={0.85}/>
            {d.isBarrel && (
              <text x={x} y={y+3} textAnchor="middle" fontSize="7" fontWeight="bold"
                fill="url(#scSeasonFire)" stroke="#000" strokeWidth="1.5" strokeLinejoin="round" paintOrder="stroke">B</text>
            )}
          </g>
        );
      })}

      {bip.filter(d => d.hitX != null && d.hitY != null).length === 0 && (
        <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No batted ball data</text>
      )}

      {/* Legend */}
      {(() => {
        const ly = 474, lx = 250 - 107;
        return <>
          <circle cx={lx+5}   cy={ly-4} r="4" fill="#888" opacity="0.88"/>
          <text x={lx+13}  y={ly} fontSize="10.5" fill="#000">hit</text>
          <circle cx={lx+48}  cy={ly-4} r="4" fill="none" stroke="#888" strokeWidth="2"/>
          <text x={lx+56}  y={ly} fontSize="10.5" fill="#000">out</text>
          <text x={lx+95}  y={ly} fontSize="10.5" fontWeight="bold"
            fill="url(#scSeasonFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
          <text x={lx+106} y={ly} fontSize="10.5" fill="#000">barrel</text>
        </>;
      })()}
    </svg>
  );
}

// ─── Barrel Events Panel ──────────────────────────────────────────────────────

function BarrelEventsPanel({ events, date, batterId, league }: {
  events: BarrelEvent[]; date?: string; batterId: number; league: string;
}) {
  if (events.length === 0) {
    return (
      <div className="bg-bone p-4 flex items-center justify-center min-h-[80px]">
        <p className="text-ink-4 text-xs text-center">No barrel events with tracking data found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {events.map((ev, i) => {
        const col = pitchColor(ev.pitchType);
        const isHit = ['single','double','triple','home run'].some(k => ev.result.toLowerCase().includes(k));
        return (
          <div key={i} className="bg-bone px-3 py-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-bold text-ink-4">{ev.date}</span>
              <span className="text-[9px] font-bold text-orange-400">🛢️ BARREL</span>
              <span className={`text-[9px] font-bold px-1 leading-4 ${isHit ? 'bg-green-800 text-green-200' : 'bg-red-900 text-red-300'}`}>
                {ev.result}
              </span>
              <span className="text-[9px] text-ink-3 truncate">vs {ev.opponent}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {ev.pitchType && (
                <span className="rounded px-1 text-[9px] font-bold text-ink" style={{ backgroundColor: col }}>
                  {ev.pitchType}
                </span>
              )}
              <span className="text-[10px] text-ink-3">{ev.pitcherName}</span>
            </div>
            <div className="flex gap-3 mt-1">
              <span className="text-yellow-400 font-semibold text-[10px]">{ev.ev.toFixed(1)} <span className="text-ink-4 font-normal">ev</span></span>
              <span className="text-yellow-400 font-semibold text-[10px]">{ev.la.toFixed(0)}° <span className="text-ink-4 font-normal">la</span></span>
              {ev.distance && <span className="text-yellow-400 font-semibold text-[10px]">{ev.distance} <span className="text-ink-4 font-normal">ft</span></span>}
              <a
                href={`/fcl/player?batterId=${batterId}&gamePk=${ev.gamePk}&date=${ev.date}&league=${league}`}
                target="_blank"
                className="ml-auto text-[9px] text-sky-400 hover:text-sky-300"
              >Game Card ↗</a>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function SeasonCardInner() {
  const params    = useSearchParams();
  const batterId  = Number(params.get('batterId') ?? '0');
  const league    = (params.get('league') ?? 'rookie').toLowerCase();
  const season    = params.get('season') ?? String(new Date().getFullYear());

  const [data, setData]         = useState<PlayerData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [imageError, setImgErr] = useState(0);

  useEffect(() => {
    if (!batterId) return;
    setLoading(true);
    fetch(`/api/fcl-player-season?batterId=${batterId}&league=${league}&season=${season}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [batterId, league, season]);

  function calcAge(bd: string | null | undefined): number | null {
    if (!bd) return null;
    const b = new Date(bd), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() - b.getMonth() < 0 || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }

  const imageSrc    = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${batterId}/headshot/silo/current`;
  const imgFallback = `https://img.mlb.com/headshots/current/60x60/${batterId}@2x.jpg`;
  const currentImage = imageError === 0 ? imageSrc : imgFallback;

  if (loading) return (
    <div className="min-h-screen bg-page flex flex-col items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent animate-spin"/>
      <span className="text-ink-3 text-sm">Loading season data… this may take a moment</span>
    </div>
  );
  if (error) return <div className="min-h-screen bg-page p-6 text-red-400 text-sm">{error}</div>;
  if (!data) return <div className="min-h-screen bg-page p-6 text-ink-4 text-sm">No data.</div>;

  const { seasonStats: ss, barrelStats: bs, barrelEvents, allBIP, bio } = data;
  const age = calcAge(bio.birthDate);
  const bioParts: string[] = [];
  if (bio.height) bioParts.push(bio.height);
  if (bio.weight) bioParts.push(`${bio.weight} lbs`);
  if (age != null) bioParts.push(`Age ${age}`);
  if (bio.batSide) bioParts.push(`Bats ${bio.batSide}`);

  const leagueLabel = league === 'rookie' ? 'FCL/ACL' : league.toUpperCase();
  const teamLogoUrl = getMLBTeamLogoUrl(data.teamAbbr);

  // rate helper
  const fmt = (v: string) => v.startsWith('0.') ? v.slice(1) : v;

  const statRows = [
    [
      { l: 'G',    v: String(ss.games) },
      { l: 'PA',   v: String(ss.pa) },
      { l: 'AB',   v: String(ss.ab) },
      { l: 'H',    v: String(ss.h) },
      { l: 'HR',   v: String(ss.hr) },
      { l: 'RBI',  v: String(ss.rbi) },
    ],
    [
      { l: 'BB',  v: String(ss.bb) },
      { l: 'K',   v: String(ss.k) },
      { l: '2B',  v: String(ss.doubles) },
      { l: '3B',  v: String(ss.triples) },
      { l: 'SB',  v: String(ss.sb) },
      { l: 'AVG', v: fmt(ss.avg) },
    ],
    [
      { l: 'OBP',    v: fmt(ss.obp) },
      { l: 'SLG',    v: fmt(ss.slg) },
      { l: 'OPS',    v: fmt(ss.ops) },
      { l: 'Brls',   v: String(bs.barrels) },
      { l: 'BBL%',   v: bs.barrelPct != null ? bs.barrelPct.toFixed(1) + '%' : '—' },
      { l: '95+',    v: String(bs.hardHit95) },
    ],
    [
      { l: 'Max EV', v: bs.maxEv != null ? bs.maxEv.toFixed(1) : '—' },
      { l: 'Avg EV', v: bs.avgEv != null ? bs.avgEv.toFixed(1) : '—' },
      { l: 'BIP',    v: String(bs.bip) },
      { l: '',       v: '' },
      { l: '',       v: '' },
      { l: '',       v: '' },
    ],
  ];

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3 flex items-center gap-4">
          <Link href="/barrels" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">← Barrel Leaderboard</Link>
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Home</Link>
        </div>
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>
        <div className="flex justify-center mb-6">
          <div className="bg-page p-6 inline-block border border-ink/30">

            {/* TOP ROW */}
            <div className="flex gap-4 items-start mb-4">

              {/* LEFT: photo + attribution */}
              <div className="flex-shrink-0 flex flex-col items-center w-[220px]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage} alt={data.playerName}
                  className="h-auto max-w-[165px] block mx-auto"
                  onError={() => setImgErr(e => Math.min(e + 1, 1))}
                />
                <div className="mt-1.5 text-center">
                  <div className="text-[10px] font-semibold text-blue-400 tracking-wide">By @Piratefan003</div>
                  <div className="text-[8.5px] text-ink-4 leading-tight mt-0.5">
                    Data: MLB Stats API<br/>Baseball Savant · Trackman
                  </div>
                </div>
              </div>

              {/* RIGHT: name / bio / stat grid */}
              <div className="flex flex-col items-center flex-1">
                <div className="flex flex-col items-center mb-3">
                  <div className="flex items-center gap-2 mb-0.5">
                    {teamLogoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={teamLogoUrl} alt={data.teamAbbr ?? ''} className="h-8 w-8 object-contain flex-shrink-0" />
                    )}
                    <h1 className="text-2xl font-bold">{data.playerName}</h1>
                  </div>
                  {bioParts.length > 0 && (
                    <p className="text-sm text-ink-2 mb-1">{bioParts.join(' • ')}</p>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-3 mb-2">
                    <span className="font-bold text-ink">{leagueLabel}</span>
                    <span>·</span>
                    <span className="font-bold text-ink">{season} Season</span>
                    <span>·</span>
                    <span>{ss.games} Games</span>
                  </div>

                  {/* Stat grid */}
                  <div className="border border-ink/20">
                    {statRows.map((row, ri) => (
                      <div key={ri} className={`grid grid-cols-6 divide-x divide-[#28304e] ${ri > 0 ? 'border-t border-ink/20' : ''}`}>
                        {row.map((s, si) => (
                          <div key={si} className="text-center px-2 py-1.5 min-w-[46px]">
                            <div className="text-[9px] text-ink-4 uppercase tracking-wide">{s.l}</div>
                            <div className={`text-sm font-bold tabular-nums ${
                              s.l === 'Brls' && Number(s.v) > 0 ? 'text-orange-400' :
                              s.l === 'OPS'  ? 'text-accent' : ''
                            }`}>{s.v || '—'}</div>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* BOTTOM ROW */}
            <div className="flex gap-4 items-start">
              {/* Barrel events */}
              <div className="flex-shrink-0 w-[260px]">
                <div className="text-[10px] font-bold text-orange-400 uppercase tracking-widest mb-1 px-1">
                  🛢️ Barrel Events ({barrelEvents.length})
                </div>
                <BarrelEventsPanel
                  events={barrelEvents}
                  batterId={batterId}
                  league={league}
                />
              </div>

              {/* Spray chart */}
              <div className="flex flex-col items-center">
                <SeasonSprayChart
                  bip={allBIP}
                  batSide={bio.batSide}
                  playerImageUrl={currentImage}
                />
                <div className="mt-1 text-[9px] text-ink-4 text-center">
                  {allBIP.length} balls in play · colored by pitch type
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

export default function FCLPlayerSeasonPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-page flex flex-col items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-sky-400 border-t-transparent animate-spin"/>
        <span className="text-ink-3 text-sm">Loading…</span>
      </div>
    }>
      <SeasonCardInner />
    </Suspense>
  );
}

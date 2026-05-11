'use client';

import { useState, useEffect, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Pitch {
  pitchNumber:   number;
  pitchType:     string | null;
  pitchTypeCode: string | null;
  callCode:      string | null;
  callDesc:      string | null;
  isInPlay:      boolean;
  isBall:        boolean;
  isStrike:      boolean;
  startSpeed:    number | null;
  spinRate:      number | null;
  pX:            number | null;
  pZ:            number | null;
  szTop:         number | null;
  szBot:         number | null;
  launchSpeed:   number | null;
  launchAngle:   number | null;
  totalDistance: number | null;
  trajectory:    string | null;
  hitX:          number | null;
  hitY:          number | null;
}

interface Play {
  atBatIndex:    number;
  inning:        number;
  halfInning:    string;
  isTopInning:   boolean;
  event:         string;
  eventType:     string;
  description:   string;
  rbi:           number;
  isOut:         boolean;
  isScoringPlay: boolean;
  awayScore:     number;
  homeScore:     number;
  balls:         number;
  strikes:       number;
  outs:          number;
  batter:        { id: number; name: string };
  pitcher:       { id: number; name: string };
  batSide:       string;
  pitchHand:     string;
  pitches:       Pitch[];
  launchSpeed:   number | null;
  launchAngle:   number | null;
  totalDistance: number | null;
  trajectory:    string | null;
}

interface GameFeed {
  gamePk:     string;
  status:     string;
  inning:     number | null;
  halfInning: string | null;
  away:       { id: number; name: string; abbr: string; score: number };
  home:       { id: number; name: string; abbr: string; score: number };
  plays:      Play[];
  hasStatcast: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PITCH_COLORS: Record<string, string> = {
  FF: '#e63946', SI: '#f4a261', FC: '#e9c46a',
  SL: '#2a9d8f', CU: '#457b9d', CH: '#6a4c93',
  KC: '#8ecae6', FS: '#a8dadc', ST: '#06b6d4',
  SV: '#7c3aed', default: '#94a3b8',
};
function pitchColor(code: string | null) {
  if (!code) return PITCH_COLORS.default;
  return PITCH_COLORS[code] ?? PITCH_COLORS.default;
}

function evColor(ev: number): string {
  if (ev >= 100) return '#16a34a';
  if (ev >= 95)  return '#84cc16';
  if (ev >= 90)  return '#ca8a04';
  if (ev >= 80)  return '#f97316';
  return '#ef4444';
}

function eventColor(event: string): string {
  if (!event) return '#6b7280';
  const e = event.toLowerCase();
  if (e.includes('home run'))  return '#f59e0b';
  if (e.includes('triple'))    return '#10b981';
  if (e.includes('double'))    return '#3b82f6';
  if (e.includes('single'))    return '#22c55e';
  if (e.includes('walk') || e.includes('hit by pitch')) return '#8b5cf6';
  if (e.includes('strikeout')) return '#ef4444';
  if (e.includes('error'))     return '#f97316';
  return '#9ca3af';
}

function trajectoryLabel(t: string | null): string {
  if (!t) return '';
  const map: Record<string, string> = {
    ground_ball: 'GB', fly_ball: 'FB', line_drive: 'LD',
    popup: 'PU', bunt_grounder: 'Bunt',
  };
  return map[t] ?? t;
}

function isBarrel(ev: number | null, la: number | null): boolean {
  if (ev == null || la == null) return false;
  if (ev < 98) return false;
  if (la >= 26 && la <= 30) return ev >= 98;
  if (la >= 16 && la <= 50) return ev >= 98 + (la - 30) * 2;
  return false;
}

function computeStats(plays: Play[]) {
  let h = 0, ab = 0, hr = 0, rbi = 0, bb = 0, k = 0, doubles = 0, triples = 0, pa = 0;
  for (const p of plays) {
    const e = (p.event ?? '').toLowerCase();
    pa++;
    rbi += p.rbi ?? 0;
    if (e === 'single')       { h++; ab++; }
    else if (e === 'double')  { h++; ab++; doubles++; }
    else if (e === 'triple')  { h++; ab++; triples++; }
    else if (e === 'home run'){ h++; ab++; hr++; }
    else if (e.includes('strikeout')) { k++; ab++; }
    else if (e === 'walk' || e === 'intent walk' || e === 'hit by pitch') { bb++; }
    else if (!e.includes('sac') && !e.includes('interference')) { ab++; }
  }
  const avg = ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000';
  return { h, ab, hr, rbi, bb, k, doubles, triples, pa, avg };
}

// ─── Pitches Seen Zone Chart ──────────────────────────────────────────────────

const SZ_W = 200, SZ_H = 220, PAD = 28;

function xToSvg(px: number) { return PAD + ((px + 1.5) / 3.0) * (SZ_W - 2 * PAD); }
function zToSvg(pz: number) { return PAD + ((4.5 - pz) / 3.5) * (SZ_H - 2 * PAD); }

function PitchesSeenChart({ plays }: { plays: Play[] }) {
  const allPitches: (Pitch & { abIndex: number })[] = [];
  plays.forEach((play, abIdx) => {
    play.pitches.forEach(p => allPitches.push({ ...p, abIndex: abIdx + 1 }));
  });
  const withCoords = allPitches.filter(p => p.pX != null && p.pZ != null);

  const szTop = withCoords[0]?.szTop ?? 3.5;
  const szBot = withCoords[0]?.szBot ?? 1.6;
  const zoneLeft  = xToSvg(-0.708);
  const zoneRight = xToSvg(0.708);
  const zoneTop   = zToSvg(szTop);
  const zoneBot   = zToSvg(szBot);
  const thirdW = (zoneRight - zoneLeft) / 3;
  const thirdH = (zoneBot - zoneTop) / 3;

  return (
    <div>
      <svg width={SZ_W} height={SZ_H} style={{ background: '#0a0a0a', borderRadius: 10, display: 'block' }}>
        {/* Strike zone */}
        <rect x={zoneLeft} y={zoneTop} width={zoneRight - zoneLeft} height={zoneBot - zoneTop}
          fill="none" stroke="#3f3f46" strokeWidth={1.5} />
        {[1, 2].map(i => (
          <g key={i}>
            <line x1={zoneLeft + thirdW * i} y1={zoneTop} x2={zoneLeft + thirdW * i} y2={zoneBot} stroke="#27272a" strokeWidth={1} />
            <line x1={zoneLeft} y1={zoneTop + thirdH * i} x2={zoneRight} y2={zoneTop + thirdH * i} stroke="#27272a" strokeWidth={1} />
          </g>
        ))}
        {/* Home plate */}
        <rect x={xToSvg(-0.708)} y={SZ_H - PAD + 3} width={zoneRight - zoneLeft} height={5}
          fill="#27272a" rx={1} />

        {/* Pitches */}
        {withCoords.map((p, i) => {
          const cx = xToSvg(p.pX!);
          const cy = zToSvg(p.pZ!);
          const code = p.callCode ?? '';
          const barrel = isBarrel(p.launchSpeed, p.launchAngle);
          const highEv = (p.launchSpeed ?? 0) >= 95;

          // Determine symbol type
          const isWhiff  = code === 'S'; // swinging strike
          const isTake   = code === 'B' || code === 'C'; // ball or called strike
          const isFoul   = code === 'F';
          const isInPlay = p.isInPlay;

          if (barrel) {
            // Barrel: orange star shape (diamond)
            return (
              <g key={i}>
                <rect x={cx - 6} y={cy - 6} width={12} height={12} fill="#f97316"
                  transform={`rotate(45 ${cx} ${cy})`} />
                <text x={cx} y={cy + 4} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="bold">B</text>
              </g>
            );
          }
          if (highEv && isInPlay) {
            // 95+ev: hot pink ring
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={8} fill="#ec4899" fillOpacity={0.85} />
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="bold">
                  {p.abIndex}
                </text>
              </g>
            );
          }
          if (isWhiff) {
            // Whiff: red X
            return (
              <g key={i} stroke="#ef4444" strokeWidth={2}>
                <line x1={cx - 5} y1={cy - 5} x2={cx + 5} y2={cy + 5} />
                <line x1={cx + 5} y1={cy - 5} x2={cx - 5} y2={cy + 5} />
              </g>
            );
          }
          if (isTake) {
            // Take: hollow circle, blue=CS, gray=ball
            const col = code === 'C' ? '#60a5fa' : '#6b7280';
            return <circle key={i} cx={cx} cy={cy} r={6} fill="none" stroke={col} strokeWidth={1.5} />;
          }
          if (isFoul) {
            // Foul: small gray filled circle
            return <circle key={i} cx={cx} cy={cy} r={5} fill="#52525b" />;
          }
          if (isInPlay) {
            // Swing in play: filled circle colored by pitch type
            const col = pitchColor(p.pitchTypeCode);
            return (
              <g key={i}>
                <circle cx={cx} cy={cy} r={8} fill={col} fillOpacity={0.9} />
                <text x={cx} y={cy + 3} textAnchor="middle" fontSize={7} fill="#fff" fontWeight="bold">
                  {p.abIndex}
                </text>
              </g>
            );
          }
          // Other swing (no call code) — small dot
          return <circle key={i} cx={cx} cy={cy} r={4} fill="#94a3b8" fillOpacity={0.6} />;
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
        {[
          { label: 'swing', el: <circle r={4} fill="#94a3b8" /> },
          { label: 'take',  el: <circle r={4} fill="none" stroke="#6b7280" strokeWidth={1.5} /> },
          { label: 'CS',    el: <circle r={4} fill="none" stroke="#60a5fa" strokeWidth={1.5} /> },
          { label: 'whiff', el: <g stroke="#ef4444" strokeWidth={1.5}><line x1={-4} y1={-4} x2={4} y2={4} /><line x1={4} y1={-4} x2={-4} y2={4} /></g> },
          { label: 'foul',  el: <circle r={4} fill="#52525b" /> },
          { label: 'in play', el: <circle r={5} fill="#2a9d8f" /> },
          { label: 'barrel', el: <rect x={-5} y={-5} width={10} height={10} fill="#f97316" transform="rotate(45)" /> },
          { label: '95+ev', el: <circle r={4} fill="#ec4899" /> },
        ].map(({ label, el }) => (
          <div key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
            <svg width={12} height={12} viewBox="-6 -6 12 12"><g>{el}</g></svg>
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Spray Chart ─────────────────────────────────────────────────────────────
// MLB Gameday coordinate system: home plate ≈ (125, 203), CF ≈ (125, 25)

const SPRAY_W = 260, SPRAY_H = 240;
// Home plate in SVG coords
const HP_X = 130, HP_Y = 228;
// Scale: 178 Gameday units ≈ 400 ft, want ~190px
const SPRAY_SCALE = 1.07;

function gdToSvg(gx: number, gy: number): [number, number] {
  const dx = (gx - 125) * SPRAY_SCALE;
  const dy = (203 - gy) * SPRAY_SCALE;
  return [HP_X + dx, HP_Y - dy];
}

function SprayChart({ plays }: { plays: Play[] }) {
  const hits: { x: number; y: number; ev: number | null; la: number | null; event: string; barrel: boolean }[] = [];
  for (const play of plays) {
    const lastPitch = play.pitches[play.pitches.length - 1];
    if (!lastPitch?.isInPlay) continue;
    const gx = lastPitch.hitX;
    const gy = lastPitch.hitY;
    if (gx == null || gy == null) continue;
    const [sx, sy] = gdToSvg(gx, gy);
    hits.push({
      x: sx, y: sy,
      ev: play.launchSpeed,
      la: play.launchAngle,
      event: play.event ?? '',
      barrel: isBarrel(play.launchSpeed, play.launchAngle),
    });
  }

  if (hits.length === 0) return null;

  // Field arc lines (approximate Gameday coords)
  const arcPoints = (fromAngleDeg: number, toAngleDeg: number, radiusUnits: number) => {
    const pts: string[] = [];
    for (let a = fromAngleDeg; a <= toAngleDeg; a += 3) {
      const rad = (a * Math.PI) / 180;
      const gx = 125 + radiusUnits * Math.sin(rad);
      const gy = 203 - radiusUnits * Math.cos(rad);
      const [sx, sy] = gdToSvg(gx, gy);
      pts.push(`${sx},${sy}`);
    }
    return pts.join(' ');
  };

  return (
    <div>
      <svg width={SPRAY_W} height={SPRAY_H} style={{ background: '#0a0a0a', borderRadius: 10, display: 'block' }}>
        {/* Outfield wall ~375-400 ft arc */}
        <polyline points={arcPoints(-45, 45, 170)} fill="none" stroke="#27272a" strokeWidth={1.5} />
        {/* 325 ft arc */}
        <polyline points={arcPoints(-45, 45, 145)} fill="none" stroke="#1c1c1c" strokeWidth={1} />
        {/* Infield dirt circle ~95 ft */}
        <polyline points={arcPoints(-90, 90, 85)} fill="none" stroke="#1c1c1c" strokeWidth={1} />
        {/* Foul lines */}
        {[[-45], [45]].map(([ang], i) => {
          const rad = (ang * Math.PI) / 180;
          const [x2, y2] = gdToSvg(125 + 200 * Math.sin(rad), 203 - 200 * Math.cos(rad));
          return <line key={i} x1={HP_X} y1={HP_Y} x2={x2} y2={y2} stroke="#27272a" strokeWidth={1} />;
        })}
        {/* Bases */}
        {[
          [125, 203 - 90],           // 2nd base
          [125 + 63.6, 203 - 63.6],  // 1st
          [125 - 63.6, 203 - 63.6],  // 3rd
        ].map(([gx, gy], i) => {
          const [sx, sy] = gdToSvg(gx, gy);
          return <rect key={i} x={sx - 4} y={sy - 4} width={8} height={8}
            fill="#1e293b" stroke="#475569" strokeWidth={1} transform={`rotate(45 ${sx} ${sy})`} />;
        })}
        {/* Home plate */}
        <polygon points={`${HP_X},${HP_Y - 7} ${HP_X + 5},${HP_Y} ${HP_X + 5},${HP_Y + 4} ${HP_X - 5},${HP_Y + 4} ${HP_X - 5},${HP_Y}`}
          fill="#334155" stroke="#64748b" strokeWidth={1} />

        {/* Distance markers */}
        {[325, 375, 400].map(ft => {
          const units = ft / 2.26; // approx conversion
          const [sx, sy] = gdToSvg(125, 203 - units);
          return sy > 10 && sy < SPRAY_H - 10 ? (
            <text key={ft} x={sx} y={sy} textAnchor="middle" fontSize={8} fill="#374151">{ft}</text>
          ) : null;
        })}

        {/* Hit dots */}
        {hits.map((h, i) => {
          const col = h.barrel ? '#f97316'
            : (h.ev ?? 0) >= 95 ? '#ec4899'
            : eventColor(h.event);
          const isHit = !['out', 'strikeout', 'field out', 'force out', 'double play',
            'grounded into double play', 'pop out', 'fly out', 'lineout'].some(k => h.event.toLowerCase().includes(k));
          return (
            <g key={i}>
              <circle cx={h.x} cy={h.y} r={6} fill={col} fillOpacity={isHit ? 0.9 : 0.5}
                stroke={isHit ? '#fff' : 'none'} strokeWidth={0.8} />
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 justify-center">
        {[
          { label: 'hit',    col: '#22c55e', opacity: 0.9 },
          { label: 'out',    col: '#9ca3af', opacity: 0.5 },
          { label: 'barrel', col: '#f97316', opacity: 0.9 },
          { label: '95+ev',  col: '#ec4899', opacity: 0.9 },
        ].map(({ label, col, opacity }) => (
          <div key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: col, opacity }} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── At-Bat Card ─────────────────────────────────────────────────────────────

function AtBatCard({ play, idx }: { play: Play; idx: number }) {
  const [open, setOpen] = useState(true);
  const hasEv = play.launchSpeed != null;
  const resultBg = play.event?.toLowerCase().includes('strikeout') ? 'bg-red-900/30 border-red-800/40'
    : (play.event?.toLowerCase().includes('single') || play.event?.toLowerCase().includes('double')
       || play.event?.toLowerCase().includes('triple') || play.event?.toLowerCase().includes('home run'))
      ? 'bg-green-900/30 border-green-800/40'
      : 'bg-[#181818] border-[#222]';

  return (
    <div className={`border rounded-xl overflow-hidden mb-3 ${resultBg}`}>
      {/* Header */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/5 transition-colors"
      >
        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider w-8 flex-shrink-0">
          AB {idx + 1}
        </span>
        <span
          className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{ background: eventColor(play.event) + '33', color: eventColor(play.event), border: `1px solid ${eventColor(play.event)}55` }}
        >
          {play.event}
        </span>
        <span className="text-xs text-gray-400 flex-1 truncate">
          {play.pitcher?.name} · {play.pitchHand}HP
        </span>
        <span className="text-xs text-gray-600">
          {play.isTopInning ? '▲' : '▼'}{play.inning} · {play.outs} out{play.outs !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-600 ml-1">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4">
          {/* Stat result */}
          {hasEv && (
            <div className="flex gap-3 mb-3 flex-wrap">
              <div className="text-center bg-[#111] rounded-lg px-3 py-2 min-w-[60px]">
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">EV</div>
                <div className="text-base font-bold font-mono" style={{ color: evColor(play.launchSpeed!) }}>
                  {play.launchSpeed?.toFixed(1)}
                </div>
              </div>
              {play.totalDistance != null && (
                <div className="text-center bg-[#111] rounded-lg px-3 py-2 min-w-[60px]">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Dist</div>
                  <div className="text-base font-bold font-mono text-gray-200">{play.totalDistance} ft</div>
                </div>
              )}
              {play.launchAngle != null && (
                <div className="text-center bg-[#111] rounded-lg px-3 py-2 min-w-[60px]">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">LA</div>
                  <div className="text-base font-bold font-mono text-gray-200">{play.launchAngle}°</div>
                </div>
              )}
              {play.trajectory && (
                <div className="text-center bg-[#111] rounded-lg px-3 py-2">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide">Type</div>
                  <div className="text-sm font-bold text-gray-300">{trajectoryLabel(play.trajectory)}</div>
                </div>
              )}
            </div>
          )}

          {/* Pitch sequence */}
          {play.pitches.length > 0 && (
            <div className="space-y-1.5">
              {play.pitches.map(p => {
                const isLast = p.pitchNumber === play.pitches[play.pitches.length - 1].pitchNumber;
                const callIcon = p.callCode === 'B' ? '○' : p.callCode === 'C' ? '◎' : p.callCode === 'S' ? '✕' : p.callCode === 'F' ? '△' : p.isInPlay ? '●' : '·';
                const callColor = p.isBall ? '#6b7280' : p.callCode === 'C' ? '#60a5fa' : p.callCode === 'S' ? '#ef4444' : p.callCode === 'F' ? '#94a3b8' : p.isInPlay ? evColor(p.launchSpeed ?? 80) : '#6b7280';
                return (
                  <div key={p.pitchNumber} className={`flex items-center gap-2 text-xs ${isLast ? 'opacity-100' : 'opacity-70'}`}>
                    {/* Pitch type badge */}
                    <div
                      className="w-7 text-center text-[10px] font-bold rounded px-1 py-0.5 flex-shrink-0"
                      style={{ background: pitchColor(p.pitchTypeCode) + '33', color: pitchColor(p.pitchTypeCode), border: `1px solid ${pitchColor(p.pitchTypeCode)}55` }}
                    >
                      {p.pitchTypeCode ?? '?'}
                    </div>
                    {/* Speed */}
                    <span className="text-gray-300 font-mono w-12 flex-shrink-0">
                      {p.startSpeed ? `${p.startSpeed.toFixed(1)}` : '—'}
                    </span>
                    {/* Call */}
                    <span className="font-bold w-4 text-center flex-shrink-0" style={{ color: callColor }}>{callIcon}</span>
                    <span className="text-gray-500 flex-1 truncate">{p.callDesc ?? '—'}</span>
                    {/* Hit data */}
                    {p.isInPlay && p.launchSpeed != null && (
                      <span className="font-mono text-[10px] flex-shrink-0" style={{ color: evColor(p.launchSpeed) }}>
                        {p.launchSpeed.toFixed(0)} mph EV
                        {p.launchAngle != null && ` · ${p.launchAngle}°`}
                        {p.totalDistance != null && ` · ${p.totalDistance} ft`}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Description */}
          <p className="text-gray-600 text-xs mt-2 leading-snug">{play.description}</p>
        </div>
      )}
    </div>
  );
}

// ─── Main Inner Component ─────────────────────────────────────────────────────

function PlayerPageInner() {
  const params = useSearchParams();
  const gamePk   = params.get('gamePk') ?? '';
  const batterId = Number(params.get('batterId') ?? '0');
  const date     = params.get('date') ?? '';
  const league   = (params.get('league') ?? 'fcl').toUpperCase();

  const [feed, setFeed]       = useState<GameFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!gamePk) return;
    setLoading(true);
    fetch(`/api/fcl-game?mode=game&gamePk=${gamePk}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFeed(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gamePk]);

  const plays = useMemo(() => {
    if (!feed) return [];
    return feed.plays.filter(p => p.batter?.id === batterId);
  }, [feed, batterId]);

  const stats = useMemo(() => computeStats(plays), [plays]);

  const playerName = plays[0]?.batter?.name ?? `Player #${batterId}`;
  const batSide    = plays[0]?.batSide ?? '';

  // Determine opponent (are we home or away?)
  // We can't tell without knowing which team the batter is on — use both
  const awayAbbr = feed?.away?.abbr ?? '???';
  const homeAbbr = feed?.home?.abbr ?? '???';
  const matchup  = `${awayAbbr} @ ${homeAbbr}`;

  const photoUrl = `https://img.mlb.com/headshots/current/60x60/${batterId}@2x.jpg`;

  const hasSpray = plays.some(p => {
    const lp = p.pitches[p.pitches.length - 1];
    return lp?.isInPlay && lp.hitX != null;
  });

  if (loading) return (
    <div className="min-h-screen bg-[#0c0c0c] text-white flex items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
      <span className="text-gray-500 text-sm">Loading game data…</span>
    </div>
  );
  if (error) return (
    <div className="min-h-screen bg-[#0c0c0c] text-white p-6 text-red-400">{error}</div>
  );
  if (!feed || plays.length === 0) return (
    <div className="min-h-screen bg-[#0c0c0c] text-white p-6 text-gray-500">
      No at-bats found for this player in this game.
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <div className="max-w-lg mx-auto px-4 py-6">

        {/* Back */}
        <div className="mb-5">
          <Link href="/" className="text-gray-500 hover:text-white text-sm">← Daily Hitters</Link>
        </div>

        {/* Player Header */}
        <div className="bg-[#141414] border border-[#222] rounded-2xl p-5 mb-4 flex gap-4 items-start">
          <img
            src={photoUrl}
            alt={playerName}
            className="w-20 h-20 rounded-xl object-cover bg-[#1e1e1e] flex-shrink-0"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-white truncate">{playerName}</h1>
            <div className="text-xs text-gray-500 mt-0.5">
              {league} · {batSide ? `Bats ${batSide}` : ''} · {matchup}
            </div>
            <div className="text-xs text-gray-600 mt-0.5">{date}</div>
            <div className="mt-2 text-xs text-gray-400">
              {feed.status}
              {feed.inning != null && ` · ${feed.halfInning} ${feed.inning}`}
              {feed.hasStatcast && <span className="ml-2 text-green-500">● Statcast</span>}
            </div>
          </div>
        </div>

        {/* Stat Line */}
        <div className="bg-[#141414] border border-[#222] rounded-2xl p-4 mb-4">
          <div className="grid grid-cols-6 gap-2 text-center mb-2">
            {[
              { label: 'AB', val: stats.ab },
              { label: 'H',  val: stats.h  },
              { label: 'HR', val: stats.hr },
              { label: 'RBI',val: stats.rbi},
              { label: 'BB', val: stats.bb },
              { label: 'K',  val: stats.k  },
            ].map(({ label, val }) => (
              <div key={label}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
                <div className={`text-lg font-bold font-mono ${
                  label === 'H' && val > 0 ? 'text-green-400'
                  : label === 'HR' && val > 0 ? 'text-amber-400'
                  : label === 'K' && val > 0 ? 'text-red-400'
                  : 'text-white'
                }`}>{val}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-4 gap-2 text-center border-t border-[#1e1e1e] pt-2">
            {[
              { label: '2B',  val: stats.doubles  },
              { label: '3B',  val: stats.triples  },
              { label: 'PA',  val: stats.pa       },
              { label: 'AVG', val: stats.avg      },
            ].map(({ label, val }) => (
              <div key={label}>
                <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
                <div className="text-sm font-bold font-mono text-gray-300">{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* At-Bat Breakdown */}
        <div className="mb-4">
          <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">At-Bat Breakdown</h2>
          {plays.map((play, idx) => (
            <AtBatCard key={play.atBatIndex} play={play} idx={idx} />
          ))}
        </div>

        {/* Pitches Seen Chart */}
        {plays.some(p => p.pitches.some(pt => pt.pX != null)) && (
          <div className="bg-[#141414] border border-[#222] rounded-2xl p-4 mb-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Pitches Seen</h2>
            <div className="flex justify-center">
              <PitchesSeenChart plays={plays} />
            </div>
          </div>
        )}

        {/* Spray Chart */}
        {hasSpray && (
          <div className="bg-[#141414] border border-[#222] rounded-2xl p-4 mb-4">
            <h2 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Spray Angle Chart</h2>
            <div className="flex justify-center">
              <SprayChart plays={plays} />
            </div>
          </div>
        )}

        {/* Data credit */}
        <div className="text-center text-[10px] text-gray-700 mt-6">
          Data: MLB Stats API · {league} Gameday
        </div>

      </div>
    </div>
  );
}

// ─── Page Export (Suspense required for useSearchParams) ──────────────────────

export default function FCLPlayerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0c0c0c] flex items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-white/20 border-t-white/70 rounded-full animate-spin" />
        <span className="text-gray-500 text-sm">Loading…</span>
      </div>
    }>
      <PlayerPageInner />
    </Suspense>
  );
}

'use client';

import React, { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl, getMLBTeamColor } from '@/lib/mlb-team-logos';

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

// ─── Pitch colors (same as MLB daily card) ───────────────────────────────────

const PITCH_COLORS: Record<string, { color: string; bg: string; text: string }> = {
  '4-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
  'Four-Seam Fastball': { color: '#D22D49', bg: '#D22D49', text: '#fff' },
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

const CODE_TO_NAME: Record<string, string> = {
  FF: '4-Seam Fastball', SI: 'Sinker', FC: 'Cutter',
  CH: 'Changeup', FS: 'Splitter', CU: 'Curveball',
  KC: 'Knuckle Curve', SL: 'Slider', ST: 'Sweeper',
  SV: 'Slurve', SW: 'Sweeper', FT: 'Sinker', CS: 'Curveball',
};

function resolvePitchName(name: string | null, code: string | null): string {
  if (name && PITCH_COLORS[name]) return name;
  if (code && CODE_TO_NAME[code]) return CODE_TO_NAME[code];
  return name ?? code ?? '?';
}

function pitchCol(name: string | null, code: string | null) {
  const n = resolvePitchName(name, code);
  return PITCH_COLORS[n] || { color: '#888', bg: '#888', text: '#fff' };
}

const PITCH_ABBREV: Record<string, string> = {
  '4-Seam Fastball': 'FF', 'Four-Seam Fastball': 'FF', 'Sinker': 'SI', 'Cutter': 'CT',
  'Changeup': 'CH', 'Curveball': 'CU', 'Slider': 'SL', 'Sweeper': 'SW',
  'Knuckle Curve': 'KC', 'Splitter': 'SP', 'Slurve': 'SV',
};

function pitchAbbrev(name: string | null, code: string | null): string {
  const n = resolvePitchName(name, code);
  return PITCH_ABBREV[n] || code || (name ? name.slice(0, 2).toUpperCase() : '??');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function cleanDesc(callDesc: string | null): string {
  if (!callDesc) return '—';
  const d = callDesc.toLowerCase();
  if (d.includes('swinging strike') || d.includes('foul tip')) return 'Whiff';
  if (d === 'called strike') return 'CS';
  if (d === 'ball' || d.includes('blocked ball') || d.includes('intentional ball')) return 'Ball';
  if (d.includes('foul')) return 'Foul';
  if (d.includes('in play')) return 'In Play';
  return callDesc;
}

function cleanResult(event: string): string {
  const map: Record<string, string> = {
    'Single': '1B', 'Double': '2B', 'Triple': '3B', 'Home Run': 'HR',
    'Strikeout': 'K', 'Strikeout Double Play': 'KDP',
    'Walk': 'BB', 'Intent Walk': 'IBB', 'Hit By Pitch': 'HBP',
    'Field Out': 'Out', 'Groundout': 'Out', 'Flyout': 'Out',
    'Lineout': 'Out', 'Pop Out': 'Out', 'Bunt Groundout': 'Out',
    'Grounded Into Double Play': 'GIDP', 'Double Play': 'DP',
    'Sac Fly': 'SF', 'Sac Bunt': 'SH',
    'Fielders Choice': 'FC', 'Fielders Choice Out': 'FC', 'Force Out': 'FC',
    'Catcher Interf': 'CI',
  };
  return map[event] || event;
}

function resultColor(event: string): string {
  const e = event.toLowerCase();
  if (['single','double','triple','home run'].some(k => e.includes(k))) return 'bg-green-700 text-green-200';
  if (['strikeout','out','double play','triple play','sac fly','sac bunt','fielders choice'].some(k => e.includes(k))) return 'bg-red-900 text-red-300';
  if (['walk','hit by pitch'].some(k => e.includes(k))) return 'bg-walk text-outcome-fg';
  return 'bg-bone text-ink-2';
}

function isBarrelCalc(ev: number | null, la: number | null): boolean {
  if (ev == null || la == null || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
}

function computeStats(plays: Play[]) {
  let h = 0, ab = 0, hr = 0, rbi = 0, bb = 0, k = 0, doubles = 0, triples = 0, pa = 0;
  const evList: number[] = [];
  for (const p of plays) {
    const e = (p.event ?? '').toLowerCase();
    pa++;
    rbi += p.rbi ?? 0;
    if (e === 'single')          { h++; ab++; }
    else if (e === 'double')     { h++; ab++; doubles++; }
    else if (e === 'triple')     { h++; ab++; triples++; }
    else if (e === 'home run')   { h++; ab++; hr++; }
    else if (e.includes('strikeout'))  { k++; ab++; }
    else if (e === 'walk' || e === 'intent walk' || e === 'hit by pitch') { bb++; }
    else if (!e.includes('sac') && !e.includes('interference')) { ab++; }
    if (p.launchSpeed != null && p.launchSpeed > 0) evList.push(p.launchSpeed);
  }
  const allPitches = plays.flatMap(p => p.pitches);
  const barrels = allPitches.filter(p => isBarrelCalc(p.launchSpeed, p.launchAngle)).length;
  const sorted = [...evList].sort((a, b) => b - a); // descending
  const avgEv = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : null;
  const maxEv = sorted.length > 0 ? sorted[0] : null;
  // EV90 = average of top 10% hardest-hit balls (≥2 BIP to show anything)
  const top10Count = Math.max(1, Math.round(sorted.length * 0.1));
  const ev90  = sorted.length >= 2
    ? Math.round((sorted.slice(0, top10Count).reduce((a, b) => a + b, 0) / top10Count) * 10) / 10
    : null;
  return { h, ab, hr, rbi, bb, k, doubles, triples, pa, barrels, avgEv, maxEv, ev90 };
}

// ─── Zone Chart (exact match to MLB daily card) ───────────────────────────────

interface RawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null;
}

// ─── EV Distribution Chart ───────────────────────────────────────────────────

function EvDistChart({
  seasonEvs,
  todayBips,
  avgEv,
  ev90,
  year,
}: {
  seasonEvs: number[];
  todayBips: { ev: number; isBarrel: boolean }[];
  avgEv: number | null;
  ev90?: number | null;
  year?: string;
}) {
  const W = 280, H = 280;
  // Margins — PB enlarged to fit stat labels below x-axis
  const PL = 36, PR = 10, PT = 32, PB = 56;
  const PW = W - PL - PR;   // 234
  const PH = H - PT - PB;   // 210

  const XMIN = 60, XMAX = 120;  // fixed axis range always shown
  const curveMax = seasonEvs.length > 0 ? Math.max(...seasonEvs) : XMAX; // curve stops here
  const toX = (ev: number) => PL + Math.max(0, Math.min(1, (ev - XMIN) / (XMAX - XMIN))) * PW;

  const evColor = (ev: number) => {
    if (ev >= 110) return '#ef4444';
    if (ev >= 100) return '#f97316';
    if (ev >= 95)  return '#f59e0b';
    return '#3b82f6';
  };

  // Gaussian KDE
  const gauss = (u: number) => Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);

  let curvePts: string[] = [];
  let maxPct = 10;

  if (seasonEvs.length >= 2) {
    const n = seasonEvs.length;
    const mean = seasonEvs.reduce((a, b) => a + b, 0) / n;
    const std  = Math.sqrt(seasonEvs.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const bw   = Math.max(5, 1.06 * std * Math.pow(n, -0.2));

    const xPts: number[] = [];
    for (let x = XMIN; x <= XMAX; x += 0.5) xPts.push(x);
    if (xPts[xPts.length - 1] < XMAX) xPts.push(XMAX);

    const taperStart = curveMax - 2.5 * bw;

    const dens = xPts.map(x => {
      const sum = seasonEvs.reduce((acc, xi) => acc + gauss((x - xi) / bw), 0);
      let d = (sum / (n * bw)) * 100;
      // Smoothstep taper to 0 at curveMax so the curve curves down naturally
      if (x > taperStart) {
        const t = Math.max(0, (curveMax - x) / (curveMax - taperStart));
        d *= t * t * (3 - 2 * t);
      }
      return d;
    });

    const peak = Math.max(...dens);
    maxPct = Math.max(Math.ceil(peak * 1.25 / 2) * 2, 4);

    const toY = (pct: number) => PT + PH - (pct / maxPct) * PH;
    curvePts = xPts.map((x, i) => `${toX(x).toFixed(1)},${toY(dens[i]).toFixed(1)}`);
  }

  const toY = (pct: number) => PT + PH - (pct / maxPct) * PH;

  const yStep = maxPct <= 8 ? 2 : maxPct <= 20 ? 4 : 5;
  const yTicks: number[] = [];
  for (let v = 0; v <= maxPct; v += yStep) yTicks.push(v);

  const axisY = (PT + PH).toFixed(1);
  const fillPath = curvePts.length > 0
    ? `M ${toX(XMIN).toFixed(1)},${axisY} L ${curvePts.join(' L ')} L ${toX(XMAX).toFixed(1)},${axisY} Z`
    : '';
  // Extend stroke to XMAX so gradient colors are visible across full 60–120 mph league scale
  const linePath = curvePts.length > 0
    ? `M ${toX(XMIN).toFixed(1)},${axisY} L ${curvePts.join(' L ')} L ${toX(XMAX).toFixed(1)},${axisY}`
    : '';

  return (
    <svg width={W} height={H} style={{ background: '#f5f3ef', display: 'block' }}>
      <defs>
        {/* Diverging gradient: dark blue (low EV) → white (league avg ~87) → dark red (elite EV) */}
        <linearGradient id="evKdeGrad" x1={PL} y1="0" x2={PL + PW} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%"    stopColor="#1e3a8a"/>  {/* 60 mph */}
          <stop offset="25%"   stopColor="#3b82f6"/>  {/* 75 mph */}
          <stop offset="45%"   stopColor="#9ca3af"/>  {/* ~87 mph — league avg, light gray */}
          <stop offset="58%"   stopColor="#fca5a5"/>  {/* ~95 mph */}
          <stop offset="67%"   stopColor="#f97316"/>  {/* ~100 mph */}
          <stop offset="83%"   stopColor="#dc2626"/>  {/* ~110 mph */}
          <stop offset="100%"  stopColor="#7f1d1d"/>  {/* 120 mph */}
        </linearGradient>
        <linearGradient id="evFireDist" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#ff2200"/>
          <stop offset="50%"  stopColor="#ff8800"/>
          <stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>

      {/* Title */}
      <text x={W / 2} y={20} textAnchor="middle" fontSize={10} fontWeight="600"
        fill="#111827" fontFamily="system-ui,sans-serif">EV Distribution</text>

      {/* White plot area */}
      <rect x={PL} y={PT} width={PW} height={PH} fill="#ffffff" />

      {/* Horizontal grid lines */}
      {yTicks.map(v => (
        <line key={v} x1={PL} y1={toY(v)} x2={PL + PW} y2={toY(v)}
          stroke={v === 0 ? '#d1d5db' : '#e5e7eb'} strokeWidth={v === 0 ? 1 : 0.8}
          strokeDasharray={v === 0 ? undefined : '3,3'} />
      ))}

      {/* Filled KDE area — diverging gradient fill */}
      {fillPath && <path d={fillPath} fill="url(#evKdeGrad)" fillOpacity={0.55} />}
      {linePath && (
        <path d={linePath} fill="none" stroke="url(#evKdeGrad)" strokeWidth={2.5}
          strokeLinejoin="round" strokeLinecap="round" />
      )}

      {/* Avg reference line */}
      {avgEv != null && (
        <>
          <line x1={toX(avgEv)} y1={PT} x2={toX(avgEv)} y2={PT + PH}
            stroke="#6b7280" strokeWidth={1} strokeDasharray="4,2" strokeOpacity={0.5} />
          <text x={toX(avgEv)} y={PT - 3} textAnchor="middle" fontSize={7}
            fill="#6b7280" fontFamily="system-ui,sans-serif">avg</text>
        </>
      )}

      {/* Y-axis labels */}
      {yTicks.map(v => (
        <text key={v} x={PL - 4} y={toY(v) + 3} textAnchor="end" fontSize={7.5}
          fill="#9ca3af" fontFamily="system-ui,sans-serif">{v}%</text>
      ))}

      {/* Y-axis rotated label */}
      <text transform={`rotate(-90,10,${PT + PH / 2})`}
        x={0} y={PT + PH / 2 + 4} textAnchor="middle" fontSize={8}
        fill="#9ca3af" fontFamily="system-ui,sans-serif">BIPs</text>

      {/* X-axis ticks + labels */}
      {[60, 70, 80, 90, 100, 110, 120].map(t => (
        <g key={t}>
          <line x1={toX(t)} y1={PT + PH} x2={toX(t)} y2={PT + PH + 4}
            stroke="#d1d5db" strokeWidth={1} />
          <text x={toX(t)} y={PT + PH + 14} textAnchor="middle" fontSize={8}
            fill="#9ca3af" fontFamily="system-ui,sans-serif">{t}</text>
        </g>
      ))}

      {/* Key stat annotations below x-axis */}
      {(() => {
        type Annot = { x: number; label: string; val: string; color: string };
        const raw: (Annot | null)[] = [
          avgEv != null        ? { x: avgEv,    label: 'AVG',  val: avgEv.toFixed(1),    color: '#6b7280' } : null,
          ev90  != null        ? { x: ev90,     label: 'EV90', val: ev90.toFixed(1),     color: '#f59e0b' } : null,
          seasonEvs.length > 0 ? { x: curveMax, label: 'MAX',  val: curveMax.toFixed(1), color: '#f97316' } : null,
        ];
        const sorted = raw.filter((a): a is Annot => a !== null).sort((a, b) => a.x - b.x);
        // If EV90 and MAX are too close, drop EV90
        const annots = sorted.filter((a, i) => {
          const next = sorted[i + 1];
          return !(a.label === 'EV90' && next && (toX(next.x) - toX(a.x)) < 30);
        });
        const BASE = PT + PH + 22;
        const ROW_H = 16;
        return annots.map((a, i) => {
          const ax = toX(a.x);
          const row = 0;
          return (
            <g key={a.label}>
              <line x1={ax} y1={PT + PH} x2={ax} y2={PT + PH + 7}
                stroke={a.color} strokeWidth={1.5} />
              <text x={ax} y={BASE + row * ROW_H} textAnchor="middle" fontSize={7}
                fill={a.color} fontWeight="600" fontFamily="system-ui,sans-serif">{a.label}</text>
              <text x={ax} y={BASE + row * ROW_H + 11} textAnchor="middle" fontSize={8.5}
                fill={a.color} fontWeight="700" fontFamily="system-ui,sans-serif">{a.val}</text>
            </g>
          );
        });
      })()}

      {/* Legend */}
      {seasonEvs.length > 0 && (
        <g>
          <rect x={PL + 6} y={PT + 6} width={100} height={16} rx={2}
            fill="white" fillOpacity={0.85} />
          <rect x={PL + 10} y={PT + 10} width={8} height={8} rx={1}
            fill="url(#evKdeGrad)" fillOpacity={0.9} />
          <text x={PL + 22} y={PT + 18} fontSize={8} fill="#374151"
            fontFamily="system-ui,sans-serif">
            {year ?? ''} · {seasonEvs.length} BIP
          </text>
        </g>
      )}

      {/* Today's BIPs — rendered last so they appear above legend and all other elements */}
      {todayBips.map((b, i) => {
        const x = toX(b.ev);
        const col = evColor(b.ev);
        return (
          <g key={i}>
            <line x1={x} y1={PT + 14} x2={x} y2={PT + PH}
              stroke="white" strokeWidth={4} strokeOpacity={0.65} />
            <line x1={x} y1={PT + 14} x2={x} y2={PT + PH}
              stroke={col} strokeWidth={2} />
            <rect x={x - 17} y={PT + 2} width={34} height={12} rx={2}
              fill="white" fillOpacity={0.9} />
            <text x={x} y={PT + 11} textAnchor="middle" fontSize={7.5}
              fill={col} fontWeight="700" fontFamily="system-ui,sans-serif">
              {b.ev.toFixed(1)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function HitterZoneChart({ rawDots }: { rawDots: RawDot[] }) {
  const size = 280;
  const xMin = -1.8, xMax = 1.8, zMin = 0.5, zMax = 4.5, pad = 28;
  const w = size - pad * 2, h = size - pad * 2;
  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;
  const szLeft = toSvgX(-0.708), szRight = toSvgX(0.708);
  const szTop  = toSvgY(3.5),    szBot   = toSvgY(1.6);
  const thirdW = (szRight - szLeft) / 3, thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0) {
    return (
      <div style={{ width: size, height: size }} className="bg-bone flex items-center justify-center">
        <p className="text-ink-4 text-xs text-center px-6">No Statcast data</p>
      </div>
    );
  }

  return (
    <svg width={size} height={size} style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="fclFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200" />
          <stop offset="50%" stopColor="#ff8800" />
          <stop offset="100%" stopColor="#ffdd00" />
        </linearGradient>
      </defs>
      <text x={size/2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">Pitches Seen</text>
      <rect x={szLeft} y={szTop} width={szRight - szLeft} height={szBot - szTop}
        fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2" />
      {[1,2].map(i => (
        <g key={i}>
          <line x1={szLeft+thirdW*i} y1={szTop} x2={szLeft+thirdW*i} y2={szBot} stroke="#00000033" strokeWidth="0.75"/>
          <line x1={szLeft} y1={szTop+thirdH*i} x2={szRight} y2={szTop+thirdH*i} stroke="#00000033" strokeWidth="0.75"/>
        </g>
      ))}

      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px), cy = toSvgY(dot.pz);
        const col = pitchCol(dot.pitchType, null).color;
        let visual: React.ReactNode;
        if (dot.isWhiff) {
          const s = 4;
          visual = <>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth={4} opacity="0.9"/>
            <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/>
            <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth={2.5} opacity="0.95"/>
          </>;
        } else if (dot.isBarrel) {
          visual = <>
            <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
              fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
            <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
              fill="url(#fclFire)" opacity="0.95">B</text>
          </>;
        } else if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95) {
          visual = <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" opacity="0.95">🔥</text>;
        } else if (dot.isTake) {
          visual = <circle cx={cx} cy={cy} r={3.5} fill="none" stroke={col} strokeWidth="1.5" opacity="0.75"/>;
        } else {
          visual = <circle cx={cx} cy={cy} r={3.5} fill={col} stroke="#000" strokeWidth="0.6" opacity="0.8"/>;
        }
        return <g key={i}>{visual}<circle cx={cx} cy={cy} r={9} fill="transparent"/></g>;
      })}

      {/* Legend */}
      {(() => {
        const lx = (size - 188) / 2;
        return <>
          <circle cx={lx+4}  cy={size-10} r="3" fill="#555" opacity="0.8"/>
          <text x={lx+10}  y={size-7} fontSize="7.5" fill="#000">swing</text>
          <circle cx={lx+42} cy={size-10} r="3" fill="none" stroke="#555" strokeWidth="1.5"/>
          <text x={lx+48}  y={size-7} fontSize="7.5" fill="#000">take</text>
          <line x1={lx+75} y1={size-14} x2={lx+81} y2={size-7} stroke="#555" strokeWidth="1.5"/>
          <line x1={lx+81} y1={size-14} x2={lx+75} y2={size-7} stroke="#555" strokeWidth="1.5"/>
          <text x={lx+85}  y={size-7} fontSize="7.5" fill="#000">whiff</text>
          <text x={lx+114} y={size-7} fontSize="7.5" fontWeight="bold" fill="url(#fclFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
          <text x={lx+122} y={size-7} fontSize="7.5" fill="#000">barrel</text>
          <text x={lx+152} y={size-7} fontSize="7.5">🔥</text>
          <text x={lx+160} y={size-7} fontSize="7.5" fill="#000">95+ev</text>
        </>;
      })()}
    </svg>
  );
}

// ─── Spray Chart (exact match to MLB daily card) ──────────────────────────────

interface HitDot {
  hcX: number; hcY: number; hitDistance: number | null;
  result: string; pitchType: string; exitVelo: number | null; isBarrel: boolean;
}

function SprayChart({ hitDots, batSide, playerImageUrl }: { hitDots: HitDot[]; batSide?: string; playerImageUrl?: string }) {
  const HOME_X = 250, HOME_Y = 450, FT_TO_SVG = 0.6512, SCALE = 1.65;
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
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>
      <polygon
        points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`}
        fill="#f5f5f5"/>
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <text x={RF_CORNER.x-28} y={RF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={181} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x+28} y={LF_CORNER.y-8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <circle cx={250} cy={186} r="3" fill="#000"/>
      <text x={RF_TOP.x+2}  y={RF_TOP.y-6}  fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <text x={LF_TOP.x-2}  y={LF_TOP.y-6}  fontSize="9" fill="#000" textAnchor="middle">375ft</text>
      <path
        d={`M ${RF_CORNER.x} ${RF_CORNER.y} L 354.6 235.5 Q ${RF_TOP.x} ${RF_TOP.y} 323.2 213.1 L 250 186 L 176.8 213.1 Q ${LF_TOP.x} ${LF_TOP.y} 145.4 235.5 L ${LF_CORNER.x} ${LF_CORNER.y}`}
        fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>

      {/* Ticks (simplified) */}
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

      <defs>
        <linearGradient id="scFclFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>

      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY, dot.hitDistance);
        const col = pitchCol(dot.pitchType, null).color;
        const isHit = ['single','double','triple','home run'].some(k => dot.result.toLowerCase().includes(k));
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={8}
              fill={isHit ? col : 'none'} fillOpacity={isHit ? 0.88 : 0}
              stroke={col} strokeWidth={isHit ? 1.2 : 2}/>
            {dot.isBarrel ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="bold"
                fill="url(#scFclFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            ) : dot.exitVelo !== null && dot.exitVelo >= 95 ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fill={isHit ? '#fff' : col} fontWeight="bold">🔥</text>
            ) : null}
          </g>
        );
      })}

      {hitDots.length === 0 && (
        <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No balls in play</text>
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
            fill="url(#scFclFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
          <text x={lx+106} y={ly} fontSize="10.5" fill="#000">barrel</text>
          <text x={lx+163} y={ly} fontSize="10.5">🔥</text>
          <text x={lx+175} y={ly} fontSize="10.5" fill="#000">95+ev</text>
        </>;
      })()}
    </svg>
  );
}

// ─── At-Bat Panel (exact match to MLB daily card) ─────────────────────────────

interface AtBatPanelEntry {
  atBatNum:    number;
  pitcherName: string;
  pitcherHand: string;
  result:      string;
  pitches: {
    pitchNum:    number;
    pitchType:   string | null;
    pitchCode:   string | null;
    velo:        number | null;
    description: string | null;
    exitVelo:    number | null;
    launchAngle: number | null;
    hitDistance: number | null;
    hcX:         number | null;
    hcY:         number | null;
    isBarrel:    boolean;
  }[];
}

function AtBatPanel({ atBats, lightMode, atBatStyle }: { atBats: AtBatPanelEntry[]; lightMode?: boolean; atBatStyle?: React.CSSProperties }) {
  const slots = atBats && atBats.length > 0 ? atBats : [];
  const padded: (AtBatPanelEntry | null)[] = [...slots, ...Array(Math.max(0, 4 - slots.length)).fill(null)];

  const cardStyle: React.CSSProperties = { flex: '0 0 calc(25% - 6px)', minWidth: 0 };
  const abBg    = lightMode ? '#f8f8f8' : '#171b24';
  const numCol  = lightMode ? '#666'    : '#a3a3a3';
  const pitcherCol = lightMode ? '#888' : '#737373';

  if (!atBats || atBats.length === 0) {
    return (
      <>
        {[0,1,2,3].map(i => (
          <div key={i} style={{ ...cardStyle, minHeight: 80, background: abBg, opacity: 0.4 }} className="flex items-center justify-center">
            {i === 1 && <p className="text-[9px] text-center px-2" style={{ color: numCol }}>No at-bat data</p>}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {padded.map((ab, idx) => ab ? (
        <div key={ab.atBatNum} style={{ ...cardStyle, ...(atBatStyle ?? { background: abBg }) }} className="px-2 py-2">
          {/* Header */}
          <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
            <span className="text-[9px] font-bold flex-shrink-0" style={{ color: numCol }}>AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[9px] font-bold px-1 py-0 leading-4 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[9px] truncate min-w-0" style={{ color: pitcherCol }}>
              {ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}
            </span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col" style={{ gap: 4 }}>
            {ab.pitches.map((p, i) => {
              const col = pitchCol(p.pitchType, p.pitchCode);
              const abbrev = pitchAbbrev(p.pitchType, p.pitchCode);
              const desc = cleanDesc(p.description);
              const isWhiff  = desc === 'Whiff';
              const isInPlay = desc === 'In Play';
              const isTake   = !isWhiff && !isInPlay && !desc.includes('Foul');
              const barrel   = isInPlay && p.isBarrel;
              const is95ev   = isInPlay && !barrel && p.exitVelo !== null && p.exitVelo >= 95;
              const pitchColor = col.color;

              return (
                <div key={i} className="flex flex-col rounded px-0.5">
                  <div className="grid items-center" style={{ gridTemplateColumns: '26px 36px 17px 1fr', lineHeight: '14px', columnGap: 3 }}>
                    {/* Type badge */}
                    <span className="rounded px-1 font-bold text-center"
                      style={{ backgroundColor: col.bg, color: col.text, fontSize: 10, lineHeight: '14px' }}>
                      {abbrev}
                    </span>
                    {/* Velo — always occupies column */}
                    <span className="font-semibold text-right" style={{ fontSize: 11, color: lightMode ? '#333' : undefined }}>
                      {p.velo !== null ? p.velo.toFixed(1) : ''}
                    </span>
                    {/* Icon — centered in fixed column */}
                    <div className="flex justify-center items-center">
                      {barrel ? (
                        <svg width="13" height="13" style={{ overflow: 'visible' }}>
                          <defs><linearGradient id={`abFire${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/></linearGradient></defs>
                          <text x="6.5" y="11" textAnchor="middle" fontSize="12" fontWeight="bold" fill={`url(#abFire${i})`} stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                        </svg>
                      ) : is95ev ? (
                        <span style={{ fontSize: 12, lineHeight: '13px' }}>🔥</span>
                      ) : isWhiff ? (
                        <svg width="13" height="13">
                          <line x1="2" y1="2" x2="11" y2="11" stroke="#000" strokeWidth="3"/>
                          <line x1="11" y1="2" x2="2" y2="11" stroke="#000" strokeWidth="3"/>
                          <line x1="2" y1="2" x2="11" y2="11" stroke={pitchColor} strokeWidth="2"/>
                          <line x1="11" y1="2" x2="2" y2="11" stroke={pitchColor} strokeWidth="2"/>
                        </svg>
                      ) : isTake ? (
                        <svg width="13" height="13">
                          <circle cx="6.5" cy="6.5" r="5" fill="none" stroke={pitchColor} strokeWidth="2"/>
                        </svg>
                      ) : (
                        <svg width="13" height="13">
                          <circle cx="6.5" cy="6.5" r="5" fill={pitchColor} stroke="#000" strokeWidth="0.6"/>
                        </svg>
                      )}
                    </div>
                    {/* Description */}
                    <span className="truncate" style={{ fontSize: 10, color: lightMode ? '#444' : undefined }}>{desc}</span>
                  </div>
                  {/* Hit data line */}
                  {(p.exitVelo !== null || p.hitDistance !== null) && (
                    <div className="pl-1 mt-1 flex gap-2">
                      {(() => {
                        const evC = lightMode ? '#374151' : '#facc15';
                        const lblC = lightMode ? '#999' : undefined;
                        return <>
                          {p.exitVelo    !== null && <span className="font-semibold" style={{ fontSize: 10, color: evC }}>{p.exitVelo.toFixed(1)} <span style={{ color: lblC }} className={lightMode ? '' : 'text-ink-4'}>ev</span></span>}
                          {p.launchAngle !== null && <span className="font-semibold" style={{ fontSize: 10, color: evC }}>{p.launchAngle.toFixed(0)}° <span style={{ color: lblC }} className={lightMode ? '' : 'text-ink-4'}>la</span></span>}
                          {p.launchAngle !== null && p.hcX !== null && p.hcY !== null && (
                            <span className="font-semibold" style={{ fontSize: 10, color: evC }}>
                              {Math.round(Math.atan2(p.hcX - 125, 208 - p.hcY) * (180 / Math.PI))}° <span style={{ color: lblC }} className={lightMode ? '' : 'text-ink-4'}>sa</span>
                            </span>
                          )}
                          {p.hitDistance  !== null && <span className="font-semibold" style={{ fontSize: 10, color: evC }}>{p.hitDistance} <span style={{ color: lblC }} className={lightMode ? '' : 'text-ink-4'}>ft</span></span>}
                        </>;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div key={`empty-${idx}`} style={{ ...cardStyle, minHeight: 80, ...(atBatStyle ?? { background: abBg }), opacity: 0.2 }} />
      ))}
    </>
  );
}

// ─── Inner Page ───────────────────────────────────────────────────────────────

function PlayerPageInner() {
  const params = useSearchParams();
  const gamePk   = params.get('gamePk') ?? '';
  const batterId = Number(params.get('batterId') ?? '0');
  const date     = params.get('date') ?? '';
  const league   = (params.get('league') ?? 'fcl').toUpperCase();

  const [currentGamePk, setCurrentGamePk] = useState<string>(gamePk);
  const [availableGames, setAvailableGames] = useState<Array<{
    gamePk: number; date: string; opponent: string; h: number; ab: number; hr: number;
  }>>([]);
  const [feed, setFeed]         = useState<GameFeed | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [imageError, setImgErr] = useState(0);
  const [playerBio, setPlayerBio] = useState<{
    height?: string; weight?: number; birthDate?: string;
    pitchHand?: string; batSide?: string;
  } | null>(null);
  const [seasonStats, setSeasonStats] = useState<{
    avg?: string; obp?: string; slg?: string; ops?: string;
    hr?: number; rbi?: number; bb?: number; k?: number;
    g?: number; pa?: number; sb?: number; hits?: number; ab?: number;
    doubles?: number; triples?: number;
  } | null>(null);
  const [seasonEvStats, setSeasonEvStats] = useState<{
    avgEv: number | null; maxEv: number | null; ev90: number | null;
    barrels: number | null; barrelPct: number | null; bipCount: number;
    evs?: number[] | null;
  } | null>(null);

  // Fetch game feed
  useEffect(() => {
    if (!currentGamePk) return;
    setLoading(true);
    setFeed(null);
    fetch(`/api/fcl-game?mode=game&gamePk=${currentGamePk}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFeed(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [currentGamePk]);

  // Fetch player bio from MLB Stats API
  useEffect(() => {
    if (!batterId) return;
    fetch(`https://statsapi.mlb.com/api/v1/people/${batterId}?fields=people,fullName,height,weight,birthDate,batSide,pitchHand`)
      .then(r => r.json())
      .then(d => {
        const p = d.people?.[0];
        if (p) setPlayerBio({
          height: p.height, weight: p.weight, birthDate: p.birthDate,
          pitchHand: p.pitchHand?.code, batSide: p.batSide?.code,
        });
      }).catch(() => {});
  }, [batterId]);

  // Fetch season stats
  useEffect(() => {
    if (!batterId) return;
    const season = date.slice(0, 4) || String(new Date().getFullYear());
    const sportId = 16; // Both FCL and ACL are sportId=16 (Rookie); sportId=17 is Winter Leagues
    fetch(
      `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=season&group=hitting&season=${season}&sportId=${sportId}`
    )
      .then(r => r.json())
      .then(d => {
        const s = d.stats?.[0]?.splits?.[0]?.stat;
        if (s) setSeasonStats({
          avg:     s.avg,
          obp:     s.obp,
          slg:     s.slg,
          ops:     s.ops,
          hr:      s.homeRuns,
          rbi:     s.rbi,
          bb:      s.baseOnBalls,
          k:       s.strikeOuts,
          g:       s.gamesPlayed,
          pa:      s.plateAppearances,
          sb:      s.stolenBases,
          hits:    s.hits,
          ab:      s.atBats,
          doubles: s.doubles,
          triples: s.triples,
        });
      }).catch(() => {});
  }, [batterId, date, league]);

  // Fetch season EV stats (aggregated across all games via game feeds)
  useEffect(() => {
    if (!batterId) return;
    const season = date.slice(0, 4) || String(new Date().getFullYear());
    fetch(`/api/fcl-season-ev?batterId=${batterId}&season=${season}`)
      .then(r => r.json())
      .then(d => setSeasonEvStats(d))
      .catch(() => {});
  }, [batterId, date]);

  // Fetch player's game log so user can switch between games
  useEffect(() => {
    if (!batterId) return;
    const year = date.slice(0, 4) || String(new Date().getFullYear());
    fetch(
      `https://statsapi.mlb.com/api/v1/people/${batterId}/stats` +
      `?stats=gameLog&group=hitting&season=${year}&sportId=16`
    )
      .then(r => r.json())
      .then(d => {
        const splits = (d.stats?.[0]?.splits ?? []) as Array<{
          stat: Record<string, number>;
          game: { gamePk: number };
          opponent: { abbreviation?: string };
          date: string;
        }>;
        setAvailableGames(
          splits
            .filter(s => s.game?.gamePk)
            .map(s => ({
              gamePk: s.game.gamePk,
              date: s.date,
              opponent: s.opponent?.abbreviation ?? '',
              h: s.stat?.hits ?? 0,
              ab: s.stat?.atBats ?? 0,
              hr: s.stat?.homeRuns ?? 0,
            }))
        );
      })
      .catch(() => {});
  }, [batterId, date]);

  // Light mode (default on, matches other daily card pages)
  const [light, setLight] = useState(true);

  // Card capture
  const cardRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [copied, setCopied] = useState(false);

  const captureCard = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    const { toPng } = await import('html-to-image');
    return toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      filter: (node) => !(node as HTMLElement).classList?.contains('export-ignore'),
    });
  };

  const handleDownload = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const safeName = batName.replace(/\s+/g, '-');
      const a = document.createElement('a');
      a.download = `${safeName}-${date}.png`;
      a.href = dataUrl;
      a.click();
    } catch (e) { console.error('capture failed', e); }
    finally { setCapturing(false); }
  };

  const handleCopy = async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const blob = await fetch(dataUrl).then(r => r.blob());
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { console.error('copy failed', e); }
    finally { setCapturing(false); }
  };

  // Filter plays for this batter
  const plays = (feed?.plays ?? []).filter(p => p.batter?.id === batterId);

  const stats    = plays.length > 0 ? computeStats(plays) : null;
  const batName    = plays[0]?.batter?.name ?? `Player #${batterId}`;
  const batSide    = plays[0]?.batSide ?? playerBio?.batSide ?? '';
  const awayAbbr   = feed?.away?.abbr ?? '';
  const homeAbbr   = feed?.home?.abbr ?? '';
  const awayLogoUrl = getMLBTeamLogoUrl(awayAbbr);
  const homeLogoUrl = getMLBTeamLogoUrl(homeAbbr);

  // Determine which side the player is on: away batters appear in top innings
  const playerIsAway  = plays.length > 0 ? plays.some(p => p.isTopInning) : true;
  const playerAbbr    = playerIsAway ? awayAbbr : homeAbbr;
  const opponentAbbr  = playerIsAway ? homeAbbr : awayAbbr;
  const playerLogoUrl = playerIsAway ? awayLogoUrl : homeLogoUrl;
  const oppLogoUrl    = playerIsAway ? homeLogoUrl : awayLogoUrl;

  function calcAge(bd: string | null | undefined): number | null {
    if (!bd) return null;
    const b = new Date(bd), n = new Date();
    let a = n.getFullYear() - b.getFullYear();
    const m = n.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
    return a;
  }

  // Build rawDots for zone chart
  const rawDots: RawDot[] = plays.flatMap(play =>
    play.pitches
      .filter(p => p.pX != null && p.pZ != null)
      .map(p => {
        const desc = cleanDesc(p.callDesc);
        const isWhiff  = desc === 'Whiff';
        const isInPlay = p.isInPlay;
        const isTake   = !isWhiff && !isInPlay && !desc.includes('Foul');
        const isSwing  = !isTake;
        const barrel   = isBarrelCalc(p.launchSpeed, p.launchAngle);
        return {
          pitchType: resolvePitchName(p.pitchType, p.pitchTypeCode),
          px: p.pX!, pz: p.pZ!,
          isWhiff, isBarrel: barrel, isSwing, isTake,
          exitVelo: p.launchSpeed,
        };
      })
  );

  // Build hitDots for spray chart
  const hitDots: HitDot[] = plays.flatMap(play => {
    const last = play.pitches[play.pitches.length - 1];
    if (!last?.isInPlay || last.hitX == null || last.hitY == null) return [];
    return [{
      hcX: last.hitX, hcY: last.hitY,
      hitDistance: last.totalDistance,
      result: play.event ?? '',
      pitchType: resolvePitchName(last.pitchType, last.pitchTypeCode),
      exitVelo: last.launchSpeed,
      isBarrel: isBarrelCalc(last.launchSpeed, last.launchAngle),
    }];
  });

  // Today's BIPs for the EV distribution chart dots
  const todayBips = plays.flatMap(play => play.pitches)
    .filter(p => p.isInPlay && p.launchSpeed !== null && p.launchSpeed > 0 && p.launchSpeed <= 130)
    .map(p => ({ ev: p.launchSpeed!, isBarrel: isBarrelCalc(p.launchSpeed, p.launchAngle) }));

  // Season EVs for the histogram
  const seasonEvs: number[] = seasonEvStats?.evs ?? [];

  // Build at-bat entries
  const atBats: AtBatPanelEntry[] = plays.map((play, i) => ({
    atBatNum: i + 1,
    pitcherName: play.pitcher?.name ?? '',
    pitcherHand: play.pitchHand ?? '',
    result: play.event ?? '',
    pitches: play.pitches.map((p, pi) => ({
      pitchNum: pi + 1,
      pitchType: p.pitchType,
      pitchCode: p.pitchTypeCode,
      velo: p.startSpeed,
      description: p.callDesc,
      exitVelo: p.launchSpeed,
      launchAngle: p.launchAngle,
      hitDistance: p.totalDistance,
      hcX: p.hitX,
      hcY: p.hitY,
      isBarrel: isBarrelCalc(p.launchSpeed, p.launchAngle),
    })),
  }));

  const imageSrc = `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${batterId}/headshot/silo/current`;
  const imgFallback = `https://img.mlb.com/headshots/current/60x60/${batterId}@2x.jpg`;
  const currentImage = imageError === 0 ? imageSrc : imgFallback;

  if (loading) return (
    <div className="min-h-screen bg-page flex items-center justify-center gap-2">
      <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin"/>
      <span className="text-ink-3 text-xs">Loading...</span>
    </div>
  );
  if (error) return <div className="min-h-screen bg-page p-6 text-red-400 text-sm">{error}</div>;
  if (!loading && (!feed || plays.length === 0)) return (
    <div className="min-h-screen bg-page p-6 text-ink-4 text-sm">
      No at-bats found for this game.
      {availableGames.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {availableGames.map(g => (
            <button key={g.gamePk} onClick={() => setCurrentGamePk(String(g.gamePk))}
              className="px-3 py-1.5 text-xs bg-bone border border-ink/20 text-ink-2">
              {g.date} vs {g.opponent} — {g.h}/{g.ab}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  // Theme helpers — identical to MLB/hitter daily card
  const BD = '2px solid #000000';
  const th = {
    statsBg:      light ? '#f7f7f7'              : '#1a1a1a',
    banner:       light ? getMLBTeamColor(playerAbbr) : '#000000',
    label:        light ? '#6b7280'              : '#777777',
    fg:           light ? '#000000'              : '#ffffff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    statsBoxStyle:light ? { border: BD }         : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    atBatStyle:   light ? { background: '#f8f8f8', border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } : {} as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'     : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'     : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'     : 'rgba(255,255,255,0.18)',
  };

  const bio = playerBio;
  const age = calcAge(bio?.birthDate);
  const bioParts: string[] = [];
  if (bio?.height) bioParts.push(bio.height);
  if (bio?.weight) bioParts.push(`${bio.weight} lbs`);
  if (age !== null) bioParts.push(`Age ${age}`);
  if (batSide && bio?.pitchHand) bioParts.push(`${batSide}/${bio.pitchHand}`);

  return (
    <div className="min-h-screen bg-page text-ink" data-light={light ? 'true' : undefined}>
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">← Daily Hitters</Link>
          {batterId > 0 && (
            <Link
              href={`/player/${batterId}/season`}
              className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
            >
              Season Card
            </Link>
          )}
        </div>
      </header>

      <div className="mx-auto px-2 py-3" style={{ maxWidth: 860 }}>
        <div className="mb-6">
          <div ref={cardRef} className="bg-page p-2 sm:p-3 w-full" style={{ position: 'relative' }}>

            {/* Export buttons — excluded from image capture */}
            {!loading && (feed || error) && (
              <div className="export-ignore" style={{
                position: 'absolute', top: 10, right: 10, display: 'flex', gap: 6, zIndex: 10,
              }}>
                <button
                  onClick={() => setLight(l => !l)}
                  title="Toggle light/dark mode"
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                    background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                    color: th.btnFg, borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  {light ? '☀ Light' : '☾ Dark'}
                </button>
                <button
                  onClick={handleCopy}
                  disabled={capturing}
                  title="Copy image to clipboard"
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                    background: copied ? '#166534' : th.btnBg,
                    border: `1px solid ${copied ? '#16a34a' : th.btnBorder}`,
                    color: copied ? '#4ade80' : th.btnFg,
                    borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  {copied ? '✓ Copied' : capturing ? '…' : '⎘ Copy'}
                </button>
                <button
                  onClick={handleDownload}
                  disabled={capturing}
                  title="Download as PNG"
                  style={{
                    padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: capturing ? 'wait' : 'pointer',
                    background: th.btnBg, border: `1px solid ${th.btnBorder}`, color: th.btnFg,
                    borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                  }}
                >
                  {capturing ? '…' : '↓ PNG'}
                </button>
              </div>
            )}

            {/* TOP ROW: [Headshot] [Name/Info/Game] [Team Logo] */}
            <div className="flex gap-3 items-stretch mb-3 max-w-[800px] mx-auto">
              {/* Col 1: Headshot + byline */}
              <div className="flex-shrink-0 flex flex-col items-center w-16 sm:w-44">
                <div className="w-full overflow-hidden bg-page h-16 sm:h-44">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage}
                    alt={batName}
                    className="w-full h-full object-cover object-top"
                    onError={() => setImgErr(e => Math.min(e + 1, 1))}
                  />
                </div>
                <div className="mt-1.5 text-center w-full">
                  <div className="font-display text-[10px] font-bold tracking-[0.08em] uppercase" style={{ color: th.fg }}>By @Piratefan003</div>
                  <div className="text-[8px] text-ink-4 leading-tight mt-0.5">
                    Data: MLB Statcast<br />Baseball Savant · MLB Stats API
                  </div>
                </div>
              </div>

              {/* Col 2: Name / Bio / Game info — centered */}
              <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
                <h1 className="font-display text-3xl uppercase tracking-[0.02em] mb-1">{batName}</h1>
                {bioParts.length > 0 && (
                  <p className="text-sm text-ink-3 mb-2">{bioParts.join(' · ')}</p>
                )}
                <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-4">
                  <span className="font-bold text-ink">{playerAbbr}</span>
                  <span>·</span>
                  <span>{date}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    {oppLogoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={oppLogoUrl} alt={opponentAbbr} className="h-4 w-4 object-contain" />
                    )}
                    <span>{playerIsAway ? '@' : 'vs'}</span>
                    <span className="font-semibold text-ink">{opponentAbbr}</span>
                  </span>
                  <span>·</span>
                  <span>{feed?.status}</span>
                </div>
              </div>

              {/* Col 3: Player's team logo */}
              <div className="flex-shrink-0 flex items-center justify-center w-16 sm:w-44">
                {playerLogoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={playerLogoUrl} alt={playerAbbr} className="object-contain w-12 sm:w-32 h-12 sm:h-32" />
                ) : (
                  <div className="w-16 sm:w-44" />
                )}
              </div>
            </div>

            {/* SEASON STATS — full width */}
            {seasonStats && (
              <div className="w-full max-w-[800px] mx-auto mb-2" style={th.statsBoxStyle}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  {date.slice(0, 4)} Season
                </div>
                <div className={`grid grid-cols-6 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'AVG', value: seasonStats.avg ?? '—' },
                    { label: 'OBP', value: seasonStats.obp ?? '—' },
                    { label: 'SLG', value: seasonStats.slg ?? '—' },
                    { label: 'OPS', value: seasonStats.ops ?? '—' },
                    { label: 'HR',  value: seasonStats.hr  != null ? String(seasonStats.hr)  : '—' },
                    { label: 'RBI', value: seasonStats.rbi != null ? String(seasonStats.rbi) : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-display tabular-nums" style={{ fontSize: 19, fontWeight: 900, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div className={`grid grid-cols-6 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'G',   value: seasonStats.g   != null ? String(seasonStats.g)   : '—' },
                    { label: 'AB',  value: seasonStats.ab  != null ? String(seasonStats.ab)  : '—' },
                    { label: 'H',   value: seasonStats.hits != null ? String(seasonStats.hits) : '—' },
                    { label: 'BB%', value: (seasonStats.bb != null && seasonStats.pa) ? ((seasonStats.bb / seasonStats.pa) * 100).toFixed(1) + '%' : '—' },
                    { label: 'K%',  value: (seasonStats.k  != null && seasonStats.pa) ? ((seasonStats.k  / seasonStats.pa) * 100).toFixed(1) + '%' : '—' },
                    { label: 'SB',  value: seasonStats.sb  != null ? String(seasonStats.sb)  : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-display tabular-nums" style={{ fontSize: 15, fontWeight: 900, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {/* EV stats row */}
                <div className={`grid grid-cols-5 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'Max EV', value: seasonEvStats?.maxEv     != null ? seasonEvStats.maxEv.toFixed(1)     : (stats?.maxEv != null ? stats.maxEv.toFixed(1) : '—') },
                    { label: 'Avg EV', value: seasonEvStats?.avgEv     != null ? seasonEvStats.avgEv.toFixed(1)     : (stats?.avgEv != null ? stats.avgEv.toFixed(1) : '—') },
                    { label: 'EV90',   value: seasonEvStats?.ev90      != null ? seasonEvStats.ev90.toFixed(1)      : (stats?.ev90  != null ? stats.ev90.toFixed(1)  : '—') },
                    { label: 'Brls',   value: seasonEvStats?.barrels   != null ? String(seasonEvStats.barrels)      : (stats?.barrels != null ? String(stats.barrels) : '—') },
                    { label: 'Brl%',   value: seasonEvStats?.barrelPct != null ? `${seasonEvStats.barrelPct.toFixed(1)}%` : '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-display tabular-nums" style={{ fontSize: 15, fontWeight: 900, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* GAME STATS — full width */}
            {stats && (
              <div className="w-full max-w-[800px] mx-auto mb-3" style={th.statsBoxStyle}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  Game
                </div>
                <div className={`grid grid-cols-6 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'AB',   value: String(stats.ab) },
                    { label: 'H',    value: String(stats.h) },
                    { label: 'HR',   value: String(stats.hr) },
                    { label: 'RBI',  value: String(stats.rbi) },
                    { label: 'BB',   value: String(stats.bb) },
                    { label: 'Brls', value: String(stats.barrels) },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-display tabular-nums" style={{ fontSize: 19, fontWeight: 900, color: th.fg, lineHeight: '22px' }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                <div className={`grid grid-cols-5 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                  {[
                    { label: 'K',  value: String(stats.k) },
                    { label: '2B', value: String(stats.doubles) },
                    { label: '3B', value: String(stats.triples) },
                    { label: 'PA', value: String(stats.pa) },
                    { label: 'SB', value: '—' },
                  ].map(s => (
                    <div key={s.label} className="text-center px-1 py-0.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                      <div className="font-display tabular-nums" style={{ fontSize: 15, fontWeight: 900, color: th.fg }}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* BOTTOM SECTIONS: ABs horizontal, then charts side by side */}
            <div className="flex flex-col gap-4">
              <div className="w-full max-w-[800px] mx-auto" style={light ? { border: BD } as React.CSSProperties : {}}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  At Bats
                </div>
                <div className="flex flex-wrap justify-center gap-2 w-full" style={{ padding: light ? 12 : 0 }}>
                  <AtBatPanel atBats={atBats} lightMode={light} atBatStyle={th.atBatStyle} />
                </div>
              </div>
              <div className="w-full max-w-[800px] mx-auto" style={th.statsBoxStyle}>
                <div className={`font-display italic text-[13px] uppercase tracking-widest text-center py-2 border-b ${th.border}`} style={{ background: th.banner, color: light ? '#ffffff' : '#ff2d2d', fontWeight: 900 }}>
                  Charts
                </div>
                <div className="flex gap-3 justify-center flex-wrap py-3" style={{ background: th.statsBg }}>
                  <HitterZoneChart rawDots={rawDots} />
                  <SprayChart hitDots={hitDots} batSide={batSide} playerImageUrl={currentImage} />
                  {(seasonEvs.length > 0 || todayBips.length > 0) && (
                    <EvDistChart
                      seasonEvs={seasonEvs}
                      todayBips={todayBips}
                      avgEv={seasonEvStats?.avgEv ?? null}
                      ev90={seasonEvStats?.ev90 ?? null}
                      year={date.slice(0, 4)}
                    />
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>

        {/* Game Log — outside card so it's excluded from image export */}
        {availableGames.length > 0 && (
          <div className="bg-page p-3 sm:p-4 mt-4 border border-ink/30 w-full max-w-[800px] mx-auto">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-ink-3 uppercase tracking-wide">
                Game Log
                <span className="ml-2 text-ink-3 font-normal normal-case">{availableGames.length} games</span>
              </h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableGames.map(g => {
                const isSelected = String(g.gamePk) === currentGamePk;
                return (
                  <button
                    key={g.gamePk}
                    onClick={() => setCurrentGamePk(String(g.gamePk))}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-deep text-deep-fg'
                        : 'bg-bone text-ink-2 hover:bg-panel hover:text-ink border border-ink/20'
                    }`}
                  >
                    <span className="font-semibold">{g.date}</span>
                    <span className="text-ink-3 ml-1">vs {g.opponent}</span>
                    <span className="ml-1">{g.h}/{g.ab}</span>
                    {g.hr > 0 && <span className="ml-1 text-yellow-400">{g.hr}HR</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FCLPlayerPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-page flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin"/>
        <span className="text-ink-3 text-xs">Loading…</span>
      </div>
    }>
      <PlayerPageInner />
    </Suspense>
  );
}

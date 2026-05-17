'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';

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
  if (ev == null || la == null) return false;
  if (ev < 98) return false;
  if (la >= 26 && la <= 30) return true;
  if (la > 30 && la <= 50) return ev >= 98 + (la - 30) * 2;
  if (la >= 8  && la < 26)  return ev >= 98 + (26 - la) * 2;
  return false;
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
    if (p.launchSpeed != null) evList.push(p.launchSpeed);
  }
  const allPitches = plays.flatMap(p => p.pitches);
  const barrels = allPitches.filter(p => isBarrelCalc(p.launchSpeed, p.launchAngle)).length;
  const avgEv = evList.length > 0 ? evList.reduce((a, b) => a + b, 0) / evList.length : null;
  return { h, ab, hr, rbi, bb, k, doubles, triples, pa, barrels, avgEv };
}

// ─── Zone Chart (exact match to MLB daily card) ───────────────────────────────

interface RawDot {
  pitchType: string; px: number; pz: number;
  isWhiff: boolean; isBarrel: boolean; isSwing: boolean; isTake: boolean;
  exitVelo: number | null;
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

function AtBatPanel({ atBats }: { atBats: AtBatPanelEntry[] }) {
  if (!atBats || atBats.length === 0) {
    return (
      <div className="bg-bone flex items-center justify-center" style={{ height: 60 }}>
        <p className="text-ink-4 text-xs text-center px-4">No at-bat data</p>
      </div>
    );
  }

  return (
    <>
      {atBats.map(ab => (
        <div key={ab.atBatNum} className="bg-[#171b24] px-2 py-2 flex-shrink-0 flex-1 min-w-[180px] max-w-[220px]">
          {/* Header */}
          <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
            <span className="text-[9px] font-bold flex-shrink-0" style={{ color: '#a3a3a3' }}>AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[9px] font-bold px-1 py-0 leading-4 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[9px] truncate min-w-0" style={{ color: '#737373' }}>
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
                  <div className="flex items-center gap-1" style={{ lineHeight: '14px' }}>
                    {/* Type badge */}
                    <span className="rounded px-1 font-bold flex-shrink-0"
                      style={{ backgroundColor: col.bg, color: col.text, fontSize: 10, lineHeight: '14px' }}>
                      {abbrev}
                    </span>
                    {/* Velo */}
                    {p.velo !== null && (
                      <span className="text-ink-2 font-semibold w-9 text-right flex-shrink-0" style={{ fontSize: 11 }}>
                        {p.velo.toFixed(1)}
                      </span>
                    )}
                    {/* Icon */}
                    {barrel ? (
                      <svg width="13" height="13" className="flex-shrink-0" style={{ overflow: 'visible' }}>
                        <defs><linearGradient id={`abFire${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/></linearGradient></defs>
                        <text x="6.5" y="11" textAnchor="middle" fontSize="12" fontWeight="bold" fill={`url(#abFire${i})`} stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                      </svg>
                    ) : is95ev ? (
                      <span className="flex-shrink-0" style={{ fontSize: 12, lineHeight: '13px' }}>🔥</span>
                    ) : isWhiff ? (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <line x1="2" y1="2" x2="11" y2="11" stroke="#000" strokeWidth="3"/>
                        <line x1="11" y1="2" x2="2" y2="11" stroke="#000" strokeWidth="3"/>
                        <line x1="2" y1="2" x2="11" y2="11" stroke={pitchColor} strokeWidth="2"/>
                        <line x1="11" y1="2" x2="2" y2="11" stroke={pitchColor} strokeWidth="2"/>
                      </svg>
                    ) : isTake ? (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill="none" stroke={pitchColor} strokeWidth="2"/>
                      </svg>
                    ) : (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill={pitchColor} stroke="#000" strokeWidth="0.6"/>
                      </svg>
                    )}
                    {/* Description */}
                    <span className="text-ink-2 truncate min-w-0" style={{ fontSize: 10 }}>{desc}</span>
                  </div>
                  {/* Hit data line */}
                  {(p.exitVelo !== null || p.hitDistance !== null) && (
                    <div className="pl-1 mt-1 flex gap-2">
                      {p.exitVelo    !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.exitVelo.toFixed(1)} <span className="text-ink-4 font-normal">ev</span></span>}
                      {p.launchAngle !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.launchAngle.toFixed(0)}° <span className="text-ink-4 font-normal">la</span></span>}
                      {p.launchAngle !== null && p.hcX !== null && p.hcY !== null && (
                        <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>
                          {Math.round(Math.atan2(p.hcX - 125, 208 - p.hcY) * (180 / Math.PI))}° <span className="text-ink-4 font-normal">sa</span>
                        </span>
                      )}
                      {p.hitDistance  !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.hitDistance} <span className="text-ink-4 font-normal">ft</span></span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
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

  // Fetch game feed
  useEffect(() => {
    if (!gamePk) return;
    setLoading(true);
    fetch(`/api/fcl-game?mode=game&gamePk=${gamePk}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setFeed(d); })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gamePk]);

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

  // Filter plays for this batter
  const plays = (feed?.plays ?? []).filter(p => p.batter?.id === batterId);

  const stats    = plays.length > 0 ? computeStats(plays) : null;
  const batName    = plays[0]?.batter?.name ?? `Player #${batterId}`;
  const batSide    = plays[0]?.batSide ?? playerBio?.batSide ?? '';
  const awayAbbr   = feed?.away?.abbr ?? '';
  const homeAbbr   = feed?.home?.abbr ?? '';
  const awayLogoUrl = getMLBTeamLogoUrl(awayAbbr);
  const homeLogoUrl = getMLBTeamLogoUrl(homeAbbr);

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
  if (!feed || plays.length === 0) return (
    <div className="min-h-screen bg-page p-6 text-ink-4 text-sm">No at-bats found.</div>
  );

  const bio = playerBio;
  const age = calcAge(bio?.birthDate);
  const bioParts: string[] = [];
  if (bio?.height) bioParts.push(bio.height);
  if (bio?.weight) bioParts.push(`${bio.weight} lbs`);
  if (age !== null) bioParts.push(`Age ${age}`);
  if (batSide && bio?.pitchHand) bioParts.push(`${batSide}/${bio.pitchHand}`);

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">← Daily Hitters</Link>
        </div>
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>
        <div className="mb-6">
          <div className="bg-page p-6 w-full">

            {/* TOP: Name + bio + game info — full-width centered */}
            <div className="text-center mb-3">
              <h1 className="font-display text-3xl uppercase tracking-[0.02em] mb-0.5">{batName}</h1>
              {bioParts.length > 0 && (
                <p className="text-sm text-ink-3 mb-1">{bioParts.join(' · ')}</p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-4">
                <span className="font-bold text-ink">{league}</span>
                <span>·</span>
                <span>{date}</span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  {awayLogoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={awayLogoUrl} alt={awayAbbr} className="h-4 w-4 object-contain" />
                  )}
                  <span className="font-semibold text-ink">{awayAbbr}</span>
                  <span className="text-ink-5">vs</span>
                  {homeLogoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={homeLogoUrl} alt={homeAbbr} className="h-4 w-4 object-contain" />
                  )}
                  <span className="font-semibold text-ink">{homeAbbr}</span>
                </span>
                <span>·</span>
                <span>{feed.status}</span>
              </div>
            </div>

            {/* MIDDLE: headshot LEFT | stat tables RIGHT */}
            <div className="flex gap-4 items-start mb-4">
              {/* Headshot + byline */}
              <div className="flex-shrink-0 flex flex-col items-center" style={{ width: 190 }}>
                <div className="w-full overflow-hidden bg-page" style={{ height: 265 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage}
                    alt={batName}
                    className="w-full h-full object-cover object-top"
                    onError={() => setImgErr(e => Math.min(e + 1, 1))}
                  />
                </div>
                <div className="mt-1.5 text-center w-full">
                  <div className="text-[10px] font-bold text-ink-3 tracking-[0.08em] uppercase">By @Piratefan003</div>
                  <div className="text-[8px] text-ink-4 leading-tight mt-0.5">
                    Data: MLB Statcast<br />Baseball Savant · MLB Stats API
                  </div>
                </div>
              </div>

              {/* Stat tables */}
              <div className="flex-1 min-w-0">
                {/* Game stat grid */}
                {stats && (
                  <div className="border border-white/20 w-full mb-2">
                    <div className="text-[8px] uppercase tracking-widest text-center py-0.5 border-b border-white/10" style={{ background: '#000', color: '#e87722' }}>
                      Game
                    </div>
                    <div className="grid grid-cols-6 divide-x divide-white/10" style={{ background: '#1a1a1a' }}>
                      {[
                        { label: 'AB',   value: String(stats.ab) },
                        { label: 'H',    value: String(stats.h) },
                        { label: 'HR',   value: String(stats.hr) },
                        { label: 'RBI',  value: String(stats.rbi) },
                        { label: 'BB',   value: String(stats.bb) },
                        { label: 'Brls', value: String(stats.barrels) },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-3">
                          <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#777' }}>{s.label}</div>
                          <div className="font-bold font-mono text-white tabular-nums" style={{ fontSize: 20 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-6 divide-x divide-white/10 border-t border-white/10" style={{ background: '#1a1a1a' }}>
                      {[
                        { label: 'K',      value: String(stats.k) },
                        { label: '2B',     value: String(stats.doubles) },
                        { label: '3B',     value: String(stats.triples) },
                        { label: 'PA',     value: String(stats.pa) },
                        { label: 'SB',     value: '—' },
                        { label: 'Avg EV', value: stats.avgEv != null ? stats.avgEv.toFixed(1) : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-3">
                          <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#777' }}>{s.label}</div>
                          <div className="font-bold font-mono text-white tabular-nums" style={{ fontSize: 20 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Season stat grid */}
                {seasonStats && (
                  <div className="border border-white/20 w-full">
                    <div className="text-[8px] uppercase tracking-widest text-center py-0.5 border-b border-white/10" style={{ background: '#000', color: '#e87722' }}>
                      {date.slice(0, 4)} Season
                    </div>
                    <div className="grid grid-cols-6 divide-x divide-white/10" style={{ background: '#1a1a1a' }}>
                      {[
                        { label: 'AVG', value: seasonStats.avg ?? '—' },
                        { label: 'OBP', value: seasonStats.obp ?? '—' },
                        { label: 'SLG', value: seasonStats.slg ?? '—' },
                        { label: 'OPS', value: seasonStats.ops ?? '—' },
                        { label: 'HR',  value: seasonStats.hr  != null ? String(seasonStats.hr)  : '—' },
                        { label: 'RBI', value: seasonStats.rbi != null ? String(seasonStats.rbi) : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-3">
                          <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#777' }}>{s.label}</div>
                          <div className="font-bold font-mono text-white tabular-nums" style={{ fontSize: 20 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-6 divide-x divide-white/10 border-t border-white/10" style={{ background: '#1a1a1a' }}>
                      {[
                        { label: 'G',  value: seasonStats.g   != null ? String(seasonStats.g)   : '—' },
                        { label: 'AB', value: seasonStats.ab  != null ? String(seasonStats.ab)  : '—' },
                        { label: 'H',  value: seasonStats.hits != null ? String(seasonStats.hits) : '—' },
                        { label: 'BB', value: seasonStats.bb  != null ? String(seasonStats.bb)  : '—' },
                        { label: 'K',  value: seasonStats.k   != null ? String(seasonStats.k)   : '—' },
                        { label: 'SB', value: seasonStats.sb  != null ? String(seasonStats.sb)  : '—' },
                      ].map(s => (
                        <div key={s.label} className="text-center px-1 py-3">
                          <div className="text-[9px] font-semibold uppercase tracking-widest" style={{ color: '#777' }}>{s.label}</div>
                          <div className="font-bold font-mono text-white tabular-nums" style={{ fontSize: 20 }}>{s.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* BOTTOM SECTIONS: ABs horizontal, then charts side by side */}
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 flex-wrap justify-center">
                <AtBatPanel atBats={atBats} />
              </div>
              <div className="flex gap-3 justify-center flex-wrap">
                <HitterZoneChart rawDots={rawDots} />
                <SprayChart hitDots={hitDots} batSide={batSide} playerImageUrl={currentImage} />
              </div>
            </div>

          </div>
        </div>
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

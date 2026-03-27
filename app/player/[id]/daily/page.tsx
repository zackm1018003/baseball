'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl } from '@/lib/mlb-team-logos';
import { getCountryFlagUrl } from '@/lib/country-flags';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ date?: string }>;
}

interface HitterRawDot {
  pitchType: string;
  px: number;
  pz: number;
  isWhiff: boolean;
  isBarrel: boolean;
  isSwing: boolean;
  isTake: boolean;
  exitVelo: number | null;
}


interface HitterPitchTypeStat {
  name: string;
  count: number;
  swings: number;
  whiffs: number;
  contacts: number;
  inZone: number;
}

interface AtBatPitch {
  pitchNum: number;
  pitchType: string;
  velo: number | null;
  hBreak: number | null;
  ivBreak: number | null;
  description: string;
  batSpeed: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  hitDistance: number | null;
  hcX: number | null;
  hcY: number | null;
}

interface AtBat {
  atBatNum: number;
  pitcherName: string;
  pitcherHand: string;
  result: string;
  pitches: AtBatPitch[];
}

interface HitterHitDot {
  hcX: number;
  hcY: number;
  result: string;
  pitchType: string;
  exitVelo: number | null;
  isBarrel: boolean;
}

interface HitterPitchData {
  totalPitches: number;
  rawDots: HitterRawDot[];
  pitchTypes: HitterPitchTypeStat[];
  atBats?: AtBat[];
  hitDots?: HitterHitDot[];
}

interface GameLine {
  date: string;
  ab: number;
  h: number;
  hr: number;
  rbi: number;
  bb: number;
  k: number;
  doubles: number;
  triples: number;
  pa: number;
  sb: number;
}

interface GameInfo {
  gamePk: number | null;
  opponent: string | null;
  opponentFull: string | null;
  team: string | null;
  isHome: boolean | null;
  date: string;
}

interface AvailableDate {
  date: string;
  opponent: string;
  ab: number;
  h: number;
  hr: number;
  k: number;
  gamePk?: number;
}

interface DailyData {
  playerId: number;
  playerName: string | null;
  playerHeight: string | null;
  playerWeight: number | null;
  playerBirthDate: string | null;
  playerPitchHand: string | null;
  playerBatSide: string | null;
  date: string;
  gameLine: GameLine;
  gameInfo: GameInfo;
  pitchData: HitterPitchData | null;
  availableDates: AvailableDate[];
}

// ─── Pitch colors ─────────────────────────────────────────────────────────────

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

function pitchColors(name: string) {
  return PITCH_COLORS[name] || { color: '#888', bg: '#888', text: '#fff' };
}

const PITCH_ABBREV: Record<string, string> = {
  '4-Seam Fastball': 'FF',
  'Sinker':          'SI',
  'Cutter':          'CT',
  'Changeup':        'CH',
  'Curveball':       'CU',
  'Slider':          'SL',
  'Sweeper':         'SW',
  'Knuckle Curve':   'KC',
  'Splitter':        'SP',
  'Slurve':          'SV',
};

function cleanDesc(desc: string): string {
  const d = desc.toLowerCase();
  if (d.includes('swinging_strike') || d.includes('swinging strike')) return 'Whiff';
  if (d === 'called_strike' || d === 'called strike') return 'CS';
  if (d === 'ball' || d === 'blocked_ball') return 'Ball';
  if (d.includes('foul_tip') || d === 'foul tip') return 'Foul Tip';
  if (d.includes('foul')) return 'Foul';
  if (d.includes('hit_into_play') || d.includes('in play')) return 'In Play';
  return desc.replace(/_/g, ' ');
}

function cleanResult(events: string): string {
  const map: Record<string, string> = {
    single: '1B', double: '2B', triple: '3B', home_run: 'HR',
    strikeout: 'K', strikeout_double_play: 'KDP',
    walk: 'BB', intent_walk: 'IBB', hit_by_pitch: 'HBP',
    field_out: 'Out', force_out: 'FC Out',
    fielders_choice: 'FC', fielders_choice_out: 'FC Out',
    grounded_into_double_play: 'GIDP', double_play: 'DP', triple_play: 'TP',
    sac_fly: 'SF', sac_fly_double_play: 'SF-DP',
    sac_bunt: 'SH', sac_bunt_double_play: 'SH-DP',
    catcher_interf: 'CI', other_out: 'Out',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run'].includes(events)) return 'bg-green-700 text-green-200';
  if (['strikeout','strikeout_double_play','field_out','force_out',
       'grounded_into_double_play','double_play','triple_play',
       'sac_fly','sac_fly_double_play','sac_bunt','sac_bunt_double_play',
       'other_out','fielders_choice','fielders_choice_out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','hit_by_pitch'].includes(events)) return 'bg-blue-800 text-blue-200';
  return 'bg-gray-700 text-gray-300';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

// ─── Zone Chart - pitches seen by hitter ─────────────────────────────────────

function HitterZoneChart({ rawDots, heightIn }: { rawDots: HitterRawDot[]; heightIn?: number }) {
  const size = 240;
  const xMin = -1.8, xMax = 1.8;
  const zMin = 0.5,  zMax = 4.5;
  const pad = 28;
  const w = size - pad * 2;
  const h = size - pad * 2;

  const toSvgX = (px: number) => pad + ((px - xMin) / (xMax - xMin)) * w;
  const toSvgY = (pz: number) => pad + ((zMax - pz) / (zMax - zMin)) * h;

  // ABS zone: top=53.5% of height, bottom=27% of height (in feet)
  const ht = heightIn ?? 72; // default 6'0"
  const absTop = (ht * 0.535) / 12;
  const absBot = (ht * 0.27)  / 12;

  const szLeft  = toSvgX(-0.708);
  const szRight = toSvgX(0.708);
  const szTop   = toSvgY(absTop);
  const szBot   = toSvgY(absBot);

  const thirdW = (szRight - szLeft) / 3;
  const thirdH = (szBot - szTop) / 3;

  if (rawDots.length === 0) {
    return (
      <div style={{ width: size, height: size }}
        className="bg-[#d1d5db] flex items-center justify-center">
        <p className="text-gray-500 text-xs text-center px-6">No Statcast data</p>
      </div>
    );
  }

  return (
    <svg width={size} height={size} className="bg-white">
      <defs>
        <linearGradient id="fireGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200" />
          <stop offset="50%" stopColor="#ff8800" />
          <stop offset="100%" stopColor="#ffdd00" />
        </linearGradient>
      </defs>
      {/* Title */}
      <text x={size / 2} y={18} textAnchor="middle" fontSize="10" fontWeight="600" fill="#111827">
        Pitches Seen
      </text>


      {/* Strike zone */}
      <rect x={szLeft} y={szTop} width={szRight - szLeft} height={szBot - szTop}
        fill="rgba(0,0,0,0.06)" stroke="#000" strokeWidth="2" />

      {/* Inner thirds grid */}
      {[1, 2].map(i => (
        <line key={`v${i}`}
          x1={szLeft + thirdW * i} y1={szTop}
          x2={szLeft + thirdW * i} y2={szBot}
          stroke="#00000033" strokeWidth="0.75" />
      ))}
      {[1, 2].map(i => (
        <line key={`h${i}`}
          x1={szLeft} y1={szTop + thirdH * i}
          x2={szRight} y2={szTop + thirdH * i}
          stroke="#00000033" strokeWidth="0.75" />
      ))}

      {/* Pitch dots */}
      {rawDots.map((dot, i) => {
        const cx = toSvgX(dot.px);
        const cy = toSvgY(dot.pz);
        const col = pitchColors(dot.pitchType).color;

        if (dot.isWhiff) {
          const s = 4;
          return (
            <g key={i}>
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke="#000" strokeWidth="4" opacity="0.9" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke="#000" strokeWidth="4" opacity="0.9" />
              <line x1={cx-s} y1={cy-s} x2={cx+s} y2={cy+s} stroke={col} strokeWidth="2.5" opacity="0.95" />
              <line x1={cx+s} y1={cy-s} x2={cx-s} y2={cy+s} stroke={col} strokeWidth="2.5" opacity="0.95" />
            </g>
          );
        }
        if (dot.isBarrel) {
          return (
            <g key={i}>
              <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
                fill="#000" stroke="#000" strokeWidth="4" strokeLinejoin="round" opacity="0.9">B</text>
              <text x={cx} y={cy+5} textAnchor="middle" fontSize="12" fontWeight="bold"
                fill="url(#fireGrad)" opacity="0.95">B</text>
            </g>
          );
        }
        if (dot.isSwing && !dot.isWhiff && dot.exitVelo !== null && dot.exitVelo >= 95) {
          return (
            <text key={i} x={cx} y={cy + 5} textAnchor="middle" fontSize="12" opacity="0.95">🔥</text>
          );
        }
        if (dot.isTake) {
          return <circle key={i} cx={cx} cy={cy} r="3.5" fill="none"
            stroke={col} strokeWidth="1.5" opacity="0.75" />;
        }
        return <circle key={i} cx={cx} cy={cy} r="3.5" fill={col}
          stroke="#000" strokeWidth="0.6" opacity="0.8" />;
      })}

      {/* Legend */}
      {(() => { const lx = (size - 188) / 2; return (<>
      <circle cx={lx + 4} cy={size - 10} r="3" fill="#555" opacity="0.8" />
      <text x={lx + 10} y={size - 7} fontSize="7.5" fill="#000">swing</text>
      <circle cx={lx + 42} cy={size - 10} r="3" fill="none" stroke="#555" strokeWidth="1.5" />
      <text x={lx + 48} y={size - 7} fontSize="7.5" fill="#000">take</text>
      <line x1={lx + 75} y1={size - 14} x2={lx + 81} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <line x1={lx + 81} y1={size - 14} x2={lx + 75} y2={size - 7} stroke="#555" strokeWidth="1.5" />
      <text x={lx + 85} y={size - 7} fontSize="7.5" fill="#000">whiff</text>
      <text x={lx + 114} y={size - 7} fontSize="7.5" fontWeight="bold" fill="url(#fireGrad)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
      <text x={lx + 122} y={size - 7} fontSize="7.5" fill="#000">barrel</text>
      <text x={lx + 152} y={size - 7} fontSize="7.5">🔥</text>
      <text x={lx + 160} y={size - 7} fontSize="7.5" fill="#000">95+ev</text>
      </>); })()}
    </svg>
  );
}

// ─── Spray Chart ─────────────────────────────────────────────────────────────

function SprayChart({ hitDots }: { hitDots: HitterHitDot[] }) {
  // 300×300 output matching the zone chart size
  // viewBox covers the full field (x: 80–420, y: 150–490) plus legend space
  const HOME_X = 250, HOME_Y = 450, SCALE = 1.65;

  const toSvg = (hcX: number, hcY: number) => ({
    x: HOME_X + (hcX - 125) * SCALE,
    y: HOME_Y + (hcY - 208) * SCALE,
  });

  // Foul line corners (where foul lines meet the wall)
  const RF_CORNER = { x: 402, y: 298 };
  const LF_CORNER = { x: 98,  y: 298 };
  // Outfield wall top corners — inward to form trapezoid (narrower at top)
  const RF_TOP = { x: 348, y: 186 };
  const LF_TOP = { x: 152, y: 186 };

  // Clip guide lines to the 4-segment trapezoid wall
  function fenceIntersect(L: number): {x: number, y: number} {
    const deg = (315 - L * 0.5) * Math.PI / 180;
    const rdx = Math.cos(deg), rdy = Math.sin(deg);
    let bestT = 999, best = { x: 250 + rdx*220, y: 450 + rdy*220 };

    const segs = [
      [RF_CORNER, RF_TOP],                     // right slanted wall
      [RF_TOP,    LF_TOP],                     // flat top wall
      [LF_TOP,    LF_CORNER],                  // left slanted wall
    ] as [typeof RF_CORNER, typeof RF_CORNER][];

    for (const [p, q] of segs) {
      const sx = q.x - p.x, sy = q.y - p.y;
      const denom = rdx * sy - rdy * sx;
      if (Math.abs(denom) < 1e-6) continue;
      const t = ((p.x - 250) * sy - (p.y - 450) * sx) / denom;
      const u = ((p.x - 250) * rdy - (p.y - 450) * rdx) / denom;
      if (t > 0 && u >= 0 && u <= 1 && t < bestT) { bestT = t; best = { x: 250 + rdx*t, y: 450 + rdy*t }; }
    }
    return best;
  }

  return (
    <svg width={240} height={240} viewBox="85 148 330 330" className="bg-white">
      <text x={250} y={158} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>

      {/* Fair territory fill — trapezoid shape */}
      <polygon
        points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`}
        fill="#f5f5f5"/>

      {/* Foul lines */}
      <line x1="250" y1="450" x2={RF_CORNER.x} y2={RF_CORNER.y} stroke="#000" strokeWidth="1.5"/>
      <line x1="250" y1="450" x2={LF_CORNER.x} y2={LF_CORNER.y} stroke="#000" strokeWidth="1.5"/>

      {/* Wall distance labels */}
      <text x={RF_CORNER.x - 28} y={RF_CORNER.y - 8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>
      <text x={250} y={RF_TOP.y - 5} fontSize="9" fill="#000" textAnchor="middle">400ft</text>
      <text x={LF_CORNER.x + 28} y={LF_CORNER.y - 8} fontSize="9" fill="#000" textAnchor="middle">330ft</text>

      {/* Outfield wall */}
      <path
        d={`M ${RF_CORNER.x} ${RF_CORNER.y}
            L ${RF_TOP.x + 8.69} ${RF_TOP.y + 18.02}
            Q ${RF_TOP.x} ${RF_TOP.y} ${RF_TOP.x - 20} ${RF_TOP.y}
            L ${LF_TOP.x + 20} ${LF_TOP.y}
            Q ${LF_TOP.x} ${LF_TOP.y} ${LF_TOP.x - 8.69} ${LF_TOP.y + 18.02}
            L ${LF_CORNER.x} ${LF_CORNER.y}`}
        fill="none" stroke="#000" strokeWidth="3.5" strokeLinecap="round"/>

      {/* Protractor arc */}
      <path d="M 341.9 358.1 A 130 130 0 0 0 158.1 358.1" fill="none" stroke="#000" strokeWidth="1"/>

      {/* Minor ticks */}
      {([{o:[337.8,354.2],i:[331.8,360.5]},{o:[329.1,346.9],i:[323.7,353.8]},{o:[319.8,340.4],i:[315.0,347.8]},{o:[310.0,334.7],i:[305.9,342.3]},{o:[299.8,329.9],i:[296.2,338.8]},{o:[289.1,326.0],i:[286.4,334.6]},{o:[278.1,323.1],i:[276.2,331.8]},{o:[267.0,321.1],i:[265.8,329.9]},{o:[255.7,320.1],i:[255.3,329.1]},{o:[244.3,320.1],i:[244.7,329.1]},{o:[233.0,321.1],i:[234.2,329.9]},{o:[221.9,323.1],i:[223.8,331.8]},{o:[210.9,326.0],i:[213.6,334.6]},{o:[200.2,329.9],i:[203.8,338.8]},{o:[190.0,334.7],i:[194.1,343.3]},{o:[180.2,340.4],i:[185.0,348.0]},{o:[170.9,346.9],i:[176.3,353.8]},{o:[162.2,354.2],i:[168.2,360.5]}] as {o:number[],i:number[]}[]).map(({o,i},idx) => (
        <line key={idx} x1={o[0]} y1={o[1]} x2={i[0]} y2={i[1]} stroke="#000" strokeWidth="0.7"/>
      ))}

      {/* Major ticks + labels */}
      {([
        {L:0,  ox:341.9,oy:358.1,ix:329.9,iy:370.0,lx:354.6,ly:349.1},
        {L:10, ox:333.6,oy:350.4,ix:322.6,iy:363.5,lx:344.9,ly:340.1},
        {L:20, ox:324.6,oy:343.5,ix:314.8,iy:357.4,lx:334.6,ly:332.7},
        {L:30, ox:315.0,oy:337.4,ix:306.6,iy:352.1,lx:323.5,ly:325.3},
        {L:40, ox:304.9,oy:332.2,ix:297.8,iy:347.8,lx:312.4,ly:319.5},
        {L:50, ox:294.5,oy:327.8,ix:288.6,iy:343.8,lx:300.5,ly:314.9},
        {L:60, ox:283.6,oy:324.5,ix:279.2,iy:341.2,lx:288.3,ly:311.2},
        {L:70, ox:272.6,oy:322.0,ix:269.6,iy:338.8,lx:275.7,ly:308.7},
        {L:80, ox:261.3,oy:320.5,ix:259.9,iy:337.5,lx:262.9,ly:307.2},
        {L:90, ox:250.0,oy:320.0,ix:250.0,iy:337.0,lx:250.0,ly:306.5},
        {L:100,ox:238.7,oy:320.5,ix:240.1,iy:337.5,lx:237.1,ly:307.2},
        {L:110,ox:227.4,oy:322.0,ix:230.4,iy:338.8,lx:224.3,ly:308.7},
        {L:120,ox:216.4,oy:324.5,ix:220.8,iy:341.2,lx:211.7,ly:311.2},
        {L:130,ox:205.5,oy:327.8,ix:211.4,iy:343.8,lx:199.5,ly:314.9},
        {L:140,ox:195.1,oy:332.2,ix:202.2,iy:347.8,lx:187.6,ly:319.5},
        {L:150,ox:185.0,oy:337.4,ix:193.4,iy:352.1,lx:176.5,ly:325.3},
        {L:160,ox:175.4,oy:343.5,ix:185.2,iy:357.4,lx:165.4,ly:332.7},
        {L:170,ox:166.4,oy:350.4,ix:177.4,iy:363.5,lx:155.1,ly:340.1},
        {L:180,ox:158.1,oy:358.1,ix:170.1,iy:370.0,lx:145.4,ly:349.1},
      ] as {L:number,ox:number,oy:number,ix:number,iy:number,lx:number,ly:number}[]).map(({L,ox,oy,ix,iy,lx,ly}) => (
        <g key={L}>
          <line x1={ox} y1={oy} x2={ix} y2={iy} stroke="#000" strokeWidth={L===90?1.4:1}/>
          <text x={lx} y={ly} fontSize={L===90?9:8} fontWeight={L===90?'bold':undefined}
            textAnchor="middle" fill="#000">{L}</text>
        </g>
      ))}

      {/* Diamond */}
      <polygon points="250,450 291,409 250,367 209,409" fill="none" stroke="#000" strokeWidth="1.5"/>
      {/* Pitcher's mound */}
      <circle cx="250" cy="411" r="12" fill="none" stroke="#000" strokeWidth="1"/>
      <rect x="246" y="408.5" width="8" height="3" rx="0.5" fill="#333"/>
      {/* Bases */}
      <rect x="287" y="405" width="8" height="8" fill="#333"/>
      <g transform="rotate(45,250,367)"><rect x="246" y="363" width="8" height="8" fill="#333"/></g>
      <rect x="205" y="405" width="8" height="8" fill="#333"/>
      {/* Home plate */}
      <path d="M 243 453 L 257 453 L 257 447 L 250 442 L 243 447 Z" fill="#333"/>
      {/* Dugouts */}
      <rect x="308" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>
      <rect x="164" y="432" width="28" height="12" rx="2" fill="#eee" stroke="#000" strokeWidth="0.8"/>

      {/* ── Hit dots ── */}
      <defs>
        <linearGradient id="scFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/>
          <stop offset="50%" stopColor="#ff8800"/>
          <stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
      </defs>

      {hitDots.map((dot, i) => {
        const { x, y } = toSvg(dot.hcX, dot.hcY);
        const col = pitchColors(dot.pitchType).color;
        const isHit = ['single','double','triple','home_run'].includes(
          dot.result.toLowerCase().replace(/\s/g,'_')
        );
        const isOut = !isHit;
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={8}
              fill={isOut ? 'none' : col} fillOpacity={isOut ? 0 : 0.88}
              stroke={col} strokeWidth={isOut ? 2 : 1.2}/>
            {dot.isBarrel ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9" fontWeight="bold"
                fill="url(#scFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
            ) : dot.exitVelo !== null && dot.exitVelo >= 95 ? (
              <text x={x} y={y+4} textAnchor="middle" fontSize="9"
                fill={isOut ? col : '#fff'} fontWeight="bold">🔥</text>
            ) : null}
          </g>
        );
      })}

      {hitDots.length === 0 && (
        <text x={250} y={390} textAnchor="middle" fontSize="12" fill="#bbb">No balls in play</text>
      )}

      {/* Legend — matches zone chart style, centered at x=250 */}
      {(() => {
        const ly = 474;
        const lx = 250 - 107;
        return (
          <>
            <circle cx={lx + 5}  cy={ly - 4} r="4" fill="#888" opacity="0.88"/>
            <text x={lx + 13} y={ly} fontSize="10.5" fill="#000">hit</text>
            <circle cx={lx + 48} cy={ly - 4} r="4" fill="none" stroke="#888" strokeWidth="2"/>
            <text x={lx + 56} y={ly} fontSize="10.5" fill="#000">out</text>
            <text x={lx + 95}  y={ly} fontSize="10.5" fontWeight="bold"
              fill="url(#scFire)" stroke="#000" strokeWidth="2.5" strokeLinejoin="round" paintOrder="stroke">B</text>
            <text x={lx + 106} y={ly} fontSize="10.5" fill="#000">barrel</text>
            <text x={lx + 163} y={ly} fontSize="10.5">🔥</text>
            <text x={lx + 175} y={ly} fontSize="10.5" fill="#000">95+ev</text>
          </>
        );
      })()}
    </svg>
  );
}

// ─── At-bat breakdown panel ───────────────────────────────────────────────────

function AtBatPanel({ atBats, loading }: { atBats: AtBat[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="bg-[#0d1b2a] flex items-center justify-center" style={{ height: 80 }}>
        <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!atBats || atBats.length === 0) {
    return (
      <div className="bg-[#0d1b2a] flex items-center justify-center" style={{ height: 60 }}>
        <p className="text-gray-500 text-xs text-center px-4">No at-bat data</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-px">
      {atBats.map(ab => (
        <div key={ab.atBatNum} className="bg-[#0d1b2a] px-2 py-2 flex-shrink-0">
          {/* Header */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className="text-[10px] font-bold text-gray-500">AB {ab.atBatNum}</span>
            {ab.result && (
              <span className={`text-[10px] font-bold px-1.5 py-0 leading-4 ${resultColor(ab.result)}`}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[10px] text-gray-400 truncate">{ab.pitcherName}{ab.pitcherHand ? ` · ${ab.pitcherHand}HP` : ''}</span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col" style={{ gap: 4 }}>
            {ab.pitches.map((p, i) => {
              const col = PITCH_COLORS[p.pitchType];
              const abbrev = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0, 2).toUpperCase();
              return (
                <div key={i} className="flex flex-col">
                  <div className="flex items-center gap-1" style={{ lineHeight: '14px' }}>
                  {/* Type badge */}
                  <span
                    className="rounded px-1 font-bold flex-shrink-0"
                    style={{ backgroundColor: col?.bg || '#555', color: col?.text || '#fff', fontSize: 10, lineHeight: '14px' }}
                  >
                    {abbrev}
                  </span>

                  {/* Velo */}
                  {p.velo !== null && (
                    <span className="text-gray-200 font-semibold w-7 text-right flex-shrink-0" style={{ fontSize: 11 }}>
                      {p.velo.toFixed(0)}
                    </span>
                  )}

                  {/* Pitch result icon */}
                  {(() => {
                    const d = p.description.toLowerCase();
                    const isWhiff = d.includes('swinging_strike') || d.includes('swinging strike') || d.includes('foul_tip') || d === 'foul tip';
                    const isInPlay = d.includes('hit_into_play') || d.includes('in play');
                    const isTake = !isWhiff && !isInPlay && !d.includes('foul');
                    const isBarrel = isInPlay && p.exitVelo !== null && p.launchAngle !== null && (() => {
                      const ev = p.exitVelo!; const la = p.launchAngle!;
                      if (ev < 98) return false;
                      const delta = Math.min(ev, 116) - 98;
                      return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
                    })();
                    const is95ev = isInPlay && !isBarrel && p.exitVelo !== null && p.exitVelo >= 95;
                    const pitchCol = col?.color || '#888';
                    if (isBarrel) return (
                      <svg width="13" height="13" className="flex-shrink-0" style={{ overflow: 'visible' }}>
                        <defs><linearGradient id="abFire" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/></linearGradient></defs>
                        <text x="6.5" y="11" textAnchor="middle" fontSize="12" fontWeight="bold" fill="url(#abFire)" stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                      </svg>
                    );
                    if (is95ev) return <span className="flex-shrink-0" style={{ fontSize: 12, lineHeight: '13px' }}>🔥</span>;
                    if (isWhiff) return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <line x1="2" y1="2" x2="11" y2="11" stroke="#000" strokeWidth="3"/><line x1="11" y1="2" x2="2" y2="11" stroke="#000" strokeWidth="3"/>
                        <line x1="2" y1="2" x2="11" y2="11" stroke={pitchCol} strokeWidth="2"/><line x1="11" y1="2" x2="2" y2="11" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    );
                    if (isTake) return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill="none" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    );
                    return (
                      <svg width="13" height="13" className="flex-shrink-0">
                        <circle cx="6.5" cy="6.5" r="5" fill={pitchCol} stroke="#000" strokeWidth="0.6"/>
                      </svg>
                    );
                  })()}

                  {/* Description */}
                  <span className="text-gray-300 truncate min-w-0" style={{ fontSize: 10 }}>{cleanDesc(p.description)}</span>
                  </div>
                {/* Stats line */}
                {(p.batSpeed !== null || p.exitVelo !== null || p.hitDistance !== null) && (
                  <div className="pl-1 mt-1 flex gap-2">
                    {p.batSpeed !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.batSpeed.toFixed(1)} <span className="text-gray-500 font-normal">bs</span></span>}
                    {p.exitVelo !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.exitVelo.toFixed(0)} <span className="text-gray-500 font-normal">ev</span></span>}
                    {p.launchAngle !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.launchAngle.toFixed(0)}° <span className="text-gray-500 font-normal">la</span></span>}
                    {p.launchAngle !== null && p.hcX !== null && p.hcY !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{Math.round(90 - Math.atan2(p.hcX - 125, 208 - p.hcY) * (360 / Math.PI))}° <span className="text-gray-500 font-normal">sa</span></span>}
                    {p.hitDistance !== null && <span className="text-yellow-400 font-semibold" style={{ fontSize: 10 }}>{p.hitDistance} <span className="text-gray-500 font-normal">ft</span></span>}
                  </div>
                )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HitterDailyPage({ params, searchParams }: DailyPageProps) {
  const { id } = use(params);
  const { date: initialDate } = use(searchParams);

  // Try to resolve player from static DB
  const isNumeric = /^\d+$/.test(id);
  const player = isNumeric
    ? getPlayerById(parseInt(id))
    : getPlayerByName(decodeURIComponent(id));
  const playerId = player?.player_id ?? (isNumeric ? parseInt(id) : null);

  const [data, setData]               = useState<DailyData | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(initialDate ?? today());
  const [imageError, setImageError]   = useState(0);
  const [filterHR, setFilterHR]       = useState(false);
  const [playerBio, setPlayerBio]     = useState<{
    height?: string; weight?: number; birthDate?: string;
    pitchHand?: string; batSide?: string;
  } | null>(null);

  const fetchData = useCallback(async (date?: string, silent = false) => {
    if (!playerId) return;
    if (!silent) { setLoading(true); setError(null); }
    try {
      const res = await fetch(`/api/hitter-daily?playerId=${playerId}&date=${date ?? today()}`, { cache: 'no-store' });
      const json = await res.json();
      if (!playerBio && json.playerHeight) {
        setPlayerBio({
          height: json.playerHeight,
          weight: json.playerWeight,
          birthDate: json.playerBirthDate,
          pitchHand: json.playerPitchHand,
          batSide: json.playerBatSide,
        });
      }
      if (!res.ok) {
        if (!silent) {
          setError(json.error || 'Failed to load game data');
          if (json.availableDates) {
            setData(prev => prev ? { ...prev, availableDates: json.availableDates } : null);
          }
        }
      } else {
        setData(json);
        setSelectedDate(json.date);
      }
    } catch {
      if (!silent) setError('Network error - could not load game data');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchData(initialDate ?? undefined); }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh every 90s when viewing today
  useEffect(() => {
    const isViewingToday = selectedDate === today();
    if (!isViewingToday || loading) return;
    const interval = setInterval(() => fetchData(selectedDate, true), 90_000);
    return () => clearInterval(interval);
  }, [selectedDate, loading, fetchData]);

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    fetchData(date);
  };

  const displayName = player?.full_name ?? data?.playerName ?? `Player ${id}`;
  const availableDates = data?.availableDates ?? [];
  const gameLine = data?.gameLine;
  const gameInfo = data?.gameInfo;

  const imageSources = [
    playerId ? `https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:silo:current.png/w_426,q_auto:best/v1/people/${playerId}/headshot/silo/current` : null,
    playerId ? getMLBStaticPlayerImage(playerId, { width: 426 }) : null,
    playerId ? getESPNPlayerImage(playerId) : null,
    '/api/placeholder/400/400',
  ].filter(Boolean) as string[];
  const currentImage = imageSources[Math.min(imageError, imageSources.length - 1)];

  const teamLogo = player?.team
    ? getMLBTeamLogoUrl(player.team)
    : (gameInfo?.team ? getMLBTeamLogoUrl(gameInfo.team) : null);
  const opponentLogo = gameInfo?.opponent ? getMLBTeamLogoUrl(gameInfo.opponent) : null;

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-white">

      {/* Nav */}
      <header className="bg-[#16213e] border-b border-gray-700">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-blue-400 hover:text-blue-300 font-medium text-sm">
              ← Back to Hitters
            </Link>
            {player && (
              <Link
                href={`/player/${id}`}
                className="px-3 py-1.5 bg-[#0d1b2a] hover:bg-[#1a2940] border border-gray-600 hover:border-blue-500 text-gray-300 hover:text-white text-xs font-semibold transition-colors"
              >
                📊 Season Card
              </Link>
            )}
            <Link href="/pitchers" className="text-green-400 hover:text-green-300 font-medium text-sm">
              View Pitchers →
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto px-6 py-6" style={{ maxWidth: 1400 }}>

        {/* ── MAIN CARD ── */}
        <div className="flex justify-center mb-6">
        <div className="bg-[#16213e] p-6 inline-block">
          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-gray-400 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-[#0d1b2a] p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
          {/* Main layout: [photo + at-bats] | center */}
          <div className="flex gap-4 items-start">
            {/* LEFT COLUMN: photo + at-bats */}
            <div className="flex-shrink-0 flex flex-col gap-3 w-[220px] overflow-hidden">
              <div className="flex items-start gap-2">
                {(() => {
                  const flag = getCountryFlagUrl(gameInfo?.team ?? null, 80);
                  return flag ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={flag} alt={gameInfo?.team ?? ''} className="w-8 h-[22px] object-cover flex-shrink-0 mt-1" />
                  ) : null;
                })()}
                <div className="overflow-hidden flex-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage}
                    alt={displayName}
                    className="w-full h-auto"
                    onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                  />
                </div>
              </div>
              <AtBatPanel
                atBats={data?.pitchData?.atBats ?? []}
                loading={loading}
              />
            </div>

            {/* CENTER: name/info/stats centered, zone chart centered below */}
            <div className="flex flex-col items-center">

              {/* Name / Bio / Game info / Stats */}
              <div className="flex flex-col items-center mb-4">
                <div className="flex items-center gap-3 mb-0.5">
                  <h1 className="text-2xl font-bold">{displayName}</h1>
                  {teamLogo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={teamLogo} alt={player?.team || gameInfo?.team || ''} className="w-8 h-8 object-contain flex-shrink-0" />
                  )}
                </div>

                {/* Bio */}
                {(() => {
                  const age = calcAge(playerBio?.birthDate ?? null);
                  const parts: string[] = [];
                  if (playerBio?.height) parts.push(playerBio.height);
                  if (playerBio?.weight) parts.push(`${playerBio.weight} lbs`);
                  if (age !== null) parts.push(`Age ${age}`);
                  if (playerBio?.batSide && playerBio?.pitchHand) parts.push(`${playerBio.batSide}/${playerBio.pitchHand}`);
                  return parts.length > 0
                    ? <p className="text-sm text-gray-300 mb-1">{parts.join(' • ')}</p>
                    : null;
                })()}

                {/* Game info */}
                <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-gray-400 mb-2">
                  {(player?.team || gameInfo?.team) && (
                    <span className="font-bold text-white">{player?.team || gameInfo?.team}</span>
                  )}
                  {gameInfo && (
                    <>
                      <span>·</span>
                      <span>{gameInfo.date}</span>
                      <span>·</span>
                      <span className="flex items-center gap-1">
                        {gameInfo.isHome ? 'vs' : '@'}
                        {opponentLogo && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={opponentLogo} alt={gameInfo.opponent || ''} className="w-4 h-4 object-contain inline" />
                        )}
                        <span className="font-semibold text-white">{gameInfo.opponentFull || gameInfo.opponent}</span>
                      </span>
                    </>
                  )}
                </div>

                {/* Stats grid */}
                {gameLine && !loading && (
                  <div className="grid grid-cols-5 gap-1.5">
                    {[
                      { label: 'AB',  value: String(gameLine.ab) },
                      { label: 'H',   value: String(gameLine.h) },
                      { label: 'HR',  value: String(gameLine.hr) },
                      { label: 'RBI', value: String(gameLine.rbi) },
                      { label: 'BB',  value: String(gameLine.bb) },
                      { label: 'K',   value: String(gameLine.k) },
                      { label: '2B',  value: String(gameLine.doubles) },
                      { label: '3B',  value: String(gameLine.triples) },
                      { label: 'PA',  value: String(gameLine.pa) },
                      { label: 'SB',  value: String(gameLine.sb) },
                    ].map(s => (
                      <div key={s.label} className="rounded px-2 py-0.5 text-center bg-[#0d1b2a] min-w-[36px]">
                        <div className="text-[7px] text-gray-400 uppercase font-semibold">{s.label}</div>
                        <div className="text-xs font-bold">{s.value}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Zone chart + Spray chart */}
              {!loading && !error && (
                <div className="flex flex-col items-center gap-2">
                  <HitterZoneChart
                    rawDots={data?.pitchData?.rawDots ?? []}
                    heightIn={playerBio?.height ? (() => {
                      const m = playerBio.height!.match(/(\d+)'\s*(\d+)/);
                      return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : undefined;
                    })() : undefined}
                  />
                  <SprayChart hitDots={data?.pitchData?.hitDots ?? []} />
                </div>
              )}
              {loading && (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-[300px] h-[300px] bg-[#0d1b2a]" />
                  <div className="w-[300px] h-[300px] bg-[#0d1b2a]" />
                </div>
              )}
            </div>

          </div>


        </div>
        </div>

        {/* ── Date picker ── */}
        {availableDates.length > 0 && (
          <div className="bg-[#16213e] p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase">
                Game Log
                <span className="ml-2 text-gray-600 font-normal normal-case">
                  {filterHR
                    ? `${availableDates.filter(d => d.hr > 0).length} HR games`
                    : `${availableDates.length} games`}
                </span>
              </h3>
              <button
                onClick={() => setFilterHR(v => !v)}
                className={`px-2.5 py-1 text-xs font-bold transition-colors border ${
                  filterHR
                    ? 'bg-yellow-500/20 border-yellow-400/60 text-yellow-300'
                    : 'bg-[#0d1b2a] border-gray-600 text-gray-400 hover:border-yellow-500 hover:text-yellow-300'
                }`}
              >
                ⚾ HR Only
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {availableDates.filter(d => !filterHR || d.hr > 0).map((d, i) => {
                const isSelected = d.date === selectedDate;
                return (
                  <button
                    key={`${d.date}-${d.gamePk ?? i}`}
                    onClick={() => handleDateChange(d.date)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      isSelected
                        ? 'bg-blue-600 text-white'
                        : 'bg-[#0d1b2a] text-gray-300 hover:bg-[#1a2940] hover:text-white border border-gray-600'
                    }`}
                  >
                    <span className="font-semibold">{d.date}</span>
                    <span className="text-gray-400 ml-1">vs {d.opponent}</span>
                    <span className="ml-1">{d.h}/{d.ab}</span>
                    {d.hr > 0 && <span className="ml-1 text-yellow-400">{d.hr}HR</span>}
                  </button>
                );
              })}
              {filterHR && availableDates.filter(d => d.hr > 0).length === 0 && (
                <p className="text-gray-600 text-xs italic">No home run games found</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

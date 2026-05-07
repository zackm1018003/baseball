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
  hardHitPct: number | null; avgBatSpeed: number | null; fastSwingPct: number | null;
  xwoba: number | null; xba: number | null; xslg: number | null;
  whiffPct: number | null; chasePct: number | null; sweetSpotPct: number | null;
  zSwingPct: number | null; zContactPct: number | null; ozContactPct: number | null;
  bipCount: number; swingCount: number;
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

interface ZoneStat {
  zone: number; pitches: number; swings: number; contacts: number;
}

interface SeasonData {
  playerId: number;
  playerName: string | null; playerHeight: string | null;
  playerWeight: number | null; playerBirthDate: string | null;
  playerBatSide: string | null; playerPitchHand: string | null;
  season: string; level: string; team: string | null;
  totals: SeasonTotals | null;
  games: GameLog[];
  statcast: Statcast | null;
  rawDots: RawDot[];
  hitDots: HitDot[];
  zoneStats: ZoneStat[];
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

// ─── Batting Stats Panel ──────────────────────────────────────────────────────

// Approximate normal CDF → percentile rank (1–99)
function calcPct(value: number | null, mean: number, std: number, invert = false): number | null {
  if (value == null) return null;
  const z = (value - mean) / std;
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  const cdf = 0.5 * (1 + (z >= 0 ? 1 : -1) * erf);
  const p = Math.round(Math.min(99, Math.max(1, cdf * 100)));
  return invert ? 100 - p : p;
}

// Per-level baselines for percentile calculation.
// MLB: calibrated against Savant 2024-25 percentile distributions.
// AAA/Low-A: offense is higher (easier competition) so averages are elevated.
type LGBaselines = Record<string, { mean: number; std: number; inv?: boolean }>;

const LG_MLB: LGBaselines = {
  avg:         { mean: 0.243, std: 0.032 },
  obp:         { mean: 0.312, std: 0.038 },
  slg:         { mean: 0.390, std: 0.065 },
  ops:         { mean: 0.702, std: 0.098 },
  xwoba:       { mean: 0.297, std: 0.044 },
  xba:         { mean: 0.243, std: 0.032 },
  xslg:        { mean: 0.388, std: 0.068 },
  avgEv:       { mean: 88.5,  std: 3.2  },
  barrelPct:   { mean: 7.5,   std: 4.5  },
  hardHitPct:  { mean: 37.0,  std: 9.0  },
  sweetSpotPct:{ mean: 31.0,  std: 8.5  },
  avgBatSpeed: { mean: 70.5,  std: 3.5  },
  fastSwingPct:{ mean: 40.0,  std: 13.0 },
  zSwingPct:   { mean: 68.0,  std: 8.5  },
  chasePct:    { mean: 27.5,  std: 6.5,  inv: true },
  zContactPct: { mean: 84.0,  std: 7.0  },
  ozContactPct:{ mean: 59.0,  std: 9.0  },
  whiffPct:    { mean: 24.5,  std: 6.5,  inv: true },
  kPct:        { mean: 22.5,  std: 6.5,  inv: true },
  bbPct:       { mean: 8.2,   std: 3.2  },
};

// AAA: slightly better offense than MLB on average (pitcher development level)
const LG_AAA: LGBaselines = {
  avg:         { mean: 0.255, std: 0.034 },
  obp:         { mean: 0.328, std: 0.042 },
  slg:         { mean: 0.415, std: 0.072 },
  ops:         { mean: 0.743, std: 0.108 },
  xwoba:       { mean: 0.315, std: 0.048 },
  xba:         { mean: 0.255, std: 0.034 },
  xslg:        { mean: 0.412, std: 0.075 },
  avgEv:       { mean: 88.0,  std: 3.4  },
  barrelPct:   { mean: 7.0,   std: 4.2  },
  hardHitPct:  { mean: 36.0,  std: 9.5  },
  sweetSpotPct:{ mean: 30.5,  std: 9.0  },
  avgBatSpeed: { mean: 70.0,  std: 3.8  },
  fastSwingPct:{ mean: 38.0,  std: 13.5 },
  zSwingPct:   { mean: 67.0,  std: 9.0  },
  chasePct:    { mean: 28.5,  std: 7.0,  inv: true },
  zContactPct: { mean: 82.0,  std: 8.0  },
  ozContactPct:{ mean: 57.0,  std: 10.0 },
  whiffPct:    { mean: 25.5,  std: 7.0,  inv: true },
  kPct:        { mean: 23.5,  std: 7.0,  inv: true },
  bbPct:       { mean: 9.0,   std: 3.5  },
};

// Low-A / Single-A: widest spread, younger players, higher variance
const LG_LOW_A: LGBaselines = {
  avg:         { mean: 0.245, std: 0.040 },
  obp:         { mean: 0.320, std: 0.048 },
  slg:         { mean: 0.390, std: 0.080 },
  ops:         { mean: 0.710, std: 0.118 },
  xwoba:       { mean: 0.305, std: 0.054 },
  xba:         { mean: 0.245, std: 0.040 },
  xslg:        { mean: 0.390, std: 0.082 },
  avgEv:       { mean: 87.0,  std: 3.8  },
  barrelPct:   { mean: 6.5,   std: 4.5  },
  hardHitPct:  { mean: 34.5,  std: 10.0 },
  sweetSpotPct:{ mean: 29.5,  std: 9.5  },
  avgBatSpeed: { mean: 69.0,  std: 4.0  },
  fastSwingPct:{ mean: 36.0,  std: 14.0 },
  zSwingPct:   { mean: 66.0,  std: 9.5  },
  chasePct:    { mean: 29.5,  std: 7.5,  inv: true },
  zContactPct: { mean: 80.0,  std: 9.0  },
  ozContactPct:{ mean: 55.0,  std: 11.0 },
  whiffPct:    { mean: 27.0,  std: 7.5,  inv: true },
  kPct:        { mean: 25.0,  std: 7.5,  inv: true },
  bbPct:       { mean: 9.5,   std: 4.0  },
};

function getLG(level: string | null | undefined): LGBaselines {
  if (level === 'AAA') return LG_AAA;
  if (level === 'Low-A') return LG_LOW_A;
  return LG_MLB;
}

function pctColor(p: number | null): string {
  if (p == null) return 'rgba(255,255,255,0.08)';
  const t = p / 100; // 0 → 1
  // Interpolate: deep blue (p=0) → slate mid (p=50) → deep red (p=100)
  // Anchors: blue rgb(37,99,235) · mid rgb(100,116,139) · red rgb(185,28,28)
  let r, g, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(37  + (100 - 37)  * s);
    g = Math.round(99  + (116 - 99)  * s);
    b = Math.round(235 + (139 - 235) * s);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(100 + (185 - 100) * s);
    g = Math.round(116 + (28  - 116) * s);
    b = Math.round(139 + (28  - 139) * s);
  }
  return `rgb(${r},${g},${b})`;
}

function StatBar({
  label, value, leagueKey,
}: {
  label: string;
  value: string | null;
  leagueKey: string | null; // key into LG, or null for no percentile
}) {
  // Look up percentile from the display value parsed back to number
  // (percentile and bar-fill both driven by leagueKey's calcPct)
  return null; // placeholder — real impl below via StatRow
}
// (StatBar is unused; we use StatRow directly)
void StatBar;

function StatRow({
  label, value, numValue, leagueKey, baselines,
}: {
  label: string;
  value: string | null;
  numValue: number | null;
  leagueKey: string | null;
  baselines: LGBaselines;
}) {
  const lg   = leagueKey ? baselines[leagueKey] ?? null : null;
  const p    = lg ? calcPct(numValue, lg.mean, lg.std, lg.inv) : null;
  const fill = p != null ? p / 100 : 0;
  const col  = pctColor(p);

  return (
    <div className="flex items-center gap-2 py-[3px]">
      {/* Label */}
      <div className="text-right text-[10px] text-gray-400 leading-tight flex-shrink-0" style={{ width: 86 }}>
        {label}
      </div>
      {/* Bar + percentile bubble */}
      <div className="flex-1 relative flex-shrink-0" style={{ height: 20 }}>
        {/* Track */}
        <div className="absolute inset-0 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
        {/* Fill */}
        {fill > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0 rounded-sm"
            style={{ width: `${(fill * 100).toFixed(1)}%`, background: col, transition: 'width 0.3s ease' }}
          />
        )}
        {/* Percentile bubble at right edge of fill */}
        {p != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full font-bold text-white select-none"
            style={{
              left:       `calc(${(fill * 100).toFixed(1)}% - 11px)`,
              width:      22, height: 22,
              fontSize:   9,
              background: col,
              border:     '1.5px solid rgba(0,0,0,0.35)',
              boxShadow:  '0 1px 3px rgba(0,0,0,0.5)',
              zIndex:     2,
              minWidth:   22,
            }}
          >
            {p}
          </div>
        )}
      </div>
      {/* Raw value */}
      <div className="text-right text-[11px] font-bold text-white tabular-nums flex-shrink-0" style={{ width: 40 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-[#212945] my-1" />;
}

function BattingStatsPanel({ totals, statcast, level }: {
  totals: SeasonTotals | null; statcast: Statcast | null; level: string | null;
}) {
  const pa    = totals?.pa ?? 0;
  const kPct  = pa > 0 ? (totals!.k  / pa) * 100 : null;
  const bbPct = pa > 0 ? (totals!.bb / pa) * 100 : null;
  const LG    = getLG(level);

  const fmt3   = (v: number | null) => v != null ? v.toFixed(3).replace(/^0\./, '.') : null;
  const fmtPct = (v: number | null) => v != null ? v.toFixed(1) + '%' : null;
  const fmtNum = (v: number | null) => v != null ? v.toFixed(1) : null;

  return (
    <div className="bg-[#0f1117] border border-[#212945] flex-shrink-0" style={{ width: 272 }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#212945] flex items-center gap-2">
        <span className="text-sm">⚾</span>
        <span className="text-[10px] font-bold text-white uppercase tracking-widest">Batting</span>
      </div>

      <div className="px-3 py-2">

        {/* Expected stats */}
        {(statcast?.xwoba != null || statcast?.xba != null || statcast?.xslg != null) && (<>
          <Divider />
          {statcast?.xwoba != null && <StatRow label="xwOBA" numValue={statcast.xwoba} value={fmt3(statcast.xwoba)} leagueKey="xwoba" baselines={LG} />}
          {statcast?.xba   != null && <StatRow label="xBA"   numValue={statcast.xba}   value={fmt3(statcast.xba)}   leagueKey="xba"   baselines={LG} />}
          {statcast?.xslg  != null && <StatRow label="xSLG"  numValue={statcast.xslg}  value={fmt3(statcast.xslg)}  leagueKey="xslg"  baselines={LG} />}
        </>)}

        {/* Contact quality */}
        {(statcast?.avgEv != null || statcast?.barrelPct != null || statcast?.hardHitPct != null || statcast?.sweetSpotPct != null) && (<>
          <Divider />
          {statcast?.avgEv        != null && <StatRow label="Avg Exit Velo"   numValue={statcast.avgEv}        value={fmtNum(statcast.avgEv)}        leagueKey="avgEv"        baselines={LG} />}
          {statcast?.barrelPct    != null && <StatRow label="Barrel %"        numValue={statcast.barrelPct}    value={fmtPct(statcast.barrelPct)}    leagueKey="barrelPct"    baselines={LG} />}
          {statcast?.hardHitPct   != null && <StatRow label="Hard-Hit %"      numValue={statcast.hardHitPct}   value={fmtPct(statcast.hardHitPct)}   leagueKey="hardHitPct"   baselines={LG} />}
          {statcast?.sweetSpotPct != null && <StatRow label="LA Sweet-Spot %" numValue={statcast.sweetSpotPct} value={fmtPct(statcast.sweetSpotPct)} leagueKey="sweetSpotPct" baselines={LG} />}
        </>)}

        {/* Bat speed */}
        {(statcast?.avgBatSpeed != null || statcast?.fastSwingPct != null) && (<>
          <Divider />
          {statcast?.avgBatSpeed  != null && <StatRow label="Bat Speed"    numValue={statcast.avgBatSpeed}  value={fmtNum(statcast.avgBatSpeed)}  leagueKey="avgBatSpeed"  baselines={LG} />}
          {statcast?.fastSwingPct != null && <StatRow label="Fast Swing %" numValue={statcast.fastSwingPct} value={fmtPct(statcast.fastSwingPct)} leagueKey="fastSwingPct" baselines={LG} />}
        </>)}

        {/* Plate discipline */}
        {(statcast?.whiffPct != null || statcast?.zSwingPct != null || statcast?.chasePct != null ||
          statcast?.zContactPct != null || statcast?.ozContactPct != null || kPct != null || bbPct != null) && (<>
          <Divider />
          {statcast?.zSwingPct    != null && <StatRow label="Z-Swing %"    numValue={statcast.zSwingPct}    value={fmtPct(statcast.zSwingPct)}    leagueKey="zSwingPct"    baselines={LG} />}
          {statcast?.chasePct     != null && <StatRow label="Chase %"      numValue={statcast.chasePct}     value={fmtPct(statcast.chasePct)}     leagueKey="chasePct"     baselines={LG} />}
          {statcast?.zContactPct  != null && <StatRow label="Z-Contact %"  numValue={statcast.zContactPct}  value={fmtPct(statcast.zContactPct)}  leagueKey="zContactPct"  baselines={LG} />}
          {statcast?.ozContactPct != null && <StatRow label="OZ Contact %"  numValue={statcast.ozContactPct} value={fmtPct(statcast.ozContactPct)} leagueKey="ozContactPct" baselines={LG} />}
          {statcast?.whiffPct     != null && <StatRow label="Whiff %"      numValue={statcast.whiffPct}     value={fmtPct(statcast.whiffPct)}     leagueKey="whiffPct"     baselines={LG} />}
          {kPct  != null          &&         <StatRow label="K %"          numValue={kPct}                  value={fmtPct(kPct)}                  leagueKey="kPct"         baselines={LG} />}
          {bbPct != null          &&         <StatRow label="BB %"         numValue={bbPct}                 value={fmtPct(bbPct)}                 leagueKey="bbPct"        baselines={LG} />}
        </>)}

      </div>
    </div>
  );
}

// ─── Zone Heat Chart ──────────────────────────────────────────────────────────
// Full zone with outer chase strips (zones 11-14).
// Inner cells (1-9): shows Swing% on top, Contact% below; colored by Contact%.
// Outer strips (11-14): shows Chase%; colored by chase rate.
// No toggle — all data shown at once.
//
// Statcast zone layout (batter's perspective, top of zone = high pitch):
//  1 | 2 | 3   high
//  4 | 5 | 6   middle
//  7 | 8 | 9   low
//  out-of-zone: 11=inside low, 12=outside low, 13=outside high, 14=inside high
//  (Savant actually: 11=low-away, 12=low-in, 13=high-in, 14=high-away from batter perspective)

const ZONE_ROWS = [[1,2,3],[4,5,6],[7,8,9]];
// Zone-specific contact% league avg (corners lower, heart higher)
const ZONE_LG_CON: Record<number, number> = { 1:77,2:83,3:77, 4:83,5:89,6:83, 7:77,8:83,9:77 };
const ZONE_CON_STD = 11;
// Chase zone lg avg (all outer zones) — chase/contact outside zone
const CHASE_LG_MEAN = 62, CHASE_STD = 11;

function zoneContactColor(con: number | null, lgMean: number, std: number): string {
  if (con == null) return 'rgba(255,255,255,0.06)';
  const z = (con - lgMean) / std;
  const t = Math.min(1, Math.max(0, (z + 2) / 4));
  let r, g, b: number;
  if (t < 0.5) {
    const s = t * 2;
    r = Math.round(37  + (100 - 37)  * s);
    g = Math.round(99  + (116 - 99)  * s);
    b = Math.round(235 + (139 - 235) * s);
  } else {
    const s = (t - 0.5) * 2;
    r = Math.round(100 + (185 - 100) * s);
    g = Math.round(116 + (28  - 116) * s);
    b = Math.round(139 + (28  - 139) * s);
  }
  return `rgba(${r},${g},${b},0.80)`;
}

function ZoneHeatChart({ zoneStats }: { zoneStats: ZoneStat[] }) {
  // Build lookup by zone number
  const zoneMap: Record<number, ZoneStat> = {};
  for (const z of zoneStats) zoneMap[z.zone] = z;

  const hasData = zoneStats.some(z => z.pitches > 0);

  // Layout dimensions
  const size    = 272;
  const pad     = 14;        // outer margin
  const strip   = 26;        // width of chase strips
  const gap     = 2;         // gap between strip and inner zone
  const titleH  = 16;        // title area height
  // Inner 3×3 grid fills the remaining space
  const innerX  = pad + strip + gap;
  const innerY  = pad + titleH + strip + gap;
  const innerW  = size - 2 * (pad + strip + gap);
  const innerH  = size - titleH - 2 * (pad + strip + gap);
  const cellW   = innerW / 3;
  const cellH   = innerH / 3;

  // helpers
  const swingPct   = (zs: ZoneStat | undefined) => zs && zs.pitches > 0 ? zs.swings   / zs.pitches * 100 : null;
  const contactPct = (zs: ZoneStat | undefined) => zs && zs.swings  > 0 ? zs.contacts / zs.swings  * 100 : null;
  const ozConPct   = (zs: { pitches:number; swings:number; contacts:number } | undefined) =>
    zs && zs.swings > 0 ? zs.contacts / zs.swings * 100 : null;
  const ozChasePct = (zs: { pitches:number; swings:number; contacts:number } | undefined) =>
    zs && zs.pitches > 0 ? zs.swings / zs.pitches * 100 : null;

  // Per-strip outer zones for the four sides:
  // top    = 13, 14  (high pitches)
  // bottom = 11, 12  (low pitches)
  // left   = 11, 14  (outer left)
  // right  = 12, 13  (outer right)
  const stripZone = (zones: number[]) => (zones).reduce((acc, z) => {
    const zs = zoneMap[z];
    if (zs) { acc.pitches += zs.pitches; acc.swings += zs.swings; acc.contacts += zs.contacts; }
    return acc;
  }, { pitches:0, swings:0, contacts:0 });

  const topStrip    = stripZone([13,14]);
  const botStrip    = stripZone([11,12]);
  const leftStrip   = stripZone([11,14]);
  const rightStrip  = stripZone([12,13]);

  const renderStrip = (agg: {pitches:number;swings:number;contacts:number}, x:number, y:number, w:number, h:number, horiz: boolean) => {
    const chase = ozChasePct(agg);
    const ozCon = ozConPct(agg);
    // Color by OZ-contact% (contact when swinging outside zone); fallback to neutral
    const fill  = zoneContactColor(ozCon, CHASE_LG_MEAN, CHASE_STD);
    const cx    = x + w / 2;
    const cy    = y + h / 2;
    return (
      <g key={`${x}-${y}`}>
        <rect x={x} y={y} width={w} height={h} fill={fill} stroke="rgba(255,255,255,0.10)" strokeWidth="0.8"/>
        {chase != null && (
          horiz ? (
            <>
              <text x={cx} y={cy - 3} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill="#fff">{chase.toFixed(0)}%</text>
              <text x={cx} y={cy + 8}  textAnchor="middle" fontSize="7"   fill="rgba(255,255,255,0.65)">
                {ozCon != null ? `Con:${ozCon.toFixed(0)}%` : 'chase'}
              </text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 2} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill="#fff" transform={`rotate(-90,${cx},${cy})`}>{chase.toFixed(0)}%</text>
            </>
          )
        )}
      </g>
    );
  };

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ background: '#0f1117', borderRadius: 2 }}>

        {/* Title */}
        <text x={size/2} y={pad + 11} textAnchor="middle" fontSize="10" fontWeight="600" fill="#e5e7eb">
          Swing % / Contact % by Zone
        </text>

        {!hasData && (
          <text x={size/2} y={size/2} textAnchor="middle" fontSize="11" fill="#6b7280">No data</text>
        )}

        {hasData && (
          <>
            {/* ── Outer chase strips ── */}
            {/* Top strip (high pitches: zones 13+14) */}
            {renderStrip(topStrip,   innerX,        pad + titleH,        innerW, strip, true)}
            {/* Bottom strip (low pitches: zones 11+12) */}
            {renderStrip(botStrip,   innerX,        innerY + innerH + gap, innerW, strip, true)}
            {/* Left strip (zones 11+14) */}
            {renderStrip(leftStrip,  pad,           innerY,               strip,  innerH, false)}
            {/* Right strip (zones 12+13) */}
            {renderStrip(rightStrip, innerX + innerW + gap, innerY,      strip,  innerH, false)}

            {/* ── Inner 3×3 grid ── */}
            {ZONE_ROWS.map((row, ri) =>
              row.map((zNum, ci) => {
                const zs   = zoneMap[zNum];
                const swg  = swingPct(zs);
                const con  = contactPct(zs);
                const fill = zoneContactColor(con, ZONE_LG_CON[zNum], ZONE_CON_STD);
                const x    = innerX + ci * cellW;
                const y    = innerY + ri * cellH;
                const cx   = x + cellW / 2;
                const cy   = y + cellH / 2;
                return (
                  <g key={zNum}>
                    <rect x={x} y={y} width={cellW} height={cellH} fill={fill} stroke="rgba(255,255,255,0.14)" strokeWidth="0.8"/>
                    {/* Zone number tiny top-left */}
                    <text x={x+3} y={y+9} fontSize="7" fill="rgba(255,255,255,0.28)">{zNum}</text>
                    {/* Swing% */}
                    <text x={cx} y={cy - 4} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill="#fff">
                      {swg != null ? swg.toFixed(0)+'%' : '—'}
                    </text>
                    {/* Divider line */}
                    <line x1={x+6} y1={cy+1} x2={x+cellW-6} y2={cy+1} stroke="rgba(255,255,255,0.20)" strokeWidth="0.6"/>
                    {/* Contact% */}
                    <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill="rgba(255,255,255,0.85)">
                      {con != null ? con.toFixed(0)+'%' : '—'}
                    </text>
                  </g>
                );
              })
            )}

            {/* Strike zone outer border */}
            <rect x={innerX} y={innerY} width={innerW} height={innerH} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1.5"/>

            {/* Legend labels */}
            <text x={innerX + innerW/2} y={size - 4} textAnchor="middle" fontSize="7.5" fill="rgba(255,255,255,0.35)">
              Swg% / Con%  ·  color = contact rate
            </text>
          </>
        )}
      </svg>
    </div>
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

  const N_BKT = 10;
  const A_LO = -45 * Math.PI / 180, A_HI = 45 * Math.PI / 180;
  const A_SZ = (A_HI - A_LO) / N_BKT;
  const bkts = new Array(N_BKT).fill(0) as number[];
  for (const dot of hitDots) {
    const a = Math.atan2(dot.hcX - 125, 208 - dot.hcY);
    const bi = Math.floor((a - A_LO) / A_SZ);
    if (bi >= 0 && bi < N_BKT) bkts[bi]++;
  }
  const maxBkt = Math.max(...bkts, 1);
  const heatFill = (c: number): string => {
    if (c === 0) return 'rgba(30,100,255,0.08)';
    const t = c / maxBkt;
    if (t < 0.5) { const s = t * 2; return `rgba(${Math.round(s*255)},${Math.round(s*255)},255,${(0.10+s*0.25).toFixed(2)})`; }
    const s = (t - 0.5) * 2;
    return `rgba(255,${Math.round((1-s)*180)},${Math.round((1-s)*180)},${(0.28+s*0.30).toFixed(2)})`;
  };
  const WR = 350;
  const wedge = (a1: number, a2: number): string => {
    const x1=(250+Math.sin(a1)*WR).toFixed(1), y1=(450-Math.cos(a1)*WR).toFixed(1);
    const x2=(250+Math.sin(a2)*WR).toFixed(1), y2=(450-Math.cos(a2)*WR).toFixed(1);
    return `M 250 450 L ${x1} ${y1} A ${WR} ${WR} 0 0 1 ${x2} ${y2} Z`;
  };

  return (
    <svg width={272} height={272} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
      <defs>
        <linearGradient id="sscFire" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff2200"/><stop offset="50%" stopColor="#ff8800"/><stop offset="100%" stopColor="#ffdd00"/>
        </linearGradient>
        <clipPath id="ftClipS"><polygon points="250,450 402,298 342,220 250,186 158,220 98,298"/></clipPath>
      </defs>
      <text x={250} y={164} textAnchor="middle" fontSize="11" fontWeight="600" fill="#111827">Spray Angle Chart</text>
      <polygon points={`250,450 ${RF_CORNER.x},${RF_CORNER.y} ${RF_TOP.x},${RF_TOP.y} 250,186 ${LF_TOP.x},${LF_TOP.y} ${LF_CORNER.x},${LF_CORNER.y}`} fill="#f5f5f5"/>
      <g clipPath="url(#ftClipS)">
        {bkts.map((c, i) => <path key={i} d={wedge(A_LO+i*A_SZ, A_LO+(i+1)*A_SZ)} fill={heatFill(c)}/>)}
      </g>
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
            <circle cx={x} cy={y} r={isHit ? 8 : 6} fill={isHit ? col : 'none'} fillOpacity={isHit ? 0.88 : 0} stroke={col} strokeOpacity={isHit ? 1 : 0.45} strokeWidth={isHit ? 1.2 : 1.2}/>
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
        <circle cx={lx+48} cy={ly-4} r="4" fill="none" stroke="#888" strokeOpacity="0.45" strokeWidth="1.2"/>
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
  const statcast    = data?.statcast ?? null;

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

  const heightIn = data?.playerHeight
    ? (() => { const m = data.playerHeight!.match(/(\d+)'\s*(\d+)/); return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : undefined; })()
    : undefined;

  const hasChartData = (data?.zoneStats?.some(z => z.pitches > 0) ?? false) || (data?.hitDots?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-[#0a0b10] text-white">

      {/* Nav */}
      <header className="bg-[#0f1117] border-b border-[#212945]">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-gray-400 hover:text-white font-medium text-sm transition-colors">
              Hitters
            </Link>
            <Link
              href={`/player/${id}/daily`}
              className="px-3 py-1.5 bg-[#161b2c] hover:bg-[#232a42] border border-[#28304e] hover:border-white/20 text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide"
            >
              Daily Card
            </Link>
            <Link
              href={`/player/${id}/weekly`}
              className="px-3 py-1.5 bg-[#161b2c] hover:bg-[#232a42] border border-[#28304e] hover:border-white/20 text-gray-400 hover:text-white text-xs font-semibold transition-colors tracking-wide"
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
        <div className="bg-[#0f1117] p-6 inline-block border border-[#1e2440]">

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
                    className="bg-[#171b24] border border-[#28304e] text-white text-xs rounded px-1 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>

                {/* Stats grid */}
                {!loading && totals && (
                  <div className="border border-[#28304e]">
                    <div className="grid grid-cols-6 divide-x divide-[#28304e]">
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
                    <div className="grid grid-cols-6 divide-x divide-[#28304e] border-t border-[#28304e]">
                      {[
                        { label: 'K',   value: String(totals.k) },
                        { label: '2B',  value: String(totals.doubles) },
                        { label: '3B',  value: String(totals.triples) },
                        { label: 'PA',  value: String(totals.pa) },
                        { label: 'SB',  value: String(totals.sb) },
                        { label: 'AVG', value: fmtRate(totals.avg) },
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

          {/* BOTTOM ROW: batting stats panel (left) + charts (right) */}
          <div className="flex gap-4 items-start justify-center mt-0">

            {/* LEFT: Batting stats panel */}
            {!loading ? (
              <BattingStatsPanel totals={totals ?? null} statcast={statcast} level={data?.level ?? null} />
            ) : (
              <div className="flex-shrink-0 bg-[#171b24]" style={{ width: 272, height: 400 }} />
            )}

            {/* RIGHT: Zone chart + Spray chart */}
            <div className="flex flex-col gap-2 flex-shrink-0">
              {!loading && hasChartData ? (<>
                <ZoneHeatChart zoneStats={data!.zoneStats ?? []} />
                <SprayChart hitDots={data!.hitDots} batSide={data?.playerBatSide} playerImageUrl={currentImage} />
              </>) : loading ? (<>
                <div className="bg-[#171b24]" style={{ width: 272, height: 272 }} />
                <div className="bg-[#171b24]" style={{ width: 272, height: 272 }} />
              </>) : (
                <div className="flex items-center justify-center bg-[#171b24]" style={{ width: 272, height: 400 }}>
                  <p className="text-gray-400 text-xs text-center px-4">No Statcast pitch data available for {season}</p>
                </div>
              )}
            </div>

          </div>

        </div>
        </div>

        {/* ── Game Log ── */}
        {games.length > 0 && (
          <div className="bg-[#0f1117] p-4 mb-6 border border-[#1e2440]">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-gray-400 uppercase">
                Game Log
                <span className="ml-2 text-gray-400 font-normal normal-case">
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
                    : 'bg-[#171b24] border-[#28304e] text-gray-400 hover:border-yellow-500/60 hover:text-yellow-300'
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
                  className="px-3 py-1.5 text-xs font-medium transition-colors bg-[#171b24] text-gray-300 hover:bg-[#1e2438] hover:text-white border border-[#28304e]"
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
                <p className="text-gray-400 text-xs italic">No home run games found.</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

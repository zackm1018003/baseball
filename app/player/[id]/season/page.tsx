'use client';

import React, { use, useState, useEffect, useCallback, useRef } from 'react';
import { getPlayerById, getPlayerByName } from '@/lib/database';
import { getMLBStaticPlayerImage, getESPNPlayerImage } from '@/lib/mlb-images';
import { getMLBTeamLogoUrl, getParentOrgAbbr } from '@/lib/mlb-team-logos';
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

interface AtBatPitch {
  pitchNum: number;
  pitchType: string;
  velo: number | null;
  description: string;
  batSpeed: number | null;
  exitVelo: number | null;
  launchAngle: number | null;
  hitDistance: number | null;
  hcX: number | null;
  hcY: number | null;
  isBarrel: boolean;
}

interface FetchedAtBat {
  atBatNum: number;
  pitcherName: string;
  pitcherHand: string;
  result: string;
  pitches: AtBatPitch[];
  gameDate: string;
  opponent: string;
  isHome: boolean;
  gamePk: number | null;
  score: number;
}

interface Statcast {
  avgEv: number | null; barrelPct: number | null;
  avgLaHard: number | null; avgBatSpeed: number | null; fastSwingPct: number | null;
  maxEv: number | null; ev90: number | null; swingPct: number | null;
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
  season: string; level: string; activeSportId: number;
  availableLevels: { sportId: number; label: string }[];
  team: string | null; teamLogoId: number | null;
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
    // snake_case
    single: '1B', double: '2B', triple: '3B', home_run: 'HR',
    strikeout: 'K', strikeout_double_play: 'KDP',
    walk: 'BB', intent_walk: 'IBB',
    hit_by_pitch: 'HBP',
    field_out: 'Out', force_out: 'FC Out',
    fielders_choice: 'FC', fielders_choice_out: 'FC Out',
    grounded_into_double_play: 'GIDP',
    double_play: 'DP', triple_play: 'TP',
    sac_fly: 'SF', sac_fly_double_play: 'SF-DP',
    sac_bunt: 'SH', sac_bunt_double_play: 'SH-DP',
    catcher_interf: 'CI', other_out: 'Out',
    // camelCase
    homeRun: 'HR', strikeOut: 'K', strikeout_Double_Play: 'KDP',
    intentionalWalk: 'IBB', hitByPitch: 'HBP',
    fieldOut: 'Out', forceOut: 'FC Out',
    fieldersChoice: 'FC', fieldersChoiceOut: 'FC Out',
    groundedIntoDoublePlay: 'GIDP',
    doublePlay: 'DP', triplePlay: 'TP',
    sacFly: 'SF', sacFlyDoublePlay: 'SF-DP',
    sacBunt: 'SH', sacBuntDoublePlay: 'SH-DP',
    catcherInterference: 'CI', otherOut: 'Out',
    // Human-readable (MLB live feed event names)
    'Home Run': 'HR', 'Single': '1B', 'Double': '2B', 'Triple': '3B',
    'Strikeout': 'K', 'Strikeout Double Play': 'KDP',
    'Walk': 'BB', 'Intentional Walk': 'IBB',
    'Hit By Pitch': 'HBP',
    'Field Out': 'Out', 'Force Out': 'FC Out',
    'Fielders Choice': 'FC', 'Fielders Choice Out': 'FC Out',
    'Grounded Into Double Play': 'GIDP',
    'Double Play': 'DP', 'Triple Play': 'TP',
    'Sac Fly': 'SF', 'Sac Fly Double Play': 'SF-DP',
    'Sac Bunt': 'SH', 'Sac Bunt Double Play': 'SH-DP',
    'Catcher Interference': 'CI', 'Other Out': 'Out',
  };
  return map[events] || events.replace(/_/g, ' ');
}

function resultColor(events: string): string {
  if (['single','double','triple','home_run','homeRun',
       'Home Run','Single','Double','Triple'].includes(events))
    return 'bg-green-700 text-green-200';
  if (['strikeout','strikeOut','strikeout_double_play','field_out','fieldOut',
       'force_out','forceOut','grounded_into_double_play','groundedIntoDoublePlay',
       'double_play','doublePlay','triple_play','sac_fly','sacFly',
       'sac_fly_double_play','sac_bunt','sac_bunt_double_play',
       'other_out','otherOut','fielders_choice','fieldersChoice',
       'fielders_choice_out','fieldersChoiceOut',
       'Strikeout','Strikeout Double Play','Field Out','Force Out',
       'Grounded Into Double Play','Double Play','Triple Play',
       'Sac Fly','Sac Fly Double Play','Sac Bunt','Sac Bunt Double Play',
       'Other Out','Fielders Choice','Fielders Choice Out'].includes(events))
    return 'bg-red-900 text-red-300';
  if (['walk','intent_walk','intentionalWalk','hit_by_pitch','hitByPitch',
       'Walk','Intentional Walk','Hit By Pitch'].includes(events))
    return 'bg-walk text-outcome-fg';
  return 'bg-bone text-ink-2';
}

// Returns an oval badge background color for a stat, or null if average (no badge).
// pa = plate appearances; <50 PA returns null (no badge — small sample).
// Best → brand red oval, average → no badge (white text), worst → dark blue oval.
// Ordered from worst → best so SCALE_COLORS[0] = bottom 5th, last = top 5th.
// null = average band (no badge rendered).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const SCALE_COLORS: (string | null)[] = [
  '#163d6e', // <5th
  '#174678', // 5–9
  '#184f82', // 10–14
  '#19588c', // 15–19
  '#1a6196', // 20–24
  '#1b6aa0', // 25–29
  '#1c72aa', // 30–34
  '#1d7ab4', // 35–39
  null,      // 40–59 average — no badge
  '#8a0404', // 60–64
  '#9e0808', // 65–69
  '#b20e0e', // 70–74
  '#c41515', // 75–79
  '#d61d1d', // 80–84
  '#e82525', // 85–89
  '#f72e2e', // 90–94
  '#ff2d2d', // 95+ (title red)
];

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function statBgColor(value: number | null, leagueKey: string, level: string | null | undefined, pa?: number): string | null {
  if (value == null) return null;
  if (pa !== undefined && pa < 25) return null; // small sample — no badge
  const LG = getLG(level);
  const baseline = LG[leagueKey];
  if (!baseline) return null;
  const p = calcPct(value, baseline.mean, baseline.std, baseline.inv);
  if (p == null) return null;
  if (p >= 95) return '#ff2d2d';
  if (p >= 90) return '#f72e2e';
  if (p >= 85) return '#e82525';
  if (p >= 80) return '#d61d1d';
  if (p >= 75) return '#c41515';
  if (p >= 70) return '#b20e0e';
  if (p >= 65) return '#9e0808';
  if (p >= 60) return '#8a0404';
  if (p >= 40) return null;       // average — no badge
  if (p >= 35) return '#1d7ab4';
  if (p >= 30) return '#1c72aa';
  if (p >= 25) return '#1b6aa0';
  if (p >= 20) return '#1a6196';
  if (p >= 15) return '#19588c';
  if (p >= 10) return '#184f82';
  if (p >= 5)  return '#174678';
  return '#163d6e';
}

// Derive plate discipline stats from zone-by-zone pitch counts.
// Zones 1-9 = strike zone, zones 11-14 = out-of-zone.
// Used as fallback when Statcast doesn't cover the level (AAA / Low-A).
function calcDisciplineFromZones(zoneStats: ZoneStat[]): {
  zSwingPct: number | null; zContactPct: number | null;
  chasePct: number | null; ozContactPct: number | null; swingPct: number | null;
} {
  const iz = zoneStats.filter(z => z.zone >= 1 && z.zone <= 9);
  const oz = zoneStats.filter(z => z.zone >= 11 && z.zone <= 14);

  const izP = iz.reduce((s, z) => s + z.pitches,  0);
  const izSw = iz.reduce((s, z) => s + z.swings,   0);
  const izCo = iz.reduce((s, z) => s + z.contacts, 0);
  const ozP  = oz.reduce((s, z) => s + z.pitches,  0);
  const ozSw = oz.reduce((s, z) => s + z.swings,   0);
  const ozCo = oz.reduce((s, z) => s + z.contacts, 0);

  const totalP = izP + ozP;
  const totalSw = izSw + ozSw;

  return {
    zSwingPct:   izP  > 0 ? (izSw / izP  * 100) : null,
    zContactPct: izSw > 0 ? (izCo / izSw * 100) : null,
    chasePct:    ozP  > 0 ? (ozSw / ozP  * 100) : null,
    ozContactPct: ozSw > 0 ? (ozCo / ozSw * 100) : null,
    swingPct:    totalP > 0 ? (totalSw / totalP * 100) : null,
  };
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
  avgLaHard:   { mean: 13.2,  std: 10.0 },
  sweetSpotPct:{ mean: 31.0,  std: 8.5  },
  avgBatSpeed: { mean: 70.5,  std: 3.5  },
  fastSwingPct:{ mean: 40.0,  std: 13.0 },
  maxEv:       { mean: 109.0, std: 4.0  },
  ev90:        { mean: 103.5, std: 3.8  },
  swingPct:    { mean: 47.0,  std: 5.5  },
  zSwingPct:   { mean: 68.0,  std: 8.5  },
  chasePct:    { mean: 27.5,  std: 6.5,  inv: true },
  zContactPct: { mean: 84.0,  std: 7.0  },
  ozContactPct:{ mean: 59.0,  std: 9.0  },
  whiffPct:    { mean: 24.5,  std: 6.5,  inv: true },
  kPct:        { mean: 22.5,  std: 6.5,  inv: true },
  bbPct:       { mean: 8.2,   std: 3.2  },
};

// AAA (IL + PCL combined): near-MLB talent, pitcher development level
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
  avgLaHard:   { mean: 11.8,  std: 10.0 },
  sweetSpotPct:{ mean: 30.5,  std: 9.0  },
  avgBatSpeed: { mean: 70.0,  std: 3.8  },
  fastSwingPct:{ mean: 38.0,  std: 13.5 },
  maxEv:       { mean: 108.0, std: 4.2  },
  ev90:        { mean: 102.5, std: 4.0  },
  swingPct:    { mean: 47.5,  std: 6.0  },
  zSwingPct:   { mean: 67.0,  std: 9.0  },
  chasePct:    { mean: 28.5,  std: 7.0,  inv: true },
  zContactPct: { mean: 82.0,  std: 8.0  },
  ozContactPct:{ mean: 57.0,  std: 10.0 },
  whiffPct:    { mean: 25.5,  std: 7.0,  inv: true },
  kPct:        { mean: 23.5,  std: 7.0,  inv: true },
  bbPct:       { mean: 9.0,   std: 3.5  },
};

// Double-A: between AAA and High-A
const LG_AA: LGBaselines = {
  avg:         { mean: 0.248, std: 0.038 },
  obp:         { mean: 0.322, std: 0.044 },
  slg:         { mean: 0.400, std: 0.075 },
  ops:         { mean: 0.722, std: 0.112 },
  xwoba:       { mean: 0.308, std: 0.050 },
  xba:         { mean: 0.248, std: 0.038 },
  xslg:        { mean: 0.400, std: 0.077 },
  avgEv:       { mean: 87.5,  std: 3.5  },
  barrelPct:   { mean: 6.8,   std: 4.3  },
  avgLaHard:   { mean: 11.5,  std: 10.0 },
  sweetSpotPct:{ mean: 30.0,  std: 9.2  },
  avgBatSpeed: { mean: 69.5,  std: 3.9  },
  fastSwingPct:{ mean: 37.0,  std: 13.8 },
  maxEv:       { mean: 107.0, std: 4.5  },
  ev90:        { mean: 101.5, std: 4.2  },
  swingPct:    { mean: 47.0,  std: 6.5  },
  zSwingPct:   { mean: 66.0,  std: 9.0  },
  chasePct:    { mean: 29.0,  std: 7.2,  inv: true },
  zContactPct: { mean: 81.5,  std: 8.0  },
  ozContactPct:{ mean: 56.0,  std: 10.5 },
  whiffPct:    { mean: 26.0,  std: 7.2,  inv: true },
  kPct:        { mean: 24.0,  std: 7.2,  inv: true },
  bbPct:       { mean: 8.8,   std: 3.5  },
};

// High-A: solid prospects, more competitive than Low-A
const LG_HIGH_A: LGBaselines = {
  avg:         { mean: 0.247, std: 0.040 },
  obp:         { mean: 0.321, std: 0.046 },
  slg:         { mean: 0.392, std: 0.078 },
  ops:         { mean: 0.713, std: 0.115 },
  xwoba:       { mean: 0.306, std: 0.052 },
  xba:         { mean: 0.247, std: 0.040 },
  xslg:        { mean: 0.392, std: 0.080 },
  avgEv:       { mean: 87.2,  std: 3.7  },
  barrelPct:   { mean: 6.6,   std: 4.4  },
  avgLaHard:   { mean: 11.2,  std: 10.0 },
  sweetSpotPct:{ mean: 29.8,  std: 9.5  },
  avgBatSpeed: { mean: 69.2,  std: 4.0  },
  fastSwingPct:{ mean: 36.5,  std: 14.0 },
  maxEv:       { mean: 106.5, std: 4.8  },
  ev90:        { mean: 101.0, std: 4.5  },
  swingPct:    { mean: 46.5,  std: 7.0  },
  zSwingPct:   { mean: 65.5,  std: 9.2  },
  chasePct:    { mean: 29.5,  std: 7.5,  inv: true },
  zContactPct: { mean: 81.0,  std: 8.5  },
  ozContactPct:{ mean: 55.5,  std: 10.8 },
  whiffPct:    { mean: 26.5,  std: 7.5,  inv: true },
  kPct:        { mean: 24.5,  std: 7.5,  inv: true },
  bbPct:       { mean: 9.0,   std: 3.7  },
};

// Low-A / Single-A: younger players, higher variance
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
  avgLaHard:   { mean: 10.9,  std: 10.0 },
  sweetSpotPct:{ mean: 29.5,  std: 9.5  },
  avgBatSpeed: { mean: 69.0,  std: 4.0  },
  fastSwingPct:{ mean: 36.0,  std: 14.0 },
  maxEv:       { mean: 106.0, std: 5.0  },
  ev90:        { mean: 100.5, std: 4.8  },
  swingPct:    { mean: 46.0,  std: 7.5  },
  zSwingPct:   { mean: 66.0,  std: 9.5  },
  chasePct:    { mean: 29.5,  std: 7.5,  inv: true },
  zContactPct: { mean: 80.0,  std: 9.0  },
  ozContactPct:{ mean: 55.0,  std: 11.0 },
  whiffPct:    { mean: 27.0,  std: 7.5,  inv: true },
  kPct:        { mean: 25.0,  std: 7.5,  inv: true },
  bbPct:       { mean: 9.5,   std: 4.0  },
};

// ACL + FCL combined (Arizona & Florida Complex Leagues): rookie/complex level
const LG_ROOKIE: LGBaselines = {
  avg:         { mean: 0.238, std: 0.045 },
  obp:         { mean: 0.315, std: 0.052 },
  slg:         { mean: 0.375, std: 0.088 },
  ops:         { mean: 0.690, std: 0.130 },
  xwoba:       { mean: 0.300, std: 0.058 },
  xba:         { mean: 0.238, std: 0.045 },
  xslg:        { mean: 0.375, std: 0.090 },
  avgEv:       { mean: 86.5,  std: 4.0  },
  barrelPct:   { mean: 6.0,   std: 4.8  },
  avgLaHard:   { mean: 8.6,   std: 10.0 },
  sweetSpotPct:{ mean: 29.0,  std: 10.0 },
  avgBatSpeed: { mean: 68.5,  std: 4.2  },
  fastSwingPct:{ mean: 35.0,  std: 14.5 },
  maxEv:       { mean: 105.0, std: 5.5  },
  ev90:        { mean: 99.5,  std: 5.2  },
  swingPct:    { mean: 45.5,  std: 8.0  },
  zSwingPct:   { mean: 64.5,  std: 9.5  },
  chasePct:    { mean: 30.5,  std: 8.0,  inv: true },
  zContactPct: { mean: 79.0,  std: 9.5  },
  ozContactPct:{ mean: 54.0,  std: 11.5 },
  whiffPct:    { mean: 28.0,  std: 8.0,  inv: true },
  kPct:        { mean: 26.0,  std: 8.0,  inv: true },
  bbPct:       { mean: 10.0,  std: 4.2  },
};

// Map level strings from the MLB Stats API to the correct baseline set.
// PCL (Pacific Coast League) and IL (International League) are both Triple-A.
// ACL (Arizona Complex League) and FCL (Florida Complex League) are both Rookie complex level.
function getLG(level: string | null | undefined): LGBaselines {
  if (!level) return LG_MLB;
  const l = level.toLowerCase();
  if (l.includes('aaa') || l.includes('triple') || l.includes('pcl') || l.includes('international')) return LG_AAA;
  if (l.includes(' aa') || l.includes('double-a') || l.includes('double a') || l === 'aa') return LG_AA;
  if (l.includes('high') || l.includes('a+') || l.includes('high-a')) return LG_HIGH_A;
  if (l.includes('low') || l.includes('single-a') || l.includes('single a')) return LG_LOW_A;
  if (l.includes('acl') || l.includes('fcl') || l.includes('rookie') || l.includes('complex') || l.includes('arizona') || l.includes('florida')) return LG_ROOKIE;
  return LG_MLB;
}

// Mini percentile bar rendered under each stat in the compact season card.
// 5 blue segments extend LEFT from center for below-avg; 5 red extend RIGHT for above-avg.
// Each segment = 10 percentile points. Only filled segments are colored; rest = dim track.
// The percentile number appears at the outer end. p=50 shows empty track (average–59) shows only the dim track.
function MiniPercentileBar({ value, leagueKey, level, pa }: {
  value: number | null; leagueKey: string; level: string | null | undefined; pa?: number;
}) {
  const LG       = getLG(level);
  const baseline = LG[leagueKey];
  if (!baseline || value == null || (pa !== undefined && pa < 25)) {
    return <div style={{ height: 16 }} />;
  }
  const p = calcPct(value, baseline.mean, baseline.std, baseline.inv);
  if (p == null) return <div style={{ height: 16 }} />;

  // p is an integer 1-99; p=50 shows empty track only
  const isBelow = p <= 49;
  const isAbove = p >= 51;

  // 5 shades per side, index 0 = closest to center
  const blueColors = ['#1d7ab4','#1a6196','#184f82','#174678','#163d6e'];
  const redColors  = ['#9e0808','#c41515','#e82525','#f72e2e','#ff2d2d'];

  // Blue bar i fills when p <= 49 - i*10  (ranges: 40-49, 30-39, 20-29, 10-19, 0-9)
  // Red  bar i fills when p >= 51 + i*10  (ranges: 51-60, 61-70, 71-80, 81-90, 91+)
  const EMPTY = 'rgba(255,255,255,0.12)';

  // Label color = outermost filled bar's color
  const lastBlueIdx = isBelow ? Math.min(4, Math.floor((49 - p) / 10)) : -1;
  const lastRedIdx  = isAbove ? Math.min(4, Math.floor((p - 51) / 10)) : -1;
  const labelColor  = isBelow ? blueColors[lastBlueIdx] : isAbove ? redColors[lastRedIdx] : '#555';

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 16, paddingTop: 2, paddingBottom: 1 }}>
      {/* Left label – visible only when below average */}
      <span style={{ fontSize: 6.5, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 18, textAlign: 'left', flexShrink: 0,
        color: isBelow ? labelColor : 'transparent' }}>
        {isBelow ? `${p}%` : ' '}
      </span>

      {/* Blue bars: row-reverse so bar[0] (40-49 range) sits closest to center */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row-reverse', gap: 1.5 }}>
        {blueColors.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 1,
            background: p <= (49 - i * 10) ? color : EMPTY }} />
        ))}
      </div>

      {/* Center gap */}
      <div style={{ width: 3, flexShrink: 0 }} />

      {/* Red bars: normal order so bar[0] (51-60 range) sits closest to center */}
      <div style={{ flex: 1, display: 'flex', gap: 1.5 }}>
        {redColors.map((color, i) => (
          <div key={i} style={{ flex: 1, height: 4, borderRadius: 1,
            background: p >= (51 + i * 10) ? color : EMPTY }} />
        ))}
      </div>

      {/* Right label – visible only when above average */}
      <span style={{ fontSize: 6.5, fontWeight: 800, lineHeight: 1, whiteSpace: 'nowrap',
        minWidth: 18, textAlign: 'right', flexShrink: 0,
        color: isAbove ? labelColor : 'transparent' }}>
        {isAbove ? `${p}%` : ' '}
      </span>
    </div>
  );
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
      <div className="text-right text-[10px] text-ink-3 leading-tight flex-shrink-0" style={{ width: 86 }}>
        {label}
      </div>
      {/* Bar + percentile bubble */}
      <div className="flex-1 relative flex-shrink-0" style={{ height: 20 }}>
        {/* Track */}
        <div className="absolute inset-0" style={{ background: 'rgba(255,255,255,0.06)' }} />
        {/* Fill */}
        {fill > 0 && (
          <div
            className="absolute left-0 top-0 bottom-0"
            style={{ width: `${(fill * 100).toFixed(1)}%`, background: col, transition: 'width 0.3s ease' }}
          />
        )}
        {/* Percentile bubble at right edge of fill */}
        {p != null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center font-bold text-deep-fg select-none"
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
      <div className="text-right text-[11px] font-bold text-deep-fg tabular-nums flex-shrink-0" style={{ width: 40 }}>
        {value ?? '—'}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-ink/20 my-1" />;
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
    <div className="bg-page border border-ink/20 flex-shrink-0" style={{ width: 272 }}>
      {/* Header */}
      <div className="px-3 py-2 border-b border-ink/20 flex items-center gap-2">
        <span className="text-sm">⚾</span>
        <span className="text-[10px] font-bold text-deep-fg uppercase tracking-widest">Batting</span>
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
        {(statcast?.avgEv != null || statcast?.barrelPct != null || statcast?.avgLaHard != null || statcast?.sweetSpotPct != null) && (<>
          <Divider />
          {statcast?.avgEv        != null && <StatRow label="Avg Exit Velo"   numValue={statcast.avgEv}        value={fmtNum(statcast.avgEv)}        leagueKey="avgEv"        baselines={LG} />}
          {statcast?.barrelPct    != null && <StatRow label="Barrel %"        numValue={statcast.barrelPct}    value={fmtPct(statcast.barrelPct)}    leagueKey="barrelPct"    baselines={LG} />}
          {statcast?.avgLaHard    != null && <StatRow label="95+ Avg LA"      numValue={statcast.avgLaHard}    value={`${fmtNum(statcast.avgLaHard)}°`} leagueKey="avgLaHard" baselines={LG} />}
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

// Heat color using the same anchor colors as the mini percentile bars:
// worst → #163d6e (dark blue), average → dark neutral, best → #ff2d2d (brand red).
// t = 0 (worst) … 0.5 (avg) … 1 (best), derived from z-score of contact%.
function zoneContactColor(con: number | null, lgMean: number, std: number, light = false): string {
  if (con == null) return light ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
  const z = (con - lgMean) / std;
  const t = Math.min(1, Math.max(0, (z + 2) / 4));
  let r, g, b: number;
  if (light) {
    // Light mode: steel blue → silver → red
    if (t < 0.5) {
      const s = t * 2;
      r = Math.round(90  + (190 - 90)  * s); // steel-blue(90)  → silver(190)
      g = Math.round(140 + (190 - 140) * s); // steel-blue(140) → silver(190)
      b = Math.round(210 + (190 - 210) * s); // steel-blue(210) → silver(190)
    } else {
      const s = (t - 0.5) * 2;
      r = Math.round(190 + (255 - 190) * s); // silver(190) → red(255)
      g = Math.round(190 + (45  - 190) * s); // silver(190) → red(45)
      b = Math.round(190 + (45  - 190) * s); // silver(190) → red(45)
    }
    return `rgba(${r},${g},${b},0.80)`;
  } else {
    if (t < 0.5) {
      const s = t * 2;                        // 0 at worst, 1 at avg
      r = Math.round(22  + (55  - 22)  * s); // #163d6e(22)  → neutral(55)
      g = Math.round(61  + (55  - 61)  * s); // #163d6e(61)  → neutral(55)
      b = Math.round(110 + (72  - 110) * s); // #163d6e(110) → neutral(72)
    } else {
      const s = (t - 0.5) * 2;               // 0 at avg, 1 at best
      r = Math.round(55  + (255 - 55)  * s); // neutral → #ff2d2d(255)
      g = Math.round(55  + (45  - 55)  * s); // neutral → #ff2d2d(45)
      b = Math.round(72  + (45  - 72)  * s); // neutral → #ff2d2d(45)
    }
    return `rgba(${r},${g},${b},0.85)`;
  }
}

function ZoneHeatChart({ zoneStats, light }: { zoneStats: ZoneStat[]; light?: boolean }) {
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
    const fill  = zoneContactColor(ozCon, CHASE_LG_MEAN, CHASE_STD, light);
    const cx    = x + w / 2;
    const cy    = y + h / 2;
    return (
      <g key={`${x}-${y}`}>
        <rect x={x} y={y} width={w} height={h} fill={fill} stroke={light ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.10)'} strokeWidth="0.8"/>
        {chase != null && (
          horiz ? (
            <>
              <text x={cx} y={cy - 3} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill={light ? '#111' : '#fff'}>{chase.toFixed(0)}%</text>
              <text x={cx} y={cy + 8}  textAnchor="middle" fontSize="7"   fill={light ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.65)'}>
                {ozCon != null ? `Con:${ozCon.toFixed(0)}%` : 'chase'}
              </text>
            </>
          ) : (
            <>
              <text x={cx} y={cy - 2} textAnchor="middle" fontSize="8.5" fontWeight="bold" fill={light ? '#111' : '#fff'} transform={`rotate(-90,${cx},${cy})`}>{chase.toFixed(0)}%</text>
            </>
          )
        )}
      </g>
    );
  };

  return (
    <div className="relative flex-shrink-0" style={{ width: 400, height: 400 }}>
      <svg width={400} height={400} viewBox={`0 0 ${size} ${size}`} style={{ background: light ? '#ffffff' : '#0f1117', borderRadius: 2 }}>

        {/* Title */}
        <text x={size/2} y={pad + 11} textAnchor="middle" fontSize="10" fontWeight="600" fill={light ? '#333333' : '#e5e7eb'}>
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
                const fill = zoneContactColor(con, ZONE_LG_CON[zNum], ZONE_CON_STD, light);
                const x    = innerX + ci * cellW;
                const y    = innerY + ri * cellH;
                const cx   = x + cellW / 2;
                const cy   = y + cellH / 2;
                return (
                  <g key={zNum}>
                    <rect x={x} y={y} width={cellW} height={cellH} fill={fill} stroke={light ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.14)'} strokeWidth="0.8"/>
                    {/* Zone number tiny top-left */}
                    <text x={x+3} y={y+9} fontSize="7" fill={light ? 'rgba(0,0,0,0.28)' : 'rgba(255,255,255,0.28)'}>{zNum}</text>
                    {/* Swing% */}
                    <text x={cx} y={cy - 4} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill={light ? '#111' : '#fff'}>
                      {swg != null ? swg.toFixed(0)+'%' : '—'}
                    </text>
                    {/* Divider line */}
                    <line x1={x+6} y1={cy+1} x2={x+cellW-6} y2={cy+1} stroke={light ? 'rgba(0,0,0,0.20)' : 'rgba(255,255,255,0.20)'} strokeWidth="0.6"/>
                    {/* Contact% */}
                    <text x={cx} y={cy + 13} textAnchor="middle" fontSize="9.5" fontWeight="bold" fill={light ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)'}>
                      {con != null ? con.toFixed(0)+'%' : '—'}
                    </text>
                  </g>
                );
              })
            )}

            {/* Strike zone outer border */}
            <rect x={innerX} y={innerY} width={innerW} height={innerH} fill="none" stroke={light ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)'} strokeWidth="1.5"/>

            {/* Legend labels */}
            <text x={innerX + innerW/2} y={size - 4} textAnchor="middle" fontSize="7.5" fill={light ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.35)'}>
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
  // Same anchor colors as mini percentile bars: #163d6e → dark neutral → #ff2d2d
  const heatFill = (c: number): string => {
    if (c === 0) return 'rgba(22,61,110,0.12)';   // dim blue hint when empty
    const t = c / maxBkt;                          // 0..1 (fraction of max bucket)
    let r, g, b: number, a: number;
    if (t < 0.5) {
      const s = t * 2;
      r = Math.round(22  + (60  - 22)  * s); // #163d6e → neutral
      g = Math.round(61  + (60  - 61)  * s);
      b = Math.round(110 + (75  - 110) * s);
      a = 0.18 + s * 0.22;
    } else {
      const s = (t - 0.5) * 2;
      r = Math.round(60  + (255 - 60)  * s); // neutral → #ff2d2d
      g = Math.round(60  + (45  - 60)  * s);
      b = Math.round(75  + (45  - 75)  * s);
      a = 0.40 + s * 0.32;
    }
    return `rgba(${r},${g},${b},${a.toFixed(2)})`;
  };
  const WR = 350;
  const wedge = (a1: number, a2: number): string => {
    const x1=(250+Math.sin(a1)*WR).toFixed(1), y1=(450-Math.cos(a1)*WR).toFixed(1);
    const x2=(250+Math.sin(a2)*WR).toFixed(1), y2=(450-Math.cos(a2)*WR).toFixed(1);
    return `M 250 450 L ${x1} ${y1} A ${WR} ${WR} 0 0 1 ${x2} ${y2} Z`;
  };

  return (
    <svg width={400} height={400} viewBox="70 120 370 370" style={{ background: '#f5f3ef' }}>
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

// ─── Top Game Highlights ──────────────────────────────────────────────────────
// Fetches pitch-sequence data for the player's most productive at-bats
// (barrel > HR > triple > double) and renders full pitch rows like AtBatPanel.

function TopGameHighlights({ games, loading, id, playerId, light }: {
  games: GameLog[]; loading: boolean; id: string; playerId: number | null; light?: boolean;
}) {
  const [topAtBats, setTopAtBats] = useState<FetchedAtBat[]>([]);
  const [fetching, setFetching] = useState(false);
  const fetchedRef = useRef<string>('');

  useEffect(() => {
    if (loading || games.length === 0 || !playerId) return;

    // Fingerprint: re-fetch only when the game set actually changes
    const fp = `${playerId}-${games.length}-${games[0]?.date ?? ''}`;
    if (fetchedRef.current === fp) return;
    fetchedRef.current = fp;

    // Candidate games: anything with a HR, 2B, or 3B (we'll refine at AB level)
    // Fall back to top games by hit total if no extra-base hits
    const withXbh = games.filter(g => g.hr > 0 || g.doubles > 0 || g.triples > 0);
    const candidates = (withXbh.length >= 4 ? withXbh : games)
      .map(g => ({ ...g, score: g.hr * 10 + g.triples * 4 + g.doubles * 3 + g.h }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    if (candidates.length === 0) { setTopAtBats([]); return; }

    setFetching(true);

    Promise.all(
      candidates.map(async g => {
        try {
          const gpParam = g.gamePk ? `&gamePk=${g.gamePk}` : '';
          const res = await fetch(`/api/hitter-daily?playerId=${playerId}&date=${g.date}${gpParam}`);
          const json = await res.json();
          const atBats = (json?.pitchData?.atBats ?? []) as {
            atBatNum: number; pitcherName: string; pitcherHand: string;
            result: string; pitches: AtBatPitch[];
          }[];
          return { atBats, game: g };
        } catch {
          return { atBats: [], game: g };
        }
      })
    ).then(results => {
      const all: FetchedAtBat[] = [];
      for (const { atBats, game } of results) {
        for (const ab of atBats) {
          const hasBarrel = ab.pitches.some(p => p.isBarrel);
          const result = ab.result?.toLowerCase().replace(/_/g, '') ?? '';
          const score = hasBarrel          ? 4
            : result === 'homerun'         ? 3
            : result === 'triple'          ? 2
            : result === 'double'          ? 1
            : 0;
          if (score > 0) {
            all.push({
              ...ab,
              gameDate: game.date,
              opponent: game.opponent,
              isHome:   game.isHome,
              gamePk:   game.gamePk ?? null,
              score,
            });
          }
        }
      }
      all.sort((a, b) => b.score - a.score);
      setTopAtBats(all.slice(0, 4));
      setFetching(false);
    }).catch(() => setFetching(false));
  }, [games, loading, playerId]);

  const cardStyle: React.CSSProperties = { flex: '0 0 calc(25% - 6px)', minWidth: 0 };
  const abStyle = light ? { background: '#f8f8f8', border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } : {};
  const isLoading = loading || fetching;

  if (isLoading) {
    return (
      <>
        {[0,1,2,3].map(i => (
          <div key={i} className={light ? '' : 'bg-[#171b24]'} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.3 }} />
        ))}
      </>
    );
  }

  if (topAtBats.length === 0) {
    return (
      <>
        {[0,1,2,3].map(i => (
          <div key={i} className={`flex items-center justify-center ${light ? '' : 'bg-[#171b24]'}`} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.2 }}>
            {i === 1 && <p className="text-[9px] text-center px-2" style={{ color: 'var(--color-ink-5)' }}>No hit data</p>}
          </div>
        ))}
      </>
    );
  }

  const padded: (FetchedAtBat | null)[] = [
    ...topAtBats,
    ...Array(Math.max(0, 4 - topAtBats.length)).fill(null),
  ];

  return (
    <>
      {padded.map((ab, idx) => ab ? (
        <Link
          key={`${ab.gameDate}-${ab.atBatNum}-${idx}`}
          href={`/player/${id}/daily?date=${ab.gameDate}${ab.gamePk ? `&gamePk=${ab.gamePk}` : ''}`}
          className={`px-2 py-2 transition-colors block ${light ? '' : 'bg-[#171b24] hover:bg-[#1e2330]'}`}
          style={{ ...cardStyle, ...abStyle }}
        >
          {/* Header */}
          <div className="flex items-center gap-1 mb-1.5 flex-nowrap min-w-0">
            <span className="text-[11px] font-bold flex-shrink-0" style={{ color: 'var(--color-ink-5)' }}>
              {ab.gameDate.slice(5)}
            </span>
            {ab.result && (
              <span className={`text-[11px] font-bold px-1 py-0 leading-5 whitespace-nowrap flex-shrink-0 ${resultColor(ab.result)}`}
                style={resultColor(ab.result) !== 'bg-bone text-ink-2' ? { textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' } : {}}>
                {cleanResult(ab.result)}
              </span>
            )}
            <span className="text-[11px] truncate min-w-0" style={{ color: 'var(--color-deep-fg-3)' }}>
              {ab.isHome ? 'vs' : '@'} {ab.opponent}
            </span>
          </div>

          {/* Pitch rows */}
          <div className="flex flex-col" style={{ gap: 5 }}>
            {ab.pitches.map((p, i) => {
              const col     = PITCH_COLORS[p.pitchType];
              const abbrev  = PITCH_ABBREV[p.pitchType] || p.pitchType.slice(0, 2).toUpperCase();
              const d       = p.description.toLowerCase();
              const isWhiff = d.includes('swinging_strike') || d.includes('swinging strike') || d.includes('foul_tip') || d === 'foul tip';
              const isInPlay = d.includes('hit_into_play') || d.includes('in play');
              const isTake  = !isWhiff && !isInPlay && !d.includes('foul');
              const isBarrel = isInPlay && p.isBarrel;
              const is95ev  = isInPlay && !isBarrel && p.exitVelo !== null && p.exitVelo >= 95;
              const pitchCol = col?.color || '#888';

              return (
                <div key={i} className="flex flex-col px-0.5">
                  <div className="flex items-center gap-1" style={{ lineHeight: '16px' }}>
                    {/* Type badge */}
                    <span
                      className="rounded px-1 font-bold flex-shrink-0"
                      style={{ backgroundColor: col?.bg || '#555', color: col?.text || '#fff', fontSize: 12, lineHeight: '16px' }}
                    >
                      {abbrev}
                    </span>

                    {/* Velo */}
                    {p.velo !== null && (
                      <span className="font-semibold w-10 text-right flex-shrink-0" style={{ fontSize: 13, color: 'var(--color-deep-fg)' }}>
                        {p.velo.toFixed(1)}
                      </span>
                    )}

                    {/* Outcome icon */}
                    {isBarrel ? (
                      <svg width="16" height="16" className="flex-shrink-0" style={{ overflow: 'visible' }}>
                        <defs>
                          <linearGradient id={`hlFire${idx}${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%"   stopColor="#ff2200"/>
                            <stop offset="50%"  stopColor="#ff8800"/>
                            <stop offset="100%" stopColor="#ffdd00"/>
                          </linearGradient>
                        </defs>
                        <text x="8" y="13" textAnchor="middle" fontSize="14" fontWeight="bold"
                          fill={`url(#hlFire${idx}${i})`} stroke="#000" strokeWidth="2" strokeLinejoin="round" paintOrder="stroke">B</text>
                      </svg>
                    ) : is95ev ? (
                      <span className="flex-shrink-0" style={{ fontSize: 14, lineHeight: '16px' }}>🔥</span>
                    ) : isWhiff ? (
                      <svg width="16" height="16" className="flex-shrink-0">
                        <line x1="2" y1="2" x2="14" y2="14" stroke="#000" strokeWidth="3"/>
                        <line x1="14" y1="2" x2="2" y2="14" stroke="#000" strokeWidth="3"/>
                        <line x1="2" y1="2" x2="14" y2="14" stroke={pitchCol} strokeWidth="2"/>
                        <line x1="14" y1="2" x2="2" y2="14" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    ) : isTake ? (
                      <svg width="16" height="16" className="flex-shrink-0">
                        <circle cx="8" cy="8" r="6" fill="none" stroke={pitchCol} strokeWidth="2"/>
                      </svg>
                    ) : (
                      <svg width="16" height="16" className="flex-shrink-0">
                        <circle cx="8" cy="8" r="6" fill={pitchCol} stroke="#000" strokeWidth="0.6"/>
                      </svg>
                    )}

                    {/* Description */}
                    <span className="text-ink-2 truncate min-w-0" style={{ fontSize: 12 }}>
                      {cleanDesc(p.description)}
                    </span>
                  </div>

                  {/* Stats line */}
                  {(p.batSpeed !== null || p.exitVelo !== null || p.hitDistance !== null) && (
                    <div className="pl-1 mt-1 flex gap-2" style={{ position: 'relative' }}>
                      {p.batSpeed !== null && p.batSpeed >= 75 && (
                        <span style={{ position: 'absolute', left: -8, top: 0, fontSize: 11, lineHeight: '16px', pointerEvents: 'none' }}>⚡</span>
                      )}
                      {p.batSpeed   !== null && p.batSpeed >= 40 && (
                        <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>
                          {p.batSpeed.toFixed(1)} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>bs</span>
                        </span>
                      )}
                      {p.exitVelo   !== null && (
                        <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>
                          {p.exitVelo.toFixed(1)} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>ev</span>
                        </span>
                      )}
                      {p.launchAngle !== null && (
                        <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>
                          {p.launchAngle.toFixed(0)}° <span style={{ color: 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>la</span>
                        </span>
                      )}
                      {p.hitDistance !== null && (
                        <span className="text-yellow-400 font-semibold" style={{ fontSize: 13, textShadow: '-1px -1px 0 #000, 0 -1px 0 #000, 1px -1px 0 #000, 1px 0 0 #000, 1px 1px 0 #000, 0 1px 0 #000, -1px 1px 0 #000, -1px 0 0 #000' }}>
                          {p.hitDistance} <span style={{ color: 'var(--color-ink-5)', fontWeight: 400, textShadow: 'none' }}>ft</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Link>
      ) : (
        <div key={`empty-${idx}`} className={light ? '' : 'bg-[#171b24]'} style={{ ...cardStyle, minHeight: 80, ...(light ? { background: '#e8e8e8' } : {}), opacity: 0.2 }} />
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HitterSeasonPage({ params }: SeasonPageProps) {
  const { id } = use(params);

  const isNumeric = /^\d+$/.test(id);
  const player    = isNumeric ? getPlayerById(parseInt(id)) : getPlayerByName(decodeURIComponent(id));
  const playerId  = player?.player_id ?? (isNumeric ? parseInt(id) : null);

  const currentYear = new Date().getFullYear().toString();
  const [season, setSeason]         = useState<string>(currentYear);
  const [sportId, setSportId]       = useState<number | null>(null); // null = auto-detect
  const [data, setData]             = useState<SeasonData | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [imageError, setImageError] = useState(0);
  const [filterHR, setFilterHR]     = useState(false);

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
      const name = (player?.full_name ?? data?.playerName ?? 'card').replace(/\s+/g, '-');
      const a = document.createElement('a');
      a.download = `${name}-${season}-season.png`;
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

  const fetchData = useCallback(async (s: string, sid: number | null) => {
    if (!playerId) return;
    setLoading(true); setError(null);
    try {
      const url  = `/api/player-season?playerId=${playerId}&season=${s}${sid ? `&sportId=${sid}` : ''}`;
      const res  = await fetch(url, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => { fetchData(season, sportId); }, [fetchData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSeasonChange = (s: string) => {
    setSeason(s);
    setSportId(null); // reset to auto-detect when season changes
    fetchData(s, null);
  };

  const handleLevelChange = (sid: number) => {
    setSportId(sid);
    fetchData(season, sid);
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

  const rawTeam = data?.team || player?.team || null;
  // Primary: use numeric parentOrgId returned by the API (works for all MLB + MiLB levels
  // without any abbreviation lookup). Fallback to the abbreviation lookup chain.
  const parentOrgAbbr = rawTeam ? getParentOrgAbbr(rawTeam) : null;
  const teamLogo =
    (data?.teamLogoId ? `https://www.mlbstatic.com/team-logos/${data.teamLogoId}.svg` : null) ??
    (rawTeam          ? getMLBTeamLogoUrl(rawTeam)        : null) ??
    (parentOrgAbbr    ? getMLBTeamLogoUrl(parentOrgAbbr)  : null);

  const yearOptions: string[] = [];
  for (let y = parseInt(currentYear); y >= 2015; y--) yearOptions.push(y.toString());

  const games = data?.games ?? [];

  const heightIn = data?.playerHeight
    ? (() => { const m = data.playerHeight!.match(/(\d+)'\s*(\d+)/); return m ? parseInt(m[1]) * 12 + parseInt(m[2]) : undefined; })()
    : undefined;

  const hasChartData = (data?.zoneStats?.some(z => z.pitches > 0) ?? false) || (data?.hitDots?.length ?? 0) > 0;

  const [light, setLight] = useState(false);
  const B = '2px solid #000000';          // light-mode section border
  const th = {
    statsBg:      light ? '#f7f7f7' : '#1a1a1a',
    banner:       light ? '#e8e8e8' : '#000000',
    label:        light ? '#000000' : '#777777',
    fg:           light ? '#000000' : '#ffffff',
    divider:      'divide-ink/10',
    border:       'border-ink/10',
    outerBorder:  light ? 'border-white/0'  : 'border-white/20', // unused for outer — use boxStyle
    boxStyle:     light ? { border: B, padding: 12, marginBottom: 12 } as React.CSSProperties
                        : { marginBottom: 12 } as React.CSSProperties,
    sectionStyle: light ? { border: B, padding: 12 } as React.CSSProperties : {},
    statsBoxStyle:light ? { border: B } as React.CSSProperties
                        : { border: '1px solid rgba(255,255,255,0.2)' } as React.CSSProperties,
    btnFg:        light ? 'rgba(0,0,0,0.55)'  : 'rgba(255,255,255,0.6)',
    btnBg:        light ? 'rgba(0,0,0,0.05)'  : 'rgba(255,255,255,0.08)',
    btnBorder:    light ? 'rgba(0,0,0,0.18)'  : 'rgba(255,255,255,0.18)',
    atBatBorder:  light ? { border: '1px solid #d4d4d4', borderLeft: '3px solid #ff2d2d', borderRadius: 4 } : {},
  };

  return (
    <div className="min-h-screen bg-page text-deep-fg" data-light={light ? 'true' : undefined}>

      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">
              Hitters
            </Link>
            <Link
              href={`/player/${id}/daily`}
              className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
            >
              Daily Card
            </Link>
            <Link
              href={`/player/${id}/weekly`}
              className="px-3 py-1.5 bg-panel hover:bg-bone border border-ink/20 hover:border-ink/40 text-ink-3 hover:text-ink text-xs font-semibold transition-colors tracking-wide"
            >
              Weekly Card
            </Link>
            <Link href="/pitchers" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">
              Pitchers
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto px-4 py-6" style={{ maxWidth: 1100 }}>

        {/* ── MAIN CARD ── */}
        <div className="mb-6">
        <div ref={cardRef} className="bg-page p-6 w-full" style={{ position: 'relative' }}>

          {/* Export buttons — excluded from image capture */}
          {!loading && (data || error) && (
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
                  background: th.btnBg, border: `1px solid ${th.btnBorder}`,
                  color: th.btnFg, borderRadius: 3, transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {capturing ? '…' : '↓ PNG'}
              </button>
            </div>
          )}

          {/* Loading / Error */}
          {loading && (
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin" />
              <span className="text-ink-3 text-xs">Loading...</span>
            </div>
          )}
          {!loading && error && (
            <div className="bg-bone p-2 mb-3 text-center">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          {/* TOP ROW: [Watermark] [Headshot] [Name/Bio/Season] [Team Logo] */}
          <div className="flex gap-3 items-stretch mx-auto" style={{ maxWidth: 860, ...th.boxStyle }}>
            {/* Col 0: Watermark — left of headshot */}
            <div className="flex-shrink-0 flex flex-col items-end justify-center" style={{ width: 76 }}>
              <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-right" style={{ color: '#ff2d2d' }}>By @Piratefan003</div>
              <div className="text-[8px] text-ink-4 leading-tight mt-0.5 text-right">
                Data: MLB Statcast<br />Baseball Savant · MLB Stats API
              </div>
            </div>

            {/* Col 1: Headshot only */}
            <div className="flex-shrink-0" style={{ width: 135 }}>
              <div className="w-full overflow-hidden bg-page" style={{ height: 135 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentImage}
                  alt={displayName}
                  className="w-full h-full object-cover object-top"
                  onError={() => setImageError(e => Math.min(e + 1, imageSources.length - 1))}
                />
              </div>
            </div>

            {/* Col 2: Name / Bio / Season info — centered */}
            <div className="flex-1 flex flex-col items-center justify-center text-center min-w-0">
              <h1 className="font-display text-2xl uppercase tracking-[0.02em] mb-1">{displayName}</h1>
              {(() => {
                const age = calcAge(data?.playerBirthDate ?? null);
                const parts: string[] = [];
                if (data?.playerHeight) parts.push(data.playerHeight);
                if (data?.playerWeight) parts.push(`${data.playerWeight} lbs`);
                if (age !== null) parts.push(`Age ${age}`);
                if (data?.playerBatSide && data?.playerPitchHand) parts.push(`${data.playerBatSide}/${data.playerPitchHand}`);
                return parts.length > 0
                  ? <p className="text-sm text-ink-3 mb-2">{parts.join(' · ')}</p>
                  : null;
              })()}
              <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-ink-4">
                {(data?.team || player?.team) && (
                  <span className="font-bold text-ink">{data?.team || player?.team}</span>
                )}
                <span>·</span>
                <span className="font-semibold text-ink">{season} Season</span>
                <span>·</span>
                <select
                  value={season}
                  onChange={e => handleSeasonChange(e.target.value)}
                  className="bg-transparent border border-ink/20 text-ink text-xs px-1 py-0.5 focus:outline-none"
                >
                  {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>

              {/* Level switcher — only shown when player has stats at multiple levels */}
              {!loading && (data?.availableLevels?.length ?? 0) > 1 && (
                <div className="flex items-center gap-1 mt-2 flex-wrap">
                  {data!.availableLevels.map(lv => {
                    const active = lv.sportId === (data?.activeSportId ?? 1);
                    return (
                      <button
                        key={lv.sportId}
                        onClick={() => handleLevelChange(lv.sportId)}
                        style={{
                          fontSize: 10, fontWeight: 700, letterSpacing: '0.05em',
                          padding: '2px 8px', borderRadius: 2,
                          background: active ? '#ff2d2d' : 'rgba(255,255,255,0.08)',
                          color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                          border: active ? '1px solid #ff2d2d' : '1px solid rgba(255,255,255,0.12)',
                          cursor: 'pointer', transition: 'all 0.15s',
                        }}
                      >
                        {lv.label}
                      </button>
                    );
                  })}
                </div>
              )}

              {!loading && !totals && !error && (
                <p className="text-ink-4 text-xs mt-2">No stats found for {season}.</p>
              )}
            </div>

            {/* Col 3: Team Logo */}
            <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ width: 135 }}>
              {teamLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={teamLogo} alt={rawTeam || ''} className="object-contain" style={{ width: 110, height: 110 }} />
              ) : (
                <div style={{ width: 135 }} />
              )}
            </div>

            {/* Col 4: Spacer — mirrors watermark width to keep name centered */}
            <div className="flex-shrink-0" style={{ width: 76 }} />
          </div>

          {/* SEASON STATS — dark boxes matching daily card style */}
          {!loading && totals && (
            <div className="w-full max-w-full mx-auto mb-3" style={th.statsBoxStyle}>
              <div className={`text-[10px] font-bold uppercase tracking-widest text-center py-0.5 border-b ${th.border}`} style={{ background: th.banner, color: '#ff2d2d' }}>
                {season} Season
              </div>
              <div className={`grid grid-cols-6 divide-x ${th.divider}`} style={{ background: th.statsBg }}>
                {[
                  { label: 'AVG', value: fmtRate(totals.avg) },
                  { label: 'OBP', value: fmtRate(totals.obp) },
                  { label: 'SLG', value: fmtRate(totals.slg) },
                  { label: 'OPS', value: fmtRate(totals.ops) },
                  { label: 'HR',  value: String(totals.hr) },
                  { label: 'RBI', value: String(totals.rbi) },
                ].map(s => (
                  <div key={s.label} className="text-center px-1 py-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
              <div className={`grid grid-cols-6 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                {[
                  { label: 'G',  value: String(games.length) },
                  { label: 'AB', value: String(totals.ab) },
                  { label: 'H',  value: String(totals.h) },
                  { label: 'BB', value: String(totals.bb) },
                  { label: 'K',  value: String(totals.k) },
                  { label: 'SB', value: String(totals.sb) },
                ].map(s => (
                  <div key={s.label} className="text-center px-1 py-0.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                    <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg }}>{s.value}</div>
                  </div>
                ))}
              </div>
              {statcast && (statcast.avgEv != null || statcast.barrelPct != null) && (() => {
                const isMLB = (data?.activeSportId ?? 1) === 1;
                const cols = isMLB
                  ? [
                      { label: 'Avg EV', value: statcast.avgEv      != null ? statcast.avgEv.toFixed(1)           : '—', num: statcast.avgEv,      lk: 'avgEv' },
                      { label: 'Brl%',   value: statcast.barrelPct   != null ? `${statcast.barrelPct.toFixed(1)}%` : '—', num: statcast.barrelPct,   lk: 'barrelPct' },
                      { label: '95+ LA', value: statcast.avgLaHard   != null ? `${statcast.avgLaHard.toFixed(1)}°`  : '—', num: statcast.avgLaHard,   lk: 'avgLaHard' },
                      { label: 'Avg BS', value: statcast.avgBatSpeed != null ? statcast.avgBatSpeed.toFixed(1)     : '—', num: statcast.avgBatSpeed, lk: 'avgBatSpeed' },
                    ]
                  : [
                      { label: 'Max EV', value: statcast.maxEv      != null ? statcast.maxEv.toFixed(1)           : '—', num: statcast.maxEv,      lk: 'maxEv' },
                      { label: 'EV90',   value: statcast.ev90        != null ? statcast.ev90.toFixed(1)            : '—', num: statcast.ev90,        lk: 'ev90' },
                      { label: 'Avg EV', value: statcast.avgEv      != null ? statcast.avgEv.toFixed(1)           : '—', num: statcast.avgEv,      lk: 'avgEv' },
                      { label: 'Brl%',   value: statcast.barrelPct   != null ? `${statcast.barrelPct.toFixed(1)}%` : '—', num: statcast.barrelPct,   lk: 'barrelPct' },
                      { label: '95+ LA', value: statcast.avgLaHard   != null ? `${statcast.avgLaHard.toFixed(1)}°`  : '—', num: statcast.avgLaHard,   lk: 'avgLaHard' },
                    ];
                return (
                  <div className={`divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg, display: 'grid', gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }}>
                    {cols.map(s => (
                      <div key={s.label} className="text-center px-1 py-0.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                        <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg, lineHeight: '19px' }}>{s.value}</div>
                        <MiniPercentileBar value={s.num} leagueKey={s.lk} level={data?.level} pa={totals?.pa} />
                      </div>
                    ))}
                  </div>
                );
              })()}
              {(() => {
                const zf = calcDisciplineFromZones(data?.zoneStats ?? []);
                const disc = {
                  zSwingPct:    statcast?.zSwingPct    ?? zf.zSwingPct,
                  zContactPct:  statcast?.zContactPct  ?? zf.zContactPct,
                  chasePct:     statcast?.chasePct     ?? zf.chasePct,
                  ozContactPct: statcast?.ozContactPct ?? zf.ozContactPct,
                  swingPct:     statcast?.swingPct     ?? zf.swingPct,
                };
                const hasAny = disc.zSwingPct != null || disc.zContactPct != null || disc.chasePct != null || disc.ozContactPct != null || disc.swingPct != null;
                if (!hasAny) return null;
                const fmt = (v: number | null) => v != null ? `${v.toFixed(1)}%` : '—';
                const level = data?.level ?? null;
                return (
                  <div className={`grid grid-cols-5 divide-x ${th.divider} border-t ${th.border}`} style={{ background: th.statsBg }}>
                    {[
                      { label: 'Swing%',     value: fmt(disc.swingPct),     num: disc.swingPct,     lk: 'swingPct' },
                      { label: 'Z-Swing%',   value: fmt(disc.zSwingPct),    num: disc.zSwingPct,    lk: 'zSwingPct' },
                      { label: 'Z-Contact%', value: fmt(disc.zContactPct),  num: disc.zContactPct,  lk: 'zContactPct' },
                      { label: 'Chase%',     value: fmt(disc.chasePct),     num: disc.chasePct,     lk: 'chasePct' },
                      { label: 'O-Contact%', value: fmt(disc.ozContactPct), num: disc.ozContactPct, lk: 'ozContactPct' },
                    ].map(s => (
                      <div key={s.label} className="text-center px-1 py-0.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: th.label }}>{s.label}</div>
                        <div className="font-bold font-display tabular-nums" style={{ fontSize: 15, color: th.fg, lineHeight: '19px' }}>{s.value}</div>
                        <MiniPercentileBar value={s.num} leagueKey={s.lk} level={level} pa={totals?.pa} />
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}


          {/* TOP 4 GAME HIGHLIGHTS + CHARTS */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap justify-center gap-2 w-full max-w-full mx-auto" style={th.sectionStyle}>
              <TopGameHighlights games={games} loading={loading} id={id} playerId={playerId} light={light} />
            </div>
            <div className="flex gap-3 justify-center flex-wrap" style={th.sectionStyle}>
              {!loading && hasChartData ? (
                <>
                  <ZoneHeatChart zoneStats={data!.zoneStats ?? []} light={light} />
                  <SprayChart hitDots={data!.hitDots} batSide={data?.playerBatSide} playerImageUrl={currentImage} />
                </>
              ) : loading ? (
                <>
                  <div className="bg-bone" style={{ width: 400, height: 400 }} />
                  <div className="bg-bone" style={{ width: 400, height: 400 }} />
                </>
              ) : null}
            </div>
          </div>

        </div>
        </div>

        {/* ── Game Log ── */}
        {games.length > 0 && (
          <div className="bg-page p-4 mb-6 border border-ink/30">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-ink-3 uppercase">
                Game Log
                <span className="ml-2 text-ink-3 font-normal normal-case">
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
                    : 'bg-bone border-ink/20 text-ink-3 hover:border-yellow-500/60 hover:text-yellow-300'
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
                  className="px-3 py-1.5 text-xs font-medium transition-colors bg-bone text-ink-2 hover:bg-panel hover:text-ink border border-ink/20"
                >
                  <span className="font-semibold">{g.date}</span>
                  <span className="text-ink-3 ml-1">{g.isHome ? 'vs' : '@'} {g.opponent}</span>
                  <span className="ml-1">{g.h}/{g.ab}</span>
                  {g.hr > 0 && <span className="ml-1 text-yellow-400">{g.hr}HR</span>}
                  {g.bb > 0 && <span className="ml-1 text-blue-400">{g.bb}BB</span>}
                  {g.k  > 0 && <span className="ml-1 text-red-400/70">{g.k}K</span>}
                </Link>
              ))}
              {filterHR && games.filter(g => g.hr > 0).length === 0 && (
                <p className="text-ink-3 text-xs italic">No home run games found.</p>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

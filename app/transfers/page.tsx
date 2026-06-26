'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

type StatRow = Record<string, string>;

interface TransferEntry {
  playerUrl: string;
  player:    string;
  fromTeam:  string;
  fromConf:  string;
  toTeam:    string;
  toConf:    string;
  year:      string;
  pos?:      string;
  woba: number | null;
  ops:  number | null;
  ba:   number | null;
  obp:  number | null;
  slg:  number | null;
  hr:   number | null;
  pa:   number | null;
  kPct: number | null;
  bbPct:number | null;
  iso:  number | null;
  siera?: number | null;
  ip?:   number | null;
  fip?:  number | null;
}

interface PortalPlayer {
  name:       string;
  pos:        string;
  fromSchool: string;
  toSchool:   string;
  classYear:  string;
  draftYear:  number;
  rank:       number | null;
}

// ─── Conference definitions ───────────────────────────────────────────────────

const CONFERENCES = [
  { id: 'sec',   name: 'SEC',           factor: 0.87 },
  { id: 'acc',   name: 'ACC',           factor: 0.90 },
  { id: 'big12', name: 'Big 12',        factor: 0.91 },
  { id: 'b10',   name: 'Big Ten',       factor: 0.93 },
  { id: 'pac12', name: 'Pac-12',        factor: 0.94 },
  { id: 'wcc',   name: 'WCC',           factor: 0.97 },
  { id: 'mwc',   name: 'Mountain West', factor: 1.00 },
  { id: 'aac',   name: 'American',      factor: 1.01 },
  { id: 'sun',   name: 'Sun Belt',      factor: 1.03 },
  { id: 'cusa',  name: 'CUSA',          factor: 1.05 },
  { id: 'mac',   name: 'MAC',           factor: 1.07 },
  { id: 'bwest', name: 'Big West',      factor: 1.06 },
  { id: 'socon', name: 'SoCon',         factor: 1.10 },
  { id: 'other', name: 'Other / NAIA',  factor: 1.13 },
] as const;

type ConfId = typeof CONFERENCES[number]['id'];
const CONF_MAP = Object.fromEntries(CONFERENCES.map(c => [c.id, c])) as Record<ConfId, typeof CONFERENCES[number]>;
const P5 = new Set<string>(['sec', 'acc', 'big12', 'b10', 'pac12']);

// ─── School → Conference mapping ──────────────────────────────────────────────

const SCHOOL_TO_CONF: Record<string, ConfId> = {
  // SEC
  'Alabama': 'sec', 'Arkansas': 'sec', 'Auburn': 'sec',
  'Florida': 'sec', 'Georgia': 'sec', 'Kentucky': 'sec',
  'LSU': 'sec', 'Mississippi State': 'sec', 'Missouri': 'sec',
  'Ole Miss': 'sec', 'South Carolina': 'sec', 'Tennessee': 'sec',
  'Texas A&M': 'sec', 'Vanderbilt': 'sec', 'Texas': 'sec',
  // ACC
  'Clemson': 'acc', 'Duke': 'acc', 'Florida State': 'acc',
  'Georgia Tech': 'acc', 'Louisville': 'acc', 'Miami': 'acc',
  'NC State': 'acc', 'North Carolina': 'acc', 'Notre Dame': 'acc',
  'Pitt': 'acc', 'Pittsburgh': 'acc', 'Syracuse': 'acc',
  'Virginia': 'acc', 'Virginia Tech': 'acc', 'Wake Forest': 'acc',
  'Boston College': 'acc', 'California': 'acc', 'Stanford': 'acc',
  'SMU': 'acc', 'Oregon State': 'acc', 'Washington State': 'acc',
  // Big 12
  'Arizona': 'big12', 'Arizona State': 'big12', 'Baylor': 'big12',
  'BYU': 'big12', 'Cincinnati': 'big12', 'Houston': 'big12',
  'Iowa State': 'big12', 'Kansas': 'big12', 'Kansas State': 'big12',
  'Oklahoma': 'big12', 'Oklahoma State': 'big12', 'TCU': 'big12',
  'Texas Tech': 'big12', 'UCF': 'big12', 'Central Florida': 'big12',
  'Utah': 'big12', 'West Virginia': 'big12',
  // Big Ten
  'Illinois': 'b10', 'Indiana': 'b10', 'Maryland': 'b10',
  'Michigan': 'b10', 'Michigan State': 'b10', 'Minnesota': 'b10',
  'Nebraska': 'b10', 'Northwestern': 'b10', 'Ohio State': 'b10',
  'Penn State': 'b10', 'Purdue': 'b10', 'Rutgers': 'b10',
  'Wisconsin': 'b10', 'UCLA': 'b10', 'USC': 'b10',
  'Washington': 'b10', 'Oregon': 'b10',
  // WCC
  'Gonzaga': 'wcc', 'San Diego': 'wcc', 'Pepperdine': 'wcc',
  'Santa Clara': 'wcc', "Saint Mary's": 'wcc', 'LMU': 'wcc',
  // Mountain West
  'Air Force': 'mwc', 'UNLV': 'mwc', 'Nevada': 'mwc',
  'New Mexico': 'mwc', 'Utah State': 'mwc', 'Boise State': 'mwc',
  'San Diego State': 'mwc', 'Fresno State': 'mwc', 'Colorado State': 'mwc',
  // American
  'Wichita State': 'aac', 'South Florida': 'aac', 'ECU': 'aac',
  'East Carolina': 'aac', 'Memphis': 'aac', 'Tulsa': 'aac',
  'Tulane': 'aac', 'Navy': 'aac', 'Army': 'aac',
  // Sun Belt
  'Louisiana Tech': 'sun', 'Texas State': 'sun', 'Georgia State': 'sun',
  'Coastal Carolina': 'sun', 'Louisiana': 'sun', 'Arkansas State': 'sun',
  'Troy': 'sun', 'South Alabama': 'sun', 'Appalachian State': 'sun',
  'Georgia Southern': 'sun', 'Marshall': 'sun', 'Old Dominion': 'sun',
  'Charlotte': 'sun',
  // CUSA
  'Florida International': 'cusa', 'FIU': 'cusa', 'FGCU': 'cusa',
  'Florida Gulf Coast': 'cusa', 'Middle Tennessee': 'cusa',
  'New Mexico State': 'cusa', 'Jacksonville State': 'cusa',
  // MAC
  'Akron': 'mac', 'Kent State': 'mac', 'Central Michigan': 'mac',
  'Miami (OH)': 'mac', 'Western Michigan': 'mac', 'Ball State': 'mac',
  'Ohio': 'mac', 'Wright State': 'mac',
  // SoCon
  'Mercer': 'socon', 'Samford': 'socon', 'ETSU': 'socon',
  'Wofford': 'socon', 'Charleston Southern': 'socon',
  // Big West
  'UC Irvine': 'bwest', 'Long Beach State': 'bwest',
  'Cal Poly': 'bwest', 'UC Riverside': 'bwest', 'UC Santa Barbara': 'bwest',
  'Cal State Northridge': 'bwest', 'Grand Canyon': 'bwest',
};

function schoolToConf(school: string): ConfId {
  return SCHOOL_TO_CONF[school] ?? 'other';
}

// ─── Projection helpers ───────────────────────────────────────────────────────

const NEUTRAL_MEAN_WOBA = 0.360;
const NEUTRAL_MEAN_BA   = 0.280;
const NEUTRAL_MEAN_OBP  = 0.370;
const NEUTRAL_MEAN_SLG  = 0.430;
const NEUTRAL_MEAN_OPS  = 0.800;
const TRANSFER_REGRESSION = 0.87;

function projectStat(value: number, fromId: string, toId: string, mean: number): number {
  const ff = CONF_MAP[fromId as ConfId]?.factor ?? 1.0;
  const tf = CONF_MAP[toId   as ConfId]?.factor ?? 1.0;
  const trueTalent = value / ff;
  const raw = trueTalent * tf;
  const destMean = mean * tf;
  return raw * TRANSFER_REGRESSION + destMean * (1 - TRANSFER_REGRESSION);
}

function projectHR(hr: number, pa: number, fromId: string, toId: string): number {
  if (pa <= 0) return 0;
  const hrRate = hr / pa;
  const projected = projectStat(hrRate, fromId, toId, 0.030);
  return projected * pa;
}

// ─── Origin conference prestige multipliers ───────────────────────────────────
// NIL is driven by HOW they performed and WHERE — a .420 in the SEC is worth
// far more than .420 in the AAC because the market prices origin difficulty
// and visibility. Multipliers based on conference strength + national exposure.
const CONF_NIL_PRESTIGE: Record<string, number> = {
  'sec':   5.0,
  'big12': 4.0,
  'acc':   4.0,
  'b10':   3.5,
  'pac12': 3.0,
  'wcc':   2.0,
  'mwc':   1.8,
  'aac':   1.6,
  'sun':   1.4,
  'cusa':  1.3,
  'mac':   1.2,
  'bwest': 1.3,
  'socon': 1.1,
  'other': 1.0,
};

// NIL estimate: raw wOBA tier (what they actually hit) ×
// origin conference prestige (how hard/visible that level was).
// Destination does not factor in — market pays for track record, not address.
function nilRange(rawWoba: number, fromConf: string): { low: number; high: number; prestige: number } {
  let base: number;
  if      (rawWoba >= 0.460) base = 50_000;
  else if (rawWoba >= 0.430) base = 28_000;
  else if (rawWoba >= 0.400) base = 14_000;
  else if (rawWoba >= 0.370) base = 6_000;
  else if (rawWoba >= 0.340) base = 2_500;
  else                       base =   800;
  const prestige = CONF_NIL_PRESTIGE[fromConf] ?? 1.0;
  const mid = base * prestige;
  return {
    low:     Math.round(mid * 0.55 / 1000) * 1000,
    high:    Math.round(mid * 1.60 / 1000) * 1000,
    prestige,
  };
}

// NIL for pitchers: lower SIERA = better (inverted tiers vs wOBA)
function nilRangePitcher(siera: number, fromConf: string): { low: number; high: number; prestige: number } {
  let base: number;
  if      (siera <= 2.50) base = 50_000;
  else if (siera <= 3.00) base = 28_000;
  else if (siera <= 3.50) base = 14_000;
  else if (siera <= 4.00) base = 6_000;
  else if (siera <= 4.50) base = 2_500;
  else                   base =   800;
  const prestige = CONF_NIL_PRESTIGE[fromConf] ?? 1.0;
  const mid = base * prestige;
  return {
    low:  Math.round(mid * 0.55 / 1000) * 1000,
    high: Math.round(mid * 1.60 / 1000) * 1000,
    prestige,
  };
}

function fmtNIL(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function parseN(s: string | undefined): number | null {
  if (!s || s === '' || s === '—') return null;
  const n = parseFloat(s.replace('%', ''));
  return isNaN(n) ? null : n;
}

function fmt3(v: number | null): string { return v != null ? v.toFixed(3).replace(/^0/, '') : '—'; }
function fmt2(v: number | null): string { return v != null ? v.toFixed(2) : '—'; }
function fmt1(v: number | null): string { return v != null ? v.toFixed(1) : '—'; }
function fmtI(v: number | null): string { return v != null ? Math.round(v).toString() : '—'; }

function deltaColor(diff: number): string {
  if (diff > 0.02) return '#22c55e';
  if (diff < -0.02) return '#ef4444';
  return '#9ca3af';
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const STORAGE_KEY = 'transfer_board_v2';

function loadBoard(): TransferEntry[] {
  if (typeof window === 'undefined') return [];
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'); } catch { return []; }
}

function saveBoard(board: TransferEntry[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(board));
}

// ─── Add Player Modal ─────────────────────────────────────────────────────────

function AddPlayerModal({
  players,
  pitchers = [],
  onAdd,
  onClose,
  existingUrls,
  preselect,
}: {
  players: StatRow[];
  pitchers?: StatRow[];
  onAdd: (entry: TransferEntry) => void;
  onClose: () => void;
  existingUrls: Set<string>;
  preselect?: { name: string; pos?: string; fromConf: ConfId; toConf: ConfId; toTeam: string };
}) {
  const initType = preselect?.pos && ['LHP', 'RHP'].includes(preselect.pos.split('/')[0]) ? 'pitch' : 'hit';
  const [type,       setType]       = useState<'hit' | 'pitch'>(initType);
  const [pitcherPos, setPitcherPos] = useState<'LHP' | 'RHP'>(
    preselect?.pos === 'LHP' ? 'LHP' : 'RHP'
  );
  const [search, setSearch]     = useState(preselect?.name ?? '');
  const [selected, setSelected] = useState<StatRow | null>(null);
  const [fromConf, setFromConf] = useState<string>(preselect?.fromConf ?? 'sec');
  const [toTeam,   setToTeam]   = useState(preselect?.toTeam ?? '');
  const [toConf,   setToConf]   = useState<string>(preselect?.toConf ?? 'sec');
  const [year,     setYear]     = useState('2026');

  useEffect(() => {
    if (!preselect?.name) return;
    const norm = normName(preselect.name);
    const data = type === 'pitch' ? pitchers : players;
    const match = data.find(p => normName(p['Player'] ?? '') === norm);
    if (match) setSelected(match);
  }, [preselect, players, pitchers]); // type excluded: auto-select on data arrival only

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    const data = type === 'pitch' ? pitchers : players;
    return data
      .filter(p => type === 'pitch'
        ? (p['IP'] && parseFloat(p['IP']) >= 5)
        : (p['PA'] && parseFloat(p['PA']) >= 30)
      )
      .filter(p =>
        p['Player']?.toLowerCase().includes(q) ||
        p['Team']?.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [players, pitchers, search, type]);

  function handleAdd() {
    if (!selected) return;
    let entry: TransferEntry;
    if (type === 'pitch') {
      entry = {
        playerUrl: selected['playerUrl'] ?? '',
        player:    selected['Player']    ?? '',
        fromTeam:  selected['Team']      ?? '',
        fromConf,
        toTeam:    toTeam.trim() || '—',
        toConf,
        year,
        pos:  pitcherPos,
        siera: parseN(selected['SIERA']),
        ip:   parseN(selected['IP']),
        fip:  parseN(selected['FIP']),
        woba: null, ops: null, ba: null, obp: null, slg: null,
        hr: null, pa: null, iso: null, kPct: null, bbPct: null,
      };
    } else {
      const pa  = parseN(selected['PA']);
      const hr  = parseN(selected['HR']);
      const bb  = parseN(selected['BB']);
      const so  = parseN(selected['SO']);
      entry = {
        playerUrl: selected['playerUrl'] ?? '',
        player:    selected['Player']    ?? '',
        fromTeam:  selected['Team']      ?? '',
        fromConf,
        toTeam:    toTeam.trim() || '—',
        toConf,
        year,
        woba: parseN(selected['wOBA']),
        ops:  parseN(selected['OPS']),
        ba:   parseN(selected['BA']),
        obp:  parseN(selected['OBP']),
        slg:  parseN(selected['SLG']),
        hr,
        pa,
        iso:  parseN(selected['ISO']),
        kPct:  pa && so ? (so / pa) * 100 : null,
        bbPct: pa && bb ? (bb / pa) * 100 : null,
      };
    }
    onAdd(entry);
    setSelected(null);
    setSearch('');
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-ink/20 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/20">
          <div>
            <div className="font-display text-lg uppercase tracking-wide">Add Transfer</div>
            <div className="text-ink-3 text-xs mt-0.5">Search college stats and configure transfer details</div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Hitter / Pitcher toggle */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-3 w-16 flex-shrink-0">Type</span>
            <div className="flex gap-1">
              {(['hit', 'pitch'] as const).map(t => (
                <button key={t} onClick={() => { setType(t); setSelected(null); setSearch(''); }}
                  className={`px-3 py-1 text-xs font-medium transition-colors ${type === t ? 'bg-deep text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}>
                  {t === 'hit' ? 'Hitter' : 'Pitcher'}
                </button>
              ))}
            </div>
            {type === 'pitch' && (
              <div className="flex gap-1 ml-2">
                {(['RHP', 'LHP'] as const).map(p => (
                  <button key={p} onClick={() => setPitcherPos(p)}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors ${pitcherPos === p ? 'bg-amber-600/40 text-amber-300' : 'bg-bone text-ink-3 hover:text-ink'}`}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-3 w-16 flex-shrink-0">Year</span>
            <div className="flex gap-1">
              {['2026','2025','2024','2023','2022','2021'].map(y => (
                <button key={y} onClick={() => setYear(y)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${year === y ? 'bg-deep text-ink' : 'bg-bone text-ink-3 hover:text-ink'}`}>
                  {y}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-3 w-16 flex-shrink-0">Player</span>
            <input
              autoFocus
              type="text"
              placeholder="Search by name or team…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 bg-bone border border-ink/20 px-3 py-1.5 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-white/40"
            />
          </div>

          {search.length >= 2 && (
            <div className="bg-bone border border-ink/10 max-h-52 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="text-center text-ink-4 text-sm py-6">No results</div>
              ) : filtered.map(p => {
                const url   = p['playerUrl'] ?? '';
                const taken = existingUrls.has(url);
                const isSel = selected?.playerUrl === url;
                return (
                  <button key={url}
                    disabled={taken}
                    onClick={() => setSelected(p)}
                    className={`w-full flex items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                      isSel ? 'bg-deep text-ink' :
                      taken ? 'opacity-40 cursor-not-allowed' :
                      'hover:bg-panel text-ink'
                    }`}>
                    <div>
                      <span className="font-medium">{p['Player']}</span>
                      <span className="text-ink-3 ml-2">{p['Team']}</span>
                    </div>
                    <div className="text-xs text-ink-3 font-mono tabular-nums">
                      {type === 'pitch'
                        ? `${p['IP']} IP · SIERA ${p['SIERA'] || '—'}`
                        : `${p['PA']} PA · wOBA ${p['wOBA'] || '—'}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {selected && (
            <div className="border border-ink/20 bg-bone p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">{selected['Player']} — {selected['Team']}</div>
                {type === 'pitch' && (
                  <div className="flex gap-4 font-mono text-sm">
                    <span className="text-ink-4">IP <span className="text-ink">{selected['IP'] || '—'}</span></span>
                    <span className="text-ink-4">FIP <span className="text-ink">{selected['FIP'] || '—'}</span></span>
                    <span className="text-ink-4">SIERA <span className="text-amber-400 font-bold">{selected['SIERA'] || '—'}</span></span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-xs text-ink-3 uppercase tracking-wide mb-1">Origin Conference</div>
                  <select value={fromConf} onChange={e => setFromConf(e.target.value)}
                    className="w-full bg-panel border border-ink/20 px-2 py-1.5 text-sm text-ink focus:outline-none">
                    {CONFERENCES.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="text-xs text-ink-3 uppercase tracking-wide mb-1">Destination Conference</div>
                  <select value={toConf} onChange={e => setToConf(e.target.value)}
                    className="w-full bg-panel border border-ink/20 px-2 py-1.5 text-sm text-ink placeholder-ink-4 focus:outline-none">
                    {CONFERENCES.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <div className="text-xs text-ink-3 uppercase tracking-wide mb-1">Destination School (optional)</div>
                <input type="text" placeholder="e.g. Vanderbilt"
                  value={toTeam} onChange={e => setToTeam(e.target.value)}
                  className="w-full bg-panel border border-ink/20 px-2 py-1.5 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-white/40"
                />
              </div>

              <button
                onClick={handleAdd}
                className="w-full py-2 bg-deep hover:bg-panel text-ink text-sm font-medium transition-colors border border-ink/20"
              >
                Add to Transfer Board
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Conf select inline ───────────────────────────────────────────────────────

function ConfSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-transparent border border-ink/10 hover:border-ink/30 text-xs text-ink px-1 py-0.5 focus:outline-none">
      {CONFERENCES.map(c => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </select>
  );
}

// ─── Portal tab ───────────────────────────────────────────────────────────────

const POS_GROUPS: Record<string, string[]> = {
  'All': [],
  'C':   ['C'],
  'INF': ['1B','2B','3B','SS','INF','2B/3B','SS/2B','1B/RHP','INF/RHP'],
  'OF':  ['OF','1B/OF','C/OF','LHP/OF','1B/LHP'],
  'RHP': ['RHP','RHP/SS'],
  'LHP': ['LHP','LHP/OF'],
};

function portalPosGroup(pos: string): string {
  for (const [group, members] of Object.entries(POS_GROUPS)) {
    if (group === 'All') continue;
    if (members.includes(pos)) return group;
  }
  // fallback
  if (pos.includes('RHP')) return 'RHP';
  if (pos.includes('LHP')) return 'LHP';
  if (pos.includes('OF'))  return 'OF';
  return 'INF';
}

function PortalTab({
  portalPlayers,
  nameMap,
  pitcherMap,
  existingUrls,
  onOpenModal,
  onDirectAdd,
}: {
  portalPlayers: PortalPlayer[];
  nameMap: Map<string, StatRow>;
  pitcherMap: Map<string, StatRow>;
  existingUrls: Set<string>;
  onOpenModal: (p: PortalPlayer) => void;
  onDirectAdd: (entry: TransferEntry) => void;
}) {
  const [search,    setSearch]    = useState('');
  const [posFilter, setPosFilter] = useState('All');
  const [yearFilter,setYearFilter]= useState<number | null>(null);
  const [committedOnly, setCommittedOnly] = useState(false);
  const [rankedOnly, setRankedOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return portalPlayers.filter(p => {
      if (q && !p.name.toLowerCase().includes(q) &&
               !p.fromSchool.toLowerCase().includes(q) &&
               !p.toSchool.toLowerCase().includes(q)) return false;
      if (posFilter !== 'All' && portalPosGroup(p.pos) !== posFilter) return false;
      if (yearFilter !== null && p.draftYear !== yearFilter) return false;
      if (committedOnly && !p.toSchool) return false;
      if (rankedOnly && p.rank === null) return false;
      return true;
    });
  }, [portalPlayers, search, posFilter, yearFilter, committedOnly, rankedOnly]);

  function handleAdd(p: PortalPlayer) {
    const norm      = normName(p.name);
    const fromConf  = schoolToConf(p.fromSchool);
    const toConf    = p.toSchool ? schoolToConf(p.toSchool) : fromConf;
    const isPitcher = ['LHP', 'RHP'].includes(portalPosGroup(p.pos));

    if (isPitcher) {
      const pitchRow = pitcherMap.get(norm);
      if (pitchRow) {
        const entry: TransferEntry = {
          playerUrl: pitchRow['playerUrl'] ?? `/portal/${encodeURIComponent(p.name)}`,
          player:    p.name,
          fromTeam:  p.fromSchool,
          fromConf,
          toTeam:    p.toSchool || '—',
          toConf,
          year:      '2026',
          pos:       p.pos,
          siera: parseN(pitchRow['SIERA']),
          ip:   parseN(pitchRow['IP']),
          fip:  parseN(pitchRow['FIP']),
          woba: null, ops: null, ba: null, obp: null, slg: null,
          hr: null, pa: null, iso: null, kPct: null, bbPct: null,
        };
        onDirectAdd(entry);
      } else {
        onOpenModal(p);
      }
    } else {
      const statRow = nameMap.get(norm);
      if (statRow) {
        const pa = parseN(statRow['PA']);
        const hr = parseN(statRow['HR']);
        const bb = parseN(statRow['BB']);
        const so = parseN(statRow['SO']);
        const entry: TransferEntry = {
          playerUrl: statRow['playerUrl'] ?? `/portal/${encodeURIComponent(p.name)}`,
          player:    p.name,
          fromTeam:  p.fromSchool,
          fromConf,
          toTeam:    p.toSchool || '—',
          toConf,
          year:      '2026',
          woba: parseN(statRow['wOBA']),
          ops:  parseN(statRow['OPS']),
          ba:   parseN(statRow['BA']),
          obp:  parseN(statRow['OBP']),
          slg:  parseN(statRow['SLG']),
          hr,
          pa,
          iso:  parseN(statRow['ISO']),
          kPct:  pa && so ? (so / pa) * 100 : null,
          bbPct: pa && bb ? (bb / pa) * 100 : null,
        };
        onDirectAdd(entry);
      } else {
        onOpenModal(p);
      }
    }
  }

  const rankBadge = (rank: number | null, draftYear: number) => {
    if (rank === null) return null;
    const color = draftYear === 2026 ? '#6b7280' : draftYear === 2027 ? '#818cf8' : '#34d399';
    return (
      <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ background: `${color}22`, color }}>
        #{rank} ʼ{String(draftYear).slice(2)}
      </span>
    );
  };

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search player or school…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-panel border border-ink/20 px-3 py-1.5 text-sm text-ink placeholder-ink-4 focus:outline-none focus:border-white/40 w-52"
        />
        <div className="flex gap-1">
          {Object.keys(POS_GROUPS).map(g => (
            <button key={g} onClick={() => setPosFilter(g)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${posFilter === g ? 'bg-deep text-ink' : 'bg-panel text-ink-3 hover:text-ink'}`}>
              {g}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {([null, 2026, 2027, 2028] as (number | null)[]).map(y => (
            <button key={y ?? 'all'} onClick={() => setYearFilter(y)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${yearFilter === y ? 'bg-deep text-ink' : 'bg-panel text-ink-3 hover:text-ink'}`}>
              {y ?? 'All'}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-ink-3 cursor-pointer">
          <input type="checkbox" checked={committedOnly} onChange={e => setCommittedOnly(e.target.checked)} className="accent-sky-500" />
          Committed
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-3 cursor-pointer">
          <input type="checkbox" checked={rankedOnly} onChange={e => setRankedOnly(e.target.checked)} className="accent-sky-500" />
          Ranked only
        </label>
        <span className="text-xs text-ink-4 ml-auto">{filtered.length} players</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto border border-ink/20">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-ink/20 bg-bone">
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[160px]">Player</th>
              <th className="text-left px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 w-12">Pos</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[120px]">From</th>
              <th className="text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[120px]">To</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 w-10">Yr</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 w-16">Draft</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 w-12 border-l border-ink/10">PA/IP</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-ink-3 w-14">wOBA/SIERA</th>
              <th className="text-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-sky-400 w-16 border-l border-sky-500/30">Proj</th>
              <th className="px-3 py-2 w-20"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p, i) => {
              const norm      = normName(p.name);
              const isPitcher = ['LHP', 'RHP'].includes(portalPosGroup(p.pos));
              const pitchRow  = isPitcher ? pitcherMap.get(norm) : undefined;
              const statRow   = !isPitcher ? nameMap.get(norm) : undefined;
              const hasMatch  = isPitcher ? !!pitchRow : !!statRow;
              const woba      = statRow  ? parseN(statRow['wOBA'])  : null;
              const pa        = statRow  ? parseN(statRow['PA'])    : null;
              const siera      = pitchRow ? parseN(pitchRow['SIERA']) : null;
              const ip        = pitchRow ? parseN(pitchRow['IP'])   : null;
              const fromConf  = schoolToConf(p.fromSchool);
              const toConf    = p.toSchool ? schoolToConf(p.toSchool) : fromConf;
              const projWoba  = woba != null ? projectStat(woba, fromConf, toConf, NEUTRAL_MEAN_WOBA) : null;

              const matchRow  = statRow ?? pitchRow;
              const portalUrl = matchRow?.['playerUrl'] ?? `/portal/${encodeURIComponent(p.name)}`;
              const onBoard   = existingUrls.has(portalUrl);

              return (
                <tr key={p.name + p.fromSchool}
                  className={`border-b border-ink/10 hover:bg-panel/60 transition-colors ${i % 2 === 0 ? 'bg-page' : 'bg-bone/20'}`}>

                  <td className="px-3 py-2">
                    <div className="font-semibold text-ink leading-tight">{p.name}</div>
                    {hasMatch && (
                      <div className="text-[9px] text-sky-500 mt-0.5">overslot match</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-ink-3">{p.pos}</td>
                  <td className="px-3 py-2">
                    <div className="text-ink-2 leading-tight">{p.fromSchool}</div>
                    <div className="text-[9px] text-ink-4">{CONF_MAP[fromConf]?.name ?? ''}</div>
                  </td>
                  <td className="px-3 py-2">
                    {p.toSchool ? (
                      <>
                        <div className="text-ink-2 leading-tight">{p.toSchool}</div>
                        <div className="text-[9px] text-ink-4">{CONF_MAP[toConf]?.name ?? ''}</div>
                      </>
                    ) : (
                      <span className="text-ink-5 text-[10px]">Undecided</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center text-ink-3">{p.classYear}</td>
                  <td className="px-2 py-2 text-center">{rankBadge(p.rank, p.draftYear)}</td>
                  <td className="px-2 py-2 text-center font-mono text-ink-2 border-l border-ink/10">
                    {isPitcher
                      ? (ip != null ? fmt1(ip) : <span className="text-ink-5">—</span>)
                      : (pa != null ? Math.round(pa) : <span className="text-ink-5">—</span>)
                    }
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-ink">
                    {isPitcher
                      ? (siera != null ? <span className="text-amber-400">{fmt2(siera)}</span> : <span className="text-ink-5">—</span>)
                      : (woba != null ? fmt3(woba) : <span className="text-ink-5">—</span>)
                    }
                  </td>
                  <td className="px-2 py-2 text-center font-mono border-l border-sky-500/20" style={{ color: projWoba != null ? '#60a5fa' : '#374151' }}>
                    {isPitcher ? '—' : (projWoba != null ? fmt3(projWoba) : '—')}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {onBoard ? (
                      <span className="text-[10px] text-ink-4">On board</span>
                    ) : (
                      <button
                        onClick={() => handleAdd(p)}
                        className="px-2 py-1 text-[10px] font-medium bg-sky-600/20 hover:bg-sky-600/40 text-sky-400 transition-colors border border-sky-600/30"
                      >
                        + Add
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-[10px] text-ink-4 space-y-0.5">
        <div>Source: Baseball America 2026 Transfer Portal Tracker.</div>
        <div>
          <span className="text-sky-500">overslot match</span> = player found in Over Slot college stats database.
          Proj wOBA assumes transfer to committed destination (or same conf if uncommitted).
          Draft rankings: <span style={{ color: '#6b7280' }}>#N ʼ26</span> = BA 2026 class ·{' '}
          <span style={{ color: '#818cf8' }}>#N ʼ27</span> = 2027 class ·{' '}
          <span style={{ color: '#34d399' }}>#N ʼ28</span> = 2028 class.
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function TransfersPage() {
  const [tab,        setTab]        = useState<'portal' | 'board'>('portal');
  const [board,      setBoard]      = useState<TransferEntry[]>([]);
  const [players,    setPlayers]    = useState<StatRow[]>([]);
  const [pitchers,   setPitchers]   = useState<StatRow[]>([]);
  const [loadingP,   setLoadingP]   = useState(true);
  const [portalData, setPortalData] = useState<PortalPlayer[]>([]);
  const [showModal,  setShowModal]  = useState(false);
  const [modalPreselect, setModalPreselect] = useState<{ name: string; pos?: string; fromConf: ConfId; toConf: ConfId; toTeam: string } | undefined>();
  const [sortKey,    setSortKey]    = useState<string>('projWoba');
  const [sortAsc,    setSortAsc]    = useState(false);
  const [year,       setYear]       = useState('2026');

  useEffect(() => { setBoard(loadBoard()); }, []);

  useEffect(() => {
    setLoadingP(true);
    fetch(`/api/overslot-stats?type=hit&year=${year}`)
      .then(r => r.json())
      .then(d => setPlayers(d.players ?? []))
      .catch(() => {})
      .finally(() => setLoadingP(false));
  }, [year]);

  useEffect(() => {
    fetch(`/api/overslot-stats?type=pitch&year=${year}`)
      .then(r => r.json())
      .then(d => setPitchers(d.players ?? []))
      .catch(() => {});
  }, [year]);

  useEffect(() => {
    fetch('/api/transfer-portal')
      .then(r => r.json())
      .then(d => setPortalData(d.players ?? []))
      .catch(() => {});
  }, []);

  // Build name → stat row maps for portal lookups
  const nameMap = useMemo(() => {
    const m = new Map<string, StatRow>();
    for (const p of players) {
      const name = p['Player'];
      if (name) m.set(normName(name), p);
    }
    return m;
  }, [players]);

  const pitcherMap = useMemo(() => {
    const m = new Map<string, StatRow>();
    for (const p of pitchers) {
      const name = p['Player'];
      if (name) m.set(normName(name), p);
    }
    return m;
  }, [pitchers]);

  function addEntry(entry: TransferEntry) {
    setBoard(prev => {
      const next = [entry, ...prev.filter(e => e.playerUrl !== entry.playerUrl)];
      saveBoard(next);
      return next;
    });
    setShowModal(false);
    setModalPreselect(undefined);
  }

  function removeEntry(playerUrl: string) {
    setBoard(prev => {
      const next = prev.filter(e => e.playerUrl !== playerUrl);
      saveBoard(next);
      return next;
    });
  }

  function updateEntry(playerUrl: string, patch: Partial<TransferEntry>) {
    setBoard(prev => {
      const next = prev.map(e => e.playerUrl === playerUrl ? { ...e, ...patch } : e);
      saveBoard(next);
      return next;
    });
  }

  function openModalForPortal(p: PortalPlayer) {
    setModalPreselect({
      name:     p.name,
      pos:      p.pos,
      fromConf: schoolToConf(p.fromSchool),
      toConf:   p.toSchool ? schoolToConf(p.toSchool) : schoolToConf(p.fromSchool),
      toTeam:   p.toSchool,
    });
    setShowModal(true);
  }

  const existingUrls = useMemo(() => new Set(board.map(e => e.playerUrl)), [board]);

  // Board projections
  const rows = useMemo(() => board.map(e => {
    const projWoba = e.woba != null ? projectStat(e.woba, e.fromConf, e.toConf, NEUTRAL_MEAN_WOBA) : null;
    const projBA   = e.ba   != null ? projectStat(e.ba,   e.fromConf, e.toConf, NEUTRAL_MEAN_BA)   : null;
    const projOBP  = e.obp  != null ? projectStat(e.obp,  e.fromConf, e.toConf, NEUTRAL_MEAN_OBP)  : null;
    const projSLG  = e.slg  != null ? projectStat(e.slg,  e.fromConf, e.toConf, NEUTRAL_MEAN_SLG)  : null;
    const projOPS  = e.ops  != null ? projectStat(e.ops,  e.fromConf, e.toConf, NEUTRAL_MEAN_OPS)  : null;
    const projHR   = e.hr   != null && e.pa != null
      ? projectHR(e.hr, e.pa, e.fromConf, e.toConf)
      : null;
    const isPitcher = e.siera != null && e.woba == null;
    const nil = isPitcher
      ? (e.siera != null ? nilRangePitcher(e.siera, e.fromConf) : null)
      : (e.woba != null ? nilRange(e.woba, e.fromConf) : null);
    return { ...e, projWoba, projBA, projOBP, projSLG, projOPS, projHR, nil };
  }), [board]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av: number | null = null, bv: number | null = null;
      if      (sortKey === 'projWoba') { av = a.projWoba;          bv = b.projWoba; }
      else if (sortKey === 'woba')     { av = a.woba;              bv = b.woba; }
      else if (sortKey === 'nilHigh')  { av = a.nil?.high ?? null; bv = b.nil?.high ?? null; }
      else if (sortKey === 'pa')       { av = a.pa;                bv = b.pa; }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
  }, [rows, sortKey, sortAsc]);

  function handleSort(key: string) {
    if (key === sortKey) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(false); }
  }

  const th = (key: string, label: string, color?: string) => (
    <button onClick={() => handleSort(key)}
      className="flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide hover:text-ink"
      style={{ color: color ?? 'var(--color-ink-3)' }}>
      {label}
      {sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : ''}
    </button>
  );

  const confLabel = (id: string) => CONF_MAP[id as ConfId]?.name ?? id;

  return (
    <div className="min-h-screen bg-page text-ink">
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/overslot" className="text-ink-3 hover:text-ink text-sm flex-shrink-0">← College Stats</Link>
            <div>
              <h1 className="font-display text-2xl uppercase tracking-[0.02em]">Transfer Projections</h1>
              <p className="text-ink-3 text-sm mt-0.5">
                Season projections &amp; NIL estimates · Source: Baseball America portal tracker
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {['2026','2025','2024','2023','2022','2021'].map(y => (
                <button key={y} onClick={() => setYear(y)}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors ${year === y ? 'bg-deep text-ink' : 'bg-panel text-ink-3 hover:bg-bone hover:text-ink'}`}>
                  {y}
                </button>
              ))}
            </div>
            <button
              onClick={() => { setModalPreselect(undefined); setShowModal(true); }}
              disabled={loadingP}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-ink text-sm font-medium transition-colors disabled:opacity-50"
            >
              + Add Transfer
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-5 border-b border-ink/20">
          <button
            onClick={() => setTab('portal')}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'portal' ? 'border-sky-400 text-sky-400' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            Portal Players
            <span className="ml-2 text-[10px] bg-panel px-1.5 py-0.5 text-ink-4">
              {portalData.length}
            </span>
          </button>
          <button
            onClick={() => setTab('board')}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === 'board' ? 'border-sky-400 text-sky-400' : 'border-transparent text-ink-3 hover:text-ink'
            }`}
          >
            My Board
            <span className="ml-2 text-[10px] bg-panel px-1.5 py-0.5 text-ink-4">
              {board.length}
            </span>
          </button>
        </div>

        {/* Model note */}
        <div className="bg-panel border border-ink/10 px-4 py-2.5 mb-5 text-xs text-ink-3">
          <span className="text-ink-2 font-semibold">Projection Model: </span>
          Conference strength factors normalize wOBA to a neutral baseline, then re-scale to destination.
          13% first-year regression toward destination mean (.360 wOBA).
          NIL: hitters use raw wOBA tier × origin conf prestige; pitchers use SIERA tier × origin conf prestige (SEC 5×, Big 12/ACC 4×, Big Ten 3.5×, … G5 1.0–1.8×). Destination does not factor in.
        </div>

        {/* Portal tab */}
        {tab === 'portal' && (
          <PortalTab
            portalPlayers={portalData}
            nameMap={nameMap}
            pitcherMap={pitcherMap}
            existingUrls={existingUrls}
            onOpenModal={openModalForPortal}
            onDirectAdd={addEntry}
          />
        )}

        {/* Board tab */}
        {tab === 'board' && (
          <>
            {board.length === 0 && (
              <div className="border border-ink/10 bg-panel flex flex-col items-center justify-center py-20 text-center">
                <div className="text-4xl mb-3">⚾</div>
                <div className="text-ink-2 font-semibold mb-1">No transfers added yet</div>
                <div className="text-ink-3 text-sm mb-5">
                  Use the Portal tab to browse and add players, or click + Add Transfer
                </div>
                <button onClick={() => setTab('portal')}
                  className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-ink text-sm font-medium transition-colors">
                  Browse Portal Players
                </button>
              </div>
            )}

            {board.length > 0 && (
              <div className="overflow-x-auto border border-ink/20">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-ink/20 bg-bone">
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[150px]">Player</th>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[110px]">From</th>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[110px]">To</th>
                      <th className="text-center px-2 py-2.5">{th('pa', 'PA')}</th>
                      <th className="text-center px-2 py-2.5 border-l border-ink/10">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">BA</span>
                      </th>
                      <th className="text-center px-2 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">OBP</span>
                      </th>
                      <th className="text-center px-2 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">SLG</span>
                      </th>
                      <th className="text-center px-2 py-2.5">{th('woba', 'wOBA')}</th>
                      <th className="text-center px-2 py-2.5 border-l border-sky-500/30">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Proj BA</span>
                      </th>
                      <th className="text-center px-2 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Proj OBP</span>
                      </th>
                      <th className="text-center px-2 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Proj SLG</span>
                      </th>
                      <th className="text-center px-2 py-2.5">{th('projWoba', 'Proj wOBA', '#60a5fa')}</th>
                      <th className="text-center px-2 py-2.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-400">Proj HR</span>
                      </th>
                      <th className="text-center px-3 py-2.5 border-l border-amber-500/30">{th('nilHigh', 'NIL Est.')}</th>
                      <th className="px-3 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((row, i) => {
                      const wobaDiff = row.projWoba != null && row.woba != null
                        ? row.projWoba - row.woba : null;
                      return (
                        <tr key={row.playerUrl}
                          className={`border-b border-ink/10 hover:bg-panel/60 transition-colors ${i % 2 === 0 ? 'bg-page' : 'bg-bone/20'}`}>

                          <td className="px-3 py-2">
                            <Link
                              href={`https://overslotbaseball.com${row.playerUrl}`}
                              target="_blank"
                              className="font-semibold text-ink hover:text-sky-400 transition-colors"
                            >
                              {row.player}
                            </Link>
                          </td>

                          <td className="px-3 py-2">
                            <div className="text-ink-2 text-[11px] leading-tight">{row.fromTeam}</div>
                            <div className="text-[9px] text-ink-4 mt-0.5">{confLabel(row.fromConf)}</div>
                          </td>

                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={row.toTeam === '—' ? '' : row.toTeam}
                              placeholder="Destination"
                              onChange={e => {
                                const team = e.target.value;
                                const detected = team ? schoolToConf(team) : row.toConf;
                                updateEntry(row.playerUrl, { toTeam: team || '—', toConf: detected });
                              }}
                              className="bg-transparent border border-ink/10 hover:border-ink/30 text-[11px] text-ink px-1 py-0.5 focus:outline-none w-full max-w-[90px] mb-0.5"
                            />
                            <div className="text-[9px] text-ink-4">{confLabel(row.toConf)}</div>
                          </td>

                          <td className="px-2 py-2 text-center font-mono text-ink-2">
                            {row.siera != null && row.woba == null
                              ? fmt1(row.ip ?? null)
                              : fmtI(row.pa)}
                          </td>

                          <td className="px-2 py-2 text-center font-mono text-ink-2 border-l border-ink/10">{fmt3(row.ba)}</td>
                          <td className="px-2 py-2 text-center font-mono text-ink-2">{fmt3(row.obp)}</td>
                          <td className="px-2 py-2 text-center font-mono text-ink-2">{fmt3(row.slg)}</td>
                          <td className="px-2 py-2 text-center font-mono font-semibold text-ink">
                            {row.siera != null && row.woba == null
                              ? <span className="text-amber-400">{fmt2(row.siera)}</span>
                              : fmt3(row.woba)}
                          </td>

                          <td className="px-2 py-2 text-center font-mono border-l border-sky-500/20" style={{ color: row.projBA != null ? '#60a5fa' : '#6b7280' }}>
                            {fmt3(row.projBA)}
                          </td>
                          <td className="px-2 py-2 text-center font-mono" style={{ color: row.projOBP != null ? '#60a5fa' : '#6b7280' }}>
                            {fmt3(row.projOBP)}
                          </td>
                          <td className="px-2 py-2 text-center font-mono" style={{ color: row.projSLG != null ? '#60a5fa' : '#6b7280' }}>
                            {fmt3(row.projSLG)}
                          </td>
                          <td className="px-2 py-2 text-center font-mono font-semibold" style={{ color: row.projWoba != null ? '#60a5fa' : '#6b7280' }}>
                            {fmt3(row.projWoba)}
                            {wobaDiff != null && (
                              <span className="ml-1 text-[10px]" style={{ color: deltaColor(wobaDiff) }}>
                                {wobaDiff > 0 ? '+' : ''}{wobaDiff.toFixed(3)}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center font-mono" style={{ color: row.projHR != null ? '#60a5fa' : '#6b7280' }}>
                            {fmt1(row.projHR)}
                          </td>

                          <td className="px-3 py-2 text-center border-l border-amber-500/20">
                            {row.nil ? (
                              <div>
                                <div className="font-semibold text-amber-400 text-xs">
                                  {fmtNIL(row.nil.low)}–{fmtNIL(row.nil.high)}
                                </div>
                                <div className="text-[9px] text-ink-4 mt-0.5">
                                  {row.siera != null && row.woba == null
                                    ? `SIERA ${fmt2(row.siera)} · `
                                    : ''}
                                  {row.nil.prestige.toFixed(1)}× · {confLabel(row.fromConf)}
                                </div>
                              </div>
                            ) : <span className="text-ink-5">—</span>}
                          </td>

                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeEntry(row.playerUrl)}
                              className="text-ink-5 hover:text-red-400 transition-colors text-base leading-none"
                              title="Remove"
                            >×</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {board.length > 0 && (
              <div className="mt-4 text-[10px] text-ink-4 space-y-0.5">
                <div>
                  <span className="text-sky-400 font-semibold">Blue columns</span> = projected stats at destination conference ·
                  <span className="text-amber-400 font-semibold ml-1">Gold column</span> = annual NIL estimate range
                </div>
                <div>
                  Projection: wOBA normalized across conference strength factors + 13% first-year regression toward .360 wOBA mean. Pitchers show IP/SIERA in place of PA/wOBA.
                  NIL: hitters — raw wOBA tier × origin conf prestige; pitchers — SIERA tier × origin conf prestige. Tiers identical (SEC 5×, Big 12/ACC 4×, Big Ten 3.5×, … G5 1.0–1.8×). Destination not used.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showModal && (
        <AddPlayerModal
          players={players}
          pitchers={pitchers}
          onAdd={addEntry}
          onClose={() => { setShowModal(false); setModalPreselect(undefined); }}
          existingUrls={existingUrls}
          preselect={modalPreselect}
        />
      )}
    </div>
  );
}

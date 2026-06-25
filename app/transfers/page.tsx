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
  // Snapshot of raw stats at time of adding
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
}

// ─── Conference definitions ───────────────────────────────────────────────────
// factor = how much stats are "inflated" relative to neutral.
// SEC factor 0.87 → stats there are 87% of what they'd be in a neutral env,
// so a player's true talent = observed / factor.
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

const CONF_MAP = Object.fromEntries(CONFERENCES.map(c => [c.id, c]));
const P5 = new Set(['sec', 'acc', 'big12', 'b10', 'pac12']);

// Neutral-level college means for projection regression
const NEUTRAL_MEAN_WOBA = 0.360;  // primary projection anchor
const NEUTRAL_MEAN_BA   = 0.280;
const NEUTRAL_MEAN_OBP  = 0.370;
const NEUTRAL_MEAN_SLG  = 0.430;
const NEUTRAL_MEAN_OPS  = 0.800;
// Transfer adjustment: first-year transfers regress ~13% toward mean
const TRANSFER_REGRESSION = 0.87;

function projectStat(
  value: number,
  fromId: string,
  toId: string,
  mean: number,
): number {
  const ff = CONF_MAP[fromId]?.factor ?? 1.0;
  const tf = CONF_MAP[toId]?.factor   ?? 1.0;
  // Normalize to neutral level
  const trueTalent = value / ff;
  // Scale to destination conference
  const raw = trueTalent * tf;
  // Marcel-style regression toward destination-league mean
  const destMean = mean * tf;
  return raw * TRANSFER_REGRESSION + destMean * (1 - TRANSFER_REGRESSION);
}

function projectHR(hr: number, pa: number, fromId: string, toId: string): number {
  if (pa <= 0) return 0;
  const hrRate = hr / pa;
  const projected = projectStat(hrRate, fromId, toId, 0.030);
  return projected * pa;
}

// ─── NIL Estimate (driven by projected wOBA) ──────────────────────────────────
// wOBA scale: .460+ elite · .420-.460 great · .390-.420 above avg ·
//             .360-.390 avg · .330-.360 below avg · <.330 poor

function nilRange(projWoba: number, toConf: string): { low: number; high: number } {
  const isP5 = P5.has(toConf);
  let base: number;
  if      (projWoba >= 0.460) base = 130_000;
  else if (projWoba >= 0.430) base = 75_000;
  else if (projWoba >= 0.400) base = 38_000;
  else if (projWoba >= 0.370) base = 16_000;
  else if (projWoba >= 0.340) base = 6_500;
  else                        base = 2_000;

  const mult = isP5 ? 2.5 : 1.0;
  const mid  = base * mult;
  return {
    low:  Math.round(mid * 0.55 / 1000) * 1000,
    high: Math.round(mid * 1.60 / 1000) * 1000,
  };
}

function fmtNIL(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseN(s: string | undefined): number | null {
  if (!s || s === '' || s === '—') return null;
  const n = parseFloat(s.replace('%', ''));
  return isNaN(n) ? null : n;
}

function fmt3(v: number | null): string { return v != null ? v.toFixed(3).replace(/^0/, '') : '—'; }
function fmt1(v: number | null): string { return v != null ? v.toFixed(1) : '—'; }
function fmtI(v: number | null): string { return v != null ? Math.round(v).toString() : '—'; }

function deltaColor(diff: number): string {
  if (diff > 0.02) return '#22c55e';
  if (diff < -0.02) return '#ef4444';
  return '#9ca3af';
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
  onAdd,
  onClose,
  existingUrls,
}: {
  players: StatRow[];
  onAdd: (entry: TransferEntry) => void;
  onClose: () => void;
  existingUrls: Set<string>;
}) {
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<StatRow | null>(null);
  const [fromConf, setFromConf] = useState('sec');
  const [toTeam,   setToTeam]   = useState('');
  const [toConf,   setToConf]   = useState('sec');
  const [year,     setYear]     = useState('2026');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return players
      .filter(p => p['PA'] && parseFloat(p['PA']) >= 30)
      .filter(p =>
        p['Player']?.toLowerCase().includes(q) ||
        p['Team']?.toLowerCase().includes(q)
      )
      .slice(0, 60);
  }, [players, search]);

  function handleAdd() {
    if (!selected) return;
    const pa  = parseN(selected['PA']);
    const hr  = parseN(selected['HR']);
    const bb  = parseN(selected['BB']);
    const so  = parseN(selected['SO']);
    const entry: TransferEntry = {
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
      kPct: pa && so ? (so / pa) * 100 : null,
      bbPct: pa && bb ? (bb / pa) * 100 : null,
    };
    onAdd(entry);
    setSelected(null);
    setSearch('');
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-panel border border-ink/20 w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-ink/20">
          <div>
            <div className="font-display text-lg uppercase tracking-wide">Add Transfer</div>
            <div className="text-ink-3 text-xs mt-0.5">Search college stats and configure transfer details</div>
          </div>
          <button onClick={onClose} className="text-ink-4 hover:text-ink text-xl leading-none">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Year */}
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

          {/* Search */}
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

          {/* Results */}
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
                      {p['PA']} PA · wOBA {p['wOBA'] || '—'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Selected player + conf config */}
          {selected && (
            <div className="border border-ink/20 bg-bone p-4 space-y-3">
              <div className="text-sm font-semibold text-ink">{selected['Player']} — {selected['Team']}</div>

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
                    className="w-full bg-panel border border-ink/20 px-2 py-1.5 text-sm text-ink focus:outline-none">
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

// ─── Edit row inline ──────────────────────────────────────────────────────────

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

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function TransfersPage() {
  const [board,     setBoard]     = useState<TransferEntry[]>([]);
  const [players,   setPlayers]   = useState<StatRow[]>([]);
  const [loadingP,  setLoadingP]  = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [sortKey,   setSortKey]   = useState<string>('projWoba');
  const [sortAsc,   setSortAsc]   = useState(false);
  const [year,      setYear]      = useState('2026');

  // Load board from localStorage on mount
  useEffect(() => { setBoard(loadBoard()); }, []);

  // Fetch college players for the search
  useEffect(() => {
    setLoadingP(true);
    fetch(`/api/overslot-stats?type=hit&year=${year}`)
      .then(r => r.json())
      .then(d => setPlayers(d.players ?? []))
      .catch(() => {})
      .finally(() => setLoadingP(false));
  }, [year]);

  function addEntry(entry: TransferEntry) {
    setBoard(prev => {
      const next = [entry, ...prev.filter(e => e.playerUrl !== entry.playerUrl)];
      saveBoard(next);
      return next;
    });
    setShowModal(false);
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

  const existingUrls = useMemo(() => new Set(board.map(e => e.playerUrl)), [board]);

  // Compute projections
  const rows = useMemo(() => board.map(e => {
    const projWoba = e.woba != null ? projectStat(e.woba, e.fromConf, e.toConf, NEUTRAL_MEAN_WOBA) : null;
    const projBA   = e.ba   != null ? projectStat(e.ba,   e.fromConf, e.toConf, NEUTRAL_MEAN_BA)   : null;
    const projOBP  = e.obp  != null ? projectStat(e.obp,  e.fromConf, e.toConf, NEUTRAL_MEAN_OBP)  : null;
    const projSLG  = e.slg  != null ? projectStat(e.slg,  e.fromConf, e.toConf, NEUTRAL_MEAN_SLG)  : null;
    const projOPS  = e.ops  != null ? projectStat(e.ops,  e.fromConf, e.toConf, NEUTRAL_MEAN_OPS)  : null;
    const projHR   = e.hr   != null && e.pa != null
      ? projectHR(e.hr, e.pa, e.fromConf, e.toConf)
      : null;
    const nil = projWoba != null ? nilRange(projWoba, e.toConf) : null;
    return { ...e, projWoba, projBA, projOBP, projSLG, projOPS, projHR, nil };
  }), [board]);

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av: number | null = null, bv: number | null = null;
      if      (sortKey === 'projWoba') { av = a.projWoba;        bv = b.projWoba; }
      else if (sortKey === 'woba')     { av = a.woba;            bv = b.woba; }
      else if (sortKey === 'nilHigh')  { av = a.nil?.high ?? null; bv = b.nil?.high ?? null; }
      else if (sortKey === 'pa')       { av = a.pa;              bv = b.pa; }
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

  const confLabel = (id: string) => CONF_MAP[id]?.name ?? id;

  return (
    <div className="min-h-screen bg-page text-ink">
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-4">
            <Link href="/overslot" className="text-ink-3 hover:text-ink text-sm flex-shrink-0">← College Stats</Link>
            <div>
              <h1 className="font-display text-2xl uppercase tracking-[0.02em]">Transfer Projections</h1>
              <p className="text-ink-3 text-sm mt-0.5">
                Season projections &amp; NIL estimates for college transfer portal players
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
              onClick={() => setShowModal(true)}
              disabled={loadingP}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-ink text-sm font-medium transition-colors disabled:opacity-50"
            >
              + Add Transfer
            </button>
          </div>
        </div>

        {/* Model description */}
        <div className="bg-panel border border-ink/10 px-4 py-3 mb-5 text-xs text-ink-3 space-y-1">
          <span className="text-ink-2 font-semibold">Projection Model: </span>
          Conference strength factors normalize wOBA to a neutral baseline, then re-scale to the destination conference.
          A 13% first-year transfer regression toward the destination league mean (.360 wOBA) is applied.
          NIL estimates are driven by projected wOBA tier × program visibility (P5 = 2.5× multiplier).
        </div>

        {/* Empty state */}
        {board.length === 0 && (
          <div className="border border-ink/10 bg-panel flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">⚾</div>
            <div className="text-ink-2 font-semibold mb-1">No transfers added yet</div>
            <div className="text-ink-3 text-sm mb-5">Search college stats and add players to see projections</div>
            <button onClick={() => setShowModal(true)}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-ink text-sm font-medium transition-colors">
              + Add Transfer
            </button>
          </div>
        )}

        {/* Transfer board */}
        {board.length > 0 && (
          <div className="overflow-x-auto border border-ink/20">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ink/20 bg-bone">
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[150px]">Player</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[110px]">From</th>
                  <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3 min-w-[110px]">To</th>
                  <th className="text-center px-2 py-2.5">{th('pa', 'PA')}</th>
                  {/* Current stats */}
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
                  {/* Projected stats */}
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

                      {/* Player */}
                      <td className="px-3 py-2">
                        <Link
                          href={`https://overslotbaseball.com${row.playerUrl}`}
                          target="_blank"
                          className="font-semibold text-ink hover:text-sky-400 transition-colors"
                        >
                          {row.player}
                        </Link>
                      </td>

                      {/* From */}
                      <td className="px-3 py-2">
                        <div className="text-ink-2 text-[11px] leading-tight">{row.fromTeam}</div>
                        <ConfSelect value={row.fromConf} onChange={v => updateEntry(row.playerUrl, { fromConf: v })} />
                      </td>

                      {/* To */}
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={row.toTeam === '—' ? '' : row.toTeam}
                          placeholder="Destination"
                          onChange={e => updateEntry(row.playerUrl, { toTeam: e.target.value || '—' })}
                          className="bg-transparent border border-ink/10 hover:border-ink/30 text-[11px] text-ink px-1 py-0.5 focus:outline-none w-full max-w-[90px] mb-0.5"
                        />
                        <ConfSelect value={row.toConf} onChange={v => updateEntry(row.playerUrl, { toConf: v })} />
                      </td>

                      {/* PA */}
                      <td className="px-2 py-2 text-center font-mono text-ink-2">{fmtI(row.pa)}</td>

                      {/* Current stats */}
                      <td className="px-2 py-2 text-center font-mono text-ink-2 border-l border-ink/10">{fmt3(row.ba)}</td>
                      <td className="px-2 py-2 text-center font-mono text-ink-2">{fmt3(row.obp)}</td>
                      <td className="px-2 py-2 text-center font-mono text-ink-2">{fmt3(row.slg)}</td>
                      <td className="px-2 py-2 text-center font-mono font-semibold text-ink">{fmt3(row.woba)}</td>

                      {/* Projected stats */}
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

                      {/* NIL */}
                      <td className="px-3 py-2 text-center border-l border-amber-500/20">
                        {row.nil ? (
                          <div>
                            <div className="font-semibold text-amber-400 text-xs">
                              {fmtNIL(row.nil.low)}–{fmtNIL(row.nil.high)}
                            </div>
                            <div className="text-[9px] text-ink-4 mt-0.5">
                              {P5.has(row.toConf) ? 'P5' : 'G5/Other'} · {confLabel(row.toConf)}
                            </div>
                          </div>
                        ) : <span className="text-ink-5">—</span>}
                      </td>

                      {/* Remove */}
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

        {/* Stats key */}
        {board.length > 0 && (
          <div className="mt-4 text-[10px] text-ink-4 space-y-0.5">
            <div>
              <span className="text-sky-400 font-semibold">Blue columns</span> = projected stats at destination conference ·
              <span className="text-amber-400 font-semibold ml-1">Gold column</span> = annual NIL estimate range
            </div>
            <div>
              Projection: wOBA normalized across conference strength factors + 13% first-year transfer regression toward .360 wOBA destination mean.
              BA/OBP/SLG/HR projected using the same conference adjustment. NIL: wOBA tier × P5 visibility multiplier (2.5×).
            </div>
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <AddPlayerModal
          players={players}
          onAdd={addEntry}
          onClose={() => setShowModal(false)}
          existingUrls={existingUrls}
        />
      )}
    </div>
  );
}

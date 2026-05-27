'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HitRow {
  playerUrl: string; Player: string; Team: string;
  G: string; PA: string; H: string;
  '1B': string; '2B': string; '3B': string; HR: string;
  R: string; BB: string; SO: string; HBP: string; SB: string; CS: string;
  BA: string; OBP: string; SLG: string; OPS: string;
  ISO: string; BABIP: string; wOBA: string;
}

interface PitchRow {
  playerUrl: string; Player: string; Team: string;
  G: string; GS: string; IP: string; BF: string;
  H: string; R: string; BB: string; SO: string; HBP: string;
  WHIP: string; BA: string; OBP: string; SLG: string; OPS: string;
  BABIP: string; 'BB%': string; 'K%': string; 'BB/K': string;
  FIP: string; xFIP: string; SIERA: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function decodeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

function n(s: string | undefined): number {
  if (!s || s === '' || s === '—') return NaN;
  return parseFloat(s.replace('%', ''));
}

function fmtBat(s: string, digits = 3): string {
  const v = parseFloat(s);
  if (isNaN(v)) return '—';
  return v.toFixed(digits).replace(/^0\./, '.');
}

function fmtNum(s: string, digits = 1): string {
  const v = parseFloat(s);
  if (isNaN(v)) return '—';
  return v.toFixed(digits);
}

function fmtInt(s: string): string {
  const v = parseInt(s);
  return isNaN(v) ? '—' : String(v);
}

// Red→Yellow→Green gradient
function statColor(val: number, bad: number, good: number, invert: boolean): string {
  if (isNaN(val)) return '';
  const lo = Math.min(bad, good), hi = Math.max(bad, good);
  const clamped = Math.max(lo, Math.min(hi, val));
  const raw = hi === lo ? 0 : (clamped - lo) / (hi - lo);
  const t = invert ? 1 - raw : raw;
  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  }
  const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
  return `rgb(${r},${g},60)`;
}

// ─── Column definitions ───────────────────────────────────────────────────────

interface Col<T> {
  key: keyof T | string;
  label: string;
  title?: string;
  fmt: (row: T) => string;
  num: (row: T) => number;
  bad?: number; good?: number; invert?: boolean;
  align?: 'left' | 'right';
  defaultSort?: 'asc' | 'desc';
  sticky?: boolean;
}

const HIT_COLS: Col<HitRow>[] = [
  { key: 'Player', label: 'Player', fmt: r => decodeHtml(r.Player), num: () => NaN, align: 'left', sticky: true },
  { key: 'Team',   label: 'Team',   fmt: r => decodeHtml(r.Team),   num: () => NaN, align: 'left' },
  { key: 'G',   label: 'G',   title: 'Games',              fmt: r => fmtInt(r.G),   num: r => n(r.G),   align: 'right' },
  { key: 'PA',  label: 'PA',  title: 'Plate Appearances',  fmt: r => fmtInt(r.PA),  num: r => n(r.PA),  align: 'right' },
  { key: 'H',   label: 'H',   title: 'Hits',               fmt: r => fmtInt(r.H),   num: r => n(r.H),   align: 'right' },
  { key: 'HR',  label: 'HR',  title: 'Home Runs',          fmt: r => fmtInt(r.HR),  num: r => n(r.HR),  align: 'right', bad: 0, good: 15, invert: false, defaultSort: 'desc' },
  { key: '2B',  label: '2B',  title: 'Doubles',            fmt: r => fmtInt(r['2B']), num: r => n(r['2B']), align: 'right' },
  { key: '3B',  label: '3B',  title: 'Triples',            fmt: r => fmtInt(r['3B']), num: r => n(r['3B']), align: 'right' },
  { key: 'BB',  label: 'BB',  title: 'Walks',              fmt: r => fmtInt(r.BB),  num: r => n(r.BB),  align: 'right' },
  { key: 'SO',  label: 'K',   title: 'Strikeouts',         fmt: r => fmtInt(r.SO),  num: r => n(r.SO),  align: 'right' },
  { key: 'SB',  label: 'SB',  title: 'Stolen Bases',       fmt: r => fmtInt(r.SB),  num: r => n(r.SB),  align: 'right' },
  { key: 'BA',  label: 'AVG', title: 'Batting Average',    fmt: r => fmtBat(r.BA),  num: r => n(r.BA),  align: 'right', bad: .200, good: .380, invert: false, defaultSort: 'desc' },
  { key: 'OBP', label: 'OBP', title: 'On-Base %',          fmt: r => fmtBat(r.OBP), num: r => n(r.OBP), align: 'right', bad: .290, good: .440, invert: false, defaultSort: 'desc' },
  { key: 'SLG', label: 'SLG', title: 'Slugging %',         fmt: r => fmtBat(r.SLG), num: r => n(r.SLG), align: 'right', bad: .320, good: .600, invert: false, defaultSort: 'desc' },
  { key: 'OPS', label: 'OPS', title: 'OPS',                fmt: r => fmtBat(r.OPS, 3).replace('.', '.'), num: r => n(r.OPS), align: 'right', bad: .650, good: .980, invert: false, defaultSort: 'desc' },
  { key: 'ISO', label: 'ISO', title: 'Isolated Power',     fmt: r => fmtBat(r.ISO), num: r => n(r.ISO), align: 'right', bad: .060, good: .280, invert: false, defaultSort: 'desc' },
  { key: 'BABIP', label: 'BABIP', title: 'BABIP',          fmt: r => fmtBat(r.BABIP), num: r => n(r.BABIP), align: 'right', bad: .250, good: .380, invert: false },
  { key: 'wOBA', label: 'wOBA', title: 'Weighted OBA',     fmt: r => fmtBat(r.wOBA), num: r => n(r.wOBA), align: 'right', bad: .290, good: .420, invert: false, defaultSort: 'desc' },
];

const PITCH_COLS: Col<PitchRow>[] = [
  { key: 'Player', label: 'Player', fmt: r => decodeHtml(r.Player), num: () => NaN, align: 'left', sticky: true },
  { key: 'Team',   label: 'Team',   fmt: r => decodeHtml(r.Team),   num: () => NaN, align: 'left' },
  { key: 'G',   label: 'G',    title: 'Appearances',   fmt: r => fmtInt(r.G),  num: r => n(r.G),  align: 'right' },
  { key: 'GS',  label: 'GS',   title: 'Starts',        fmt: r => fmtInt(r.GS), num: r => n(r.GS), align: 'right' },
  { key: 'IP',  label: 'IP',   title: 'Innings Pitched', fmt: r => fmtNum(r.IP, 1), num: r => n(r.IP), align: 'right' },
  { key: 'BF',  label: 'BF',   title: 'Batters Faced', fmt: r => fmtInt(r.BF), num: r => n(r.BF), align: 'right' },
  { key: 'SO',  label: 'K',    title: 'Strikeouts',    fmt: r => fmtInt(r.SO), num: r => n(r.SO), align: 'right' },
  { key: 'BB',  label: 'BB',   title: 'Walks',         fmt: r => fmtInt(r.BB), num: r => n(r.BB), align: 'right' },
  { key: 'H',   label: 'H',    title: 'Hits Allowed',  fmt: r => fmtInt(r.H),  num: r => n(r.H),  align: 'right' },
  { key: 'WHIP', label: 'WHIP', title: 'WHIP',         fmt: r => fmtNum(r.WHIP, 2), num: r => n(r.WHIP), align: 'right', bad: 1.80, good: 0.75, invert: true, defaultSort: 'asc' },
  { key: 'BA',   label: 'BAA',  title: 'Batting Avg Against', fmt: r => fmtBat(r.BA), num: r => n(r.BA), align: 'right', bad: .320, good: .175, invert: true, defaultSort: 'asc' },
  { key: 'K%',   label: 'K%',   title: 'Strikeout Rate', fmt: r => fmtNum(r['K%']) + '%', num: r => n(r['K%']), align: 'right', bad: 14, good: 38, invert: false, defaultSort: 'desc' },
  { key: 'BB%',  label: 'BB%',  title: 'Walk Rate',    fmt: r => fmtNum(r['BB%']) + '%', num: r => n(r['BB%']), align: 'right', bad: 14, good: 4, invert: true, defaultSort: 'asc' },
  { key: 'FIP',  label: 'FIP',  title: 'Fielding Independent Pitching', fmt: r => fmtNum(r.FIP, 2), num: r => n(r.FIP), align: 'right', bad: 6.5, good: 2.0, invert: true, defaultSort: 'asc' },
  { key: 'xFIP', label: 'xFIP', title: 'Expected FIP', fmt: r => fmtNum(r.xFIP, 2), num: r => n(r.xFIP), align: 'right', bad: 6.0, good: 2.0, invert: true, defaultSort: 'asc' },
  { key: 'SIERA', label: 'SIERA', title: 'Skill-Interactive ERA', fmt: r => fmtNum(r.SIERA, 2), num: r => n(r.SIERA), align: 'right', bad: 6.0, good: 1.0, invert: true, defaultSort: 'asc' },
  { key: 'BABIP', label: 'BABIP', title: 'BABIP Against', fmt: r => fmtBat(r.BABIP), num: r => n(r.BABIP), align: 'right', bad: .370, good: .220, invert: true },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];

export default function CollegePage() {
  const [tab, setTab] = useState<'hit' | 'pitch'>('hit');
  const [year, setYear] = useState('2025');
  const [hitRows, setHitRows] = useState<HitRow[]>([]);
  const [pitchRows, setPitchRows] = useState<PitchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort state
  const [sortKey, setSortKey] = useState<string>('OPS');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Filters
  const [search, setSearch] = useState('');
  const [minPA, setMinPA] = useState(25);
  const [minIP, setMinIP] = useState(5);

  // Fetch both types whenever year changes
  useEffect(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetch(`/api/overslot-stats?type=hit&year=${year}`).then(r => r.json()),
      fetch(`/api/overslot-stats?type=pitch&year=${year}`).then(r => r.json()),
    ])
      .then(([hitData, pitchData]) => {
        setHitRows((hitData.players ?? []) as HitRow[]);
        setPitchRows((pitchData.players ?? []) as PitchRow[]);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [year]);

  // Reset sort to sensible default when switching tabs
  useEffect(() => {
    if (tab === 'hit') { setSortKey('OPS'); setSortDir('desc'); }
    else               { setSortKey('FIP'); setSortDir('asc');  }
  }, [tab]);

  const handleSort = (key: string, defaultDir: 'asc' | 'desc' = 'desc') => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(defaultDir); }
  };

  // ── Filtered & sorted hitters ──────────────────────────────────────────────
  const filteredHitters = useMemo(() => {
    const q = search.toLowerCase();
    const col = HIT_COLS.find(c => c.key === sortKey) ?? HIT_COLS[11];
    return hitRows
      .filter(r => {
        if (n(r.PA) < minPA) return false;
        if (q && !decodeHtml(r.Player).toLowerCase().includes(q) && !decodeHtml(r.Team).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = col.num(a), bv = col.num(b);
        if (isNaN(av) && isNaN(bv)) return 0;
        if (isNaN(av)) return 1;
        if (isNaN(bv)) return -1;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [hitRows, search, minPA, sortKey, sortDir]);

  // ── Filtered & sorted pitchers ─────────────────────────────────────────────
  const filteredPitchers = useMemo(() => {
    const q = search.toLowerCase();
    const col = PITCH_COLS.find(c => c.key === sortKey) ?? PITCH_COLS[13];
    return pitchRows
      .filter(r => {
        if (n(r.IP) < minIP) return false;
        if (q && !decodeHtml(r.Player).toLowerCase().includes(q) && !decodeHtml(r.Team).toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const av = col.num(a), bv = col.num(b);
        if (isNaN(av) && isNaN(bv)) return 0;
        if (isNaN(av)) return 1;
        if (isNaN(bv)) return -1;
        return sortDir === 'desc' ? bv - av : av - bv;
      });
  }, [pitchRows, search, minIP, sortKey, sortDir]);

  const cols = tab === 'hit' ? HIT_COLS : PITCH_COLS;

  return (
    <div className="min-h-screen bg-page text-deep-fg">
      {/* Nav */}
      <header className="bg-page border-b border-ink/20">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Hitters</Link>
          <h1 className="font-display font-black uppercase tracking-widest text-lg">College Baseball</h1>
          <Link href="/pitchers" className="text-ink-3 hover:text-ink font-medium text-sm transition-colors">Pitchers</Link>
        </div>
      </header>

      {/* Controls */}
      <div className="border-b border-ink/20 bg-page">
        <div className="container mx-auto px-4 py-3 flex flex-wrap items-center gap-3">

          {/* Tab toggle */}
          <div className="flex overflow-hidden border border-ink/20">
            {(['hit', 'pitch'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                  tab === t ? 'bg-deep text-deep-fg' : 'bg-panel text-ink-3 hover:text-ink'
                }`}>
                {t === 'hit' ? 'Hitters' : 'Pitchers'}
              </button>
            ))}
          </div>

          {/* Year selector */}
          <div className="flex overflow-hidden border border-ink/20">
            {YEARS.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  year === y ? 'bg-deep text-deep-fg' : 'bg-panel text-ink-3 hover:text-ink'
                }`}>
                {y}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search player or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="px-3 py-1.5 text-xs bg-panel border border-ink/20 text-ink placeholder:text-ink-4 outline-none focus:border-ink/40"
            style={{ minWidth: 200 }}
          />

          {/* Min sample */}
          {tab === 'hit' ? (
            <label className="flex items-center gap-2 text-xs text-ink-3">
              Min PA:
              <select value={minPA} onChange={e => setMinPA(+e.target.value)}
                className="bg-panel border border-ink/20 text-ink text-xs px-2 py-1 outline-none">
                {[0, 10, 25, 50, 75, 100, 150, 200].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          ) : (
            <label className="flex items-center gap-2 text-xs text-ink-3">
              Min IP:
              <select value={minIP} onChange={e => setMinIP(+e.target.value)}
                className="bg-panel border border-ink/20 text-ink text-xs px-2 py-1 outline-none">
                {[0, 5, 10, 15, 20, 30, 40, 50].map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
          )}

          {/* Count */}
          {!loading && (
            <span className="text-xs text-ink-4 ml-auto">
              {tab === 'hit' ? filteredHitters.length : filteredPitchers.length} players
              {' · '}data via Overslot Baseball
            </span>
          )}
        </div>
      </div>

      {/* Table area */}
      <div className="container mx-auto px-4 py-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-16">
            <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent animate-spin"/>
            <span className="text-ink-3 text-sm">Loading {year} stats…</span>
          </div>
        )}
        {error && (
          <div className="text-center py-16 text-red-400 text-sm">{error}</div>
        )}

        {!loading && !error && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs" style={{ minWidth: 900 }}>
              <thead>
                <tr className="border-b-2 border-ink/30" style={{ background: 'var(--color-panel)' }}>
                  {cols.map((col, ci) => (
                    <th
                      key={String(col.key)}
                      title={col.title ?? col.label}
                      onClick={() => handleSort(String(col.key), col.defaultSort ?? 'desc')}
                      className={`px-2 py-2 font-bold uppercase tracking-wider text-ink-3 cursor-pointer select-none hover:text-ink transition-colors whitespace-nowrap ${
                        col.align === 'left' ? 'text-left' : 'text-right'
                      } ${ci === 0 ? 'pl-3' : ''}`}
                      style={{ fontSize: 10 }}
                    >
                      {col.label}
                      {sortKey === String(col.key) && (
                        <span className="ml-0.5">{sortDir === 'desc' ? ' ▼' : ' ▲'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tab === 'hit' && filteredHitters.map((row, ri) => (
                  <tr key={ri}
                    className="border-b border-ink/10 hover:bg-panel/60 transition-colors"
                    style={{ background: ri % 2 === 0 ? undefined : 'rgba(0,0,0,0.02)' }}>
                    {HIT_COLS.map((col, ci) => {
                      const displayVal = col.fmt(row);
                      const numVal     = col.num(row);
                      const color = (col.bad != null && col.good != null && !isNaN(numVal))
                        ? statColor(numVal, col.bad, col.good, col.invert ?? false)
                        : '';
                      return (
                        <td key={String(col.key)}
                          className={`px-2 py-1.5 tabular-nums ${col.align === 'left' ? 'text-left' : 'text-right'} ${ci === 0 ? 'pl-3 font-semibold' : ''}`}
                          style={{ color: color || undefined, fontSize: 12 }}>
                          {displayVal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {tab === 'pitch' && filteredPitchers.map((row, ri) => (
                  <tr key={ri}
                    className="border-b border-ink/10 hover:bg-panel/60 transition-colors"
                    style={{ background: ri % 2 === 0 ? undefined : 'rgba(0,0,0,0.02)' }}>
                    {PITCH_COLS.map((col, ci) => {
                      const displayVal = col.fmt(row as unknown as PitchRow);
                      const numVal     = col.num(row as unknown as PitchRow);
                      const color = (col.bad != null && col.good != null && !isNaN(numVal))
                        ? statColor(numVal, col.bad, col.good, col.invert ?? false)
                        : '';
                      return (
                        <td key={String(col.key)}
                          className={`px-2 py-1.5 tabular-nums ${col.align === 'left' ? 'text-left' : 'text-right'} ${ci === 0 ? 'pl-3 font-semibold' : ''}`}
                          style={{ color: color || undefined, fontSize: 12 }}>
                          {displayVal}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!loading && tab === 'hit' && filteredHitters.length === 0 && (
                  <tr><td colSpan={HIT_COLS.length} className="text-center py-12 text-ink-4">No hitters found.</td></tr>
                )}
                {!loading && tab === 'pitch' && filteredPitchers.length === 0 && (
                  <tr><td colSpan={PITCH_COLS.length} className="text-center py-12 text-ink-4">No pitchers found.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Legend */}
        {!loading && !error && (
          <div className="mt-4 flex flex-wrap gap-4 text-[10px] text-ink-4">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: statColor(1, 0, 1, false) }}/>
              <span>Elite</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: statColor(0.5, 0, 1, false) }}/>
              <span>Average</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded-sm" style={{ background: statColor(0, 0, 1, false) }}/>
              <span>Below avg</span>
            </div>
            <span>· Click column header to sort · Color coding on rate stats only</span>
          </div>
        )}
      </div>
    </div>
  );
}

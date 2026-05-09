'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';

// ─── Types ───────────────────────────────────────────────────────────────────

interface HSPlayer {
  playerUrl:   string;
  name:        string;
  position:    string | null;
  school:      string | null;
  commit:      string | null;
  bt:          string | null;
  height:      string | null;
  weight:      string | null;
  hometown:    string | null;
  draftYear:   string | null;
  photoUrl:    string | null;
  whiffPct:    number | null;
  izWhiffPct:  number | null;
  oozWhiffPct: number | null;
  chasePct:    number | null;
  kPct:        number | null;
  bbPct:       number | null;
  avgEv:       number | null;
  ev90:        number | null;
  barrelPct:   number | null;
  pullAirPct:  number | null;
  xWoba:       number | null;
}

interface PlayerGrades {
  hit: string; power: string; fielding: string; arm: string; run: string; fv: string;
  name: string; team: string; position: string; draftYear: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const YEARS = ['2026', '2027', '2028'];

const COLS: { key: keyof HSPlayer; label: string; title: string; lower?: boolean }[] = [
  { key: 'avgEv',       label: 'Avg EV',      title: 'Average Exit Velocity' },
  { key: 'ev90',        label: '90th EV',     title: '90th Percentile Exit Velocity' },
  { key: 'barrelPct',   label: 'Barrel%',     title: 'Barrel %' },
  { key: 'xWoba',       label: 'xWOBA',       title: 'Expected wOBA' },
  { key: 'whiffPct',    label: 'Whiff%',      title: 'Whiff %',          lower: true },
  { key: 'izWhiffPct',  label: 'IZ Whiff%',   title: 'In-Zone Whiff %',  lower: true },
  { key: 'oozWhiffPct', label: 'OOZ Whiff%',  title: 'Out-of-Zone Whiff %', lower: true },
  { key: 'chasePct',    label: 'Chase%',      title: 'Chase %',          lower: true },
  { key: 'kPct',        label: 'K%',          title: 'Strikeout %',      lower: true },
  { key: 'bbPct',       label: 'BB%',         title: 'Walk %' },
  { key: 'pullAirPct',  label: 'Pull Air%',   title: 'Pull Air Ball %' },
];

const GRADE_FIELDS: { key: keyof PlayerGrades; label: string }[] = [
  { key: 'hit',      label: 'HIT' },
  { key: 'power',    label: 'POW' },
  { key: 'run',      label: 'RUN' },
  { key: 'fielding', label: 'FLD' },
  { key: 'arm',      label: 'ARM' },
  { key: 'fv',       label: 'FV'  },
];

const GRADE_OPTIONS = ['', '20', '25', '30', '35', '40', '45', '45+', '50', '50+', '55', '55+', '60', '65', '70', '75', '80'];

const CARD_STATS: { key: keyof HSPlayer; label: string; bad: number; good: number; invert: boolean; fmt: (v: number) => string }[] = [
  { key: 'avgEv',       label: 'Avg EV',         bad: 84,   good: 95,   invert: false, fmt: v => v.toFixed(1) + ' mph' },
  { key: 'ev90',        label: '90th% EV',        bad: 98,   good: 114,  invert: false, fmt: v => v.toFixed(1) + ' mph' },
  { key: 'barrelPct',   label: 'Barrel %',        bad: 3,    good: 25,   invert: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'xWoba',       label: 'xWOBA',           bad: 0.27, good: 0.44, invert: false, fmt: v => v.toFixed(3).replace(/^0/, '') },
  { key: 'whiffPct',    label: 'Whiff %',         bad: 35,   good: 12,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'izWhiffPct',  label: 'In-Zone Whiff %', bad: 25,   good: 8,    invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'oozWhiffPct', label: 'OOZ Whiff %',     bad: 55,   good: 20,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'chasePct',    label: 'Chase %',          bad: 38,   good: 16,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'kPct',        label: 'K %',             bad: 35,   good: 10,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'bbPct',       label: 'BB %',            bad: 4,    good: 18,   invert: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'pullAirPct',  label: 'Pull Air Ball %', bad: 10,   good: 45,   invert: false, fmt: v => v.toFixed(1) + '%' },
];

// ─── Color helpers ───────────────────────────────────────────────────────────

function statColor(n: number, bad: number, good: number, invert: boolean): string {
  const lo = Math.min(bad, good);
  const hi = Math.max(bad, good);
  const clamped = Math.max(lo, Math.min(hi, n));
  const raw = hi === lo ? 0 : (clamped - lo) / (hi - lo);
  const t = invert ? 1 - raw : raw;
  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  }
  const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
  return `rgb(${r},${g},60)`;
}

function gradeColor(val: string): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '#374151';
  if (n >= 70) return '#16a34a';
  if (n >= 60) return '#22c55e';
  if (n >= 55) return '#84cc16';
  if (n >= 50) return '#ca8a04';
  if (n >= 45) return '#d97706';
  if (n >= 40) return '#ea580c';
  return '#dc2626';
}

function fmtStat(key: keyof HSPlayer, val: number): string {
  if (key === 'xWoba') return val.toFixed(3).replace(/^0/, '');
  return val.toFixed(1);
}

function colorForCol(col: { key: keyof HSPlayer; bad: number; good: number; invert: boolean } | undefined, val: number): string {
  if (!col) return '';
  return statColor(val, col.bad, col.good, col.invert);
}

// ─── Grades localStorage helpers ─────────────────────────────────────────────

function loadGrades(url: string): Partial<PlayerGrades> {
  if (typeof window === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(`og_grade:${url}`) ?? '{}'); } catch { return {}; }
}

function saveGrades(url: string, g: Partial<PlayerGrades>) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`og_grade:${url}`, JSON.stringify(g));
}

// ─── Player Card ─────────────────────────────────────────────────────────────

function HSPlayerCard({ player, onClose }: { player: HSPlayer; onClose: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const [grades, setGrades] = useState<Partial<PlayerGrades>>(() => loadGrades(player.playerUrl));

  const initials = player.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const fv = grades.fv ?? '';

  function updateGrade(key: keyof PlayerGrades, val: string) {
    const next = {
      ...grades, [key]: val,
      name: player.name, team: player.school ?? '',
      position: player.position ?? '', draftYear: player.draftYear ?? '',
    };
    setGrades(next);
    saveGrades(player.playerUrl, next);
  }

  function InfoPanel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
      <div className="rounded-xl border border-[#262626] bg-[#101010] flex flex-col">
        <div className="px-4 pt-3 pb-2 border-b border-[#262626]">
          <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">{title}</span>
        </div>
        <div className="px-4 py-3 flex-1">{children}</div>
      </div>
    );
  }

  const hasTrackman = CARD_STATS.some(s => player[s.key] != null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3"
      style={{ background: 'rgba(0,0,0,0.82)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}>
      <div className="relative w-full max-w-4xl max-h-[95vh] overflow-y-auto rounded-2xl border border-[#222]"
        style={{ background: '#0a0a0a' }}
        onClick={e => e.stopPropagation()}>

        <button onClick={onClose}
          className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[#1c1c1c] text-[#666] hover:text-white transition-colors text-lg leading-none">
          ×
        </button>

        {/* ── Top row ── */}
        <div className="grid grid-cols-4 gap-3 p-4 pb-3">

          {/* Photo */}
          <div className="rounded-xl border border-[#262626] bg-[#101010] overflow-hidden flex flex-col">
            <div className="flex-1 min-h-0">
              {player.photoUrl && !imgFailed ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/proxy-photo?url=${encodeURIComponent(player.photoUrl)}`}
                  alt={player.name} className="w-full h-full object-cover object-top"
                  style={{ minHeight: '160px', maxHeight: '200px' }}
                  onError={() => setImgFailed(true)} />
              ) : (
                <div className="w-full flex items-center justify-center text-5xl font-bold text-[#333] bg-[#111]"
                  style={{ minHeight: '160px' }}>{initials}</div>
              )}
            </div>
            <div className="px-3 py-2 border-t border-[#262626] text-center">
              <div className="font-bold text-white text-sm leading-tight">{player.name}</div>
              <div className="text-xs text-[#888] mt-0.5">
                {player.position && <span className="text-white font-semibold">{player.position} · </span>}
                {player.school}
              </div>
              {player.playerUrl && (
                <a href={`https://overslotbaseball.com${player.playerUrl}`} target="_blank" rel="noopener noreferrer"
                  className="text-[10px] text-[#888] hover:text-white transition-colors mt-0.5 inline-block">
                  View on Over Slot ↗
                </a>
              )}
            </div>
          </div>

          {/* Player Info */}
          <InfoPanel title="Player Info">
            <div className="space-y-2.5">
              {[
                { label: 'HIGH SCHOOL', val: player.school },
                { label: 'COMMIT',      val: player.commit },
                { label: 'HOMETOWN',    val: player.hometown },
                { label: 'B/T',         val: player.bt },
                { label: 'HEIGHT',      val: player.height },
                { label: 'WEIGHT',      val: player.weight },
                { label: 'DRAFT',       val: player.draftYear ? `${player.draftYear} Draft` : null },
              ].map(({ label, val }) => val ? (
                <div key={label}>
                  <div className="text-[10px] text-[#666] font-bold tracking-wider mb-0.5">{label}</div>
                  <div className="text-sm text-white font-medium">{val}</div>
                </div>
              ) : null)}
            </div>
          </InfoPanel>

          {/* Scout Grades */}
          <InfoPanel title="Scout Grades">
            <div className="text-center mb-3 pb-3 border-b border-[#262626]">
              <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1">Future Value</div>
              <div className="text-5xl font-black leading-none" style={{ color: fv ? gradeColor(fv) : '#333' }}>
                {fv || '—'}
              </div>
              {fv && (
                <div className="text-xs mt-1 font-medium" style={{ color: gradeColor(fv) }}>
                  {parseFloat(fv) >= 65 ? 'Plus-Plus' : parseFloat(fv) >= 60 ? 'Plus' : parseFloat(fv) >= 55 ? 'Above Avg' : parseFloat(fv) >= 50 ? 'Average' : parseFloat(fv) >= 45 ? 'Fringe' : 'Below Avg'}
                </div>
              )}
              <select value={fv} onChange={e => updateGrade('fv', e.target.value)}
                className="mt-2 rounded-lg py-1 px-2 text-sm font-bold text-center border border-[#333] focus:outline-none cursor-pointer w-20"
                style={{ background: fv ? gradeColor(fv) : '#1c1c1c', color: fv ? '#fff' : '#666' }}>
                {GRADE_OPTIONS.map(o => (
                  <option key={o} value={o} style={{ background: '#111', color: '#e5e7eb' }}>{o || '—'}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              {GRADE_FIELDS.filter(f => f.key !== 'fv').map(({ key, label }) => {
                const val = grades[key] ?? '';
                return (
                  <div key={key} className="flex items-center justify-between gap-2">
                    <span className="text-xs text-[#555] w-8">{label}</span>
                    <select value={val} onChange={e => updateGrade(key, e.target.value)}
                      className="flex-1 rounded py-0.5 text-xs font-bold text-center border border-[#2e2e2e] focus:outline-none cursor-pointer"
                      style={{ background: val ? gradeColor(val) : '#1c1c1c', color: val ? '#fff' : '#555' }}>
                      {GRADE_OPTIONS.map(o => (
                        <option key={o} value={o} style={{ background: '#111', color: '#e5e7eb' }}>{o || '—'}</option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <a href="/grades" className="text-[10px] text-[#666] hover:text-white mt-3 block text-right transition-colors">
              Grades Board ↗
            </a>
          </InfoPanel>

          {/* TrackMan highlight */}
          <InfoPanel title="TrackMan">
            {hasTrackman ? (
              <div className="space-y-2">
                {[
                  { key: 'xWoba' as keyof HSPlayer,     label: 'xWOBA',    bad: 0.27, good: 0.44, invert: false, fmt: (v: number) => v.toFixed(3).replace(/^0/,'') },
                  { key: 'barrelPct' as keyof HSPlayer,  label: 'Barrel%',  bad: 3,    good: 25,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'avgEv' as keyof HSPlayer,      label: 'Avg EV',   bad: 84,   good: 95,   invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                  { key: 'ev90' as keyof HSPlayer,       label: '90th EV',  bad: 98,   good: 114,  invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                  { key: 'whiffPct' as keyof HSPlayer,   label: 'Whiff%',   bad: 35,   good: 12,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'chasePct' as keyof HSPlayer,   label: 'Chase%',   bad: 38,   good: 16,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'kPct' as keyof HSPlayer,       label: 'K%',       bad: 35,   good: 10,   invert: true,  fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'bbPct' as keyof HSPlayer,      label: 'BB%',      bad: 4,    good: 18,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                ].map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  if (raw == null) return null;
                  const color = statColor(raw, bad, good, invert);
                  return (
                    <div key={String(key)} className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-[#666]">{label}</span>
                      <span className="text-sm font-bold font-mono" style={{ color }}>{fmt(raw)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full py-6">
                <span className="text-[#444] text-xs">No TrackMan data</span>
              </div>
            )}
          </InfoPanel>
        </div>

        {/* ── TrackMan full breakdown ── */}
        {hasTrackman && (
          <div className="px-4 pb-4">
            <div className="rounded-xl border border-[#262626] bg-[#101010]">
              <div className="px-4 py-2 border-b border-[#262626]">
                <span className="text-[10px] font-bold text-[#555] uppercase tracking-widest">TrackMan Breakdown</span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-[#262626] border-b border-[#262626]">
                {[
                  { key: 'xWoba' as keyof HSPlayer,    label: 'xWOBA',    bad: 0.27, good: 0.44, invert: false, fmt: (v: number) => v.toFixed(3).replace(/^0/,'') },
                  { key: 'barrelPct' as keyof HSPlayer, label: 'Barrel %', bad: 3,    good: 25,   invert: false, fmt: (v: number) => v.toFixed(1)+'%' },
                  { key: 'avgEv' as keyof HSPlayer,     label: 'Avg EV',   bad: 84,   good: 95,   invert: false, fmt: (v: number) => v.toFixed(1)+' mph' },
                ].map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  return (
                    <div key={String(key)} className="text-center py-4 px-3">
                      <div className="text-xs text-[#555] mb-1">{label}</div>
                      <div className="text-3xl font-black" style={{ color: raw != null ? statColor(raw, bad, good, invert) : '#333' }}>
                        {raw != null ? fmt(raw) : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2 px-5 py-3">
                {CARD_STATS.filter(s => !['xWoba','barrelPct','avgEv'].includes(s.key as string)).map(({ key, label, bad, good, invert, fmt }) => {
                  const raw = player[key] as number | null;
                  if (raw == null) return null;
                  const color = statColor(raw, bad, good, invert);
                  return (
                    <div key={String(key)} className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-[#555]">{label}</span>
                      <span className="text-sm font-bold font-mono" style={{ color }}>{fmt(raw)}</span>
                    </div>
                  );
                }).filter(Boolean)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HSPage() {
  const [year, setYear]         = useState('2026');
  const [players, setPlayers]   = useState<HSPlayer[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [sortCol, setSortCol]   = useState<keyof HSPlayer>('avgEv');
  const [sortAsc, setSortAsc]   = useState(false);
  const [selected, setSelected] = useState<HSPlayer | null>(null);
  const loadedYear              = useRef('');

  const load = useCallback(async (y: string) => {
    if (loadedYear.current === y) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hs-players?year=${y}`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setPlayers(d.players ?? []);
      loadedYear.current = y;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(year); }, [year, load]);

  const filtered = useMemo(() => {
    let rows = players;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.school?.toLowerCase().includes(q) ||
        p.commit?.toLowerCase().includes(q) ||
        p.hometown?.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const av = (a[sortCol] as number | null) ?? -Infinity;
      const bv = (b[sortCol] as number | null) ?? -Infinity;
      if (av === bv) return 0;
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });
  }, [players, search, sortCol, sortAsc]);

  const colMeta = COLS.reduce<Record<string, typeof COLS[0]>>((acc, c) => { acc[c.key] = c; return acc; }, {});

  function handleSort(key: keyof HSPlayer) {
    if (key === sortCol) { setSortAsc(a => !a); }
    else { setSortCol(key); setSortAsc(colMeta[key as string]?.lower ?? false); }
  }

  const withData = players.filter(p => p.avgEv != null || p.barrelPct != null).length;

  return (
    <div className="min-h-screen text-white" style={{ background: '#0c0c0c' }}>
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <Link href="/" className="text-[#666] hover:text-white text-sm flex-shrink-0 transition-colors">← Back</Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">High School Prospects</h1>
            <p className="text-[#666] text-sm mt-0.5">
              {loading ? 'Loading…' : error ? 'Error' : `${filtered.length} players · ${withData} with TrackMan · via Over Slot`}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {/* Year */}
          <div className="flex gap-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  year === y ? 'bg-white text-black' : 'bg-[#1c1c1c] text-[#888] hover:bg-[#222] hover:text-white'
                }`}>
                {y}
              </button>
            ))}
          </div>

          {/* Search */}
          <input type="text" placeholder="Search name, school, commit…"
            value={search} onChange={e => setSearch(e.target.value)}
            className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-3 py-1.5 text-sm text-white placeholder-[#555] focus:outline-none focus:border-white/40 w-64" />
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-auto border border-[#222]" style={{ background: '#141414' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-[#555]">
              <div className="w-6 h-6 border-2 border-white/30 border-t-white/80 rounded-full animate-spin" />
              <span className="text-sm">Fetching {year} HS prospects (~25s)…</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#222]">
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">#</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Player</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Pos</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">School</th>
                  <th className="text-left px-3 py-2.5 text-[#555] font-medium">Commit</th>
                  <th className="text-center px-3 py-2.5 text-[#555] font-medium">Yr</th>
                  {COLS.map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)}
                      title={col.title}
                      className={`px-3 py-2.5 text-right font-medium cursor-pointer select-none transition-colors hover:text-white ${
                        sortCol === col.key ? 'text-white' : 'text-[#555]'
                      }`}>
                      {col.label}
                      {sortCol === col.key && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((player, i) => (
                  <tr key={player.playerUrl}
                    className="border-b border-[#1a1a1a] cursor-pointer hover:bg-[#1c1c1c] transition-colors"
                    style={{ background: i % 2 === 0 ? '#111111' : '#0f0f0f' }}
                    onClick={() => setSelected(player)}>
                    <td className="px-3 py-2 text-[#444] text-xs">{i + 1}</td>
                    <td className="px-3 py-2">
                      <span className="text-white font-medium hover:text-gray-300 transition-colors">{player.name}</span>
                    </td>
                    <td className="px-3 py-2 text-[#888] font-medium text-sm">{player.position || '—'}</td>
                    <td className="px-3 py-2 text-[#888] text-sm">{player.school || '—'}</td>
                    <td className="px-3 py-2 text-[#888] text-sm">{player.commit || '—'}</td>
                    <td className="px-3 py-2 text-center text-[#666] text-sm">{player.draftYear || '—'}</td>
                    {COLS.map(col => {
                      const raw = player[col.key] as number | null;
                      if (raw == null) return <td key={col.key} className="px-3 py-2 text-right text-[#333]">—</td>;
                      const color = statColor(raw, col.lower ? (col.key === 'kPct' ? 35 : col.key === 'whiffPct' ? 35 : col.key === 'izWhiffPct' ? 25 : col.key === 'oozWhiffPct' ? 55 : col.key === 'chasePct' ? 38 : 35) : (col.key === 'avgEv' ? 84 : col.key === 'ev90' ? 98 : col.key === 'barrelPct' ? 3 : col.key === 'xWoba' ? 0.27 : col.key === 'bbPct' ? 4 : 10), col.lower ? (col.key === 'kPct' ? 10 : col.key === 'whiffPct' ? 12 : col.key === 'izWhiffPct' ? 8 : col.key === 'oozWhiffPct' ? 20 : col.key === 'chasePct' ? 16 : 12) : (col.key === 'avgEv' ? 95 : col.key === 'ev90' ? 114 : col.key === 'barrelPct' ? 25 : col.key === 'xWoba' ? 0.44 : col.key === 'bbPct' ? 18 : 45), col.lower ?? false);
                      return (
                        <td key={col.key} className="px-3 py-2 text-right font-mono text-sm">
                          <span style={{ color }}>{fmtStat(col.key, raw)}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr><td colSpan={6 + COLS.length} className="text-center py-12 text-[#444]">No players found</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-3 text-xs text-[#333] text-right">
          Data via <a href="https://overslotbaseball.com" target="_blank" rel="noopener noreferrer"
            className="hover:text-[#666] transition-colors">Over Slot</a>
        </p>
      </div>

      {selected && <HSPlayerCard player={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

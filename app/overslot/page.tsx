'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StatRow = Record<string, any>;

interface AdvancedStats {
  draftYear:   string | null;
  position:    string | null;
  bt:          string | null;
  height:      string | null;
  weight:      string | null;
  hometown:    string | null;
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

const YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
const HIT_DEFAULT_SORT = 'OPS';
const PIT_DEFAULT_SORT = 'SO';

const LOWER_IS_BETTER = new Set([
  'WHIP', 'FIP', 'xFIP', 'SIERA', 'BB%', 'BB/K', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP',
  'H', 'R', 'BB', 'HBP', 'Whiff%', 'IZ Whiff%', 'OOZ Whiff%', 'Chase%', 'K%',
]);
const HIT_RATE_COLS = new Set(['BA', 'OBP', 'SLG', 'OPS', 'ISO', 'BABIP', 'wOBA']);
const PIT_RATE_COLS = new Set(['WHIP', 'BA', 'OBP', 'SLG', 'OPS', 'BABIP', 'BB%', 'K%', 'BB/K', 'FIP', 'xFIP', 'SIERA']);

const MIN_PA_OPTIONS = [1, 25, 50, 75, 100, 150, 200];
const MIN_IP_OPTIONS = [1, 5, 10, 15, 20, 30, 40];

const ADV_COLS = [
  { key: 'draftYear',   label: 'Yr',         title: 'Draft Year' },
  { key: 'whiffPct',    label: 'Whiff%',      title: 'Whiff %' },
  { key: 'izWhiffPct',  label: 'IZ Whiff%',   title: 'In-Zone Whiff %' },
  { key: 'oozWhiffPct', label: 'OOZ Whiff%',  title: 'Out-of-Zone Whiff %' },
  { key: 'chasePct',    label: 'Chase%',      title: 'Chase %' },
  { key: 'kPct',        label: 'K%',          title: 'K %' },
  { key: 'bbPct',       label: 'BB%',         title: 'BB %' },
  { key: 'avgEv',       label: 'Avg EV',      title: 'Avg Exit Velocity' },
  { key: 'ev90',        label: '90th EV',     title: '90th Percentile Exit Velocity' },
  { key: 'barrelPct',   label: 'Barrel%',     title: 'Barrel %' },
  { key: 'pullAirPct',  label: 'Pull AIR%',   title: 'Pull Air Ball %' },
  { key: 'xWoba',       label: 'xWOBA',       title: 'Expected wOBA' },
];

// Advanced stats to show in player card with bar chart
const CARD_ADV_STATS: { key: keyof AdvancedStats; label: string; bad: number; good: number; invert: boolean; fmt: (v: number) => string }[] = [
  { key: 'avgEv',       label: 'Avg EV',          bad: 84,   good: 95,   invert: false, fmt: v => v.toFixed(1) + ' mph' },
  { key: 'ev90',        label: '90th% EV',         bad: 98,   good: 114,  invert: false, fmt: v => v.toFixed(1) + ' mph' },
  { key: 'barrelPct',   label: 'Barrel %',         bad: 3,    good: 25,   invert: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'xWoba',       label: 'xWOBA',            bad: 0.27, good: 0.44, invert: false, fmt: v => v.toFixed(3).replace(/^0/, '') },
  { key: 'whiffPct',    label: 'Whiff %',          bad: 35,   good: 12,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'izWhiffPct',  label: 'In-Zone Whiff %',  bad: 25,   good: 8,    invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'oozWhiffPct', label: 'OOZ Whiff %',      bad: 55,   good: 20,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'chasePct',    label: 'Chase %',           bad: 38,   good: 16,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'kPct',        label: 'K %',              bad: 35,   good: 10,   invert: true,  fmt: v => v.toFixed(1) + '%' },
  { key: 'bbPct',       label: 'BB %',             bad: 4,    good: 18,   invert: false, fmt: v => v.toFixed(1) + '%' },
  { key: 'pullAirPct',  label: 'Pull Air Ball %',  bad: 10,   good: 45,   invert: false, fmt: v => v.toFixed(1) + '%' },
];

function numVal(v: string | undefined): number {
  if (!v || v === '' || v === '—') return -Infinity;
  return parseFloat(v.replace('%', ''));
}

function statColor(n: number, bad: number, good: number, invert: boolean): string {
  let t: number;
  const lo = invert ? good : bad;
  const hi = invert ? bad  : good;
  if (n <= lo) t = 0;
  else if (n >= hi) t = 1;
  else t = (n - lo) / (hi - lo);
  if (invert) t = 1 - t;
  // re-normalize so t=0 is bad, t=1 is good
  t = invert ? (hi - Math.max(lo, Math.min(hi, n))) / (hi - lo) : (Math.max(lo, Math.min(hi, n)) - lo) / (hi - lo);

  if (t < 0.5) {
    const r = 220, g = Math.round(80 + t * 2 * 140);
    return `rgb(${r},${g},60)`;
  } else {
    const r = Math.round(220 - (t - 0.5) * 2 * 180), g = 200;
    return `rgb(${r},${g},60)`;
  }
}

function statPct(n: number, bad: number, good: number, invert: boolean): number {
  const lo = Math.min(bad, good);
  const hi = Math.max(bad, good);
  const clamped = Math.max(lo, Math.min(hi, n));
  const raw = hi === lo ? 0 : (clamped - lo) / (hi - lo);
  const t = invert ? 1 - raw : raw;
  return Math.round(Math.max(3, Math.min(100, t * 100)));
}

function colorForTableStat(col: string, val: string, type: 'hit' | 'pitch'): string {
  const n = parseFloat(val);
  if (isNaN(n)) return '';
  if (type === 'hit') {
    if (col === 'BA')   return statColor(n, 0.200, 0.350, false);
    if (col === 'OBP')  return statColor(n, 0.280, 0.430, false);
    if (col === 'SLG')  return statColor(n, 0.350, 0.600, false);
    if (col === 'OPS')  return statColor(n, 0.650, 1.000, false);
    if (col === 'wOBA') return statColor(n, 0.280, 0.420, false);
    if (col === 'ISO')  return statColor(n, 0.100, 0.280, false);
  }
  if (type === 'pitch') {
    if (col === 'K%')    return statColor(n, 15, 32, false);
    if (col === 'BB%')   return statColor(n, 12, 4, true);
    if (col === 'FIP')   return statColor(n, 5.0, 3.0, true);
    if (col === 'xFIP')  return statColor(n, 5.0, 3.0, true);
    if (col === 'SIERA') return statColor(n, 5.0, 3.0, true);
    if (col === 'WHIP')  return statColor(n, 1.8, 0.9, true);
  }
  // Advanced cols in table
  if (col === 'Avg EV')    return statColor(n, 84, 95, false);
  if (col === '90th EV')   return statColor(n, 98, 114, false);
  if (col === 'Barrel%')   return statColor(n, 3, 25, false);
  if (col === 'xWOBA')     return statColor(n, 0.27, 0.44, false);
  if (col === 'Whiff%')    return statColor(n, 35, 12, true);
  if (col === 'Chase%')    return statColor(n, 38, 16, true);
  if (col === 'K%')        return statColor(n, 35, 10, true);
  if (col === 'BB%')       return statColor(n, 4, 18, false);
  return '';
}

// ─── Player Card ─────────────────────────────────────────────────────────────

function PlayerCard({ player, advData, onClose, onLoadAdv, advLoading }:{
  player: StatRow;
  advData: Record<string, AdvancedStats>;
  onClose: () => void;
  onLoadAdv: () => void;
  advLoading: boolean;
}) {
  const adv: AdvancedStats | undefined = advData[player.playerUrl];
  const hasAdv = !!adv;

  // Auto-trigger load when card opens and advanced stats aren't available yet
  useEffect(() => {
    if (!hasAdv && !advLoading) {
      onLoadAdv();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initials avatar fallback
  const initials = (player['Player'] ?? '??').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  const [imgFailed, setImgFailed] = useState(false);

  // Rate stats to show in card
  const hitRateStats = [
    { label: 'BA',    val: player['BA'] },
    { label: 'OBP',   val: player['OBP'] },
    { label: 'SLG',   val: player['SLG'] },
    { label: 'OPS',   val: player['OPS'] },
    { label: 'ISO',   val: player['ISO'] },
    { label: 'BABIP', val: player['BABIP'] },
    { label: 'wOBA',  val: player['wOBA'] },
  ];
  const hitCountStats = [
    { label: 'G',   val: player['G'] },
    { label: 'PA',  val: player['PA'] },
    { label: 'H',   val: player['H'] },
    { label: '2B',  val: player['2B'] },
    { label: '3B',  val: player['3B'] },
    { label: 'HR',  val: player['HR'] },
    { label: 'R',   val: player['R'] },
    { label: 'BB',  val: player['BB'] },
    { label: 'SO',  val: player['SO'] },
    { label: 'SB',  val: player['SB'] },
    { label: 'HBP', val: player['HBP'] },
    { label: 'CS',  val: player['CS'] },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#2a3a5c]"
        style={{ background: '#0d1424' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-[#1a2235] text-gray-400 hover:text-white hover:bg-[#2a3a5c] transition-colors text-lg leading-none"
        >
          ×
        </button>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex gap-5 p-6 pb-5 border-b border-[#1e2a45]">
          {/* Photo or initials */}
          <div className="flex-shrink-0">
            {adv?.photoUrl && !imgFailed ? (
              <div className="w-24 h-24 rounded-xl overflow-hidden border border-[#2a3a5c] bg-[#1a2235]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/proxy-photo?url=${encodeURIComponent(adv.photoUrl)}`}
                  alt={player['Player']}
                  className="w-full h-full object-cover object-top"
                  onError={() => setImgFailed(true)}
                />
              </div>
            ) : (
              <div className="w-24 h-24 rounded-xl bg-[#1a2235] border border-[#2a3a5c] flex items-center justify-center text-3xl font-bold text-gray-500">
                {initials}
              </div>
            )}
          </div>

          {/* Name + meta */}
          <div className="flex-1 min-w-0 pt-1">
            <div className="flex items-start gap-3 flex-wrap">
              <h2 className="text-2xl font-bold text-white leading-tight">{player['Player']}</h2>
              {adv?.draftYear && (
                <span className="mt-1 px-2 py-0.5 rounded-full text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 flex-shrink-0">
                  {adv.draftYear} Draft
                </span>
              )}
            </div>

            <div className="mt-1 text-gray-300 text-sm">
              {adv?.position && <span className="text-amber-400 font-semibold">{adv.position}</span>}
              {adv?.position && ' • '}
              <span>{player['Team']}</span>
            </div>

            {/* Bio pills */}
            <div className="flex flex-wrap gap-2 mt-3">
              {adv?.bt && (
                <span className="px-2.5 py-1 rounded-lg bg-[#1a2235] text-xs text-gray-300 border border-[#2a3a5c]">
                  <span className="text-gray-500 mr-1">B/T</span>{adv.bt}
                </span>
              )}
              {adv?.height && (
                <span className="px-2.5 py-1 rounded-lg bg-[#1a2235] text-xs text-gray-300 border border-[#2a3a5c]">
                  <span className="text-gray-500 mr-1">Ht</span>{adv.height}
                </span>
              )}
              {adv?.weight && (
                <span className="px-2.5 py-1 rounded-lg bg-[#1a2235] text-xs text-gray-300 border border-[#2a3a5c]">
                  <span className="text-gray-500 mr-1">Wt</span>{adv.weight}
                </span>
              )}
              {adv?.hometown && (
                <span className="px-2.5 py-1 rounded-lg bg-[#1a2235] text-xs text-gray-300 border border-[#2a3a5c]">
                  <span className="text-gray-500 mr-1">📍</span>{adv.hometown}
                </span>
              )}
              {!hasAdv && advLoading && (
                <span className="text-sky-400 text-xs animate-pulse">⏳ Loading profile…</span>
              )}
            </div>

            {/* Over Slot link */}
            {player.playerUrl && (
              <a
                href={`https://overslotbaseball.com${player.playerUrl}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-2 text-xs text-sky-400 hover:text-sky-300 transition-colors"
              >
                View on Over Slot ↗
              </a>
            )}
          </div>
        </div>

        {/* ── Counting Stats ──────────────────────────────────────────── */}
        <div className="p-6 pb-0">
          <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Batting Stats</h3>

          {/* Count stats */}
          <div className="grid grid-cols-6 gap-x-3 gap-y-3 mb-4">
            {hitCountStats.map(({ label, val }) => (
              <div key={label} className="text-center">
                <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                <div className="text-base font-bold text-white font-mono">{val || '—'}</div>
              </div>
            ))}
          </div>

          {/* Rate stats */}
          <div className="grid grid-cols-7 gap-x-2 gap-y-2 pb-5 border-b border-[#1e2a45]">
            {hitRateStats.map(({ label, val }) => {
              const color = colorForTableStat(label, val, 'hit');
              return (
                <div key={label} className="text-center">
                  <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                  <div
                    className="text-sm font-bold font-mono"
                    style={color ? { color } : { color: '#e5e7eb' }}
                  >
                    {val || '—'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Advanced Stats ──────────────────────────────────────────── */}
        <div className="p-6 pt-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest">Advanced (TrackMan)</h3>
            {!hasAdv && advLoading && (
              <span className="text-sky-400 text-xs animate-pulse">Fetching profiles…</span>
            )}
          </div>

          {hasAdv ? (
            <div className="space-y-2.5">
              {CARD_ADV_STATS.map(({ key, label, bad, good, invert, fmt }) => {
                const raw = adv[key] as number | null;
                if (raw == null) return null;
                const pct   = statPct(raw, bad, good, invert);
                const color = statColor(raw, bad, good, invert);
                return (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-32 text-xs text-gray-400 flex-shrink-0">{label}</div>
                    <div className="flex-1 h-4 rounded-full overflow-hidden bg-[#1a2235]">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: color, opacity: 0.85 }}
                      />
                    </div>
                    <div className="w-20 text-right text-sm font-bold font-mono" style={{ color }}>
                      {fmt(raw)}
                    </div>
                  </div>
                );
              }).filter(Boolean)}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              {advLoading ? (
                <>
                  <div className="w-6 h-6 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
                  <span className="text-gray-500 text-sm">Loading TrackMan data for all players…</span>
                </>
              ) : (
                <span className="text-gray-600 text-sm">No TrackMan data available for this player</span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function OverslotPage() {
  const [type, setType]       = useState<'hit' | 'pitch'>('hit');
  const [year, setYear]       = useState('2026');
  const [players, setPlayers] = useState<StatRow[]>([]);
  const [cols, setCols]       = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [search, setSearch]   = useState('');
  const [sortCol, setSortCol] = useState(HIT_DEFAULT_SORT);
  const [sortAsc, setSortAsc] = useState(false);
  const [minPA, setMinPA]     = useState(50);
  const [minIP, setMinIP]     = useState(10);

  const [advData, setAdvData]       = useState<Record<string, AdvancedStats>>({});
  const [advLoading, setAdvLoading] = useState(false);
  const [advLoaded, setAdvLoaded]   = useState(false);
  const [showAdv, setShowAdv]       = useState(false);

  const [selectedPlayer, setSelectedPlayer] = useState<StatRow | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setAdvData({});
    setAdvLoaded(false);
    setShowAdv(false);
    setSelectedPlayer(null);
    fetch(`/api/overslot-stats?type=${type}&year=${year}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setPlayers(d.players ?? []);
        setCols(d.cols ?? []);
        setSortCol(type === 'pitch' ? PIT_DEFAULT_SORT : HIT_DEFAULT_SORT);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, [type, year]);

  const loadAdvancedStats = useCallback(async () => {
    if (advLoading) return;
    setAdvLoading(true);
    try {
      const res = await fetch(`/api/overslot-advanced?year=${year}`);
      const d = await res.json();
      setAdvData(d.data ?? {});
      setAdvLoaded(true);
      setShowAdv(true);
      setSortCol('Avg EV');
      setSortAsc(false);
    } finally {
      setAdvLoading(false);
    }
  }, [year, advLoading]);

  const allCols = useMemo(() => {
    if (showAdv && type === 'hit') return [...cols, ...ADV_COLS.map(c => c.label)];
    return cols;
  }, [cols, showAdv, type]);

  const filtered = useMemo(() => {
    let rows = players;

    if (type === 'hit') {
      rows = rows.filter(p => parseFloat(p['PA'] ?? '0') >= minPA);
    } else {
      rows = rows.filter(p => parseFloat(p['IP'] ?? '0') >= minIP);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(p =>
        p['Player']?.toLowerCase().includes(q) ||
        p['Team']?.toLowerCase().includes(q)
      );
    }

    rows = rows.map(p => ({ ...p, _adv: advData[p.playerUrl] }));

    rows = [...rows].sort((a, b) => {
      const advCol = ADV_COLS.find(c => c.label === sortCol);
      if (advCol && showAdv) {
        const av = a._adv?.[advCol.key] ?? -Infinity;
        const bv = b._adv?.[advCol.key] ?? -Infinity;
        if (av === bv) return 0;
        return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
      }
      const av = numVal(a[sortCol]);
      const bv = numVal(b[sortCol]);
      if (av === bv) return 0;
      return sortAsc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
    });

    return rows;
  }, [players, type, minPA, minIP, search, sortCol, sortAsc, advData, showAdv]);

  function handleColClick(col: string) {
    if (col === sortCol) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      setSortAsc(type === 'pitch' && LOWER_IS_BETTER.has(col));
    }
  }

  const rateCols = type === 'hit' ? HIT_RATE_COLS : PIT_RATE_COLS;

  function renderAdvCell(player: StatRow, label: string) {
    const adv: AdvancedStats | undefined = player._adv;
    const col = ADV_COLS.find(c => c.label === label);
    if (!col || !adv) return <span className="text-gray-600">—</span>;

    if (col.key === 'draftYear') {
      return <span className="text-gray-300 font-medium">{adv.draftYear ?? '—'}</span>;
    }

    const raw = adv[col.key as keyof AdvancedStats] as number | null;
    if (raw == null) return <span className="text-gray-600">—</span>;

    const display = col.key === 'xWoba'
      ? raw.toFixed(3).replace(/^0/, '')
      : raw.toFixed(1);

    const cardStat = CARD_ADV_STATS.find(s => s.key === col.key);
    const color = cardStat ? statColor(raw, cardStat.bad, cardStat.good, cardStat.invert) : '';
    return <span style={color ? { color } : undefined} className="font-mono">{display}</span>;
  }

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <div className="max-w-full mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-5">
          <Link href="/" className="text-gray-400 hover:text-white text-sm flex-shrink-0">← Back</Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">College Baseball Stats</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {loading ? 'Loading…' : error ? 'Error' : `${filtered.length} players · via Over Slot`}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="flex gap-1">
            {(['hit', 'pitch'] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  type === t ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                }`}>
                {t === 'hit' ? 'Hitting' : 'Pitching'}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {YEARS.map(y => (
              <button key={y} onClick={() => setYear(y)}
                className={`px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  year === y ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                }`}>
                {y}
              </button>
            ))}
          </div>

          {type === 'hit' ? (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 text-sm">Min PA:</span>
              <div className="flex gap-1">
                {MIN_PA_OPTIONS.map(n => (
                  <button key={n} onClick={() => setMinPA(n)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      minPA === n ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <span className="text-gray-400 text-sm">Min IP:</span>
              <div className="flex gap-1">
                {MIN_IP_OPTIONS.map(n => (
                  <button key={n} onClick={() => setMinIP(n)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      minIP === n ? 'bg-amber-500 text-black' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                    }`}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          <input
            type="text"
            placeholder="Search player or team…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="bg-[#1a1f30] border border-[#2a3050] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 w-52"
          />

          {type === 'hit' && (
            <div className="flex items-center gap-2 ml-auto">
              {advLoaded && (
                <button
                  onClick={() => setShowAdv(v => !v)}
                  className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                    showAdv ? 'bg-sky-600 text-white' : 'bg-[#1a1f30] text-gray-300 hover:bg-[#1e2438]'
                  }`}
                >
                  {showAdv ? '⚡ Advanced On' : '⚡ Show Advanced'}
                </button>
              )}
              {!advLoaded && (
                <button
                  onClick={loadAdvancedStats}
                  disabled={advLoading || loading}
                  className="px-3 py-1.5 rounded text-sm font-medium bg-sky-700 hover:bg-sky-600 disabled:opacity-50 text-white transition-colors"
                >
                  {advLoading ? '⏳ Loading…' : '⚡ Load Advanced Stats'}
                </button>
              )}
              {advLoading && (
                <span className="text-gray-400 text-xs">Fetching {players.length} profiles (~30s)…</span>
              )}
            </div>
          )}
        </div>

        {/* Table */}
        <div className="bg-[#111827] rounded-xl overflow-auto border border-[#1e2a45]">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-gray-400">Loading stats…</div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-red-400 text-sm">{error}</div>
          ) : (
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="border-b border-[#1e2a45]">
                  <th className="text-left px-3 py-2.5 text-gray-400 font-medium">#</th>
                  {allCols.map(col => {
                    const advMeta = ADV_COLS.find(c => c.label === col);
                    return (
                      <th
                        key={col}
                        onClick={() => handleColClick(col)}
                        title={advMeta?.title ?? col}
                        className={`px-3 py-2.5 font-medium cursor-pointer select-none transition-colors hover:text-white ${
                          col === 'Player' || col === 'Team' ? 'text-left text-gray-400' : 'text-right text-gray-400'
                        } ${sortCol === col ? 'text-amber-400' : ''} ${
                          advMeta ? 'bg-[#0e1628] border-l border-[#2a3a5c]' : ''
                        }`}
                      >
                        {col}
                        {sortCol === col && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {filtered.map((player, i) => (
                  <tr
                    key={`${player['Player']}-${i}`}
                    className={`border-b border-[#1a2235] cursor-pointer ${
                      i % 2 === 0 ? 'bg-[#0d1424]' : 'bg-[#0a1020]'
                    } hover:bg-[#1a2440] transition-colors`}
                    onClick={() => setSelectedPlayer(player)}
                  >
                    <td className="px-3 py-2 text-gray-500 text-xs">{i + 1}</td>
                    {allCols.map(col => {
                      const isAdv = ADV_COLS.some(c => c.label === col);

                      if (isAdv) {
                        return (
                          <td key={col} className="px-3 py-2 text-right bg-[#090f1e] border-l border-[#1e2a45]">
                            {renderAdvCell(player, col)}
                          </td>
                        );
                      }

                      const val    = player[col] ?? '';
                      const isRate = rateCols.has(col);
                      const color  = isRate ? colorForTableStat(col, val, type) : '';
                      const isPlayer = col === 'Player';
                      const isTeam   = col === 'Team';

                      return (
                        <td
                          key={col}
                          className={`px-3 py-2 ${isPlayer || isTeam ? 'text-left' : 'text-right font-mono'}`}
                          style={color ? { color } : undefined}
                        >
                          {isPlayer ? (
                            <span className="text-white font-medium hover:text-amber-400 transition-colors">
                              {val}
                            </span>
                          ) : (
                            <span className={isTeam ? 'text-gray-300' : ''}>
                              {val || '—'}
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filtered.length === 0 && !loading && (
                  <tr>
                    <td colSpan={allCols.length + 1} className="text-center py-12 text-gray-500">
                      No players found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        <p className="mt-3 text-xs text-gray-600 text-right">
          Data via{' '}
          <a href="https://overslotbaseball.com/stats/" target="_blank" rel="noopener noreferrer" className="hover:text-gray-400">
            Over Slot
          </a>{' '}
          · powered by 6-4-3 Charts
        </p>
      </div>

      {/* Player Card Modal */}
      {selectedPlayer && (
        <PlayerCard
          player={selectedPlayer}
          advData={advData}
          onClose={() => setSelectedPlayer(null)}
          onLoadAdv={loadAdvancedStats}
          advLoading={advLoading}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import GradesGraphic from '@/app/components/GradesGraphic';

interface PlayerGrades {
  // Hitter tools
  hit:        string;
  power:      string;
  fielding:   string;
  arm:        string;
  run:        string;
  // Pitcher tools
  fb:         string;
  slider:     string;
  curve:      string;
  offspeed:   string;
  command:    string;
  // Shared
  fv:         string;
  name:       string;
  team:       string;
  position:   string;
  draftYear:  string;
  playerType: 'hs' | 'college';
  height:     string;
  weight:     string;
  velocity:   string;
}

interface GradeEntry {
  playerUrl: string;
  grades: Partial<PlayerGrades>;
}

const GRADE_FIELDS: { key: keyof PlayerGrades; label: string }[] = [
  { key: 'hit',      label: 'HIT' },
  { key: 'power',    label: 'POW' },
  { key: 'run',      label: 'RUN' },
  { key: 'fielding', label: 'FLD' },
  { key: 'arm',      label: 'ARM' },
  { key: 'fv',       label: 'FV'  },
];

const GRADE_OPTIONS = ['', '20', '25', '30', '35', '40', '45', '45+', '50', '50+', '55', '55+', '60', '65', '70', '75', '80'];

function decodeHtml(str: string | undefined): string {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function gradeNumeric(val: string | undefined): number {
  if (!val) return -1;
  return parseFloat(val) || -1;
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

function GradeBadge({ val }: { val: string | undefined }) {
  if (!val) return <span className="text-gray-600">—</span>;
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-md text-xs font-bold text-white min-w-[2.5rem] text-center"
      style={{ background: gradeColor(val) }}
    >
      {val}
    </span>
  );
}

function GradeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="rounded py-1 px-1 text-sm font-bold text-center border border-[#2e2e2e] focus:outline-none focus:border-amber-500 cursor-pointer w-16"
      style={{
        background: value ? gradeColor(value) : '#1e1e1e',
        color: value ? '#ffffff' : '#9ca3af',
      }}
    >
      {GRADE_OPTIONS.map(o => (
        <option key={o} value={o} style={{ background: '#111111', color: '#e5e7eb' }}>
          {o || '—'}
        </option>
      ))}
    </select>
  );
}

export default function GradesPage() {
  const [entries, setEntries] = useState<GradeEntry[]>([]);
  const [sortCol, setSortCol] = useState<string>('fv');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch]   = useState('');
  const [editMode, setEditMode] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'hs' | 'college'>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  const [playerOrder, setPlayerOrder] = useState<string[]>([]);
  const [showGraphic, setShowGraphic] = useState(false);
  const attemptedBio = useRef(new Set<string>());

  // Load manual order from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('og_grade_order');
    if (saved) {
      try { setPlayerOrder(JSON.parse(saved) as string[]); } catch { /* ignore */ }
    }
  }, []);

  // Keep playerOrder in sync as new entries are added
  useEffect(() => {
    setPlayerOrder(prev => {
      const existing = new Set(prev);
      const newUrls = entries.map(e => e.playerUrl).filter(u => !existing.has(u));
      if (newUrls.length === 0) return prev;
      const next = [...prev, ...newUrls];
      localStorage.setItem('og_grade_order', JSON.stringify(next));
      return next;
    });
  }, [entries]);

  function movePlayer(filteredList: GradeEntry[], index: number, direction: 'up' | 'down') {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= filteredList.length) return;
    const urlA = filteredList[index].playerUrl;
    const urlB = filteredList[targetIndex].playerUrl;
    setPlayerOrder(prev => {
      const next = [...prev];
      // Ensure both are in the array
      if (!next.includes(urlA)) next.push(urlA);
      if (!next.includes(urlB)) next.push(urlB);
      const ai = next.indexOf(urlA);
      const bi = next.indexOf(urlB);
      [next[ai], next[bi]] = [next[bi], next[ai]];
      localStorage.setItem('og_grade_order', JSON.stringify(next));
      return next;
    });
  }

  // Load grades: localStorage first, then fetch from server and merge
  useEffect(() => {
    // 1. Load from localStorage immediately
    const fromLocal: Record<string, Partial<PlayerGrades>> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('og_grade:')) continue;
      const playerUrl = key.slice('og_grade:'.length);
      try {
        fromLocal[playerUrl] = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PlayerGrades>;
      } catch { /* skip */ }
    }

    const toEntries = (map: Record<string, Partial<PlayerGrades>>): GradeEntry[] =>
      Object.entries(map).map(([playerUrl, grades]) => ({ playerUrl, grades }));

    setEntries(toEntries(fromLocal));

    // 2. Fetch from server and merge (restores grades lost from localStorage)
    setSyncing(true);
    fetch('/api/grades')
      .then(r => r.json())
      .then((serverData: Record<string, Partial<PlayerGrades>>) => {
        const merged = { ...fromLocal };
        let changed = false;
        for (const [url, grades] of Object.entries(serverData)) {
          if (!merged[url]) {
            // Server has grades that localStorage lost — restore them
            merged[url] = grades;
            localStorage.setItem(`og_grade:${url}`, JSON.stringify(grades));
            changed = true;
          }
        }
        if (changed) setEntries(toEntries(merged));
      })
      .catch(() => {/* server unavailable — local grades still shown */})
      .finally(() => setSyncing(false));
  }, []);

  // Auto-fetch height/weight from overslot for every entry that's still missing it.
  // Uses a ref to track which URLs have been attempted so we don't loop.
  useEffect(() => {
    const missing = entries
      .filter(e => !e.grades.height && !e.grades.weight && !e.grades.velocity && !attemptedBio.current.has(e.playerUrl))
      .map(e => e.playerUrl);
    if (missing.length === 0) return;

    // Mark all as attempted immediately so concurrent re-renders don't double-fetch
    missing.forEach(u => attemptedBio.current.add(u));

    const BATCH = 20;
    async function fetchBatch(urls: string[]) {
      try {
        // Pass URLs as plain comma-separated string — no encodeURIComponent
        // (player URLs are safe: only letters, digits, hyphens, slashes)
        const res = await fetch(`/api/player-bio?urls=${urls.join(',')}`);
        if (!res.ok) return;
        const bioMap = await res.json() as Record<string, { height: string | null; weight: string | null; velocity: string | null }>;
        setEntries(prev => prev.map(e => {
          const bio = bioMap[e.playerUrl];
          if (!bio || (!bio.height && !bio.weight && !bio.velocity)) return e;
          const updated = {
            ...e.grades,
            ...(bio.height   ? { height:   bio.height   } : {}),
            ...(bio.weight   ? { weight:   bio.weight   } : {}),
            ...(bio.velocity ? { velocity: bio.velocity } : {}),
          };
          localStorage.setItem(`og_grade:${e.playerUrl}`, JSON.stringify(updated));
          return { ...e, grades: updated };
        }));
      } catch { /* silent */ }
    }

    for (let i = 0; i < missing.length; i += BATCH) {
      fetchBatch(missing.slice(i, i + BATCH));
    }
  }, [entries]);

  function updateGrade(playerUrl: string, field: keyof PlayerGrades, val: string) {
    setEntries(prev => {
      const next = prev.map(e => {
        if (e.playerUrl !== playerUrl) return e;
        const updated = { ...e.grades, [field]: val };
        localStorage.setItem(`og_grade:${playerUrl}`, JSON.stringify(updated));
        fetch('/api/grades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playerUrl, grades: updated }),
        }).catch(() => {});
        return { ...e, grades: updated };
      });
      return next;
    });
  }

  function deleteEntry(playerUrl: string) {
    localStorage.removeItem(`og_grade:${playerUrl}`);
    setEntries(prev => prev.filter(e => e.playerUrl !== playerUrl));
    fetch('/api/grades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerUrl, grades: null }),
    }).catch(() => {});
  }

  // Collect available draft years from actual data
  const availableYears = useMemo(() => {
    const years = new Set<string>();
    for (const e of entries) {
      if (e.grades.draftYear) years.add(e.grades.draftYear);
    }
    return [...years].sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let rows = entries;

    // Type filter
    if (typeFilter !== 'all') {
      rows = rows.filter(e => e.grades.playerType === typeFilter);
    }

    // Year filter
    if (yearFilter !== 'all') {
      rows = rows.filter(e => e.grades.draftYear === yearFilter);
    }

    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(e =>
        decodeHtml(e.grades.name).toLowerCase().includes(q) ||
        e.grades.team?.toLowerCase().includes(q) ||
        e.grades.position?.toLowerCase().includes(q)
      );
    }

    return [...rows].sort((a, b) => {
      const av = gradeNumeric(a.grades[sortCol as keyof PlayerGrades]);
      const bv = gradeNumeric(b.grades[sortCol as keyof PlayerGrades]);
      if (av !== bv) return sortAsc ? av - bv : bv - av;
      // Same grade — use manual order as tiebreaker
      const ai = playerOrder.indexOf(a.playerUrl);
      const bi = playerOrder.indexOf(b.playerUrl);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return decodeHtml(a.grades.name).localeCompare(decodeHtml(b.grades.name));
    });
  }, [entries, typeFilter, yearFilter, search, sortCol, sortAsc, playerOrder]);

  function handleColClick(col: string) {
    if (col === sortCol) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(false); }
  }

  // Summary stats
  const graded = entries.filter(e => e.grades.fv);
  const avgFv = graded.length
    ? (graded.reduce((s, e) => s + (parseFloat(e.grades.fv ?? '0') || 0), 0) / graded.length).toFixed(1)
    : '—';

  return (
    <div className="min-h-screen bg-[#0c0c0c] text-white">
      <div className="max-w-5xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/overslot" className="text-gray-400 hover:text-white text-sm flex-shrink-0">← Back to Stats</Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Scout Grades Leaderboard</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {entries.length} scouted · {graded.length} with FV · avg FV {avgFv}
              {syncing && <span className="ml-2 text-xs text-gray-600 animate-pulse">syncing…</span>}
            </p>
          </div>
          <button
            onClick={() => setShowGraphic(true)}
            disabled={filtered.length === 0}
            className="px-3 py-1.5 rounded text-sm font-medium bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            🎨 Export Image
          </button>
          <button
            onClick={() => setEditMode(v => !v)}
            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              editMode ? 'bg-white text-black' : 'bg-[#1c1c1c] text-gray-400 hover:bg-[#222222] hover:text-white'
            }`}
          >
            {editMode ? '✏️ Editing' : '✏️ Edit Grades'}
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
            <span className="text-4xl">📋</span>
            <p className="text-lg font-medium">No grades yet</p>
            <p className="text-sm">Open a player card on the <Link href="/overslot" className="text-white underline hover:text-gray-300">College Stats</Link> page to add grades</p>
          </div>
        ) : (
          <>
            {/* Controls */}
            <div className="flex flex-wrap items-center gap-3 mb-4">
              {/* Type filter */}
              <div className="flex rounded overflow-hidden border border-[#2e2e2e]">
                {(['all', 'college', 'hs'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      typeFilter === t
                        ? 'bg-white text-black'
                        : 'bg-[#1c1c1c] text-gray-400 hover:text-white'
                    }`}
                  >
                    {t === 'all' ? 'All' : t === 'college' ? 'College' : 'HS'}
                  </button>
                ))}
              </div>

              {/* Year filter */}
              {availableYears.length > 0 && (
                <div className="flex rounded overflow-hidden border border-[#2e2e2e]">
                  <button
                    onClick={() => setYearFilter('all')}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      yearFilter === 'all'
                        ? 'bg-white text-black'
                        : 'bg-[#1c1c1c] text-gray-400 hover:text-white'
                    }`}
                  >
                    All Yrs
                  </button>
                  {availableYears.map(yr => (
                    <button
                      key={yr}
                      onClick={() => setYearFilter(yr)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                        yearFilter === yr
                          ? 'bg-white text-black'
                          : 'bg-[#1c1c1c] text-gray-400 hover:text-white'
                      }`}
                    >
                      {yr}
                    </button>
                  ))}
                </div>
              )}

              {/* Search */}
              <input
                type="text"
                placeholder="Search player or team…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 w-48"
              />
              <span className="text-gray-600 text-xs">{filtered.length} players</span>
            </div>

            {/* Table */}
            <div className="bg-[#141414] rounded-xl overflow-auto border border-[#262626]">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#262626]">
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">{editMode ? '⇅' : '#'}</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white" onClick={() => handleColClick('name')}>
                      Player {sortCol === 'name' && <span className="text-xs text-white">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Pos</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Team</th>
                    <th className="text-center px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white" onClick={() => handleColClick('draftYear')}>
                      Yr {sortCol === 'draftYear' && <span className="text-xs text-white">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                    <th className="text-center px-3 py-2.5 text-gray-400 font-medium">FB</th>
                    {GRADE_FIELDS.map(({ key, label }) => (
                      <th
                        key={key}
                        className={`text-center px-3 py-2.5 font-medium cursor-pointer hover:text-white transition-colors ${
                          sortCol === key ? 'text-white' : 'text-gray-500'
                        }`}
                        onClick={() => handleColClick(key)}
                      >
                        {label}
                        {sortCol === key && <span className="ml-1 text-xs">{sortAsc ? '↑' : '↓'}</span>}
                      </th>
                    ))}
                    {editMode && <th className="px-3 py-2.5 text-gray-600 font-medium text-center">Del</th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((entry, i) => (
                    <tr
                      key={entry.playerUrl}
                      className={`border-b border-[#1e1e1e] ${
                        i % 2 === 0 ? 'bg-[#111111]' : 'bg-[#101010]'
                      } hover:bg-[#232323] transition-colors`}
                    >
                      <td className="px-3 py-2.5 text-gray-500 text-xs">
                        {editMode ? (
                          <div className="flex flex-col gap-0.5 items-center">
                            <button
                              onClick={() => movePlayer(filtered, i, 'up')}
                              disabled={i === 0}
                              className="text-gray-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-1"
                              title="Move up"
                            >▲</button>
                            <span className="text-[10px] text-gray-600">{i + 1}</span>
                            <button
                              onClick={() => movePlayer(filtered, i, 'down')}
                              disabled={i === filtered.length - 1}
                              className="text-gray-500 hover:text-white disabled:opacity-20 disabled:cursor-not-allowed leading-none text-[10px] px-1"
                              title="Move down"
                            >▼</button>
                          </div>
                        ) : (
                          i + 1
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <a
                          href={`https://overslotbaseball.com${entry.playerUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white font-medium hover:text-gray-300 transition-colors"
                        >
                          {decodeHtml(entry.grades.name) || entry.playerUrl.split('/').filter(Boolean).pop()}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300 font-medium text-sm">
                        {entry.grades.position || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-300 text-sm">{entry.grades.team || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-gray-400 text-sm">{entry.grades.draftYear || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-xs font-medium tabular-nums">
                        {entry.grades.velocity
                          ? <span className="text-sky-400">{entry.grades.velocity}</span>
                          : <span className="text-gray-600">—</span>}
                      </td>
                      {GRADE_FIELDS.map(({ key }) => (
                        <td key={key} className="px-2 py-2 text-center">
                          {editMode ? (
                            <GradeSelect
                              value={entry.grades[key] ?? ''}
                              onChange={v => updateGrade(entry.playerUrl, key, v)}
                            />
                          ) : (
                            <GradeBadge val={entry.grades[key]} />
                          )}
                        </td>
                      ))}
                      {editMode && (
                        <td className="px-3 py-2.5 text-center">
                          <button
                            onClick={() => deleteEntry(entry.playerUrl)}
                            className="text-red-700 hover:text-red-500 text-xs transition-colors"
                            title="Remove player"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Grade scale legend */}
            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <span className="text-gray-600 text-xs mr-1">20–80 scale:</span>
              {[
                { range: '20–35', color: '#dc2626', label: 'Well Below Avg' },
                { range: '40',    color: '#ea580c', label: 'Below Avg' },
                { range: '45',    color: '#d97706', label: 'Fringe' },
                { range: '50',    color: '#ca8a04', label: 'Average' },
                { range: '55',    color: '#84cc16', label: 'Above Avg' },
                { range: '60',    color: '#22c55e', label: 'Plus' },
                { range: '65+',   color: '#16a34a', label: 'Plus-Plus' },
              ].map(({ range, color, label }) => (
                <span key={range} className="flex items-center gap-1 text-xs">
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: color }} />
                  <span className="text-gray-500">{range}</span>
                  <span className="text-gray-700">({label})</span>
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {showGraphic && (
        <GradesGraphic
          entries={filtered}
          onClose={() => setShowGraphic(false)}
        />
      )}
    </div>
  );
}

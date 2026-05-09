'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';

interface PlayerGrades {
  // Present/future tool grades stored as "present/future" e.g. "30/50"
  hit:     string;
  power:   string;
  arm:     string;
  speed:   string;
  defense: string;
  // Single-value grades
  fv:   string;
  rank: string;
  // Stored metadata
  name:     string;
  team:     string;
  position: string;
  draftYear: string;
}

interface GradeEntry {
  playerUrl: string;
  grades: Partial<PlayerGrades>;
}

// Tool grades shown as present/future in the leaderboard
const GRADE_FIELDS: { key: keyof PlayerGrades; label: string; type: 'single' | 'pf' }[] = [
  { key: 'rank',    label: 'Rank',    type: 'single' },
  { key: 'fv',      label: 'FV',      type: 'single' },
  { key: 'hit',     label: 'Hit',     type: 'pf'     },
  { key: 'power',   label: 'Power',   type: 'pf'     },
  { key: 'arm',     label: 'Arm',     type: 'pf'     },
  { key: 'speed',   label: 'Speed',   type: 'pf'     },
  { key: 'defense', label: 'Defense', type: 'pf'     },
];

const GRADE_OPTIONS = ['', '20', '25', '30', '35', '40', '45', '50', '55', '60', '65', '70', '75', '80'];

function gradeNumeric(val: string | undefined): number {
  if (!val) return -1;
  // Handle "present/future" format — sort by future grade
  if (val.includes('/')) {
    const future = val.split('/')[1];
    return parseFloat(future) || -1;
  }
  return parseFloat(val) || -1;
}

function gradeColor(val: string): string {
  // For "present/future" format, color by future grade
  const raw = val.includes('/') ? val.split('/')[1] : val;
  const n = parseFloat(raw);
  if (isNaN(n)) return '#374151';
  if (n >= 70) return '#16a34a';
  if (n >= 60) return '#22c55e';
  if (n >= 55) return '#84cc16';
  if (n >= 50) return '#ca8a04';
  if (n >= 45) return '#d97706';
  if (n >= 40) return '#ea580c';
  return '#dc2626';
}

// Badge for display mode
function GradeBadge({ val, type }: { val: string | undefined; type: 'single' | 'pf' }) {
  if (!val) return <span className="text-gray-600 text-xs">—</span>;
  if (type === 'single') {
    return (
      <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold text-white min-w-[2rem] text-center bg-[#4338ca]">
        {val}
      </span>
    );
  }
  // Present/future: indigo badge showing "30/50"
  return (
    <span className="inline-block px-2 py-0.5 rounded-md text-xs font-bold text-white min-w-[3rem] text-center bg-[#4338ca]">
      {val}
    </span>
  );
}

// Selects for edit mode
function GradeSelect({ value, onChange, type }: { value: string; onChange: (v: string) => void; type: 'single' | 'pf' }) {
  if (type === 'single') {
    const opts = ['', '1','2','3','4','5','6','7','8','9','10',
      '15','20','25','30','35','40','45','50','55','60','65','70','75','80','NR'];
    return (
      <select value={value} onChange={e => onChange(e.target.value)}
        className="rounded py-1 px-1 text-xs font-bold text-center border border-[#2e2e2e] focus:outline-none cursor-pointer w-16 bg-[#4338ca] text-white">
        {opts.map(o => <option key={o} value={o} style={{ background: '#111', color: '#e5e7eb' }}>{o || '—'}</option>)}
      </select>
    );
  }
  // Present/future: two selects
  const parts = value.split('/');
  const present = parts[0] ?? '';
  const future  = parts[1] ?? '';
  return (
    <div className="flex items-center gap-0.5">
      <select value={present} onChange={e => onChange(`${e.target.value}/${future}`)}
        className="rounded py-1 px-1 text-xs font-bold text-center border border-[#2e2e2e] focus:outline-none cursor-pointer w-12 bg-[#4338ca] text-white">
        {GRADE_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#111', color: '#e5e7eb' }}>{o || '—'}</option>)}
      </select>
      <span className="text-[#555] text-xs">/</span>
      <select value={future} onChange={e => onChange(`${present}/${e.target.value}`)}
        className="rounded py-1 px-1 text-xs font-bold text-center border border-[#2e2e2e] focus:outline-none cursor-pointer w-12 bg-[#4338ca] text-white">
        {GRADE_OPTIONS.map(o => <option key={o} value={o} style={{ background: '#111', color: '#e5e7eb' }}>{o || '—'}</option>)}
      </select>
    </div>
  );
}

export default function GradesPage() {
  const [entries, setEntries] = useState<GradeEntry[]>([]);
  const [sortCol, setSortCol] = useState<string>('fv');
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch]   = useState('');
  const [editMode, setEditMode] = useState(false);

  // Load all grades from localStorage
  useEffect(() => {
    const all: GradeEntry[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('og_grade:')) continue;
      const playerUrl = key.slice('og_grade:'.length);
      try {
        const grades = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<PlayerGrades>;
        all.push({ playerUrl, grades });
      } catch { /* skip */ }
    }
    setEntries(all);
  }, []);

  function updateGrade(playerUrl: string, field: keyof PlayerGrades, val: string) {
    setEntries(prev => {
      const next = prev.map(e => {
        if (e.playerUrl !== playerUrl) return e;
        const updated = { ...e.grades, [field]: val };
        localStorage.setItem(`og_grade:${playerUrl}`, JSON.stringify(updated));
        return { ...e, grades: updated };
      });
      return next;
    });
  }

  function deleteEntry(playerUrl: string) {
    localStorage.removeItem(`og_grade:${playerUrl}`);
    setEntries(prev => prev.filter(e => e.playerUrl !== playerUrl));
  }

  const filtered = useMemo(() => {
    let rows = entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter(e =>
        e.grades.name?.toLowerCase().includes(q) ||
        e.grades.team?.toLowerCase().includes(q) ||
        e.grades.position?.toLowerCase().includes(q)
      );
    }
    return [...rows].sort((a, b) => {
      const av = gradeNumeric(a.grades[sortCol as keyof PlayerGrades]);
      const bv = gradeNumeric(b.grades[sortCol as keyof PlayerGrades]);
      if (av === bv) {
        // secondary sort: name
        return (a.grades.name ?? '').localeCompare(b.grades.name ?? '');
      }
      return sortAsc ? av - bv : bv - av;
    });
  }, [entries, search, sortCol, sortAsc]);

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
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/overslot" className="text-gray-400 hover:text-white text-sm flex-shrink-0">← Back to Stats</Link>
          <div className="flex-1">
            <h1 className="text-xl font-bold">Scout Grades Leaderboard</h1>
            <p className="text-gray-400 text-sm mt-0.5">
              {entries.length} scouted · {graded.length} with FV · avg FV {avgFv}
            </p>
          </div>
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
            <div className="flex items-center gap-3 mb-4">
              <input
                type="text"
                placeholder="Search player or team…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-[#1c1c1c] border border-[#2e2e2e] rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500 w-52"
              />
              <span className="text-gray-600 text-xs">{filtered.length} players</span>
            </div>

            {/* Table */}
            <div className="bg-[#141414] rounded-xl overflow-auto border border-[#262626]">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="border-b border-[#262626]">
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">#</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white" onClick={() => handleColClick('name')}>
                      Player {sortCol === 'name' && <span className="text-xs text-white">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Pos</th>
                    <th className="text-left px-3 py-2.5 text-gray-400 font-medium">Team</th>
                    <th className="text-center px-3 py-2.5 text-gray-400 font-medium cursor-pointer hover:text-white" onClick={() => handleColClick('draftYear')}>
                      Yr {sortCol === 'draftYear' && <span className="text-xs text-white">{sortAsc ? '↑' : '↓'}</span>}
                    </th>
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
                      <td className="px-3 py-2.5 text-gray-500 text-xs">{i + 1}</td>
                      <td className="px-3 py-2.5">
                        <a
                          href={`https://overslotbaseball.com${entry.playerUrl}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white font-medium hover:text-gray-300 transition-colors"
                        >
                          {entry.grades.name || entry.playerUrl.split('/').filter(Boolean).pop()}
                        </a>
                      </td>
                      <td className="px-3 py-2.5 text-gray-300 font-medium text-sm">
                        {entry.grades.position || '—'}
                      </td>
                      <td className="px-3 py-2.5 text-gray-300 text-sm">{entry.grades.team || '—'}</td>
                      <td className="px-3 py-2.5 text-center text-gray-400 text-sm">{entry.grades.draftYear || '—'}</td>
                      {GRADE_FIELDS.map(({ key, type }) => (
                        <td key={key} className="px-2 py-2 text-center">
                          {editMode ? (
                            <GradeSelect
                              type={type}
                              value={entry.grades[key] ?? ''}
                              onChange={v => updateGrade(entry.playerUrl, key, v)}
                            />
                          ) : (
                            <GradeBadge type={type} val={entry.grades[key]} />
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
    </div>
  );
}

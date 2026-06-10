// Client-side CSV upload for international pitcher cards. Detects the feed format
// (TrackMan vs movement-only), lists the pitchers in a file, and builds the card's
// data for a chosen pitcher — all in the browser. Uploaded CSVs live in localStorage.

import { parseTrackmanCsv, aggregateTrackman, buildGameInfo, buildGameLine, type ProspectMeta } from './trackman';
import { parseMovementCsv, aggregateMovement, listPitchers } from './dsl-movement';

export type IntlFormat = 'trackman' | 'movement';

export const UPLOAD_LIST_KEY = 'intl-uploads';
export const uploadCsvKey = (id: string) => `intl-upload-csv:${id}`;

export interface UploadEntry {
  id: string;
  label: string;
  fmt: IntlFormat;
  pitchers: { name: string; count: number }[];
}

// "Last, First" -> "First Last"; leave single tokens as-is.
export function prettyName(raw: string): string {
  const s = (raw || '').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2].trim()} ${m[1].trim()}` : s;
}

export function detectFormat(csv: string): IntlFormat | null {
  const header = (csv.split(/\r?\n/)[0] ?? '').toLowerCase();
  if (header.includes('relspeed') || header.includes('autopitchtype') || header.includes('pitchno') || header.includes('pitcherid')) return 'trackman';
  if (header.includes('release_speed_mph') || header.includes('induced_vertical_break_in')) return 'movement';
  return null;
}

// List the distinct pitchers in a CSV with their pitch counts.
export function listPitchersFromCsv(csv: string, fmt: IntlFormat): { name: string; count: number }[] {
  if (fmt === 'movement') return listPitchers(parseMovementCsv(csv));
  const rows = parseTrackmanCsv(csv);
  const counts: Record<string, number> = {};
  for (const r of rows) { const n = r.Pitcher; if (n) counts[n] = (counts[n] || 0) + 1; }
  return Object.entries(counts).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
}

export interface BuiltCard {
  playerName: string;
  throws: 'L' | 'R' | null;
  pitchData: ReturnType<typeof aggregateTrackman>;
  gameInfo: { opponent: string | null; team: string | null; date: string };
  gameLine: { date: string; ip: string; h: number; er: number; bb: number; k: number; hr: number; pitches: number; strikes: number; bf: number; era: string | null };
}

const emptyLine = (pitches: number, bf: number) =>
  ({ date: '', ip: '0.0', h: 0, er: 0, bb: 0, k: 0, hr: 0, pitches, strikes: 0, bf, era: null as string | null });

// Build the daily-card data for one pitcher (by their CSV name) from a raw CSV.
export function buildCardFromCsv(csv: string, fmt: IntlFormat, pitcherName: string): BuiltCard {
  if (fmt === 'movement') {
    const rows = parseMovementCsv(csv);
    const { pitchData, battersFaced } = aggregateMovement(rows, pitcherName);
    return {
      playerName: prettyName(pitcherName),
      throws: pitchData.throws,
      pitchData,
      gameInfo: { opponent: null, team: null, date: '' },
      gameLine: { ...emptyLine(pitchData.totalPitches, battersFaced) },
    };
  }
  const rows = parseTrackmanCsv(csv);
  const subject = rows.find(r => r.Pitcher === pitcherName);
  const pitcherId = subject?.PitcherId ?? '';
  const throws: 'L' | 'R' = /^l/i.test(subject?.PitcherThrows ?? '') ? 'L' : 'R';
  const meta: ProspectMeta = { slug: 'upload', file: '', name: prettyName(pitcherName), pitcherId, team: subject?.PitcherTeam ?? 'Uploaded', throws, format: 'trackman' };
  const pitchData = aggregateTrackman(rows, pitcherId);
  const gi = buildGameInfo(rows, meta);
  const gl = buildGameLine(rows, meta);
  return {
    playerName: meta.name, throws, pitchData,
    gameInfo: { opponent: gi.opponent, team: gi.team, date: gi.date ?? '' },
    gameLine: gl,
  };
}

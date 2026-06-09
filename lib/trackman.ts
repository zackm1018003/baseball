// TrackMan / Diamond-Solutions pitch-by-pitch CSV → pitcher-card `pitchData` shape.
// Used for the "International Prospects" cards, whose data comes from committed CSVs
// rather than the MLB Stats API. The output object matches what /api/pitcher-daily
// returns so the existing pitcher daily card renders it unchanged.

// ─── CSV parsing ────────────────────────────────────────────────────────────
function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseTrackmanCsv(text: string): Record<string, string>[] {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];
  const hdr = parseLine(lines[0]).map(h => h.trim());
  return lines.slice(1).map(line => {
    const v = parseLine(line);
    const row: Record<string, string> = {};
    hdr.forEach((h, i) => { row[h] = (v[i] ?? '').trim(); });
    return row;
  });
}

// ─── Pitch-type tagging ─────────────────────────────────────────────────────
// TrackMan AutoPitchType / TaggedPitchType → the display names the card colors by.
const TM_TYPE: Record<string, string> = {
  'four-seam': '4-Seam Fastball', 'fourseam': '4-Seam Fastball', 'fourseamfastball': '4-Seam Fastball',
  'fastball': '4-Seam Fastball', 'four seam': '4-Seam Fastball',
  'two-seam': 'Sinker', 'twoseam': 'Sinker', 'twoseamfastball': 'Sinker', 'sinker': 'Sinker',
  'cutter': 'Cutter',
  'slider': 'Slider',
  'sweeper': 'Sweeper',
  'curveball': 'Curveball', 'curve': 'Curveball',
  'knuckle curve': 'Knuckle Curve', 'knucklecurve': 'Knuckle Curve',
  'slurve': 'Slurve',
  'changeup': 'Changeup', 'change-up': 'Changeup', 'change up': 'Changeup',
  'splitter': 'Splitter', 'split': 'Splitter', 'split-finger': 'Splitter',
};
function tagPitch(auto: string, tagged: string): string | null {
  const a = (auto || '').toLowerCase().trim();
  if (TM_TYPE[a]) return TM_TYPE[a];
  const t = (tagged || '').toLowerCase().trim();
  if (TM_TYPE[t]) return TM_TYPE[t];
  return null;
}

// ─── Pitch-call interpretation ──────────────────────────────────────────────
function callFlags(pitchCall: string) {
  const c = (pitchCall || '').toLowerCase();
  const isWhiff   = c === 'strikeswinging';
  const isFoul    = c.startsWith('foul');
  const isInPlay  = c === 'inplay';
  const isSwing   = isWhiff || isFoul || isInPlay;
  const isStrike  = isWhiff || isFoul || isInPlay || c === 'strikecalled';
  return { isWhiff, isSwing, isStrike };
}

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  // Standard Statcast barrel: at 98 mph the window is 26–30°, widening ~2–3° per mph.
  const span = (ev - 98) * 2;
  const lo = 26 - span, hi = 30 + span;
  return la >= lo && la <= hi;
}

const num = (s: string | undefined) => { const v = parseFloat(s ?? ''); return isNaN(v) ? NaN : v; };

export interface RawDot {
  hb: number; ivb: number; pitchType: string;
  px: number | null; pz: number | null;
  isWhiff: boolean; isSwing: boolean; isBarrel: boolean;
  batterSide: string | null;
  velo: number | null; spin: number | null;
  vaa: number | null; haa: number | null;
  hRel: number | null; vRel: number | null; extension: number | null;
}

export interface PitchType {
  name: string; count: number; usage: number;
  velo: number | null; maxVelo: number | null; spin: number | null;
  h_movement: number | null; v_movement: number | null;
  vaa: number | null; haa: number | null;
  whiff: number | null; whiffs: number; swings: number;
  zone_pct: number | null; barrel_pct: number | null;
  h_rel: number | null; v_rel: number | null; extension: number | null;
  arm_angle: number | null;
}

export interface PitchData {
  totalPitches: number;
  pitchTypes: PitchType[];
  rawDots: RawDot[];
  throws: 'L' | 'R' | null;
  armAngle: number | null;
  strikePct: number | null;
  swingAndMissPct: number | null;
  totalWhiffs: number;
}

// Aggregate every pitch thrown by `pitcherId` into the card's pitchData shape.
export function aggregateTrackman(rows: Record<string, string>[], pitcherId: string): PitchData {
  const throwsRaw = rows.find(r => r.PitcherId === pitcherId)?.PitcherThrows ?? '';
  const throws: 'L' | 'R' | null = /^l/i.test(throwsRaw) ? 'L' : /^r/i.test(throwsRaw) ? 'R' : null;
  // Arm-side sign: make arm-side run/release positive for both hands.
  // TrackMan RHP fastballs have +HorzBreak / +RelSide; LHP have negative.
  const armSign = throws === 'L' ? -1 : 1;

  interface Grp {
    velos: number[]; spins: number[]; hBreaks: number[]; vBreaks: number[];
    vaas: number[]; haas: number[]; hRels: number[]; vRels: number[]; exts: number[];
    count: number; swings: number; whiffs: number; inZone: number; barrels: number;
  }
  const groups: Record<string, Grp> = {};
  const rawDots: RawDot[] = [];
  let totalPitches = 0, strikes = 0, swingAndMisses = 0;

  for (const row of rows) {
    if (row.PitcherId !== pitcherId) continue;
    const name = tagPitch(row.AutoPitchType, row.TaggedPitchType);
    if (!name) continue;
    totalPitches++;

    const { isWhiff, isSwing, isStrike } = callFlags(row.PitchCall);
    if (isStrike) strikes++;
    if (isWhiff) swingAndMisses++;

    if (!groups[name]) groups[name] = { velos: [], spins: [], hBreaks: [], vBreaks: [], vaas: [], haas: [], hRels: [], vRels: [], exts: [], count: 0, swings: 0, whiffs: 0, inZone: 0, barrels: 0 };
    const g = groups[name];
    g.count++;
    if (isSwing) g.swings++;
    if (isWhiff) g.whiffs++;

    const velo = num(row.RelSpeed);   if (!isNaN(velo)) g.velos.push(velo);
    const spin = num(row.SpinRate);   if (!isNaN(spin)) g.spins.push(spin);
    const ivb  = num(row.InducedVertBreak);                 // inches, up positive
    const hb   = num(row.HorzBreak);  const hbArm = isNaN(hb) ? NaN : hb * armSign; // arm-side positive
    if (!isNaN(ivb)) g.vBreaks.push(ivb);
    if (!isNaN(hbArm)) g.hBreaks.push(hbArm);
    const vaa  = num(row.VertApprAngle);  if (!isNaN(vaa)) g.vaas.push(vaa);
    const haaR = num(row.HorzApprAngle);  const haa = isNaN(haaR) ? NaN : haaR * armSign;
    if (!isNaN(haa)) g.haas.push(haa);
    const vRel = num(row.RelHeight);  if (!isNaN(vRel)) g.vRels.push(vRel);
    const sideR = num(row.RelSide);   const hRel = isNaN(sideR) ? NaN : sideR * armSign; // arm-side positive
    if (!isNaN(hRel)) g.hRels.push(hRel);
    const ext  = num(row.Extension);  if (!isNaN(ext)) g.exts.push(ext);

    const px = num(row.PlateLocSide);
    const pz = num(row.PlateLocHeight);
    if (!isNaN(px) && !isNaN(pz) && Math.abs(px) <= 0.708 && pz >= 1.5 && pz <= 3.5) g.inZone++;

    const ev = num(row.ExitSpeed), la = num(row.Angle);
    const isBarrel = checkBarrel(ev, la);
    if (isBarrel) g.barrels++;

    if (!isNaN(hbArm) && !isNaN(ivb)) {
      rawDots.push({
        hb: hbArm, ivb, pitchType: name,
        px: !isNaN(px) ? px : null, pz: !isNaN(pz) ? pz : null,
        isWhiff, isSwing, isBarrel,
        batterSide: (row.BatterSide || '').trim() || null,
        velo: !isNaN(velo) ? velo : null, spin: !isNaN(spin) ? spin : null,
        vaa: !isNaN(vaa) ? vaa : null, haa: !isNaN(haa) ? haa : null,
        hRel: !isNaN(hRel) ? hRel : null, vRel: !isNaN(vRel) ? vRel : null,
        extension: !isNaN(ext) ? ext : null,
      });
    }
  }

  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
  const r1 = (v: number | null) => v !== null ? Math.round(v * 10) / 10 : null;
  const r2 = (v: number | null) => v !== null ? Math.round(v * 100) / 100 : null;
  const counted = Object.values(groups).reduce((s, g) => s + g.count, 0);

  // Shoulder height ≈ 75% of mean release height (matches pitcher-daily geometry).
  const allVRel = Object.values(groups).flatMap(g => g.vRels);
  const meanVRelFt = allVRel.length ? allVRel.reduce((a, b) => a + b, 0) / allVRel.length : null;
  const allHRel = Object.values(groups).flatMap(g => g.hRels);
  const meanHRelFt = allHRel.length ? allHRel.reduce((a, b) => a + b, 0) / allHRel.length : null;
  const shoulderIn = meanVRelFt !== null ? meanVRelFt * 12 * 0.75 : 50;
  const handSign = throws === 'L' ? -1 : 1;

  const pitchTypes: PitchType[] = [];
  for (const [name, g] of Object.entries(groups)) {
    const usage = counted > 0 ? (g.count / counted) * 100 : 0;
    if (usage < 1) continue;
    const avgHRel = avg(g.hRels), avgVRel = avg(g.vRels);
    const arm_angle = (avgHRel !== null && avgVRel !== null)
      ? Math.round(Math.atan2(avgVRel * 12 - shoulderIn, Math.abs(avgHRel * 12)) * (180 / Math.PI) * handSign * 10) / 10
      : null;
    pitchTypes.push({
      name, count: g.count, usage: Math.round(usage * 10) / 10,
      velo: r1(avg(g.velos)), maxVelo: g.velos.length ? r1(Math.max(...g.velos)) : null,
      spin: avg(g.spins) !== null ? Math.round(avg(g.spins)!) : null,
      h_movement: r1(avg(g.hBreaks)), v_movement: r1(avg(g.vBreaks)),
      vaa: r2(avg(g.vaas)), haa: r2(avg(g.haas)),
      whiff: g.swings > 0 ? Math.round((g.whiffs / g.swings) * 1000) / 10 : null,
      whiffs: g.whiffs, swings: g.swings,
      zone_pct: g.count > 0 ? Math.round((g.inZone / g.count) * 1000) / 10 : null,
      barrel_pct: g.count > 0 ? Math.round((g.barrels / g.count) * 1000) / 10 : null,
      h_rel: r2(avgHRel), v_rel: r2(avgVRel), extension: r2(avg(g.exts)), arm_angle,
    });
  }
  pitchTypes.sort((a, b) => b.usage - a.usage);

  let armAngle: number | null = null;
  if (meanVRelFt !== null && meanHRelFt !== null) {
    armAngle = Math.round(Math.atan2(meanVRelFt * 12 - shoulderIn, Math.abs(meanHRelFt * 12)) * (180 / Math.PI) * handSign * 10) / 10;
  }

  return {
    totalPitches, pitchTypes, rawDots, throws, armAngle,
    strikePct: totalPitches > 0 ? Math.round((strikes / totalPitches) * 1000) / 10 : null,
    swingAndMissPct: totalPitches > 0 ? Math.round((swingAndMisses / totalPitches) * 1000) / 10 : null,
    totalWhiffs: swingAndMisses,
  };
}

// ─── Prospect manifest ──────────────────────────────────────────────────────
// One entry per committed CSV (data/intl-prospects/<file>), keyed by slug.
export interface ProspectMeta {
  slug: string; file: string; name: string; pitcherId: string;
  team: string; throws: 'L' | 'R';
}
export const INTL_PROSPECTS: ProspectMeta[] = [
  { slug: 'jassel-bermudez', file: 'jassel-bermudez.csv', name: 'Jassel Bermudez', pitcherId: '1000286625', team: 'CUP_POL2', throws: 'R' },
  { slug: 'nelson-escalante', file: 'nelson-escalante.csv', name: 'Nelson Escalante', pitcherId: '10911539', team: 'CUP_POL1', throws: 'R' },
];

// Derive a box-score game line for the subject pitcher from the pitch rows.
export function buildGameLine(rows: Record<string, string>[], meta: ProspectMeta) {
  const mine = rows.filter(r => r.PitcherId === meta.pitcherId);
  const HITS = new Set(['single', 'double', 'triple', 'homerun', 'home run']);
  let k = 0, bb = 0, h = 0, hr = 0, outs = 0, runs = 0, bf = 0, strikes = 0;
  for (const r of mine) {
    const { isStrike } = callFlags(r.PitchCall);
    if (isStrike) strikes++;
    const korbb = (r.KorBB || '').toLowerCase();
    const pr = (r.PlayResult || '').toLowerCase().replace(/\s+/g, '');
    const call = (r.PitchCall || '').toLowerCase();
    if (korbb === 'strikeout') { k++; outs++; bf++; }
    else if (korbb === 'walk') { bb++; bf++; }
    else if (call === 'hitbypitch') { bf++; }
    else if (call === 'inplay') {
      bf++;
      if (HITS.has(pr)) h++;
      if (pr === 'homerun') hr++;
      outs += parseInt(r.OutsOnPlay || '0') || 0;
    } else {
      outs += parseInt(r.OutsOnPlay || '0') || 0; // e.g. caught stealing on a non-PA-ending pitch
    }
    runs += parseInt(r.RunsScored || '0') || 0;
  }
  const ipWhole = Math.floor(outs / 3);
  const ip = `${ipWhole}.${outs % 3}`;
  const era = outs > 0 ? ((runs * 9) / (outs / 3)).toFixed(2) : null;
  return { date: (mine[0]?.Date ?? '').replace(/\//g, '-'), ip, h, er: runs, bb, k, hr, pitches: mine.length, strikes, bf, era };
}

// Build the card's gameInfo + meta from the subject pitcher's rows.
export function buildGameInfo(rows: Record<string, string>[], meta: ProspectMeta) {
  const mine = rows.filter(r => r.PitcherId === meta.pitcherId);
  const first = mine[0] ?? {};
  const opp = mine.find(r => (r.BatterTeam || '') && r.BatterTeam !== meta.team)?.BatterTeam ?? null;
  const dateRaw = first.Date ?? null; // e.g. 2026/3/19
  const date = dateRaw ? dateRaw.replace(/\//g, '-').replace(/-(\d)(?=-|$)/g, '-0$1').replace(/^(\d{4})-(\d)-/, '$1-0$2-') : null;
  return {
    gamePk: null,
    opponent: opp,
    opponentFull: opp,
    team: meta.team,
    isHome: first['Top/Bottom'] === 'Bottom',
    date: date ?? dateRaw,
    sportId: 0,
    level: first.Level ?? null,
    league: first.League ?? null,
    stadium: first.Stadium ?? null,
  };
}

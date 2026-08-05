import { NextRequest, NextResponse } from 'next/server';
import { xwobaConFromEvLa, WOBA_BB, WOBA_HBP } from '@/app/lib/xwobacon';

export const maxDuration = 60;

const MLB_API    = 'https://statsapi.mlb.com/api/v1';
const SAVANT_CSV = 'https://baseballsavant.mlb.com/statcast_search/csv';

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchJSON(url: string, noCache = false) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    ...(noCache ? { cache: 'no-store' } : { next: { revalidate: 300 } }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 50_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://baseballsavant.mlb.com/' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    return text.startsWith('\uFEFF') ? text.slice(1) : text;
  } finally {
    clearTimeout(timer);
  }
}

// ─── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let cur = '', inQ = false;
  for (const ch of line) {
    if (ch === '"') { inQ = !inQ; continue; }
    if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  values.push(cur.trim());
  return values;
}

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  // Use the same quote-aware parser for headers so fields like
  // "last_name, first_name" are kept as a single column, not split into two.
  const headers = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

const PITCH_TYPE_MAP: Record<string, string | null> = {
  FF: '4-Seam Fastball', FA: '4-Seam Fastball', SI: 'Sinker',    FC: 'Cutter',
  FS: 'Splitter',        FO: 'Splitter',         SL: 'Slider',   ST: 'Sweeper',
  SV: 'Slurve',          CH: 'Changeup',          CU: 'Curveball', CS: 'Curveball',
  KC: 'Knuckle Curve',   KN: null,                EP: null,       PO: null,
  IN: null,              AB: null,                NP: null,
};

function checkBarrel(ev: number, la: number): boolean {
  if (isNaN(ev) || isNaN(la) || ev < 98) return false;
  const delta = Math.min(ev, 116) - 98;
  return la >= Math.max(8, 26 - delta) && la <= Math.min(50, 30 + delta);
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

// Per-zone (Statcast zones 1-9) swing/contact counts
interface ZoneStat {
  zone: number;      // 1-9
  pitches: number;
  swings: number;
  contacts: number;  // swings that made contact (not whiffs)
}

interface ApproachStat {
  pitches: number;
  zSwingPct: number | null;
  chasePct: number | null;
  contactPct: number | null;
  xslg: number | null;
  brlPct: number | null;
  bip: number;
}

interface ApproachStats {
  twoStrike: ApproachStat;
  highVelo: ApproachStat;
  breaking: ApproachStat;
  offspeed: ApproachStat;
}

// ─── MLB Stats API live feed aggregation (for minor league players) ───────────

async function fetchLiveFeedDots(
  gamePks: number[], playerId: string
): Promise<{ rawDots: RawDot[]; hitDots: HitDot[]; liveStatcast: CsvStatcast | null; zoneStats: ZoneStat[]; approachStats: ApproachStats | null }> {
  const allRaw: RawDot[] = [];
  const allHit: HitDot[] = [];
  const pidNum = parseInt(playerId);

  // Statcast metric accumulators
  let swings = 0, whiffs = 0;
  let inZonePitches = 0, inZoneSwings = 0, inZoneContact = 0;
  let outZonePitches = 0, outZoneSwings = 0, outZoneContact = 0;
  let battedBalls = 0, barrels = 0, laHardSum = 0, laHardCount = 0;
  let evSum = 0, evCount = 0;
  // xwOBA reconstruction from EV/LA (live feeds expose launch data but not the Statcast model output)
  let xwConSum = 0, xwPaDenom = 0, xwBB = 0, xwHBP = 0;
  let totalPitches = 0, maxEvRaw = -1;
  const evListAll: number[] = [];
  let sweetSpots = 0, sweetSpotDenom = 0;
  // Bat speed (from /gf endpoint, same as daily card)
  let batSpeedSum = 0, batSpeedCount = 0, fastSwings = 0;
  // Per-zone accumulators: indices 0-8 = zones 1-9, indices 9-12 = zones 11-14
  const allZoneP = new Array(13).fill(0) as number[];
  const allZoneS = new Array(13).fill(0) as number[];
  const allZoneC = new Array(13).fill(0) as number[];

  // Approach accumulators: 2-strike (ts), 95+ mph (hv), 83+ breaking (bb), offspeed (os)
  let ts_zP=0, ts_zS=0, ts_oP=0, ts_oS=0, ts_sw=0, ts_co=0, ts_br=0, ts_bi=0;
  let hv_zP=0, hv_zS=0, hv_oP=0, hv_oS=0, hv_sw=0, hv_co=0, hv_br=0, hv_bi=0;
  let bb_zP=0, bb_zS=0, bb_oP=0, bb_oS=0, bb_sw=0, bb_co=0, bb_br=0, bb_bi=0;
  let os_zP=0, os_zS=0, os_oP=0, os_oS=0, os_sw=0, os_co=0, os_br=0, os_bi=0;
  const BREAKING_MAPPED = new Set(['Slider', 'Sweeper', 'Slurve', 'Curveball', 'Knuckle Curve']);
  const OFFSPEED_MAPPED = new Set(['Changeup', 'Splitter']);

  // Fetch in batches of 5 to avoid hammering the API
  for (let i = 0; i < gamePks.length; i += 5) {
    const batch = gamePks.slice(i, i + 5);
    const results = await Promise.all(batch.map(async (gamePk) => {
      try {
        // Fetch live feed and Savant /gf in parallel — /gf has bat speed per play_id
        const [feed, gf] = await Promise.all([
          fetchJSON(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`),
          fetchJSON(`https://baseballsavant.mlb.com/gf?game_pk=${gamePk}`, true).catch(() => null),
        ]);

        const allPlays: Record<string, unknown>[] = feed?.liveData?.plays?.allPlays ?? [];
        const raw: RawDot[] = [];
        const hit: HitDot[] = [];
        // per-game accumulators returned alongside dots
        const acc = {
          swings:0, whiffs:0, inZoneP:0, inZoneS:0, inZoneC:0,
          outZoneP:0, outZoneS:0, outZoneC:0,
          bbs:0, barrels:0, laHardSum:0, laHardCount:0, evSum:0, evCount:0, sweetSpots:0, sweetSpotD:0,
          bsSum:0, bsCount:0, fastSwings:0,
          xwConSum:0, xwPaDenom:0, xwBB:0, xwHBP:0,
          totalPitches:0, maxEvRaw:-1, evList:[] as number[],
          zP: new Array(13).fill(0) as number[],
          zS: new Array(13).fill(0) as number[],
          zC: new Array(13).fill(0) as number[],
          ts_zP:0, ts_zS:0, ts_oP:0, ts_oS:0, ts_sw:0, ts_co:0, ts_br:0, ts_bi:0,
          hv_zP:0, hv_zS:0, hv_oP:0, hv_oS:0, hv_sw:0, hv_co:0, hv_br:0, hv_bi:0,
          bb_zP:0, bb_zS:0, bb_oP:0, bb_oS:0, bb_sw:0, bb_co:0, bb_br:0, bb_bi:0,
          os_zP:0, os_zS:0, os_oP:0, os_oS:0, os_sw:0, os_co:0, os_br:0, os_bi:0,
        };

        // ── Bat speed: iterate /gf pitcher arrays directly (same as daily card) ──
        // Build play_id → batSpeed lookup from exit_velocity, then walk pitcher arrays
        // to find swings for this batter and accumulate. Independent of live feed.
        const pidStr = String(playerId);
        const batSpeedByPlayId: Record<string, number> = {};
        const evArray = (gf?.exit_velocity ?? []) as Record<string, unknown>[];
        for (const ev of evArray) {
          const pid = String(ev.play_id ?? '');
          const bs  = Number(ev.batSpeed ?? NaN);
          if (pid && !isNaN(bs)) batSpeedByPlayId[pid] = bs;
        }
        const homePitchers = (gf?.home_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;
        const awayPitchers = (gf?.away_pitchers ?? {}) as Record<string, Record<string, unknown>[]>;
        for (const pitcherPitches of [...Object.values(homePitchers), ...Object.values(awayPitchers)]) {
          if (!Array.isArray(pitcherPitches)) continue;
          for (const pitch of pitcherPitches) {
            const batterId = String(pitch.batter ?? pitch.batter_id ?? '');
            if (batterId !== pidStr) continue;
            const playId = String(pitch.play_id ?? '');
            const bs = playId ? (batSpeedByPlayId[playId] ?? NaN) : NaN;
            if (isNaN(bs) || bs < 60) continue; // competitive swings only
            const desc = String(pitch.description ?? pitch.call_name ?? '').toLowerCase();
            const isSwing = desc.includes('swinging strike') || desc.includes('foul') || desc.includes('in play') || desc.includes('hit into play');
            if (isSwing) { acc.bsSum += bs; acc.bsCount++; if (bs >= 75) acc.fastSwings++; }
          }
        }

        for (const play of allPlays) {
          const matchup = play.matchup as Record<string, unknown> | undefined;
          if ((matchup?.batter as Record<string, unknown>)?.id !== pidNum) continue;
          const events = (play.playEvents as Record<string, unknown>[]) ?? [];

          // Capture the in-play batted ball's EV/LA for this PA so we can map it to xwOBAcon below.
          let paBipEv = NaN, paBipLa = NaN;

          for (const evt of events) {
            if ((evt.type as string) !== 'pitch') continue;
            const pd       = evt.pitchData as Record<string, unknown> | undefined;
            const hitData  = evt.hitData   as Record<string, unknown> | undefined;
            const details  = evt.details   as Record<string, unknown> | undefined;
            const desc     = ((details?.description as string) ?? '').toLowerCase();

            const rawType = (details?.type as Record<string, unknown>)?.code as string ?? '';
            const mapped  = PITCH_TYPE_MAP[rawType];
            if (mapped === null || mapped === undefined) continue;
            acc.totalPitches++;

            const px = Number((pd?.coordinates as Record<string, unknown>)?.pX ?? NaN);
            const pz = Number((pd?.coordinates as Record<string, unknown>)?.pZ ?? NaN);
            const ev = Number(hitData?.launchSpeed ?? NaN);
            const la = Number(hitData?.launchAngle ?? NaN);
            const isWhiff  = desc.includes('swinging strike') || desc.includes('foul tip');
            const isSwing  = isWhiff || desc.includes('foul') || desc.includes('in play');
            const isTake   = !isSwing;
            const isHIP    = desc.includes('in play');
            const isBarrel = isHIP && checkBarrel(ev, la);

            // Zone — live feed provides pd.zone (1-9 = in, 11-14 = out)
            const zone     = Number(pd?.zone ?? NaN);
            let inZone   = zone >= 1  && zone <= 9;
            let outZone  = zone >= 11 && zone <= 14;
            // Fallback for MiLB feeds where pd.zone is absent: estimate from plate coords.
            // pX is horizontal feet from plate center; pZ is height in feet.
            // Standard Statcast strike zone ≈ ±0.83 ft wide, 1.5–3.5 ft tall.
            if (!inZone && !outZone && !isNaN(px) && !isNaN(pz)) {
              inZone  = Math.abs(px) <= 0.83 && pz >= 1.5 && pz <= 3.5;
              outZone = !inZone;
            }

            if (!isNaN(px) && !isNaN(pz)) {
              raw.push({ pitchType: mapped, px, pz, isWhiff, isBarrel, isSwing, isTake, exitVelo: !isNaN(ev) ? ev : null });
            }
            if (isHIP) {
              const coords = hitData?.coordinates as Record<string, unknown> | undefined;
              const hcX = Number(coords?.coordX ?? NaN);
              const hcY = Number(coords?.coordY ?? NaN);
              const dist = Number(hitData?.totalDistance ?? NaN);
              const result = (play.result as Record<string, unknown>)?.eventType as string ?? '';
              if (result && !isNaN(hcX) && !isNaN(hcY)) {
                hit.push({ hcX, hcY, hitDistance: !isNaN(dist) && dist > 0 ? dist : null, result, pitchType: mapped, exitVelo: !isNaN(ev) ? ev : null, isBarrel });
              }
              // Remember this PA's batted-ball EV/LA for xwOBAcon mapping
              if (!isNaN(ev) && !isNaN(la)) { paBipEv = ev; paBipLa = la; }
              // Contact quality accumulators
              if (!isNaN(ev)) {
                acc.bbs++; acc.evSum += ev; acc.evCount++;
                if (ev > acc.maxEvRaw) acc.maxEvRaw = ev;
                acc.evList.push(ev);
                if (ev >= 95 && !isNaN(la)) { acc.laHardSum += la; acc.laHardCount++; }
                if (isBarrel) acc.barrels++;
                if (!isNaN(la)) { acc.sweetSpotD++; if (la >= 8 && la <= 32) acc.sweetSpots++; }
              }
            }
            // Plate discipline accumulators
            if (isSwing) acc.swings++;
            if (isWhiff) acc.whiffs++;
            if (inZone)  { acc.inZoneP++;  if (isSwing) { acc.inZoneS++;  if (!isWhiff) acc.inZoneC++;  } }
            if (outZone) { acc.outZoneP++; if (isSwing) { acc.outZoneS++; if (!isWhiff) acc.outZoneC++; } }
            // Per-zone tracking: 1-9 → indices 0-8, 11-14 → indices 9-12
            if (zone >= 1 && zone <= 9)   { const zi = zone - 1; acc.zP[zi]++; if (isSwing) { acc.zS[zi]++; if (!isWhiff) acc.zC[zi]++; } }
            if (zone >= 11 && zone <= 14) { const zi = zone - 2; acc.zP[zi]++; if (isSwing) { acc.zS[zi]++; if (!isWhiff) acc.zC[zi]++; } }

            // Approach splits — use evt.count (count BEFORE this pitch) for 2-strike detection
            const countBefore  = evt.count as { strikes?: number } | undefined;
            const strikesB     = countBefore?.strikes ?? -1;
            const pitchVelo    = Number(pd?.startSpeed ?? NaN);
            const isTwoStrike  = strikesB === 2;
            const isHighVelo   = !isNaN(pitchVelo) && pitchVelo >= 95;
            const isBreaking   = BREAKING_MAPPED.has(mapped) && !isNaN(pitchVelo) && pitchVelo >= 83;
            const isOffspeed   = OFFSPEED_MAPPED.has(mapped);
            const isContact    = !isWhiff;

            if (isTwoStrike) {
              if (isSwing) { acc.ts_sw++; if (isContact) acc.ts_co++; }
              if (isHIP) { acc.ts_bi++; if (isBarrel) acc.ts_br++; }
              if (inZone)       { acc.ts_zP++; if (isSwing) acc.ts_zS++; }
              else if (outZone) { acc.ts_oP++; if (isSwing) acc.ts_oS++; }
            }
            if (isHighVelo) {
              if (isSwing) { acc.hv_sw++; if (isContact) acc.hv_co++; }
              if (isHIP) { acc.hv_bi++; if (isBarrel) acc.hv_br++; }
              if (inZone)       { acc.hv_zP++; if (isSwing) acc.hv_zS++; }
              else if (outZone) { acc.hv_oP++; if (isSwing) acc.hv_oS++; }
            }
            if (isBreaking) {
              if (isSwing) { acc.bb_sw++; if (isContact) acc.bb_co++; }
              if (isHIP) { acc.bb_bi++; if (isBarrel) acc.bb_br++; }
              if (inZone)       { acc.bb_zP++; if (isSwing) acc.bb_zS++; }
              else if (outZone) { acc.bb_oP++; if (isSwing) acc.bb_oS++; }
            }
            if (isOffspeed) {
              if (isSwing) { acc.os_sw++; if (isContact) acc.os_co++; }
              if (isHIP) { acc.os_bi++; if (isBarrel) acc.os_br++; }
              if (inZone)       { acc.os_zP++; if (isSwing) acc.os_zS++; }
              else if (outZone) { acc.os_oP++; if (isSwing) acc.os_oS++; }
            }
          }

          // ── xwOBA reconstruction (once per completed plate appearance) ──
          // Statcast xwOBA = [ Σ xwOBAcon(EV,LA) over BIP + wBB·uBB + wHBP·HBP ] / (AB + BB + HBP + SF).
          // Strikeouts contribute 0 to the numerator and 1 to the denominator.
          const paResult = ((play.result as Record<string, unknown>)?.eventType as string ?? '').toLowerCase();
          if (paResult) {
            switch (paResult) {
              case 'walk':
                acc.xwBB++; acc.xwPaDenom++; break;
              case 'hit_by_pitch':
                acc.xwHBP++; acc.xwPaDenom++; break;
              case 'sac_fly': case 'sac_fly_double_play': {
                // SF is in the denominator; numerator gets the batted ball's xwOBAcon if available
                const xc = xwobaConFromEvLa(paBipEv, paBipLa);
                if (xc != null) acc.xwConSum += xc;
                acc.xwPaDenom++;
                break;
              }
              // Excluded from wOBA denominator entirely
              case 'intent_walk': case 'sac_bunt': case 'sac_bunt_double_play':
              case 'catcher_interf': case 'batter_interference': case 'runner_double_play':
                break;
              default: {
                // Any other PA outcome counts as an at-bat (denominator).
                // Balls in play get their modeled xwOBAcon; strikeouts/non-BIP outs add 0.
                const xc = xwobaConFromEvLa(paBipEv, paBipLa);
                if (xc != null) acc.xwConSum += xc;
                acc.xwPaDenom++;
                break;
              }
            }
          }
        }
        return { raw, hit, acc };
      } catch {
        return {
          raw: [] as RawDot[], hit: [] as HitDot[],
          acc: { swings:0, whiffs:0, inZoneP:0, inZoneS:0, inZoneC:0, outZoneP:0, outZoneS:0, outZoneC:0, bbs:0, barrels:0, laHardSum:0, laHardCount:0, evSum:0, evCount:0, sweetSpots:0, sweetSpotD:0, bsSum:0, bsCount:0, fastSwings:0, xwConSum:0, xwPaDenom:0, xwBB:0, xwHBP:0, totalPitches:0, maxEvRaw:-1, evList:[] as number[], zP:new Array(13).fill(0) as number[], zS:new Array(13).fill(0) as number[], zC:new Array(13).fill(0) as number[], ts_zP:0, ts_zS:0, ts_oP:0, ts_oS:0, ts_sw:0, ts_co:0, ts_br:0, ts_bi:0, hv_zP:0, hv_zS:0, hv_oP:0, hv_oS:0, hv_sw:0, hv_co:0, hv_br:0, hv_bi:0, bb_zP:0, bb_zS:0, bb_oP:0, bb_oS:0, bb_sw:0, bb_co:0, bb_br:0, bb_bi:0, os_zP:0, os_zS:0, os_oP:0, os_oS:0, os_sw:0, os_co:0, os_br:0, os_bi:0 }, // already correct
        };
      }
    }));
    for (const r of results) {
      allRaw.push(...r.raw);
      allHit.push(...r.hit);
      swings          += r.acc.swings;       whiffs        += r.acc.whiffs;
      inZonePitches   += r.acc.inZoneP;      inZoneSwings  += r.acc.inZoneS;   inZoneContact  += r.acc.inZoneC;
      outZonePitches  += r.acc.outZoneP;     outZoneSwings += r.acc.outZoneS;  outZoneContact += r.acc.outZoneC;
      battedBalls     += r.acc.bbs;          barrels       += r.acc.barrels;   laHardSum      += r.acc.laHardSum;  laHardCount += r.acc.laHardCount;
      evSum           += r.acc.evSum;        evCount       += r.acc.evCount;
      xwConSum        += r.acc.xwConSum;     xwPaDenom     += r.acc.xwPaDenom;  xwBB += r.acc.xwBB;  xwHBP += r.acc.xwHBP;
      sweetSpots      += r.acc.sweetSpots;   sweetSpotDenom += r.acc.sweetSpotD;
      batSpeedSum     += r.acc.bsSum;        batSpeedCount += r.acc.bsCount;   fastSwings     += r.acc.fastSwings;
      totalPitches    += r.acc.totalPitches;
      if (r.acc.maxEvRaw > maxEvRaw) maxEvRaw = r.acc.maxEvRaw;
      evListAll.push(...r.acc.evList);
      for (let z = 0; z < 13; z++) { allZoneP[z] += r.acc.zP[z]; allZoneS[z] += r.acc.zS[z]; allZoneC[z] += r.acc.zC[z]; }
      ts_zP += r.acc.ts_zP; ts_zS += r.acc.ts_zS; ts_oP += r.acc.ts_oP; ts_oS += r.acc.ts_oS;
      ts_sw += r.acc.ts_sw; ts_co += r.acc.ts_co; ts_br += r.acc.ts_br; ts_bi += r.acc.ts_bi;
      hv_zP += r.acc.hv_zP; hv_zS += r.acc.hv_zS; hv_oP += r.acc.hv_oP; hv_oS += r.acc.hv_oS;
      hv_sw += r.acc.hv_sw; hv_co += r.acc.hv_co; hv_br += r.acc.hv_br; hv_bi += r.acc.hv_bi;
      bb_zP += r.acc.bb_zP; bb_zS += r.acc.bb_zS; bb_oP += r.acc.bb_oP; bb_oS += r.acc.bb_oS;
      bb_sw += r.acc.bb_sw; bb_co += r.acc.bb_co; bb_br += r.acc.bb_br; bb_bi += r.acc.bb_bi;
      os_zP += r.acc.os_zP; os_zS += r.acc.os_zS; os_oP += r.acc.os_oP; os_oS += r.acc.os_oS;
      os_sw += r.acc.os_sw; os_co += r.acc.os_co; os_br += r.acc.os_br; os_bi += r.acc.os_bi;
    }
  }

  const r1  = (n: number) => Math.round(n * 10) / 10;
  const pct = (n: number, d: number): number | null => d > 0 ? Math.round(n / d * 1000) / 10 : null;

  const ev90Live = evListAll.length >= 5 ? (() => {
    const sorted     = [...evListAll].sort((a, b) => b - a);   // descending
    const top10Count = Math.max(1, Math.round(sorted.length * 0.1));
    return r1(sorted.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count);
  })() : null;

  // xwOBA reconstructed from per-BIP EV/LA (Statcast xwOBAcon model) + walk/HBP weights,
  // divided by the wOBA denominator (AB+BB+HBP+SF). Requires a few BIP to be meaningful.
  const r3x = (n: number) => Math.round(n * 1000) / 1000;
  const liveXwoba = (xwPaDenom >= 10 && battedBalls >= 3)
    ? r3x((xwConSum + WOBA_BB * xwBB + WOBA_HBP * xwHBP) / xwPaDenom)
    : null;

  const liveStatcast: CsvStatcast | null = allRaw.length === 0 ? null : {
    avgEv:        evCount      > 0 ? r1(evSum / evCount)           : null,
    barrelPct:    pct(barrels,       battedBalls),
    avgLaHard:    laHardCount > 0 ? r1(laHardSum / laHardCount) : null,
    sweetSpotPct: pct(sweetSpots,    sweetSpotDenom),
    avgBatSpeed:  batSpeedCount > 0 ? r1(batSpeedSum / batSpeedCount) : null,
    fastSwingPct: pct(fastSwings,    batSpeedCount),
    maxEv:        maxEvRaw > 0 ? r1(maxEvRaw) : null,
    ev90:         ev90Live,
    swingPct:     pct(swings, totalPitches),
    xwoba:        liveXwoba, xba: null, xslg: null, // xwOBA from EV/LA model; xBA/xSLG only via Savant (MLB)
    whiffPct:     pct(whiffs,         swings),
    chasePct:     pct(outZoneSwings,  outZonePitches),
    zSwingPct:    pct(inZoneSwings,   inZonePitches),
    zContactPct:  pct(inZoneContact,  inZoneSwings),
    ozContactPct: pct(outZoneContact, outZoneSwings),
    bipCount:     battedBalls,
    swingCount:   swings,
  };

  // Indices 0-8 → zones 1-9; indices 9-12 → zones 11-14
  const zoneStats: ZoneStat[] = allZoneP.map((p, i) => ({
    zone: i < 9 ? i + 1 : i + 2,
    pitches: p, swings: allZoneS[i], contacts: allZoneC[i],
  }));

  const mkApp = (zP: number, zS: number, oP: number, oS: number, sw: number, co: number, br: number, bi: number): ApproachStat => ({
    pitches: zP + oP, zSwingPct: pct(zS, zP), chasePct: pct(oS, oP),
    contactPct: pct(co, sw), xslg: null, brlPct: bi >= 5 ? pct(br, bi) : null, bip: bi,
  });
  const hasApproach = ts_zP + ts_oP + hv_zP + hv_oP + bb_zP + bb_oP + os_zP + os_oP > 0;
  const approachStats: ApproachStats | null = hasApproach ? {
    twoStrike: mkApp(ts_zP, ts_zS, ts_oP, ts_oS, ts_sw, ts_co, ts_br, ts_bi),
    highVelo:  mkApp(hv_zP, hv_zS, hv_oP, hv_oS, hv_sw, hv_co, hv_br, hv_bi),
    breaking:  mkApp(bb_zP, bb_zS, bb_oP, bb_oS, bb_sw, bb_co, bb_br, bb_bi),
    offspeed:  mkApp(os_zP, os_zS, os_oP, os_oS, os_sw, os_co, os_br, os_bi),
  } : null;

  return { rawDots: allRaw, hitDots: allHit, liveStatcast, zoneStats, approachStats };
}

interface CsvStatcast {
  avgEv: number | null; barrelPct: number | null; avgLaHard: number | null;
  sweetSpotPct: number | null; avgBatSpeed: number | null; fastSwingPct: number | null;
  maxEv: number | null; ev90: number | null; swingPct: number | null;
  xwoba: number | null; xba: number | null; xslg: number | null;
  whiffPct: number | null; chasePct: number | null; zSwingPct: number | null;
  zContactPct: number | null; ozContactPct: number | null;
  bipCount: number; swingCount: number; // sample sizes for percentile gating
}

function aggregateCsv(rows: Record<string, string>[]): { rawDots: RawDot[]; hitDots: HitDot[]; csvStatcast: CsvStatcast | null; zoneStats: ZoneStat[]; approachStats: ApproachStats | null } {
  const rawDots: RawDot[] = [];
  const hitDots: HitDot[] = [];

  // Plate discipline counters
  let swings = 0, whiffs = 0;
  let inZonePitches = 0, inZoneSwings = 0, inZoneContact = 0;
  let outZonePitches = 0, outZoneSwings = 0, outZoneContact = 0;
  // Contact quality counters — BIP ONLY (not fouls)
  let battedBalls = 0, barrels = 0, laHardSum = 0, laHardCount = 0;
  let evSum = 0, evCount = 0;
  let totalPitchesAgg = 0, maxEvAgg = -1;
  const evListAgg: number[] = [];
  let sweetSpots = 0, sweetSpotDenom = 0;
  // Expected stats — BIP only; divided by AB / PA for proper season rates
  let xwobaSum = 0, xbaSum = 0, xslgSum = 0;
  let abCount = 0, paCount = 0; // for xBA/xSLG (/AB) and xwOBA (/PA) denominators
  // Bat speed — all competitive swings (same as Savant)
  let batSpeedSum = 0, batSpeedCount = 0, fastSwings = 0;
  // Per-zone swing/contact: indices 0-8 = zones 1-9, indices 9-12 = zones 11-14
  const zoneP = new Array(13).fill(0), zoneS = new Array(13).fill(0), zoneC = new Array(13).fill(0);
  // Approach accumulators: 2-strike (ts), 95+ mph (hv), 83+ breaking (bb), offspeed (os)
  const CSV_BREAKING = new Set(['SL','ST','SV','CU','CS','KC']);
  const CSV_OFFSPEED = new Set(['CH','FS','FO']);
  let ts_zP=0, ts_zS=0, ts_oP=0, ts_oS=0, ts_sw=0, ts_co=0, ts_br=0, ts_bi=0, ts_xslgSum=0;
  let hv_zP=0, hv_zS=0, hv_oP=0, hv_oS=0, hv_sw=0, hv_co=0, hv_br=0, hv_bi=0, hv_xslgSum=0;
  let bb_zP=0, bb_zS=0, bb_oP=0, bb_oS=0, bb_sw=0, bb_co=0, bb_br=0, bb_bi=0, bb_xslgSum=0;
  let os_zP=0, os_zS=0, os_oP=0, os_oS=0, os_sw=0, os_co=0, os_br=0, os_bi=0, os_xslgSum=0;

  // Events that do NOT count as an at-bat
  const NON_AB = new Set([
    'walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt',
    'catcher_interf','fan_interference','sac_fly_double_play','batter_interference',
  ]);

  for (const row of rows) {
    const mapped = PITCH_TYPE_MAP[row.pitch_type];
    if (mapped === null || mapped === undefined) continue;
    totalPitchesAgg++;
    const desc      = (row.description || '').toLowerCase();
    const isWhiff   = desc === 'swinging_strike' || desc === 'swinging_strike_blocked' || desc === 'foul_tip';
    const isSwing   = isWhiff || desc.includes('foul') || desc.includes('hit_into_play');
    const isTake    = !isSwing;
    const isContact = isSwing && !isWhiff;
    const ev        = parseFloat(row.launch_speed);
    const la        = parseFloat(row.launch_angle);
    const isBarrel  = isContact && (
      row.launch_speed_angle ? Number(row.launch_speed_angle) === 6 : checkBarrel(ev, la)
    );
    const px = parseFloat(row.plate_x);
    const pz = parseFloat(row.plate_z);

    // Raw dots for zone chart
    if (!isNaN(px) && !isNaN(pz)) {
      rawDots.push({ pitchType: mapped, px, pz, isWhiff, isBarrel, isSwing, isTake, exitVelo: !isNaN(ev) ? ev : null });
    }

    // Hit dots for spray chart
    if (desc === 'hit_into_play') {
      const hcX = parseFloat(row.hc_x);
      const hcY = parseFloat(row.hc_y);
      const hdist = parseFloat(row.hit_distance_sc);
      const events = (row.events || '').trim();
      if (events && !isNaN(hcX) && !isNaN(hcY)) {
        hitDots.push({ hcX, hcY, hitDistance: !isNaN(hdist) && hdist > 0 ? hdist : null, result: events, pitchType: mapped, exitVelo: !isNaN(ev) ? ev : null, isBarrel });
      }
    }

    // Plate discipline
    if (isSwing) swings++;
    if (isWhiff) whiffs++;
    const zone = parseInt(row.zone ?? '0');
    const inZone  = zone >= 1 && zone <= 9;
    const outZone = zone >= 11 && zone <= 14;
    if (inZone)  { inZonePitches++;  if (isSwing) { inZoneSwings++;  if (isContact) inZoneContact++;  } }
    if (outZone) { outZonePitches++; if (isSwing) { outZoneSwings++; if (isContact) outZoneContact++; } }
    // Per-zone tracking: 1-9 → indices 0-8, 11-14 → indices 9-12
    if (inZone)  { const zi = zone - 1;  zoneP[zi]++; if (isSwing) { zoneS[zi]++; if (isContact) zoneC[zi]++; } }
    if (outZone) { const zi = zone - 2;  zoneP[zi]++; if (isSwing) { zoneS[zi]++; if (isContact) zoneC[zi]++; } }

    // Approach splits using CSV's strikes (count before pitch) and release_speed
    const strikesB    = parseInt(row.strikes ?? '-1');
    const pitchVelo   = parseFloat(row.release_speed);
    const isTwoStrike = strikesB === 2;
    const isHighVelo  = !isNaN(pitchVelo) && pitchVelo >= 95;
    const isBreaking  = CSV_BREAKING.has(row.pitch_type ?? '') && !isNaN(pitchVelo) && pitchVelo >= 83;
    const isOffspeedP = CSV_OFFSPEED.has(row.pitch_type ?? '');
    const isHIP       = desc === 'hit_into_play';
    const rowXslg = isHIP ? parseFloat(row.estimated_slg_using_speedangle) : NaN;
    if (isTwoStrike) {
      if (isSwing) { ts_sw++; if (isContact) ts_co++; }
      if (isHIP) { ts_bi++; if (isBarrel) ts_br++; if (!isNaN(rowXslg)) ts_xslgSum += rowXslg; }
      if (inZone)       { ts_zP++; if (isSwing) ts_zS++; }
      else if (outZone) { ts_oP++; if (isSwing) ts_oS++; }
    }
    if (isHighVelo) {
      if (isSwing) { hv_sw++; if (isContact) hv_co++; }
      if (isHIP) { hv_bi++; if (isBarrel) hv_br++; if (!isNaN(rowXslg)) hv_xslgSum += rowXslg; }
      if (inZone)       { hv_zP++; if (isSwing) hv_zS++; }
      else if (outZone) { hv_oP++; if (isSwing) hv_oS++; }
    }
    if (isBreaking) {
      if (isSwing) { bb_sw++; if (isContact) bb_co++; }
      if (isHIP) { bb_bi++; if (isBarrel) bb_br++; if (!isNaN(rowXslg)) bb_xslgSum += rowXslg; }
      if (inZone)       { bb_zP++; if (isSwing) bb_zS++; }
      else if (outZone) { bb_oP++; if (isSwing) bb_oS++; }
    }
    if (isOffspeedP) {
      if (isSwing) { os_sw++; if (isContact) os_co++; }
      if (isHIP) { os_bi++; if (isBarrel) os_br++; if (!isNaN(rowXslg)) os_xslgSum += rowXslg; }
      if (inZone)       { os_zP++; if (isSwing) os_zS++; }
      else if (outZone) { os_oP++; if (isSwing) os_oS++; }
    }

    // Contact quality — hit_into_play ONLY (never count fouls)
    if (isHIP && !isNaN(ev)) {
      battedBalls++;
      evSum += ev; evCount++;
      if (ev > maxEvAgg) maxEvAgg = ev;
      evListAgg.push(ev);
      if (ev >= 95 && !isNaN(la)) { laHardSum += la; laHardCount++; }
      if (isBarrel) barrels++;
      if (!isNaN(la)) { sweetSpotDenom++; if (la >= 8 && la <= 32) sweetSpots++; }
    }

    // Expected stats — only valid for balls in play; sum over BIP, divide by AB/PA
    if (isHIP) {
      const xwoba = parseFloat(row.estimated_woba_using_speedangle);
      const xba   = parseFloat(row.estimated_ba_using_speedangle);
      const xslg  = parseFloat(row.estimated_slg_using_speedangle);
      if (!isNaN(xwoba)) xwobaSum += xwoba;
      if (!isNaN(xba))   xbaSum   += xba;
      if (!isNaN(xslg))  xslgSum  += xslg;
    }

    // PA / AB counters — only from plate-appearance-ending pitches (events field set)
    const eventStr = (row.events || '').trim();
    if (eventStr) {
      paCount++;
      if (!NON_AB.has(eventStr)) abCount++;
    }

    // Bat speed — competitive swings only (bs >= 60 mph, same filter as Savant)
    const bs = parseFloat(row.bat_speed);
    if (!isNaN(bs) && isSwing && bs >= 60) {
      batSpeedSum += bs; batSpeedCount++;
      if (bs >= 75) fastSwings++;
    }
  }

  if (rows.length === 0) return { rawDots, hitDots, csvStatcast: null, zoneStats: [], approachStats: null };

  const r1  = (n: number) => Math.round(n * 10) / 10;
  const r3  = (n: number) => Math.round(n * 1000) / 1000;
  const pct = (n: number, d: number): number | null => d > 0 ? Math.round(n / d * 1000) / 10 : null;

  const ev90Agg = evListAgg.length >= 5 ? (() => {
    const sorted     = [...evListAgg].sort((a, b) => b - a);   // descending
    const top10Count = Math.max(1, Math.round(sorted.length * 0.1));
    return r1(sorted.slice(0, top10Count).reduce((s, v) => s + v, 0) / top10Count);
  })() : null;

  const csvStatcast: CsvStatcast = {
    avgEv:        evCount      > 0 ? r1(evSum / evCount) : null,
    barrelPct:    pct(barrels,    battedBalls),
    avgLaHard:    laHardCount > 0 ? r1(laHardSum / laHardCount) : null,
    sweetSpotPct: pct(sweetSpots, sweetSpotDenom),
    avgBatSpeed:  batSpeedCount > 0 ? r1(batSpeedSum / batSpeedCount) : null,
    fastSwingPct: pct(fastSwings, batSpeedCount),
    maxEv:        maxEvAgg > 0 ? r1(maxEvAgg) : null,
    ev90:         ev90Agg,
    swingPct:     pct(swings, totalPitchesAgg),
    // xBA/xSLG: sum of per-BIP estimates divided by AB (like regular BA/SLG)
    xba:   abCount > 0 && xbaSum  > 0 ? r3(xbaSum  / abCount) : null,
    xslg:  abCount > 0 && xslgSum > 0 ? r3(xslgSum / abCount) : null,
    // xwOBA: sum of per-BIP estimates divided by PA (wOBA denominator approx)
    xwoba: paCount > 0 && xwobaSum > 0 ? r3(xwobaSum / paCount) : null,
    whiffPct:     pct(whiffs,         swings),
    chasePct:     pct(outZoneSwings,  outZonePitches),
    zSwingPct:    pct(inZoneSwings,   inZonePitches),
    zContactPct:  pct(inZoneContact,  inZoneSwings),
    ozContactPct: pct(outZoneContact, outZoneSwings),
    bipCount:     battedBalls,
    swingCount:   swings,
  };

  // Indices 0-8 → zones 1-9; indices 9-12 → zones 11-14
  const zoneStats: ZoneStat[] = zoneP.map((p, i) => ({
    zone: i < 9 ? i + 1 : i + 2,  // 0→1..8→9, 9→11..12→14
    pitches: p, swings: zoneS[i], contacts: zoneC[i],
  }));
  const pctA = (n: number, d: number): number | null => d > 0 ? Math.round(n / d * 1000) / 10 : null;
  const r3A  = (n: number) => Math.round(n * 1000) / 1000;
  const mkA = (zP: number, zS: number, oP: number, oS: number, sw: number, co: number, br: number, bi: number, xslgSum: number): ApproachStat => ({
    pitches: zP + oP, zSwingPct: pctA(zS, zP), chasePct: pctA(oS, oP),
    contactPct: pctA(co, sw), xslg: bi >= 5 ? r3A(xslgSum / bi) : null,
    brlPct: bi >= 5 ? pctA(br, bi) : null, bip: bi,
  });
  const csvApproach: ApproachStats = {
    twoStrike: mkA(ts_zP, ts_zS, ts_oP, ts_oS, ts_sw, ts_co, ts_br, ts_bi, ts_xslgSum),
    highVelo:  mkA(hv_zP, hv_zS, hv_oP, hv_oS, hv_sw, hv_co, hv_br, hv_bi, hv_xslgSum),
    breaking:  mkA(bb_zP, bb_zS, bb_oP, bb_oS, bb_sw, bb_co, bb_br, bb_bi, bb_xslgSum),
    offspeed:  mkA(os_zP, os_zS, os_oP, os_oS, os_sw, os_co, os_br, os_bi, os_xslgSum),
  };
  return { rawDots, hitDots, csvStatcast, zoneStats, approachStats: csvApproach };
}

// Lightweight Barrel% / Contact% for a pitcher-hand subset of Savant CSV rows.
// Reuses aggregateCsv rather than re-deriving the swing/whiff/BIP logic.
function computeHandStatcast(rows: Record<string, string>[]): { barrelPct: number | null; contactPct: number | null } | null {
  if (rows.length === 0) return null;
  const a = aggregateCsv(rows).csvStatcast;
  if (!a) return null;
  return {
    barrelPct:  a.barrelPct,
    contactPct: a.whiffPct != null ? Math.round((100 - a.whiffPct) * 10) / 10 : null,
  };
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId     = searchParams.get('playerId');
  const season       = searchParams.get('season') ?? new Date().getFullYear().toString();
  // Optional: caller can force a specific level. 1=MLB 11=AAA 12=AA 13=High-A 14=Low-A 16=FCL 17=ACL
  const sportIdParam = searchParams.get('sportId');
  const requestedSportId = sportIdParam ? parseInt(sportIdParam) : null;
  // statcastOnly=true: skip the slow live-feed aggregation and return only Savant CSV metrics.
  // Used by hitter-age-percentiles to stay within its 15-second timeout.
  const statcastOnly = searchParams.get('statcastOnly') === 'true';

  if (!playerId) return NextResponse.json({ error: 'playerId required' }, { status: 400 });

  try {
    // ── 1. Player bio ────────────────────────────────────────────────────────
    const personData = await fetchJSON(`${MLB_API}/people/${playerId}`).catch(() => null);
    const person = personData?.people?.[0];

    // ── 2. Season totals — fetch all levels in parallel to build level switcher ──
    const [mlbSeason, aaaSeason, aaSeason, highASeason, lowASeason, fclSeason, aclSeason] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=1`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=11`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=12`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=13`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=14`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=16`).catch(() => null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=season&group=hitting&season=${season}&sportId=17`).catch(() => null),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pickSplit = (d: any) => d?.stats?.[0]?.splits?.[0];

    const hasMLB   = !!pickSplit(mlbSeason);
    const hasAAA   = !!pickSplit(aaaSeason);
    const hasAA    = !!pickSplit(aaSeason);
    const hasHighA = !!pickSplit(highASeason);
    const hasLowA  = !!pickSplit(lowASeason);
    const hasFCL   = !!pickSplit(fclSeason);
    const hasACL   = !!pickSplit(aclSeason);

    // Build available-level list for the UI switcher (only levels with data)
    const availableLevels = [
      ...(hasMLB   ? [{ sportId: 1,  label: 'MLB'    }] : []),
      ...(hasAAA   ? [{ sportId: 11, label: 'AAA'    }] : []),
      ...(hasAA    ? [{ sportId: 12, label: 'AA'     }] : []),
      ...(hasHighA ? [{ sportId: 13, label: 'High-A' }] : []),
      ...(hasLowA  ? [{ sportId: 14, label: 'Low-A'  }] : []),
      ...(hasFCL   ? [{ sportId: 16, label: 'FCL'    }] : []),
      ...(hasACL   ? [{ sportId: 17, label: 'ACL'    }] : []),
    ];

    // Select active level: honour explicit request when data exists, else pick the level
    // with the most plate appearances so a player like Valdez (5 MLB games, 50+ AAA games)
    // uses AAA Statcast data instead of a tiny MLB sample.
    let activeSportId: number;
    let seasonSplit: ReturnType<typeof pickSplit>;
    let level: string;

    const paOf = (d: unknown) => Number((pickSplit(d) as { stat?: { plateAppearances?: unknown } } | undefined)?.stat?.plateAppearances ?? 0);

    if      (requestedSportId === 1  && hasMLB)   { activeSportId = 1;  seasonSplit = pickSplit(mlbSeason);   level = 'MLB';    }
    else if (requestedSportId === 11 && hasAAA)   { activeSportId = 11; seasonSplit = pickSplit(aaaSeason);   level = 'AAA';    }
    else if (requestedSportId === 12 && hasAA)    { activeSportId = 12; seasonSplit = pickSplit(aaSeason);    level = 'AA';     }
    else if (requestedSportId === 13 && hasHighA) { activeSportId = 13; seasonSplit = pickSplit(highASeason); level = 'High-A'; }
    else if (requestedSportId === 14 && hasLowA)  { activeSportId = 14; seasonSplit = pickSplit(lowASeason);  level = 'Low-A';  }
    else if (requestedSportId === 16 && hasFCL)   { activeSportId = 16; seasonSplit = pickSplit(fclSeason);   level = 'FCL';    }
    else if (requestedSportId === 17 && hasACL)   { activeSportId = 17; seasonSplit = pickSplit(aclSeason);   level = 'ACL';    }
    else {
      // Auto-detect: pick the level with the most plate appearances
      const candidates = [
        { id: 1,  has: hasMLB,   pa: paOf(mlbSeason),   d: mlbSeason,   lbl: 'MLB'    },
        { id: 11, has: hasAAA,   pa: paOf(aaaSeason),   d: aaaSeason,   lbl: 'AAA'    },
        { id: 12, has: hasAA,    pa: paOf(aaSeason),    d: aaSeason,    lbl: 'AA'     },
        { id: 13, has: hasHighA, pa: paOf(highASeason), d: highASeason, lbl: 'High-A' },
        { id: 14, has: hasLowA,  pa: paOf(lowASeason),  d: lowASeason,  lbl: 'Low-A'  },
        { id: 16, has: hasFCL,   pa: paOf(fclSeason),   d: fclSeason,   lbl: 'FCL'    },
        { id: 17, has: hasACL,   pa: paOf(aclSeason),   d: aclSeason,   lbl: 'ACL'    },
      ].filter(c => c.has).sort((a, b) => b.pa - a.pa);
      const primary = candidates[0] ?? { id: 17, d: aclSeason, lbl: 'ACL' };
      activeSportId = primary.id;
      seasonSplit   = pickSplit(primary.d);
      level         = primary.lbl;
    }

    const isMLBPlayer = activeSportId === 1; // only MLB level uses Savant CSV
    const seasonStat  = seasonSplit?.stat ?? null;
    const team: string | null = seasonSplit?.team?.abbreviation ?? null;

    // ── 3. Game log + team details — fetched in parallel ─────────────────────
    // The /teams/{id} endpoint reliably includes parentOrgId for MiLB teams and
    // sport.id for MLB teams — much more dependable than the person.currentTeam object.
    const splitTeamId: number | null = seasonSplit?.team?.id ?? null;
    const [activeLog, teamInfo, vsHandSplits] = await Promise.all([
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=gameLog&group=hitting&season=${season}&sportId=${activeSportId}`).catch(() => null),
      splitTeamId ? fetchJSON(`${MLB_API}/teams/${splitTeamId}`).catch(() => null) : Promise.resolve(null),
      fetchJSON(`${MLB_API}/people/${playerId}/stats?stats=statSplits&group=hitting&season=${season}&sitCodes=vl,vr&sportId=${activeSportId}`).catch(() => null),
    ]);

    // vs LHP / vs RHP splits (same level as the active stats block)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vsHandSplitList: any[] = vsHandSplits?.stats?.[0]?.splits ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const findHandSplit = (code: string) => vsHandSplitList.find((s: any) => s.split?.code === code)?.stat ?? null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buildSplitTotals = (s: any) => {
      if (!s) return null;
      const sAb = Number(s.atBats ?? 0);
      const sH  = Number(s.hits   ?? 0);
      return {
        pa:  Number(s.plateAppearances ?? 0),
        ab:  sAb,
        h:   sH,
        hr:  Number(s.homeRuns    ?? 0),
        rbi: Number(s.rbi         ?? 0),
        bb:  Number(s.baseOnBalls ?? 0),
        k:   Number(s.strikeOuts  ?? 0),
        avg: s.avg ?? (sAb > 0 ? (sH / sAb).toFixed(3) : null),
        obp: s.obp ?? null,
        slg: s.slg ?? null,
        ops: s.ops ?? null,
      };
    };
    const splits = {
      vsLHP: buildSplitTotals(findHandSplit('vl')),
      vsRHP: buildSplitTotals(findHandSplit('vr')),
    };

    // Build the mlbstatic.com team logo ID
    const t = teamInfo?.teams?.[0];
    const teamLogoId: number | null =
      // MiLB teams: parentOrgId points to the parent MLB club
      Number(t?.parentOrgId || 0) ||
      // MLB teams: sport.id === 1, use the team's own id
      (t?.sport?.id === 1 ? Number(t?.id || 0) || null : null) ||
      // last-resort: person.currentTeam (may lack parentOrgId on basic endpoint)
      Number(person?.currentTeam?.parentOrgId || 0) ||
      (person?.currentTeam?.sport?.id === 1 ? Number(person?.currentTeam?.id || 0) || null : null) ||
      null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allSplits: any[] = activeLog?.stats?.[0]?.splits ?? [];

    const games = allSplits.map(s => ({
      date:     s.date || s.game?.gameDate?.slice(0, 10) || '',
      opponent: s.opponent?.abbreviation ?? s.opponent?.name ?? '?',
      isHome:   s.isHome ?? false,
      ab:       Number(s.stat?.atBats       ?? 0),
      h:        Number(s.stat?.hits         ?? 0),
      hr:       Number(s.stat?.homeRuns     ?? 0),
      rbi:      Number(s.stat?.rbi          ?? 0),
      bb:       Number(s.stat?.baseOnBalls  ?? 0),
      k:        Number(s.stat?.strikeOuts   ?? 0),
      doubles:  Number(s.stat?.doubles      ?? 0),
      triples:  Number(s.stat?.triples      ?? 0),
      pa:       Number(s.stat?.plateAppearances ?? 0),
      sb:       Number(s.stat?.stolenBases  ?? 0),
      gamePk:   s.game?.gamePk ?? null,
    })).filter(g => g.date).sort((a, b) => b.date.localeCompare(a.date));

    // ── 4. Charts + Statcast metrics ─────────────────────────────────────────────
    // MLB: Savant pitch-by-pitch CSV filtered to game_type=R (regular season only,
    //   no spring training) — gives bat speed, EV, zone, xStats, spray dots.
    //   xwOBA/xBA/xSLG overridden from Savant expected_statistics leaderboard CSV.
    // Minor league: aggregate MLB Stats API live feed across all gamePks in the
    //   season game log (same source as daily hitter card, regular season only).
    let rawDots: RawDot[] = [];
    let hitDots: HitDot[] = [];
    let statcast: CsvStatcast | null = null;
    let zoneStats: ZoneStat[] = [];
    let approachStats: ApproachStats | null = null;
    // Barrel% / Contact% vs LHP / vs RHP — derived from Savant CSV pitch rows (p_throws),
    // computed alongside the main Statcast aggregation below. Stays null when no
    // pitch-level Savant coverage exists for this player/level (small-sample MiLB).
    let handStatcast: {
      vsLHP: { barrelPct: number | null; contactPct: number | null } | null;
      vsRHP: { barrelPct: number | null; contactPct: number | null } | null;
    } = { vsLHP: null, vsRHP: null };

    if (isMLBPlayer) {
      const pitchUrl = `${SAVANT_CSV}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&hfSea=${season}%7C&min_pitches=0&min_results=0&group_by=name&sort_col=pitches&player_event_sort=api_p_release_speed&sort_order=desc&min_abs=0`;
      const expUrl   = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${season}&position=&team=&min=1&csv=true`;
      const [pitchCsv, expCsv] = await Promise.all([
        fetchText(pitchUrl).catch(() => null),
        fetchText(expUrl).catch(() => null),
      ]);
      try {
        if (pitchCsv?.includes('pitch_type')) {
          // Filter to regular season only (game_type = 'R') — excludes spring training
          const rows = parseCSV(pitchCsv).filter(r =>
            String(r.batter ?? '').trim() === String(playerId).trim() &&
            (r.game_type ?? 'R') === 'R'
          );
          const agg = aggregateCsv(rows);
          rawDots       = agg.rawDots;
          hitDots       = agg.hitDots;
          statcast      = agg.csvStatcast;
          zoneStats     = agg.zoneStats;
          approachStats = agg.approachStats;
          handStatcast  = {
            vsLHP: computeHandStatcast(rows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'L')),
            vsRHP: computeHandStatcast(rows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'R')),
          };
        }
        // Override xwOBA/xBA/xSLG with season-level rates from leaderboard CSV
        if (expCsv?.includes('est_woba') && statcast) {
          const expRow = parseCSV(expCsv).find(r => String(r.player_id ?? '').trim() === String(playerId).trim());
          if (expRow) {
            const n3 = (v: string | undefined) => { const x = parseFloat(v ?? ''); return isNaN(x) ? null : Math.round(x * 1000) / 1000; };
            statcast.xwoba = n3(expRow.est_woba);
            statcast.xba   = n3(expRow.est_ba);
            statcast.xslg  = n3(expRow.est_slg);
          }
        }
      } catch { /* non-fatal */ }
    } else {
      // Non-MLB (AAA/AA/A): try Savant's &minors=true CSV first (same endpoint the pitcher
      // route uses) — it carries estimated_slg_using_speedangle and all other Statcast
      // model outputs per pitch. Fall back to the live-feed aggregation when Savant has
      // no data for this player (e.g. parks without Hawk-Eye, early-season small sample).
      if (statcastOnly) {
        statcast = null;
      } else {
        const milbUrl    = `${SAVANT_CSV}?all=true&type=details&batters_lookup%5B%5D=${playerId}&player_type=batter&hfSea=${season}%7C&hfGT=R%7C&min_pitches=0&min_results=0&min_abs=0&minors=true`;
        const milbGamePks = games.map(g => g.gamePk).filter((pk): pk is number => pk != null);
        // Run Savant CSV and live feed in parallel so fallback doesn't add latency,
        // and so we can use the live feed's whiffPct (all games) for Contact% even
        // when Savant has partial Hawk-Eye coverage.
        const emptyLive = { rawDots: [] as RawDot[], hitDots: [] as HitDot[], liveStatcast: null, zoneStats: [] as ZoneStat[], approachStats: null };
        const [milbCsv, liveResult] = await Promise.all([
          fetchText(milbUrl).catch(() => null),
          milbGamePks.length > 0 ? fetchLiveFeedDots(milbGamePks, playerId) : Promise.resolve(emptyLive),
        ]);
        const pidStr  = String(playerId).trim();
        // Filter to the level-specific gamePks so Low-A and FCL tabs show separate data
        const levelGamePkSet = new Set(games.map(g => g.gamePk?.toString()).filter(Boolean));
        const milbRows = milbCsv?.includes('pitch_type')
          ? parseCSV(milbCsv).filter(r =>
              String(r.batter ?? '').trim() === pidStr &&
              (r.game_type ?? 'R') === 'R' &&
              (levelGamePkSet.size === 0 || levelGamePkSet.has(r.game_pk))
            )
          : [];

        if (milbRows.length > 0) {
          const agg  = aggregateCsv(milbRows);
          rawDots       = agg.rawDots;
          hitDots       = agg.hitDots;
          statcast      = agg.csvStatcast;
          zoneStats     = agg.zoneStats;
          approachStats = agg.approachStats;
          handStatcast  = {
            vsLHP: computeHandStatcast(milbRows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'L')),
            vsRHP: computeHandStatcast(milbRows.filter(r => (r.p_throws ?? '').trim().toUpperCase() === 'R')),
          };
          // Override whiffPct with live feed value — covers all games, not just Hawk-Eye parks.
          // This gives Contact% (= 100 - whiffPct) a comprehensive sample rather than
          // the partial Statcast sample that coincidentally matches zone contact% in small data.
          if (liveResult.liveStatcast?.whiffPct != null && statcast) {
            statcast = { ...statcast, whiffPct: liveResult.liveStatcast.whiffPct };
          }
        } else {
          // Savant had no MiLB data — use the live feed results already fetched above
          rawDots       = liveResult.rawDots;
          hitDots       = liveResult.hitDots;
          statcast      = liveResult.liveStatcast;
          zoneStats     = liveResult.zoneStats;
          approachStats = liveResult.approachStats;
        }
      }
    }

    // ── 6. Build totals ──────────────────────────────────────────────────────
    const ab  = Number(seasonStat?.atBats          ?? 0);
    const h   = Number(seasonStat?.hits            ?? 0);
    const bb  = Number(seasonStat?.baseOnBalls     ?? 0);
    const hbp = Number(seasonStat?.hitByPitch      ?? 0);
    const sf  = Number(seasonStat?.sacFlies        ?? 0);
    const pa  = Number(seasonStat?.plateAppearances ?? (ab + bb + hbp + sf));

    return NextResponse.json({
      playerId:        parseInt(playerId),
      playerName:      person?.fullName    ?? null,
      playerHeight:    person?.height      ?? null,
      playerWeight:    person?.weight      ?? null,
      playerBirthDate: person?.birthDate   ?? null,
      playerBatSide:   person?.batSide?.code   ?? null,
      playerPitchHand: person?.pitchHand?.code ?? null,
      season,
      level,
      activeSportId,
      availableLevels,
      team,
      teamLogoId,
      totals: seasonStat ? {
        pa, ab, h,
        hr:      Number(seasonStat.homeRuns    ?? 0),
        rbi:     Number(seasonStat.rbi         ?? 0),
        bb,
        k:       Number(seasonStat.strikeOuts  ?? 0),
        doubles: Number(seasonStat.doubles     ?? 0),
        triples: Number(seasonStat.triples     ?? 0),
        sb:      Number(seasonStat.stolenBases ?? 0),
        avg:     seasonStat.avg ?? (ab > 0 ? (h / ab).toFixed(3) : '.000'),
        obp:     seasonStat.obp ?? null,
        slg:     seasonStat.slg ?? null,
        ops:     seasonStat.ops ?? null,
      } : null,
      games,
      statcast,
      rawDots,
      hitDots,
      zoneStats,
      approachStats,
      splits: {
        vsLHP: splits.vsLHP ? { ...splits.vsLHP, ...(handStatcast.vsLHP ?? { barrelPct: null, contactPct: null }) } : null,
        vsRHP: splits.vsRHP ? { ...splits.vsRHP, ...(handStatcast.vsRHP ?? { barrelPct: null, contactPct: null }) } : null,
      },
    });

  } catch (err) {
    console.error('player-season error:', err);
    return NextResponse.json({ error: 'Failed to fetch season data' }, { status: 500 });
  }
}

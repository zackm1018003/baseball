import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? 'prj_BDfdiMWJA1y8m28NZ0gKxmxU7puC';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;
const GRADES_KEY = 'GRADES_STORAGE';

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors() });
}

// ─── Vercel env var helpers ───────────────────────────────────────────────────

async function getStoredGrades(): Promise<{ id: string | null; data: Record<string, unknown> }> {
  if (!VERCEL_TOKEN) return { id: null, data: {} };

  const listRes = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env?limit=100`, {
    headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
  });
  const listData = await listRes.json();
  const existing = (listData.envs ?? []).find(
    (e: { key: string; id: string }) => e.key === GRADES_KEY
  );

  if (!existing) return { id: null, data: {} };

  // Fetch the actual decrypted value
  const valRes = await fetch(
    `https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${existing.id}`,
    { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` } }
  );
  const valData = await valRes.json();
  try {
    const data = JSON.parse(valData.value ?? '{}');
    return { id: existing.id, data };
  } catch {
    return { id: existing.id, data: {} };
  }
}

async function writeStoredGrades(id: string | null, data: Record<string, unknown>) {
  if (!VERCEL_TOKEN) return;
  const value = JSON.stringify(data);

  if (id) {
    await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ value, type: 'plain', target: ['production', 'preview'] }),
    });
  } else {
    await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: GRADES_KEY, value, type: 'plain', target: ['production', 'preview'] }),
    });
  }
}

// ─── GET — return all saved grades ───────────────────────────────────────────

export async function GET() {
  try {
    const { data } = await getStoredGrades();
    return NextResponse.json(data, { headers: cors() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: cors() });
  }
}

// ─── POST — save or delete a single player's grades ──────────────────────────
// Body: { playerUrl: string, grades: object | null }
// grades: null  → delete that player
// grades: {...} → upsert

export async function POST(req: Request) {
  try {
    const { playerUrl, grades } = await req.json();
    if (!playerUrl) {
      return NextResponse.json({ error: 'playerUrl required' }, { status: 400, headers: cors() });
    }

    const { id, data } = await getStoredGrades();

    if (grades === null || grades === undefined) {
      delete data[playerUrl];
    } else {
      data[playerUrl] = grades;
    }

    await writeStoredGrades(id, data);
    return NextResponse.json({ ok: true, count: Object.keys(data).length }, { headers: cors() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: cors() });
  }
}

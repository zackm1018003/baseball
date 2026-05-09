import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const PROJECT_ID = process.env.VERCEL_PROJECT_ID ?? 'prj_BDfdiMWJA1y8m28NZ0gKxmxU7puC';
const VERCEL_TOKEN = process.env.VERCEL_API_TOKEN;

// Allow calls from the bookmarklet (any origin)
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(req: Request) {
  try {
    const { players, cols, type, year } = await req.json();

    if (!players || !Array.isArray(players) || players.length < 10) {
      return NextResponse.json({ error: 'Too few players' }, { status: 400, headers: corsHeaders() });
    }

    const key = `STATS_CACHE_${type.toUpperCase()}_${year}`;
    const value = JSON.stringify({ players, cols, ts: Date.now() });

    if (!VERCEL_TOKEN) {
      return NextResponse.json({ error: 'No VERCEL_API_TOKEN configured' }, { status: 500, headers: corsHeaders() });
    }

    // Check if env var exists
    const listRes = await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` },
    });
    const listData = await listRes.json();
    const existing = (listData.envs ?? []).find((e: { key: string; id: string }) => e.key === key);

    if (existing) {
      // Update
      await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env/${existing.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, type: 'plain', target: ['production', 'preview'] }),
      });
    } else {
      // Create
      await fetch(`https://api.vercel.com/v9/projects/${PROJECT_ID}/env`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, type: 'plain', target: ['production', 'preview'] }),
      });
    }

    return NextResponse.json({ ok: true, players: players.length, key }, { headers: corsHeaders() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500, headers: corsHeaders() });
  }
}

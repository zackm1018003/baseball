import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ teamId: string }> }
) {
  const { teamId } = await params;
  if (!/^\d+$/.test(teamId)) {
    return new NextResponse('Bad request', { status: 400 });
  }

  const url = `https://www.mlbstatic.com/team-logos/${teamId}.svg`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 86400 },
  });

  if (!res.ok) {
    return new NextResponse('Not found', { status: 404 });
  }

  const svg = await res.text();

  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

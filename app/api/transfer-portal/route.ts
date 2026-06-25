import { NextResponse } from 'next/server';
import portalData from '@/data/transfer-portal-2026.json';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(portalData);
}

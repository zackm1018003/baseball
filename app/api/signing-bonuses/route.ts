import { NextResponse } from 'next/server';
import bonusData from '@/data/signing-bonuses.json';

// GET /api/signing-bonuses
// Returns map of MLB player ID → signing bonus (dollars)
export async function GET() {
  return NextResponse.json(bonusData, {
    headers: { 'Cache-Control': 'public, max-age=86400' },
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { deauthorizeStravaToken } from '@/lib/strava/client';
import {
  clearAthleteCache,
  clearStravaSessionCookie,
  getStravaSession,
} from '@/lib/strava/session';

export async function POST(req: NextRequest) {
  let clearCache = true;
  try {
    const body = (await req.json()) as { clearCache?: boolean };
    if (typeof body?.clearCache === 'boolean') {
      clearCache = body.clearCache;
    }
  } catch {
    // Default to clearing cache when no JSON body is supplied
  }

  const session = await getStravaSession();
  if (session) {
    if (session.tokens?.access_token) {
      await deauthorizeStravaToken(session.tokens.access_token);
    }
    if (clearCache) {
      clearAthleteCache(session.athlete.id);
    }
  }

  await clearStravaSessionCookie();

  return NextResponse.json({
    disconnected: true,
    cacheCleared: clearCache,
  });
}

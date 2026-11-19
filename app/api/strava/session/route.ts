import { NextResponse } from 'next/server';
import { getStravaConfig } from '@/lib/strava/client';
import {
  getAthleteCache,
  getManualSyncCooldownRemainingSec,
  getStravaSession,
} from '@/lib/strava/session';

export async function GET() {
  const cfg = getStravaConfig();
  const session = await getStravaSession();

  if (!session || session.revoked) {
    return NextResponse.json({
      configured: cfg.configured,
      connected: false,
      revoked: Boolean(session?.revoked),
      redirectUri: cfg.redirectUri,
      athlete: null,
      scope: null,
      lastSyncedAt: null,
      cooldownRemainingSec: 0,
      rateLimit: null,
    });
  }

  const cache = getAthleteCache(session.athlete.id);
  const cooldownRemainingSec = getManualSyncCooldownRemainingSec(session.athlete.id);

  return NextResponse.json({
    configured: cfg.configured,
    connected: true,
    revoked: false,
    redirectUri: cfg.redirectUri,
    athlete: session.athlete,
    scope: session.scope,
    lastSyncedAt: cache?.lastSyncedAt || session.lastSyncedAt,
    cooldownRemainingSec,
    rateLimit: cache?.rateLimit ?? null,
  });
}

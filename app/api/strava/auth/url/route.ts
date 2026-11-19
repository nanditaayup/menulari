import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { buildStravaAuthorizeUrl, getStravaConfig } from '@/lib/strava/client';
import { setOAuthStateCookie } from '@/lib/strava/session';

export async function GET(req: NextRequest) {
  const cfg = getStravaConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        configured: false,
        redirectUri: cfg.redirectUri,
        error:
          'Kredensial Strava OAuth belum dikonfigurasi (STRAVA_CLIENT_ID & STRAVA_CLIENT_SECRET).',
      },
      { status: 503 }
    );
  }

  const includePrivate = req.nextUrl.searchParams.get('includePrivate') === 'true';
  const state = crypto.randomBytes(24).toString('hex');

  await setOAuthStateCookie({ state, includePrivate });

  const url = buildStravaAuthorizeUrl({
    clientId: cfg.clientId,
    redirectUri: cfg.redirectUri,
    state,
    includePrivate,
  });

  return NextResponse.json({
    configured: true,
    url,
    redirectUri: cfg.redirectUri,
    scope: includePrivate ? 'read,activity:read_all' : 'read,activity:read',
  });
}

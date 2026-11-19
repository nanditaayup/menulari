import {
  mergeActivities,
  normalizeStravaActivity,
  parseRateLimitHeaders,
} from './transform';
import type {
  NormalizedRunningActivity,
  StravaAthleteSummary,
  StravaRateLimitInfo,
  StravaRawActivity,
  StravaSessionData,
  StravaTokenSet,
} from './types';

const STRAVA_AUTH_BASE = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_DEAUTHORIZE_URL = 'https://www.strava.com/oauth/deauthorize';
const STRAVA_API_BASE = 'https://www.strava.com/api/v3';

export interface StravaConfig {
  clientId: string;
  clientSecret: string;
  appUrl: string;
  redirectUri: string;
  configured: boolean;
}

export function getStravaConfig(): StravaConfig {
  const clientId = (process.env.STRAVA_CLIENT_ID || process.env.CLIENT_ID || '').trim();
  const clientSecret = (process.env.STRAVA_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
  const rawAppUrl = (process.env.APP_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');

  const isPlaceholder =
    !clientId ||
    !clientSecret ||
    clientId === 'MY_STRAVA_CLIENT_ID' ||
    clientSecret === 'MY_STRAVA_CLIENT_SECRET';

  return {
    clientId,
    clientSecret,
    appUrl: rawAppUrl,
    redirectUri: `${rawAppUrl}/auth/callback`,
    configured: !isPlaceholder,
  };
}

export function buildStravaAuthorizeUrl(options: {
  clientId: string;
  redirectUri: string;
  state: string;
  includePrivate?: boolean;
}): string {
  const scope = options.includePrivate ? 'read,activity:read_all' : 'read,activity:read';
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope,
    state: options.state,
  });
  return `${STRAVA_AUTH_BASE}?${params.toString()}`;
}

export interface StravaTokenExchangeResult {
  tokens: StravaTokenSet;
  athlete: StravaAthleteSummary;
}

export async function exchangeCodeForStravaTokens(code: string): Promise<StravaTokenExchangeResult> {
  const cfg = getStravaConfig();
  if (!cfg.configured) {
    throw new Error('Strava OAuth credentials are not configured.');
  }

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
    }),
    cache: 'no-store',
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Strava token exchange failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
    athlete: {
      id: number;
      firstname?: string;
      lastname?: string;
      username?: string | null;
      profile?: string | null;
      city?: string | null;
      country?: string | null;
    };
  };

  return {
    tokens: {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      expires_at: json.expires_at,
    },
    athlete: {
      id: json.athlete.id,
      firstname: json.athlete.firstname || 'Atlet',
      lastname: json.athlete.lastname || '',
      username: json.athlete.username ?? null,
      profile: json.athlete.profile ?? null,
      city: json.athlete.city ?? null,
      country: json.athlete.country ?? null,
    },
  };
}

export async function refreshStravaTokensIfNeeded(
  session: StravaSessionData
): Promise<{ session: StravaSessionData; refreshed: boolean }> {
  const nowSec = Math.floor(Date.now() / 1000);
  // Refresh 5 minutes prior to expiration
  if (session.tokens.expires_at > nowSec + 300) {
    return { session, refreshed: false };
  }

  const cfg = getStravaConfig();
  if (!cfg.configured) {
    throw new Error('Strava OAuth credentials are not configured.');
  }

  const res = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: session.tokens.refresh_token,
    }),
    cache: 'no-store',
  });

  if (res.status === 401 || res.status === 400) {
    throw new StravaUnauthorizedError('Sesi Strava telah dicabut atau tidak lagi berlaku.');
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Strava token refresh failed (${res.status}): ${errText}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  };

  return {
    refreshed: true,
    session: {
      ...session,
      tokens: {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: json.expires_at,
      },
    },
  };
}

export async function deauthorizeStravaToken(accessToken: string): Promise<void> {
  try {
    await fetch(STRAVA_DEAUTHORIZE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ access_token: accessToken }).toString(),
      cache: 'no-store',
    });
  } catch {
    // Best-effort revocation; local session is still cleared
  }
}

export class StravaUnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StravaUnauthorizedError';
  }
}

export class StravaRateLimitError extends Error {
  rateLimit: StravaRateLimitInfo | null;
  constructor(message: string, rateLimit: StravaRateLimitInfo | null) {
    super(message);
    this.name = 'StravaRateLimitError';
    this.rateLimit = rateLimit;
  }
}

export interface FetchActivitiesResult {
  activities: NormalizedRunningActivity[];
  rateLimit: StravaRateLimitInfo | null;
  fetchedCount: number;
}

/**
 * Retrieves historical running activities from Strava using pagination.
 * On initial backfill, retrieves up to 90 days (max 4 pages x 50 items = 200 items).
 * On incremental sync, passes `afterEpochSec` so only new activities are fetched.
 */
export async function fetchStravaRunningActivities(options: {
  accessToken: string;
  afterEpochSec?: number | null;
  maxPages?: number;
}): Promise<FetchActivitiesResult> {
  const defaultAfter = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000);
  const after = options.afterEpochSec ?? defaultAfter;
  const maxPages = options.maxPages ?? 4;
  const perPage = 50;

  let collected: NormalizedRunningActivity[] = [];
  let latestRateLimit: StravaRateLimitInfo | null = null;
  let totalRawFetched = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`${STRAVA_API_BASE}/athlete/activities`);
    url.searchParams.set('after', String(after));
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
      },
      cache: 'no-store',
    });

    const parsedLimit = parseRateLimitHeaders(res.headers);
    if (parsedLimit) {
      latestRateLimit = parsedLimit;
    }

    if (res.status === 401) {
      throw new StravaUnauthorizedError('Izin akses Strava dicabut oleh pengguna.');
    }

    if (res.status === 429) {
      throw new StravaRateLimitError(
        'Batas permintaan Strava API tercapai sementara.',
        latestRateLimit
      );
    }

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Strava API error (${res.status}): ${errBody}`);
    }

    const batch = (await res.json()) as StravaRawActivity[];
    totalRawFetched += batch.length;

    const normalizedBatch = batch
      .map(normalizeStravaActivity)
      .filter((item): item is NormalizedRunningActivity => item !== null);

    collected = mergeActivities(collected, normalizedBatch);

    // Stop pagination if fewer than perPage items returned or near rate limit
    if (batch.length < perPage || latestRateLimit?.nearLimit) {
      break;
    }
  }

  return {
    activities: collected,
    rateLimit: latestRateLimit,
    fetchedCount: totalRawFetched,
  };
}

/**
 * Fetches a single activity by ID (used by webhook event ingestion).
 */
export async function fetchSingleStravaActivity(
  accessToken: string,
  activityId: number
): Promise<{ activity: NormalizedRunningActivity | null; rateLimit: StravaRateLimitInfo | null }> {
  const res = await fetch(`${STRAVA_API_BASE}/activities/${activityId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  });

  const rateLimit = parseRateLimitHeaders(res.headers);

  if (res.status === 404) {
    return { activity: null, rateLimit };
  }
  if (res.status === 401) {
    throw new StravaUnauthorizedError('Token Strava tidak berlaku.');
  }
  if (res.status === 429) {
    throw new StravaRateLimitError('Batas permintaan Strava API tercapai.', rateLimit);
  }
  if (!res.ok) {
    throw new Error(`Gagal mengambil detail aktivitas Strava (${res.status})`);
  }

  const raw = (await res.json()) as StravaRawActivity;
  return {
    activity: normalizeStravaActivity(raw),
    rateLimit,
  };
}

import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import type {
  NormalizedRunningActivity,
  StravaRateLimitInfo,
  StravaSessionData,
} from './types';

export const STRAVA_SESSION_COOKIE = 'pacecraft_strava_session';
export const STRAVA_STATE_COOKIE = 'pacecraft_strava_oauth_state';
export const MANUAL_SYNC_COOLDOWN_SEC = 60;
export const AUTO_SYNC_STALE_MS = 15 * 60 * 1000; // 15 minutes

interface CachedAthleteData {
  activities: NormalizedRunningActivity[];
  lastSyncedAt: string | null;
  lastSyncedEpochSec: number | null;
  lastManualRefreshMs: number;
  rateLimit: StravaRateLimitInfo | null;
}

// In-memory store scoped to server process (keyed by Strava athlete ID)
const globalForStravaStore = globalThis as unknown as {
  __stravaActivityStore?: Map<number, CachedAthleteData>;
};

const activityStore =
  globalForStravaStore.__stravaActivityStore ?? new Map<number, CachedAthleteData>();

if (!globalForStravaStore.__stravaActivityStore) {
  globalForStravaStore.__stravaActivityStore = activityStore;
}

function getSigningSecret(): string {
  return (
    process.env.STRAVA_CLIENT_SECRET ||
    process.env.CLIENT_SECRET ||
    process.env.SESSION_SECRET ||
    'pacecraft-local-signing-key-dev-only'
  );
}

function signValue(payloadBase64: string): string {
  return crypto
    .createHmac('sha256', getSigningSecret())
    .update(payloadBase64)
    .digest('base64url');
}

function encodeSignedPayload<T>(data: T): string {
  const payloadBase64 = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const signature = signValue(payloadBase64);
  return `${payloadBase64}.${signature}`;
}

function decodeSignedPayload<T>(cookieValue: string | undefined): T | null {
  if (!cookieValue) return null;
  const dotIdx = cookieValue.indexOf('.');
  if (dotIdx <= 0) return null;

  const payloadBase64 = cookieValue.slice(0, dotIdx);
  const signature = cookieValue.slice(dotIdx + 1);
  const expectedSig = signValue(payloadBase64);

  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const json = Buffer.from(payloadBase64, 'base64url').toString('utf8');
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Cookie attributes required by AI Studio iframe preview context.
 */
export function getIframeCookieOptions(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none' as const,
    path: '/',
    maxAge: maxAgeSec,
  };
}

export async function getStravaSession(): Promise<StravaSessionData | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STRAVA_SESSION_COOKIE)?.value;
  return decodeSignedPayload<StravaSessionData>(raw);
}

export async function setStravaSessionCookie(session: StravaSessionData): Promise<void> {
  const cookieStore = await cookies();
  const encoded = encodeSignedPayload(session);
  cookieStore.set(STRAVA_SESSION_COOKIE, encoded, getIframeCookieOptions(60 * 60 * 24 * 30));
}

export async function clearStravaSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(STRAVA_SESSION_COOKIE, '', getIframeCookieOptions(0));
}

export async function setOAuthStateCookie(statePayload: {
  state: string;
  includePrivate: boolean;
}): Promise<void> {
  const cookieStore = await cookies();
  const encoded = encodeSignedPayload(statePayload);
  cookieStore.set(STRAVA_STATE_COOKIE, encoded, getIframeCookieOptions(60 * 10));
}

export async function consumeOAuthStateCookie(): Promise<{
  state: string;
  includePrivate: boolean;
} | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(STRAVA_STATE_COOKIE)?.value;
  cookieStore.set(STRAVA_STATE_COOKIE, '', getIframeCookieOptions(0));
  return decodeSignedPayload<{ state: string; includePrivate: boolean }>(raw);
}

export function getAthleteCache(athleteId: number): CachedAthleteData | null {
  return activityStore.get(athleteId) ?? null;
}

export function setAthleteCache(athleteId: number, data: CachedAthleteData): void {
  activityStore.set(athleteId, data);
}

export function removeActivityFromAthleteCache(athleteId: number, activityId: number): void {
  const existing = activityStore.get(athleteId);
  if (!existing) return;
  existing.activities = existing.activities.filter((act) => act.id !== activityId);
  activityStore.set(athleteId, existing);
}

export function clearAthleteCache(athleteId: number): void {
  activityStore.delete(athleteId);
}

export function getManualSyncCooldownRemainingSec(athleteId: number, nowMs = Date.now()): number {
  const cache = activityStore.get(athleteId);
  if (!cache || !cache.lastManualRefreshMs) return 0;
  const elapsedSec = Math.floor((nowMs - cache.lastManualRefreshMs) / 1000);
  return Math.max(0, MANUAL_SYNC_COOLDOWN_SEC - elapsedSec);
}

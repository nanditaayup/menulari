import { NextRequest, NextResponse } from 'next/server';
import {
  fetchStravaRunningActivities,
  refreshStravaTokensIfNeeded,
  StravaRateLimitError,
  StravaUnauthorizedError,
} from '@/lib/strava/client';
import { getDemoActivitiesResponse } from '@/lib/strava/demo-data';
import {
  AUTO_SYNC_STALE_MS,
  getAthleteCache,
  getManualSyncCooldownRemainingSec,
  getStravaSession,
  setAthleteCache,
  setStravaSessionCookie,
} from '@/lib/strava/session';
import { computeRunningSummary, mergeActivities } from '@/lib/strava/transform';
import type {
  NormalizedRunningActivity,
  StravaActivitiesResponse,
} from '@/lib/strava/types';

function applyFilters(
  activities: NormalizedRunningActivity[],
  daysParam: string | null,
  sportTypeParam: string | null
): NormalizedRunningActivity[] {
  const days = daysParam ? Number(daysParam) : 90;
  const validDays = Number.isFinite(days) && days > 0 ? days : 90;
  const cutoffMs = Date.now() - validDays * 24 * 60 * 60 * 1000;

  return activities.filter((act) => {
    const actMs = Date.parse(act.startDateUtc);
    if (!Number.isNaN(actMs) && actMs < cutoffMs) {
      return false;
    }
    if (sportTypeParam && sportTypeParam !== 'all' && act.sportType !== sportTypeParam) {
      return false;
    }
    return true;
  });
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const isDemo = searchParams.get('demo') === '1' || searchParams.get('demo') === 'true';
  const forceRefresh = searchParams.get('refresh') === 'true';
  const daysParam = searchParams.get('days');
  const sportTypeParam = searchParams.get('sportType');

  if (isDemo) {
    const demo = getDemoActivitiesResponse();
    const filtered = applyFilters(demo.activities, daysParam, sportTypeParam);
    const payload: StravaActivitiesResponse = {
      ...demo,
      activities: filtered,
    };
    return NextResponse.json(payload);
  }

  const session = await getStravaSession();
  if (!session || session.revoked) {
    return NextResponse.json(
      { error: 'Akun Strava belum terhubung.', connected: false },
      { status: 401 }
    );
  }

  const athleteId = session.athlete.id;
  const existingCache = getAthleteCache(athleteId);
  const nowMs = Date.now();
  const cooldownRemainingSec = getManualSyncCooldownRemainingSec(athleteId, nowMs);

  const lastSyncedMs = existingCache?.lastSyncedAt
    ? Date.parse(existingCache.lastSyncedAt)
    : 0;
  const isStale = !existingCache || nowMs - lastSyncedMs > AUTO_SYNC_STALE_MS;

  // Enforce 60s manual sync cooldown when cached data already exists
  if (forceRefresh && existingCache && cooldownRemainingSec > 0) {
    const filtered = applyFilters(existingCache.activities, daysParam, sportTypeParam);
    const payload: StravaActivitiesResponse = {
      source: 'cache',
      syncedAt: existingCache.lastSyncedAt,
      cooldownRemainingSec,
      rateLimit: existingCache.rateLimit,
      warning: `Tunggu ${cooldownRemainingSec} detik sebelum menyinkronkan ulang.`,
      activities: filtered,
      summary: computeRunningSummary(existingCache.activities),
    };
    return NextResponse.json(payload);
  }

  const shouldFetchFromStrava = forceRefresh || isStale;

  if (!shouldFetchFromStrava && existingCache) {
    const filtered = applyFilters(existingCache.activities, daysParam, sportTypeParam);
    const payload: StravaActivitiesResponse = {
      source: 'cache',
      syncedAt: existingCache.lastSyncedAt,
      cooldownRemainingSec,
      rateLimit: existingCache.rateLimit,
      warning: null,
      activities: filtered,
      summary: computeRunningSummary(existingCache.activities),
    };
    return NextResponse.json(payload);
  }

  try {
    const { session: activeSession, refreshed } = await refreshStravaTokensIfNeeded(session);

    // Incremental fetch using last synced epoch (minus 5-min safety overlap), or 90-day initial backfill
    const afterEpochSec = existingCache?.lastSyncedEpochSec
      ? Math.max(0, existingCache.lastSyncedEpochSec - 300)
      : null;

    const fetched = await fetchStravaRunningActivities({
      accessToken: activeSession.tokens.access_token,
      afterEpochSec,
      maxPages: afterEpochSec ? 2 : 4,
    });

    const merged = mergeActivities(existingCache?.activities ?? [], fetched.activities);
    const syncedAtIso = new Date().toISOString();
    const newestEpochSec =
      merged.length > 0
        ? Math.floor(Date.parse(merged[0].startDateUtc) / 1000)
        : Math.floor(Date.now() / 1000);

    const nextCache = {
      activities: merged,
      lastSyncedAt: syncedAtIso,
      lastSyncedEpochSec: newestEpochSec,
      lastManualRefreshMs: forceRefresh
        ? Date.now()
        : existingCache?.lastManualRefreshMs ?? 0,
      rateLimit: fetched.rateLimit ?? existingCache?.rateLimit ?? null,
    };

    setAthleteCache(athleteId, nextCache);

    if (refreshed || !activeSession.lastSyncedAt) {
      await setStravaSessionCookie({
        ...activeSession,
        lastSyncedAt: syncedAtIso,
      });
    }

    const filtered = applyFilters(merged, daysParam, sportTypeParam);
    const payload: StravaActivitiesResponse = {
      source: 'strava',
      syncedAt: syncedAtIso,
      cooldownRemainingSec: forceRefresh ? 60 : 0,
      rateLimit: nextCache.rateLimit,
      warning: nextCache.rateLimit?.nearLimit
        ? 'Penggunaan kuota Strava API mendekati batas 15 menit. Sinkronisasi otomatis dijeda sementara.'
        : null,
      activities: filtered,
      summary: computeRunningSummary(merged),
    };

    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof StravaUnauthorizedError) {
      await setStravaSessionCookie({
        ...session,
        revoked: true,
      });
      return NextResponse.json(
        {
          error: err.message,
          revoked: true,
          connected: false,
        },
        { status: 401 }
      );
    }

    if (err instanceof StravaRateLimitError && existingCache) {
      const filtered = applyFilters(existingCache.activities, daysParam, sportTypeParam);
      const payload: StravaActivitiesResponse = {
        source: 'cache',
        syncedAt: existingCache.lastSyncedAt,
        cooldownRemainingSec,
        rateLimit: err.rateLimit ?? existingCache.rateLimit,
        warning:
          'Batas permintaan Strava API tercapai sementara. Menampilkan data tersimpan terakhir.',
        activities: filtered,
        summary: computeRunningSummary(existingCache.activities),
      };
      return NextResponse.json(payload);
    }

    if (existingCache) {
      const filtered = applyFilters(existingCache.activities, daysParam, sportTypeParam);
      const payload: StravaActivitiesResponse = {
        source: 'cache',
        syncedAt: existingCache.lastSyncedAt,
        cooldownRemainingSec,
        rateLimit: existingCache.rateLimit,
        warning: 'Gagal menghubungi Strava. Menampilkan data tersimpan terakhir.',
        activities: filtered,
        summary: computeRunningSummary(existingCache.activities),
      };
      return NextResponse.json(payload);
    }

    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Gagal mengambil riwayat aktivitas lari dari Strava.',
      },
      { status: 502 }
    );
  }
}

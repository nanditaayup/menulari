import type {
  NormalizedRunningActivity,
  RunningSportType,
  RunningSummaryStats,
  StravaRateLimitInfo,
  StravaRawActivity,
  WeeklyVolumePoint,
} from './types';

const RUNNING_TYPES = new Set<string>(['Run', 'TrailRun', 'VirtualRun']);

export function resolveRunningSportType(raw: Pick<StravaRawActivity, 'sport_type' | 'type'>): RunningSportType | null {
  const candidate = raw.sport_type || raw.type || '';
  if (RUNNING_TYPES.has(candidate)) {
    return candidate as RunningSportType;
  }
  return null;
}

export function isRunningActivity(raw: Pick<StravaRawActivity, 'sport_type' | 'type'>): boolean {
  return resolveRunningSportType(raw) !== null;
}

export function getSportLabel(sportType: RunningSportType): string {
  switch (sportType) {
    case 'TrailRun':
      return 'Trail';
    case 'VirtualRun':
      return 'Virtual / Treadmill';
    case 'Run':
    default:
      return 'Jalan Raya';
  }
}

export function metersToKm(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  return Number((meters / 1000).toFixed(2));
}

export function mpsToKmh(mps: number): number {
  if (!Number.isFinite(mps) || mps <= 0) return 0;
  return Number((mps * 3.6).toFixed(1));
}

export function mpsToPaceSecPerKm(mps: number): number | null {
  if (!Number.isFinite(mps) || mps <= 0) return null;
  return Math.round(1000 / mps);
}

export function formatPace(paceSecPerKm: number | null): string {
  if (paceSecPerKm === null || !Number.isFinite(paceSecPerKm) || paceSecPerKm <= 0) {
    return '-';
  }
  const rounded = Math.round(paceSecPerKm);
  const mins = Math.floor(rounded / 60);
  const secs = rounded % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}/km`;
}

export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) {
    return '00:00';
  }
  const whole = Math.round(totalSeconds);
  const hours = Math.floor(whole / 3600);
  const mins = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function normalizeStravaActivity(raw: StravaRawActivity): NormalizedRunningActivity | null {
  const sportType = resolveRunningSportType(raw);
  if (!sportType) return null;

  const distanceKm = metersToKm(raw.distance);
  const movingTimeSec = Math.max(0, Math.round(raw.moving_time || 0));
  const elapsedTimeSec = Math.max(movingTimeSec, Math.round(raw.elapsed_time || 0));
  const avgSpeed = raw.average_speed > 0
    ? raw.average_speed
    : raw.distance > 0 && movingTimeSec > 0
      ? raw.distance / movingTimeSec
      : 0;

  const paceSecPerKm = distanceKm > 0 ? mpsToPaceSecPerKm(avgSpeed) : null;
  const rawPolyline = raw.map?.summary_polyline || raw.map?.polyline || null;
  const summaryPolyline = rawPolyline && rawPolyline.trim().length > 0 ? rawPolyline.trim() : null;

  const hasHr = Boolean(raw.has_heartrate && raw.average_heartrate && raw.average_heartrate > 0);

  return {
    id: raw.id,
    name: raw.name && raw.name.trim().length > 0 ? raw.name.trim() : 'Lari Tanpa Judul',
    sportType,
    sportLabel: getSportLabel(sportType),
    startDateUtc: raw.start_date,
    startDateLocal: raw.start_date_local || raw.start_date,
    distanceKm,
    movingTimeSec,
    elapsedTimeSec,
    formattedDuration: formatDuration(movingTimeSec),
    formattedElapsedTime: formatDuration(elapsedTimeSec),
    averageSpeedKmh: mpsToKmh(avgSpeed),
    maxSpeedKmh: mpsToKmh(raw.max_speed || 0),
    paceSecPerKm,
    formattedPace: formatPace(paceSecPerKm),
    elevationGainM: Math.max(0, Math.round(raw.total_elevation_gain || 0)),
    summaryPolyline,
    averageHeartrate: hasHr && raw.average_heartrate ? Math.round(raw.average_heartrate) : null,
    maxHeartrate: hasHr && raw.max_heartrate ? Math.round(raw.max_heartrate) : null,
    isPrivate: Boolean(raw.private),
    isIndoor: Boolean(raw.trainer || sportType === 'VirtualRun' || !summaryPolyline),
  };
}

/**
 * Merges incoming activities with existing cached activities using strava_activity_id deduplication.
 * Sorted newest-first by startDateUtc.
 */
export function mergeActivities(
  existing: NormalizedRunningActivity[],
  incoming: NormalizedRunningActivity[]
): NormalizedRunningActivity[] {
  const byId = new Map<number, NormalizedRunningActivity>();
  for (const item of existing) {
    byId.set(item.id, item);
  }
  for (const item of incoming) {
    byId.set(item.id, item);
  }
  return Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.startDateUtc) - Date.parse(a.startDateUtc)
  );
}

/**
 * Computes Monday-start UTC week key for consistent weekly grouping.
 */
function getWeekStartDate(dateInput: Date): Date {
  const d = new Date(Date.UTC(dateInput.getUTCFullYear(), dateInput.getUTCMonth(), dateInput.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return d;
}

function formatWeekLabel(weekStart: Date): string {
  const day = weekStart.getUTCDate();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${day} ${months[weekStart.getUTCMonth()]}`;
}

export function computeRunningSummary(
  activities: NormalizedRunningActivity[],
  referenceNow: Date = new Date()
): RunningSummaryStats {
  const nowMs = referenceNow.getTime();
  const thirtyDaysAgoMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  const twentyEightDaysAgoMs = nowMs - 28 * 24 * 60 * 60 * 1000;

  let thirtyDayTotalKm = 0;
  let thirtyDayRunCount = 0;
  let thirtyDayTotalTimeSec = 0;
  let twentyEightDayTotalKm = 0;
  let longestRunKm = 0;

  for (const act of activities) {
    const actMs = Date.parse(act.startDateUtc);
    if (Number.isNaN(actMs) || actMs > nowMs + 86400000) continue;

    if (actMs >= thirtyDaysAgoMs) {
      thirtyDayTotalKm += act.distanceKm;
      thirtyDayRunCount += 1;
      thirtyDayTotalTimeSec += act.movingTimeSec;
      if (act.distanceKm > longestRunKm) {
        longestRunKm = act.distanceKm;
      }
    }
    if (actMs >= twentyEightDaysAgoMs) {
      twentyEightDayTotalKm += act.distanceKm;
    }
  }

  thirtyDayTotalKm = Number(thirtyDayTotalKm.toFixed(2));
  const fourWeekAvgKm = Number((twentyEightDayTotalKm / 4).toFixed(1));

  let avgPaceSecPerKm: number | null = null;
  let avgSpeedKmh = 0;

  if (thirtyDayTotalKm > 0 && thirtyDayTotalTimeSec > 0) {
    avgPaceSecPerKm = Math.round(thirtyDayTotalTimeSec / thirtyDayTotalKm);
    avgSpeedKmh = Number(((thirtyDayTotalKm / thirtyDayTotalTimeSec) * 3600).toFixed(1));
  }

  // Build 8-week series ending on current week
  const currentWeekStart = getWeekStartDate(referenceNow);
  const weekBuckets = new Map<string, { distance: number; count: number; date: Date }>();

  for (let i = 7; i >= 0; i--) {
    const w = new Date(currentWeekStart);
    w.setUTCDate(w.getUTCDate() - i * 7);
    const key = w.toISOString().slice(0, 10);
    weekBuckets.set(key, { distance: 0, count: 0, date: w });
  }

  for (const act of activities) {
    const actDate = new Date(act.startDateUtc);
    if (Number.isNaN(actDate.getTime())) continue;
    const wStart = getWeekStartDate(actDate);
    const key = wStart.toISOString().slice(0, 10);
    const bucket = weekBuckets.get(key);
    if (bucket) {
      bucket.distance += act.distanceKm;
      bucket.count += 1;
    }
  }

  const weeklySeries: WeeklyVolumePoint[] = Array.from(weekBuckets.entries()).map(([iso, data]) => ({
    weekStartIso: iso,
    weekLabel: formatWeekLabel(data.date),
    totalDistanceKm: Number(data.distance.toFixed(1)),
    runCount: data.count,
  }));

  return {
    fourWeekAvgKm,
    thirtyDayTotalKm,
    thirtyDayRunCount,
    thirtyDayTotalTimeSec,
    avgPaceSecPerKm,
    formattedAvgPace: formatPace(avgPaceSecPerKm),
    avgSpeedKmh,
    longestRunKm: Number(longestRunKm.toFixed(2)),
    weeklySeries,
  };
}

export function parseRateLimitHeaders(headers: Headers): StravaRateLimitInfo | null {
  const usageRaw = headers.get('x-ratelimit-usage') || headers.get('X-RateLimit-Usage');
  const limitRaw = headers.get('x-ratelimit-limit') || headers.get('X-RateLimit-Limit');
  if (!usageRaw || !limitRaw) return null;

  const [shortUsageStr, dailyUsageStr] = usageRaw.split(',');
  const [shortLimitStr, dailyLimitStr] = limitRaw.split(',');

  const shortTermUsage = Number(shortUsageStr?.trim() || 0);
  const dailyUsage = Number(dailyUsageStr?.trim() || 0);
  const shortTermLimit = Number(shortLimitStr?.trim() || 100);
  const dailyLimit = Number(dailyLimitStr?.trim() || 1000);

  if (!Number.isFinite(shortTermUsage) || !Number.isFinite(shortTermLimit) || shortTermLimit <= 0) {
    return null;
  }

  const shortRatio = shortTermUsage / shortTermLimit;
  const dailyRatio = dailyLimit > 0 ? dailyUsage / dailyLimit : 0;

  return {
    shortTermUsage,
    shortTermLimit,
    dailyUsage,
    dailyLimit,
    nearLimit: shortRatio >= 0.85 || dailyRatio >= 0.85,
    exceeded: shortTermUsage >= shortTermLimit || (dailyLimit > 0 && dailyUsage >= dailyLimit),
  };
}

export type RunningSportType = 'Run' | 'TrailRun' | 'VirtualRun';

export interface StravaAthleteSummary {
  id: number;
  firstname: string;
  lastname: string;
  username?: string | null;
  profile?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface StravaTokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // Unix timestamp in seconds
}

export interface StravaSessionData {
  athlete: StravaAthleteSummary;
  tokens: StravaTokenSet;
  scope: string;
  lastSyncedAt: string | null;
  revoked?: boolean;
}

export interface StravaRawActivity {
  id: number;
  name: string;
  type?: string;
  sport_type?: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain?: number; // meters
  start_date: string; // ISO UTC
  start_date_local: string; // ISO local
  average_speed: number; // m/s
  max_speed?: number; // m/s
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  map?: {
    id?: string;
    summary_polyline?: string | null;
    polyline?: string | null;
  } | null;
  private?: boolean;
  trainer?: boolean;
}

export interface NormalizedRunningActivity {
  id: number;
  name: string;
  sportType: RunningSportType;
  sportLabel: string;
  startDateUtc: string;
  startDateLocal: string;
  distanceKm: number;
  movingTimeSec: number;
  elapsedTimeSec: number;
  formattedDuration: string;
  formattedElapsedTime: string;
  averageSpeedKmh: number;
  maxSpeedKmh: number;
  paceSecPerKm: number | null;
  formattedPace: string;
  elevationGainM: number;
  summaryPolyline: string | null;
  averageHeartrate: number | null;
  maxHeartrate: number | null;
  isPrivate: boolean;
  isIndoor: boolean;
}

export interface WeeklyVolumePoint {
  weekStartIso: string;
  weekLabel: string;
  totalDistanceKm: number;
  runCount: number;
}

export interface RunningSummaryStats {
  fourWeekAvgKm: number;
  thirtyDayTotalKm: number;
  thirtyDayRunCount: number;
  thirtyDayTotalTimeSec: number;
  avgPaceSecPerKm: number | null;
  formattedAvgPace: string;
  avgSpeedKmh: number;
  longestRunKm: number;
  weeklySeries: WeeklyVolumePoint[];
}

export interface StravaRateLimitInfo {
  shortTermUsage: number;
  shortTermLimit: number;
  dailyUsage: number;
  dailyLimit: number;
  nearLimit: boolean;
  exceeded: boolean;
}

export interface StravaActivitiesResponse {
  source: 'strava' | 'cache' | 'demo';
  syncedAt: string | null;
  cooldownRemainingSec: number;
  rateLimit: StravaRateLimitInfo | null;
  warning: string | null;
  activities: NormalizedRunningActivity[];
  summary: RunningSummaryStats;
}

import { normalizeStravaActivity, computeRunningSummary } from './transform';
import type { NormalizedRunningActivity, StravaActivitiesResponse, StravaRawActivity } from './types';

// Realistic encoded polylines representing park/city running loops
const LOOP_POLYLINE_A =
  '~f`e@m`nhT}@wB}@oBs@{Bm@gCk@yCi@qD_@_EOaES}DM_EEwCBgDVmD~@sD|AaDtByBxBeArB_@zBFhCj@zBxAdBjBlAzBn@jC\\`DFnDRbEHnDC~C]nCy@rByAhBoB~@mCl@{Cf@gDV_E';
const LOOP_POLYLINE_B =
  'pf`e@kanhTgAkDq@_E]eEJ_E`AwDfBkChCiBdC_ApCRpCjAdBxBv@bDd@zDRfD[|CcAzB}AhBsBz@mC';
const TRAIL_POLYLINE =
  'tf`e@wanhTq@mB_AeB}AwAgBqAgBm@oBy@_BeAaAwAm@qBe@oCi@gD\\eD`AgDjBeCdCyAxBa@zB\\jClAvAbCv@`Df@xCEtCi@tB}ArAiCj@{Cf@';

const RAW_DEMO_RUNS: StravaRawActivity[] = [
  {
    id: 9001001,
    name: 'Long Run Minggu Pagi — Senayan Loop',
    sport_type: 'Run',
    distance: 16200,
    moving_time: 5832, // 06:00/km
    elapsed_time: 5980,
    total_elevation_gain: 68,
    start_date: '2026-11-15T23:00:00Z',
    start_date_local: '2026-11-16T06:00:00Z',
    average_speed: 2.7778,
    max_speed: 3.65,
    has_heartrate: true,
    average_heartrate: 148,
    max_heartrate: 164,
    map: { summary_polyline: LOOP_POLYLINE_A },
    private: false,
  },
  {
    id: 9001002,
    name: 'Tempo Threshold 8K',
    sport_type: 'Run',
    distance: 8100,
    moving_time: 2430, // 05:00/km
    elapsed_time: 2475,
    total_elevation_gain: 32,
    start_date: '2026-11-13T10:30:00Z',
    start_date_local: '2026-11-13T17:30:00Z',
    average_speed: 3.3333,
    max_speed: 4.15,
    has_heartrate: true,
    average_heartrate: 168,
    max_heartrate: 181,
    map: { summary_polyline: LOOP_POLYLINE_B },
    private: false,
  },
  {
    id: 9001003,
    name: 'Recovery Treadmill 5K',
    sport_type: 'VirtualRun',
    distance: 5000,
    moving_time: 1920, // 06:24/km
    elapsed_time: 1920,
    total_elevation_gain: 0,
    start_date: '2026-11-11T12:00:00Z',
    start_date_local: '2026-11-11T19:00:00Z',
    average_speed: 2.6042,
    max_speed: 2.95,
    has_heartrate: true,
    average_heartrate: 136,
    max_heartrate: 145,
    map: { summary_polyline: '' },
    trainer: true,
    private: false,
  },
  {
    id: 9001004,
    name: 'Sentul Hill Trail Easy',
    sport_type: 'TrailRun',
    distance: 11400,
    moving_time: 4902, // 07:10/km
    elapsed_time: 5210,
    total_elevation_gain: 345,
    start_date: '2026-11-08T23:15:00Z',
    start_date_local: '2026-11-09T06:15:00Z',
    average_speed: 2.3256,
    max_speed: 3.4,
    has_heartrate: true,
    average_heartrate: 155,
    max_heartrate: 176,
    map: { summary_polyline: TRAIL_POLYLINE },
    private: false,
  },
  {
    id: 9001005,
    name: 'Interval 6x800m Track',
    sport_type: 'Run',
    distance: 9200,
    moving_time: 2944, // 05:20/km
    elapsed_time: 3320,
    total_elevation_gain: 18,
    start_date: '2026-11-05T23:00:00Z',
    start_date_local: '2026-11-06T06:00:00Z',
    average_speed: 3.125,
    max_speed: 4.75,
    has_heartrate: true,
    average_heartrate: 162,
    max_heartrate: 186,
    map: { summary_polyline: LOOP_POLYLINE_B },
    private: false,
  },
  {
    id: 9001006,
    name: 'Easy Shakeout 6K',
    sport_type: 'Run',
    distance: 6100,
    moving_time: 2257, // 06:10/km
    elapsed_time: 2290,
    total_elevation_gain: 24,
    start_date: '2026-10-31T23:30:00Z',
    start_date_local: '2026-11-01T06:30:00Z',
    average_speed: 2.7027,
    max_speed: 3.2,
    has_heartrate: false,
    map: { summary_polyline: LOOP_POLYLINE_A },
    private: false,
  },
  {
    id: 9001007,
    name: 'Long Run Akhir Pekan 14K',
    sport_type: 'Run',
    distance: 14100,
    moving_time: 5146, // 06:05/km
    elapsed_time: 5280,
    total_elevation_gain: 54,
    start_date: '2026-10-25T23:00:00Z',
    start_date_local: '2026-10-26T06:00:00Z',
    average_speed: 2.74,
    max_speed: 3.55,
    has_heartrate: true,
    average_heartrate: 149,
    max_heartrate: 165,
    map: { summary_polyline: LOOP_POLYLINE_A },
    private: false,
  },
  {
    id: 9001008,
    name: 'Midweek Aerobic 10K',
    sport_type: 'Run',
    distance: 10050,
    moving_time: 3618, // 06:00/km
    elapsed_time: 3690,
    total_elevation_gain: 42,
    start_date: '2026-10-21T10:45:00Z',
    start_date_local: '2026-10-21T17:45:00Z',
    average_speed: 2.7778,
    max_speed: 3.4,
    has_heartrate: true,
    average_heartrate: 146,
    max_heartrate: 159,
    map: { summary_polyline: LOOP_POLYLINE_B },
    private: false,
  },
];

export function getDemoActivitiesResponse(referenceNow: Date = new Date('2026-11-19T08:00:00Z')): StravaActivitiesResponse {
  const activities = RAW_DEMO_RUNS.map(normalizeStravaActivity).filter(
    (item): item is NormalizedRunningActivity => item !== null
  );

  return {
    source: 'demo',
    syncedAt: referenceNow.toISOString(),
    cooldownRemainingSec: 0,
    rateLimit: null,
    warning: 'Menampilkan data contoh untuk pratinjau antarmuka sebelum menghubungkan akun Strava.',
    activities,
    summary: computeRunningSummary(activities, referenceNow),
  };
}

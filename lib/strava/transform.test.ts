import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, polylineToSvgGeometry } from './polyline';
import {
  computeRunningSummary,
  formatDuration,
  formatPace,
  isRunningActivity,
  mergeActivities,
  normalizeStravaActivity,
  parseRateLimitHeaders,
} from './transform';
import type { StravaRawActivity } from './types';

test('isRunningActivity filters strictly to Run, TrailRun, and VirtualRun', () => {
  assert.equal(isRunningActivity({ sport_type: 'Run' }), true);
  assert.equal(isRunningActivity({ sport_type: 'TrailRun' }), true);
  assert.equal(isRunningActivity({ type: 'VirtualRun' }), true);
  assert.equal(isRunningActivity({ sport_type: 'Ride' }), false);
  assert.equal(isRunningActivity({ sport_type: 'Swim' }), false);
  assert.equal(isRunningActivity({ type: 'Walk' }), false);
});

test('normalizeStravaActivity accurately converts distance, duration, speed, and pace', () => {
  const raw: StravaRawActivity = {
    id: 1001,
    name: 'Morning Tempo 10K',
    sport_type: 'Run',
    distance: 10000,
    moving_time: 3300,
    elapsed_time: 3360,
    total_elevation_gain: 84.6,
    start_date: '2026-11-18T00:15:00Z',
    start_date_local: '2026-11-18T07:15:00Z',
    average_speed: 3.030303,
    max_speed: 4.2,
    has_heartrate: true,
    average_heartrate: 158.4,
    max_heartrate: 174.9,
    map: {
      summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@',
    },
  };

  const normalized = normalizeStravaActivity(raw);
  assert.ok(normalized);
  assert.equal(normalized.distanceKm, 10);
  assert.equal(normalized.formattedDuration, '55:00');
  assert.equal(normalized.formattedElapsedTime, '56:00');
  assert.equal(normalized.averageSpeedKmh, 10.9);
  assert.equal(normalized.maxSpeedKmh, 15.1);
  assert.equal(normalized.paceSecPerKm, 330);
  assert.equal(normalized.formattedPace, '05:30/km');
  assert.equal(normalized.elevationGainM, 85);
  assert.equal(normalized.averageHeartrate, 158);
  assert.equal(normalized.maxHeartrate, 175);
  assert.equal(normalized.isIndoor, false);
});

test('normalizeStravaActivity handles zero speed and missing polyline safely', () => {
  const raw: StravaRawActivity = {
    id: 1002,
    name: '',
    sport_type: 'VirtualRun',
    distance: 5000,
    moving_time: 1800,
    elapsed_time: 1800,
    start_date: '2026-11-17T06:00:00Z',
    start_date_local: '2026-11-17T06:00:00Z',
    average_speed: 0,
    has_heartrate: false,
    map: { summary_polyline: '' },
  };

  const normalized = normalizeStravaActivity(raw);
  assert.ok(normalized);
  assert.equal(normalized.name, 'Lari Tanpa Judul');
  assert.equal(normalized.isIndoor, true);
  assert.equal(normalized.summaryPolyline, null);
  assert.equal(normalized.averageHeartrate, null);
  // Falls back to distance / moving_time = 5000 / 1800 = 2.7778 m/s -> 360 s/km = 06:00/km
  assert.equal(normalized.formattedPace, '06:00/km');

  assert.equal(formatPace(null), '-');
  assert.equal(formatPace(0), '-');
  assert.equal(formatDuration(3665), '1:01:05');
});

test('decodePolyline and polylineToSvgGeometry produce bounded SVG path', () => {
  const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
  const points = decodePolyline(encoded);
  assert.equal(points.length, 3);
  assert.ok(Math.abs(points[0].lat - 38.5) < 0.001);
  assert.ok(Math.abs(points[0].lng - -120.2) < 0.001);

  const svg = polylineToSvgGeometry(encoded, 160, 96, 10);
  assert.equal(svg.pointCount, 3);
  assert.ok(svg.pathData.startsWith('M'));
  assert.ok(svg.startPoint);
  assert.ok(svg.endPoint);

  const emptySvg = polylineToSvgGeometry(null);
  assert.equal(emptySvg.pointCount, 0);
  assert.equal(emptySvg.pathData, '');
});

test('mergeActivities deduplicates by id and sorts newest-first', () => {
  const older = normalizeStravaActivity({
    id: 1,
    name: 'Old Run',
    sport_type: 'Run',
    distance: 5000,
    moving_time: 1500,
    elapsed_time: 1500,
    start_date: '2026-11-10T06:00:00Z',
    start_date_local: '2026-11-10T06:00:00Z',
    average_speed: 3.33,
  })!;
  const newer = normalizeStravaActivity({
    id: 2,
    name: 'New Run',
    sport_type: 'Run',
    distance: 8000,
    moving_time: 2400,
    elapsed_time: 2400,
    start_date: '2026-11-18T06:00:00Z',
    start_date_local: '2026-11-18T06:00:00Z',
    average_speed: 3.33,
  })!;
  const updatedOlder = { ...older, name: 'Renamed Old Run' };

  const merged = mergeActivities([older], [newer, updatedOlder]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].id, 2);
  assert.equal(merged[1].name, 'Renamed Old Run');
});

test('computeRunningSummary computes 4-week average and 8-week series accurately', () => {
  const now = new Date('2026-11-19T10:00:00Z');
  const runs = [
    normalizeStravaActivity({
      id: 11,
      name: 'Run A',
      sport_type: 'Run',
      distance: 10000,
      moving_time: 3000,
      elapsed_time: 3000,
      start_date: '2026-11-18T06:00:00Z',
      start_date_local: '2026-11-18T06:00:00Z',
      average_speed: 3.3333,
    })!,
    normalizeStravaActivity({
      id: 12,
      name: 'Run B',
      sport_type: 'TrailRun',
      distance: 12000,
      moving_time: 4200,
      elapsed_time: 4300,
      start_date: '2026-11-11T06:00:00Z',
      start_date_local: '2026-11-11T06:00:00Z',
      average_speed: 2.857,
    })!,
  ];

  const summary = computeRunningSummary(runs, now);
  assert.equal(summary.thirtyDayTotalKm, 22);
  assert.equal(summary.thirtyDayRunCount, 2);
  assert.equal(summary.fourWeekAvgKm, 5.5);
  assert.equal(summary.longestRunKm, 12);
  assert.equal(summary.weeklySeries.length, 8);
});

test('parseRateLimitHeaders flags near-limit and exceeded states', () => {
  const nearHeaders = new Headers({
    'X-RateLimit-Usage': '86, 250',
    'X-RateLimit-Limit': '100, 1000',
  });
  const near = parseRateLimitHeaders(nearHeaders);
  assert.ok(near);
  assert.equal(near.nearLimit, true);
  assert.equal(near.exceeded, false);

  const exceededHeaders = new Headers({
    'X-RateLimit-Usage': '100, 250',
    'X-RateLimit-Limit': '100, 1000',
  });
  const exceeded = parseRateLimitHeaders(exceededHeaders);
  assert.ok(exceeded);
  assert.equal(exceeded.exceeded, true);
});

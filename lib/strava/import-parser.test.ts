import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline } from './polyline';
import {
  encodePolyline,
  parseCsvRows,
  parseGpxActivity,
  parseStravaActivitiesCsv,
  SAMPLE_STRAVA_CSV,
} from './import-parser';

test('parseCsvRows handles quoted strings with embedded commas', () => {
  const csv = `Activity ID,Activity Name,Activity Type,Distance\n1,"Morning Run, Senayan",Run,10.5`;
  const rows = parseCsvRows(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'Morning Run, Senayan');
});

test('parseStravaActivitiesCsv filters running types and converts sample Strava export', () => {
  const result = parseStravaActivitiesCsv(SAMPLE_STRAVA_CSV);
  assert.equal(result.activities.length, 4);
  assert.equal(result.skippedNonRunning, 1); // Ride skipped
  assert.equal(result.skippedInvalid, 0);

  const first = result.activities[0];
  assert.equal(first.id, 120948101);
  assert.equal(first.name, 'Long Run Minggu Pagi — GBK');
  assert.equal(first.distanceKm, 16.2);
  assert.equal(first.formattedPace, '06:00/km');
  assert.equal(first.averageHeartrate, 148);
});

test('parseStravaActivitiesCsv handles duplicate Distance columns (km + meters)', () => {
  const csvWithDupCols = [
    'Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Distance,Elevation Gain',
    '555,"Nov 18, 2026, 6:00:00 AM","10K Pagi",Run,3360,10.00,3300,10000,45',
  ].join('\n');

  const result = parseStravaActivitiesCsv(csvWithDupCols);
  assert.equal(result.activities.length, 1);
  assert.equal(result.activities[0].distanceKm, 10);
  assert.equal(result.activities[0].formattedPace, '05:30/km');
  assert.equal(result.activities[0].elevationGainM, 45);
});

test('encodePolyline round-trips cleanly with decodePolyline', () => {
  const original = [
    { lat: -6.2185, lng: 106.8024 },
    { lat: -6.2195, lng: 106.8042 },
    { lat: -6.221, lng: 106.8058 },
  ];
  const encoded = encodePolyline(original);
  const decoded = decodePolyline(encoded);
  assert.equal(decoded.length, 3);
  assert.ok(Math.abs(decoded[0].lat - original[0].lat) < 0.0001);
  assert.ok(Math.abs(decoded[2].lng - original[2].lng) < 0.0001);
});

test('parseGpxActivity extracts distance, duration, elevation, heartrate, and route polyline', () => {
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1">
  <trk>
    <name>Easy Park Loop</name>
    <type>running</type>
    <trkseg>
      <trkpt lat="-6.21850" lon="106.80240"><ele>10.0</ele><time>2026-11-18T06:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>140</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="-6.22300" lon="106.80240"><ele>15.0</ele><time>2026-11-18T06:03:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>150</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
      <trkpt lat="-6.22750" lon="106.80240"><ele>18.0</ele><time>2026-11-18T06:06:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>154</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
    </trkseg>
  </trk>
</gpx>`;

  const result = parseGpxActivity(gpx, 'easy_park.gpx');
  assert.equal(result.activities.length, 1);
  const run = result.activities[0];
  assert.equal(run.name, 'Easy Park Loop');
  assert.equal(run.sportType, 'Run');
  assert.ok(run.distanceKm > 0.95 && run.distanceKm < 1.05); // ~1.00 km
  assert.equal(run.movingTimeSec, 360);
  assert.equal(run.elevationGainM, 8);
  assert.equal(run.averageHeartrate, 148);
  assert.ok(run.summaryPolyline && run.summaryPolyline.length > 5);
});

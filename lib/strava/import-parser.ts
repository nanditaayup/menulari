import type { LatLngPoint } from './polyline';
import {
  formatDuration,
  formatPace,
  getSportLabel,
  metersToKm,
  mpsToKmh,
  mpsToPaceSecPerKm,
} from './transform';
import type { NormalizedRunningActivity, RunningSportType } from './types';

export interface ImportParseResult {
  activities: NormalizedRunningActivity[];
  skippedNonRunning: number;
  skippedInvalid: number;
  warnings: string[];
}

function encodeSignedNumber(num: number): string {
  let sgnNum = num << 1;
  if (num < 0) {
    sgnNum = ~sgnNum;
  }
  let encoded = '';
  while (sgnNum >= 0x20) {
    encoded += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>= 5;
  }
  encoded += String.fromCharCode(sgnNum + 63);
  return encoded;
}

/**
 * Encodes lat/lng points into Google/Strava Encoded Polyline format.
 * Downsamples smoothly when trackpoints exceed maxPoints so SVG rendering stays fast.
 */
export function encodePolyline(points: LatLngPoint[], maxPoints = 300): string {
  if (points.length === 0) return '';

  let sampled = points;
  if (points.length > maxPoints) {
    const step = (points.length - 1) / (maxPoints - 1);
    sampled = [];
    for (let i = 0; i < maxPoints - 1; i++) {
      sampled.push(points[Math.round(i * step)]);
    }
    sampled.push(points[points.length - 1]);
  }

  let prevLat = 0;
  let prevLng = 0;
  let result = '';

  for (const pt of sampled) {
    const latE5 = Math.round(pt.lat * 1e5);
    const lngE5 = Math.round(pt.lng * 1e5);
    result += encodeSignedNumber(latE5 - prevLat);
    result += encodeSignedNumber(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }

  return result;
}

/**
 * Parses CSV text handling quoted fields, embedded commas, escaped quotes (""), and CRLF/LF.
 */
export function parseCsvRows(csvText: string): string[][] {
  const clean = csvText.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    const next = clean[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return rows;
}

function mapCsvSportType(rawType: string): RunningSportType | null {
  const normalized = rawType.trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'run' || normalized === 'running' || normalized === 'lari') {
    return 'Run';
  }
  if (normalized === 'trailrun' || normalized === 'trailrunning') {
    return 'TrailRun';
  }
  if (normalized === 'virtualrun' || normalized === 'treadmill') {
    return 'VirtualRun';
  }
  return null;
}

function parseNumericField(value: string | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/,/g, '.').trim();
  if (!cleaned) return null;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function parseStravaCsvDate(rawDate: string): string | null {
  if (!rawDate) return null;
  const trimmed = rawDate.trim();
  // Try direct Date.parse (handles ISO 8601 and English Strava format "Nov 16, 2026, 6:00:00 AM")
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toISOString();
  }
  return null;
}

/**
 * Parses Strava bulk-export `activities.csv` into NormalizedRunningActivity items.
 * Handles Strava's duplicate column names (e.g., multiple Distance / Elapsed Time columns)
 * and automatically detects whether Distance is recorded in kilometers or meters.
 */
export function parseStravaActivitiesCsv(csvText: string): ImportParseResult {
  const rows = parseCsvRows(csvText);
  if (rows.length < 2) {
    return {
      activities: [],
      skippedNonRunning: 0,
      skippedInvalid: 0,
      warnings: ['File CSV kosong atau tidak memiliki baris data aktivitas.'],
    };
  }

  const headers = rows[0].map((h) => h.trim().toLowerCase());

  const findIndices = (candidates: string[]): number[] => {
    const out: number[] = [];
    headers.forEach((h, idx) => {
      if (candidates.includes(h)) out.push(idx);
    });
    return out;
  };

  const idIdx = findIndices(['activity id', 'id'])[0] ?? -1;
  const dateIdx = findIndices(['activity date', 'date', 'start_date', 'start date'])[0] ?? -1;
  const nameIdx = findIndices(['activity name', 'name', 'title'])[0] ?? -1;
  const typeIdx = findIndices(['activity type', 'sport type', 'type', 'sport_type'])[0] ?? -1;
  const movingTimeIndices = findIndices(['moving time', 'moving_time']);
  const elapsedTimeIndices = findIndices(['elapsed time', 'elapsed_time']);
  const distanceIndices = findIndices(['distance']);
  const elevationIndices = findIndices(['elevation gain', 'total_elevation_gain', 'elev gain']);
  const avgSpeedIndices = findIndices(['average speed', 'average_speed']);
  const maxSpeedIndices = findIndices(['max speed', 'max_speed']);
  const avgHrIndices = findIndices(['average heart rate', 'average_heartrate', 'avg hr']);
  const maxHrIndices = findIndices(['max heart rate', 'max_heartrate', 'max hr']);
  const polylineIdx = findIndices(['polyline', 'summary_polyline'])[0] ?? -1;

  if (typeIdx === -1 || distanceIndices.length === 0) {
    return {
      activities: [],
      skippedNonRunning: 0,
      skippedInvalid: rows.length - 1,
      warnings: [
        'Format header CSV tidak dikenali. Pastikan file berasal dari ekspor Strava (memiliki kolom "Activity Type" dan "Distance").',
      ],
    };
  }

  const activities: NormalizedRunningActivity[] = [];
  let skippedNonRunning = 0;
  let skippedInvalid = 0;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawType = row[typeIdx] || '';
    const sportType = mapCsvSportType(rawType);

    if (!sportType) {
      skippedNonRunning += 1;
      continue;
    }

    const rawId = idIdx >= 0 ? parseNumericField(row[idIdx]) : null;
    const isoDate =
      (dateIdx >= 0 ? parseStravaCsvDate(row[dateIdx]) : null) ||
      new Date().toISOString();

    const movingTimeSec =
      movingTimeIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ??
      elapsedTimeIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ??
      0;

    const elapsedTimeSec =
      elapsedTimeIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ?? movingTimeSec;

    // Strava's activities.csv may have two Distance columns: first in km, second in meters
    const distanceCandidates = distanceIndices
      .map((idx) => parseNumericField(row[idx]))
      .filter((v): v is number => v !== null && v > 0);

    if (distanceCandidates.length === 0) {
      skippedInvalid += 1;
      continue;
    }

    let distanceMeters = 0;
    if (distanceCandidates.length >= 2) {
      // Pick the meters value (typically the larger column, ~1000x the km column)
      distanceMeters = Math.max(...distanceCandidates);
    } else {
      const singleVal = distanceCandidates[0];
      if (movingTimeSec > 0) {
        const impliedRatio = singleVal / movingTimeSec;
        // Human running speed is ~1.0 to 8.0 m/s. If ratio < 0.05, value is in km!
        distanceMeters = impliedRatio < 0.05 ? singleVal * 1000 : singleVal;
      } else {
        distanceMeters = singleVal < 150 ? singleVal * 1000 : singleVal;
      }
    }

    const distanceKm = metersToKm(distanceMeters);
    if (distanceKm <= 0) {
      skippedInvalid += 1;
      continue;
    }

    const csvAvgSpeed =
      avgSpeedIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ?? 0;

    const avgSpeedMps =
      csvAvgSpeed > 0
        ? csvAvgSpeed
        : movingTimeSec > 0
          ? distanceMeters / movingTimeSec
          : 0;

    const maxSpeedMps =
      maxSpeedIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ?? 0;

    const elevationGainM = Math.max(
      0,
      Math.round(
        elevationIndices
          .map((idx) => parseNumericField(row[idx]))
          .find((v): v is number => v !== null && v >= 0) ?? 0
      )
    );

    const avgHr =
      avgHrIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ?? null;

    const maxHr =
      maxHrIndices
        .map((idx) => parseNumericField(row[idx]))
        .find((v): v is number => v !== null && v > 0) ?? null;

    const summaryPolyline =
      polylineIdx >= 0 && row[polylineIdx] && row[polylineIdx].length > 0
        ? row[polylineIdx]
        : null;

    const paceSecPerKm = mpsToPaceSecPerKm(avgSpeedMps);
    const id = rawId ? Math.round(rawId) : Math.abs(hashString(`${isoDate}-${r}-${distanceKm}`));
    const name =
      nameIdx >= 0 && row[nameIdx] && row[nameIdx].length > 0
        ? row[nameIdx]
        : `Lari ${getSportLabel(sportType)}`;

    activities.push({
      id,
      name,
      sportType,
      sportLabel: getSportLabel(sportType),
      startDateUtc: isoDate,
      startDateLocal: isoDate,
      distanceKm,
      movingTimeSec: Math.round(movingTimeSec),
      elapsedTimeSec: Math.round(elapsedTimeSec),
      formattedDuration: formatDuration(movingTimeSec),
      formattedElapsedTime: formatDuration(elapsedTimeSec),
      averageSpeedKmh: mpsToKmh(avgSpeedMps),
      maxSpeedKmh: mpsToKmh(maxSpeedMps),
      paceSecPerKm,
      formattedPace: formatPace(paceSecPerKm),
      elevationGainM,
      summaryPolyline,
      averageHeartrate: avgHr ? Math.round(avgHr) : null,
      maxHeartrate: maxHr ? Math.round(maxHr) : null,
      isPrivate: false,
      isIndoor: sportType === 'VirtualRun' || !summaryPolyline,
    });
  }

  return {
    activities,
    skippedNonRunning,
    skippedInvalid,
    warnings: [],
  };
}

function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return hash || 1;
}

function extractTagText(xml: string, tagName: string): string | null {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = regex.exec(xml);
  if (!match) return null;
  return match[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

/**
 * Parses a single Strava `.gpx` file into a NormalizedRunningActivity with encoded route polyline.
 */
export function parseGpxActivity(gpxText: string, fileName = 'activity.gpx'): ImportParseResult {
  const trkRegex = /<trkpt\b([^>]*)>([\s\S]*?)<\/trkpt>|<trkpt\b([^>]*)\/>/gi;
  const points: LatLngPoint[] = [];
  const timestamps: number[] = [];
  const elevations: number[] = [];
  const heartRates: number[] = [];

  let match: RegExpExecArray | null;
  while ((match = trkRegex.exec(gpxText)) !== null) {
    const attrs = match[1] || match[3] || '';
    const inner = match[2] || '';

    const latMatch = /lat\s*=\s*["']([^"']+)["']/i.exec(attrs);
    const lonMatch = /lon\s*=\s*["']([^"']+)["']/i.exec(attrs);
    if (!latMatch || !lonMatch) continue;

    const lat = Number(latMatch[1]);
    const lng = Number(lonMatch[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    points.push({ lat, lng });

    const timeStr = extractTagText(inner, 'time');
    if (timeStr) {
      const ms = Date.parse(timeStr);
      if (!Number.isNaN(ms)) timestamps.push(ms);
    }

    const eleStr = extractTagText(inner, 'ele');
    if (eleStr) {
      const ele = Number(eleStr);
      if (Number.isFinite(ele)) elevations.push(ele);
    }

    const hrMatch = /<(?:gpxtpx:)?hr[^>]*>(\d+(?:\.\d+)?)<\/(?:gpxtpx:)?hr>/i.exec(inner);
    if (hrMatch) {
      const hr = Number(hrMatch[1]);
      if (Number.isFinite(hr) && hr > 0) heartRates.push(hr);
    }
  }

  if (points.length < 2) {
    return {
      activities: [],
      skippedNonRunning: 0,
      skippedInvalid: 1,
      warnings: [`File GPX "${fileName}" tidak memiliki titik koordinat rute yang cukup.`],
    };
  }

  const rawType = extractTagText(gpxText, 'type') || 'running';
  const sportType = mapCsvSportType(rawType) || 'Run';

  let distanceMeters = 0;
  let movingTimeSec = 0;
  let maxSpeedMps = 0;

  for (let i = 1; i < points.length; i++) {
    const segDist = haversineMeters(points[i - 1], points[i]);
    distanceMeters += segDist;

    if (timestamps.length === points.length) {
      const dtSec = (timestamps[i] - timestamps[i - 1]) / 1000;
      if (dtSec > 0 && dtSec < 120) {
        const segSpeed = segDist / dtSec;
        if (segSpeed > 0.5) {
          movingTimeSec += dtSec;
          if (segSpeed > maxSpeedMps && segSpeed < 12) {
            maxSpeedMps = segSpeed;
          }
        }
      }
    }
  }

  const elapsedTimeSec =
    timestamps.length >= 2
      ? Math.max(0, Math.round((timestamps[timestamps.length - 1] - timestamps[0]) / 1000))
      : 0;

  if (movingTimeSec <= 0) {
    movingTimeSec = elapsedTimeSec;
  }

  let elevationGainM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0.8) {
      elevationGainM += diff;
    }
  }

  const avgSpeedMps = movingTimeSec > 0 ? distanceMeters / movingTimeSec : 0;
  const paceSecPerKm = mpsToPaceSecPerKm(avgSpeedMps);
  const startDateIso =
    timestamps.length > 0
      ? new Date(timestamps[0]).toISOString()
      : extractTagText(gpxText, 'time') || new Date().toISOString();

  const name =
    extractTagText(gpxText, 'name') ||
    fileName.replace(/\.gpx$/i, '').replace(/[_-]+/g, ' ');

  const avgHr =
    heartRates.length > 0
      ? Math.round(heartRates.reduce((sum, v) => sum + v, 0) / heartRates.length)
      : null;
  const maxHr = heartRates.length > 0 ? Math.round(Math.max(...heartRates)) : null;

  const summaryPolyline = encodePolyline(points);

  const activity: NormalizedRunningActivity = {
    id: Math.abs(hashString(`${fileName}-${startDateIso}-${distanceMeters.toFixed(0)}`)),
    name,
    sportType,
    sportLabel: getSportLabel(sportType),
    startDateUtc: startDateIso,
    startDateLocal: startDateIso,
    distanceKm: metersToKm(distanceMeters),
    movingTimeSec: Math.round(movingTimeSec),
    elapsedTimeSec,
    formattedDuration: formatDuration(movingTimeSec),
    formattedElapsedTime: formatDuration(elapsedTimeSec),
    averageSpeedKmh: mpsToKmh(avgSpeedMps),
    maxSpeedKmh: mpsToKmh(maxSpeedMps),
    paceSecPerKm,
    formattedPace: formatPace(paceSecPerKm),
    elevationGainM: Math.round(elevationGainM),
    summaryPolyline,
    averageHeartrate: avgHr,
    maxHeartrate: maxHr,
    isPrivate: false,
    isIndoor: false,
  };

  return {
    activities: [activity],
    skippedNonRunning: 0,
    skippedInvalid: 0,
    warnings: [],
  };
}

export const SAMPLE_STRAVA_CSV = `Activity ID,Activity Date,Activity Name,Activity Type,Elapsed Time,Distance,Moving Time,Elevation Gain,Average Speed,Max Speed,Average Heart Rate,Max Heart Rate
120948101,"Nov 16, 2026, 6:00:00 AM","Long Run Minggu Pagi — GBK",Run,5940,16.20,5832,68,2.78,3.65,148,164
120948102,"Nov 13, 2026, 5:30:00 PM","Tempo 8K Sore",Run,2475,8.10,2430,32,3.33,4.15,168,181
120948103,"Nov 11, 2026, 7:00:00 PM","Recovery Treadmill 5K",Virtual Run,1920,5.00,1920,0,2.60,2.95,136,145
120948104,"Nov 09, 2026, 6:15:00 AM","Sentul Trail Easy",Trail Run,5210,11.40,4902,345,2.33,3.40,155,176
120948105,"Nov 06, 2026, 6:00:00 AM","Sepeda Santai Pagi",Ride,3600,25.00,3400,110,7.35,10.2,128,145
`;

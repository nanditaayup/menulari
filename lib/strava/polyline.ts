export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface SvgRouteGeometry {
  pathData: string;
  startPoint: { x: number; y: number } | null;
  endPoint: { x: number; y: number } | null;
  pointCount: number;
}

/**
 * Decodes a Google/Strava encoded polyline string into an array of [lat, lng] coordinates.
 */
export function decodePolyline(encoded: string | null | undefined): LatLngPoint[] {
  if (!encoded || typeof encoded !== 'string') {
    return [];
  }

  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte = 0;

    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      if (index >= encoded.length) return points;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}

/**
 * Projects geographic coordinates onto a normalized 2D SVG viewport preserving aspect ratio.
 */
export function polylineToSvgGeometry(
  encoded: string | null | undefined,
  width = 160,
  height = 96,
  padding = 10
): SvgRouteGeometry {
  const points = decodePolyline(encoded);
  if (points.length === 0) {
    return {
      pathData: '',
      startPoint: null,
      endPoint: null,
      pointCount: 0,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const pt of points) {
    if (pt.lat < minLat) minLat = pt.lat;
    if (pt.lat > maxLat) maxLat = pt.lat;
    if (pt.lng < minLng) minLng = pt.lng;
    if (pt.lng > maxLng) maxLng = pt.lng;
  }

  const midLatRad = (((minLat + maxLat) / 2) * Math.PI) / 180;
  const lngScale = Math.max(0.2, Math.cos(midLatRad));

  const spanX = Math.max((maxLng - minLng) * lngScale, 1e-6);
  const spanY = Math.max(maxLat - minLat, 1e-6);

  const innerW = Math.max(1, width - padding * 2);
  const innerH = Math.max(1, height - padding * 2);
  const scale = Math.min(innerW / spanX, innerH / spanY);

  const drawnW = spanX * scale;
  const drawnH = spanY * scale;
  const offsetX = padding + (innerW - drawnW) / 2;
  const offsetY = padding + (innerH - drawnH) / 2;

  const projected = points.map((pt) => {
    const x = Number((offsetX + (pt.lng - minLng) * lngScale * scale).toFixed(2));
    const y = Number((offsetY + (maxLat - pt.lat) * scale).toFixed(2));
    return { x, y };
  });

  const commands = projected.map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${pt.x} ${pt.y}`);

  return {
    pathData: commands.join(' '),
    startPoint: projected[0] ?? null,
    endPoint: projected[projected.length - 1] ?? null,
    pointCount: projected.length,
  };
}

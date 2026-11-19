'use client';

import { Footprints } from 'lucide-react';
import { polylineToSvgGeometry } from '@/lib/strava/polyline';

interface RoutePreviewProps {
  summaryPolyline: string | null;
  activityName: string;
  width?: number;
  height?: number;
  padding?: number;
  strokeWidth?: number;
  className?: string;
}

export default function RoutePreview({
  summaryPolyline,
  activityName,
  width = 160,
  height = 96,
  padding = 12,
  strokeWidth = 2.5,
  className = '',
}: RoutePreviewProps) {
  const geometry = polylineToSvgGeometry(summaryPolyline, width, height, padding);

  if (!geometry.pathData) {
    return (
      <div
        className={`flex flex-col items-center justify-center rounded-xl bg-slate-100 text-slate-500 ${className}`}
        aria-label={`Tidak ada rute GPS untuk ${activityName}`}
      >
        <Footprints className="h-5 w-5 text-slate-400" aria-hidden="true" />
        <span className="mt-1 text-[11px] font-medium">Indoor / Tanpa GPS</span>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden rounded-xl bg-slate-100 ${className}`}
      aria-label={`Pratinjau rute lari ${activityName}`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-full w-full"
        role="img"
        aria-label={`Peta garis rute ${activityName}`}
      >
        <path
          d={geometry.pathData}
          fill="none"
          stroke="#EA580C"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {geometry.startPoint && (
          <circle
            cx={geometry.startPoint.x}
            cy={geometry.startPoint.y}
            r={3.5}
            fill="#16A34A"
            stroke="#FFFFFF"
            strokeWidth={1.5}
          />
        )}
        {geometry.endPoint && (
          <circle
            cx={geometry.endPoint.x}
            cy={geometry.endPoint.y}
            r={3.5}
            fill="#0F172A"
            stroke="#FFFFFF"
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  );
}

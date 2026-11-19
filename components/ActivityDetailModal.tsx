'use client';

import { useEffect } from 'react';
import { ExternalLink, X } from 'lucide-react';
import RoutePreview from './RoutePreview';
import type { NormalizedRunningActivity } from '@/lib/strava/types';

interface ActivityDetailModalProps {
  activity: NormalizedRunningActivity | null;
  onClose: () => void;
}

function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export default function ActivityDetailModal({
  activity,
  onClose,
}: ActivityDetailModalProps) {
  useEffect(() => {
    if (!activity) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activity, onClose]);

  if (!activity) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="activity-detail-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              <span>{activity.sportLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{formatLocalDateTime(activity.startDateLocal)}</span>
              {activity.isPrivate && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Privat</span>
                </>
              )}
            </div>
            <h2
              id="activity-detail-title"
              className="mt-1 text-xl font-semibold text-slate-900"
            >
              {activity.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup detail aktivitas"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5">
          <RoutePreview
            summaryPolyline={activity.summaryPolyline}
            activityName={activity.name}
            width={560}
            height={220}
            padding={20}
            strokeWidth={3}
            className="h-56 w-full"
          />
          {activity.summaryPolyline && (
            <div className="mt-2 flex items-center gap-4 text-xs text-slate-500">
              <span>Titik hijau: Mulai</span>
              <span aria-hidden="true">·</span>
              <span>Titik hitam: Selesai</span>
            </div>
          )}
        </div>

        <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-slate-200 pt-5 sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-slate-500">Jarak</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {activity.distanceKm.toFixed(2).replace('.', ',')} km
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Waktu Aktif</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {activity.formattedDuration}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Pace Rata-rata</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-orange-600">
              {activity.formattedPace}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Kecepatan</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {activity.averageSpeedKmh.toFixed(1).replace('.', ',')} km/jam
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Waktu Total</dt>
            <dd className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-700">
              {activity.formattedElapsedTime}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Kecepatan Maks</dt>
            <dd className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-700">
              {activity.maxSpeedKmh.toFixed(1).replace('.', ',')} km/jam
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Elevasi</dt>
            <dd className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-700">
              +{activity.elevationGainM} m
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Detak Jantung</dt>
            <dd className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-700">
              {activity.averageHeartrate ? `${activity.averageHeartrate} bpm` : 'Tidak tersedia'}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
          <a
            href={`https://www.strava.com/activities/${activity.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-sm font-medium text-orange-700 hover:underline whitespace-nowrap shrink-0"
          >
            Buka di Strava
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

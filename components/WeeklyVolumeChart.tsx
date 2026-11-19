'use client';

import type { WeeklyVolumePoint } from '@/lib/strava/types';

interface WeeklyVolumeChartProps {
  series: WeeklyVolumePoint[];
}

export default function WeeklyVolumeChart({ series }: WeeklyVolumeChartProps) {
  const maxKm = Math.max(10, ...series.map((item) => item.totalDistanceKm));

  return (
    <section
      aria-label="Grafik volume lari mingguan"
      className="rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Volume Lari 8 Minggu Terakhir
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Akumulasi jarak per minggu untuk kalibrasi beban awal menu latihan.
          </p>
        </div>
        <span className="font-mono text-xs tabular-nums text-slate-500">
          Satuan: km / minggu
        </span>
      </div>

      <div className="mt-6 grid grid-cols-8 items-end gap-2 sm:gap-4" role="list">
        {series.map((week, idx) => {
          const heightPct =
            week.totalDistanceKm > 0
              ? Math.max(8, Math.round((week.totalDistanceKm / maxKm) * 100))
              : 0;
          const isLatest = idx === series.length - 1;

          return (
            <div
              key={week.weekStartIso}
              role="listitem"
              className="flex flex-col items-center gap-2"
            >
              <span className="font-mono text-xs font-medium tabular-nums text-slate-700">
                {week.totalDistanceKm > 0 ? week.totalDistanceKm.toFixed(1) : '0'}
              </span>
              <div className="flex h-32 w-full items-end justify-center rounded-lg bg-slate-100 p-1">
                {heightPct > 0 ? (
                  <div
                    className={`w-full rounded-md transition-opacity duration-200 ${
                      isLatest ? 'bg-orange-600' : 'bg-slate-800'
                    }`}
                    style={{ height: `${heightPct}%` }}
                    title={`Minggu ${week.weekLabel}: ${week.totalDistanceKm.toFixed(1)} km (${week.runCount} sesi)`}
                  />
                ) : (
                  <div className="h-1 w-full rounded bg-slate-200" />
                )}
              </div>
              <span className="text-center text-[11px] font-medium whitespace-nowrap text-slate-500">
                {week.weekLabel}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

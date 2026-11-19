'use client';

import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, Trash2, Upload } from 'lucide-react';
import {
  parseGpxActivity,
  parseStravaActivitiesCsv,
  SAMPLE_STRAVA_CSV,
} from '@/lib/strava/import-parser';
import type { NormalizedRunningActivity } from '@/lib/strava/types';

interface ImportActivitiesPanelProps {
  importedCount: number;
  onImport: (
    activities: NormalizedRunningActivity[],
    meta: { fileCount: number; skippedNonRunning: number; warnings: string[] }
  ) => void;
  onLoadDemo: () => void;
  onClearImported: () => void;
}

export default function ImportActivitiesPanel({
  importedCount,
  onImport,
  onLoadDemo,
  onClearImported,
}: ImportActivitiesPanelProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);

  const processFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setParsing(true);

    try {
      const collected: NormalizedRunningActivity[] = [];
      let totalSkippedNonRunning = 0;
      const warnings: string[] = [];

      for (const file of Array.from(fileList)) {
        const lower = file.name.toLowerCase();
        const text = await file.text();

        if (lower.endsWith('.csv')) {
          const parsed = parseStravaActivitiesCsv(text);
          collected.push(...parsed.activities);
          totalSkippedNonRunning += parsed.skippedNonRunning;
          warnings.push(...parsed.warnings);
        } else if (lower.endsWith('.gpx')) {
          const parsed = parseGpxActivity(text, file.name);
          collected.push(...parsed.activities);
          warnings.push(...parsed.warnings);
        } else {
          warnings.push(
            `Format "${file.name}" tidak didukung. Gunakan file .csv (activities.csv) atau .gpx.`
          );
        }
      }

      onImport(collected, {
        fileCount: fileList.length,
        skippedNonRunning: totalSkippedNonRunning,
        warnings,
      });
    } finally {
      setParsing(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleDownloadSampleCsv = () => {
    const blob = new Blob([SAMPLE_STRAVA_CSV], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'strava_activities_contoh.csv';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
      <div className="lg:col-span-7">
        <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Impor Data Aktivitas Lari Strava
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
          Unggah file <code className="font-mono text-sm text-slate-900">activities.csv</code>{' '}
          atau <code className="font-mono text-sm text-slate-900">.gpx</code> dari ekspor
          akun Strava gratis Anda. Semua data diproses langsung di browser.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            processFiles(e.dataTransfer.files);
          }}
          className={`mt-5 rounded-xl border border-dashed p-5 transition-colors ${
            dragging
              ? 'border-orange-600 bg-orange-50'
              : 'border-slate-300 bg-slate-50'
          }`}
        >
          <input
            ref={inputRef}
            id="strava-file-input"
            type="file"
            accept=".csv,.gpx"
            multiple
            className="sr-only"
            onChange={(e) => processFiles(e.target.files)}
          />

          <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 border border-slate-200">
                <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-900">
                  Seret file <span className="font-mono">activities.csv</span> atau{' '}
                  <span className="font-mono">.gpx</span> ke sini
                </p>
                <p className="text-xs text-slate-500">
                  Mendukung multi-file GPX sekaligus dan filter otomatis aktivitas non-lari.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={parsing}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-700 disabled:opacity-60 whitespace-nowrap shrink-0"
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {parsing ? 'Memproses...' : 'Pilih File CSV / GPX'}
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onLoadDemo}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            Muat Data Contoh
          </button>

          <button
            type="button"
            onClick={handleDownloadSampleCsv}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4 text-slate-500" aria-hidden="true" />
            Unduh Contoh CSV
          </button>

          {importedCount > 0 && (
            <button
              type="button"
              onClick={onClearImported}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Hapus Data Impor ({importedCount})
            </button>
          )}
        </div>
      </div>

      <div className="border-t border-slate-200 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
        <h2 className="text-sm font-semibold text-slate-900">
          Cara Mengambil Data dari Strava Gratis
        </h2>
        <ol className="mt-3 space-y-2.5 text-xs leading-relaxed text-slate-600">
          <li>
            <span className="font-semibold text-slate-900">1. Seluruh Riwayat (CSV):</span>{' '}
            Buka web Strava &rarr; <em>Settings</em> &rarr; <em>My Account</em> &rarr;{' '}
            <em>Download or Delete Your Account</em> &rarr; unduh arsip lalu pilih file{' '}
            <code className="font-mono text-slate-900">activities.csv</code>.
          </li>
          <li>
            <span className="font-semibold text-slate-900">2. Per Aktivitas + Peta Rute (GPX):</span>{' '}
            Buka satu aktivitas lari di web Strava &rarr; klik ikon{' '}
            <code className="font-mono text-slate-900">...</code> &rarr;{' '}
            <em>Export GPX</em> untuk mengimpor koordinat rute penuh.
          </li>
          <li>
            <span className="font-semibold text-slate-900">3. Privasi Lokal:</span>{' '}
            File hasil impor disimpan lokal di browser perangkat Anda dan otomatis
            menghitung rata-rata volume 4 minggu.
          </li>
        </ol>
      </div>
    </div>
  );
}

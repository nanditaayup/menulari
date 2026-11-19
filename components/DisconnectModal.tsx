'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

interface DisconnectModalProps {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (clearCache: boolean) => void;
}

export default function DisconnectModal({
  open,
  busy,
  onCancel,
  onConfirm,
}: DisconnectModalProps) {
  const [clearCache, setClearCache] = useState(true);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="disconnect-title"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="disconnect-title" className="text-lg font-semibold text-slate-900">
            Putuskan Akun Strava
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Batal memutuskan koneksi"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Tindakan ini akan mencabut izin token akses Strava Anda dari aplikasi ini.
        </p>

        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <input
            type="checkbox"
            checked={clearCache}
            onChange={(e) => setClearCache(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-600"
          />
          <span className="text-sm text-slate-700">
            Hapus seluruh riwayat aktivitas lari yang sudah disinkronkan dari cache server.
          </span>
        </label>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap shrink-0"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => onConfirm(clearCache)}
            disabled={busy}
            className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60 whitespace-nowrap shrink-0"
          >
            {busy ? 'Memutuskan...' : 'Putuskan Akun'}
          </button>
        </div>
      </div>
    </div>
  );
}

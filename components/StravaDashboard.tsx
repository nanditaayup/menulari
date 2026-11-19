'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Link2,
  RefreshCw,
  Search,
  ShieldCheck,
  Unlink,
} from 'lucide-react';
import ActivityDetailModal from './ActivityDetailModal';
import DisconnectModal from './DisconnectModal';
import ImportActivitiesPanel from './ImportActivitiesPanel';
import RoutePreview from './RoutePreview';
import WeeklyVolumeChart from './WeeklyVolumeChart';
import { computeRunningSummary, mergeActivities } from '@/lib/strava/transform';
import type {
  NormalizedRunningActivity,
  StravaActivitiesResponse,
  StravaAthleteSummary,
  StravaRateLimitInfo,
} from '@/lib/strava/types';

interface SessionResponse {
  configured: boolean;
  connected: boolean;
  revoked: boolean;
  redirectUri: string;
  athlete: StravaAthleteSummary | null;
  scope: string | null;
  lastSyncedAt: string | null;
  cooldownRemainingSec: number;
  rateLimit: StravaRateLimitInfo | null;
}

type DayFilter = '7' | '30' | '90' | 'all';
type SportFilter = 'all' | 'Run' | 'TrailRun' | 'VirtualRun';
type SourceTab = 'import' | 'oauth';

const LOCAL_IMPORT_STORAGE_KEY = 'pacecraft_imported_runs_v1';

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

function buildLocalResponse(
  activities: NormalizedRunningActivity[],
  source: 'cache' | 'demo',
  warning: string | null = null
): StravaActivitiesResponse {
  return {
    source,
    syncedAt: new Date().toISOString(),
    cooldownRemainingSec: 0,
    rateLimit: null,
    warning,
    activities,
    summary: computeRunningSummary(activities),
  };
}

export default function StravaDashboard() {
  const [activeTab, setActiveTab] = useState<SourceTab>('import');
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [importedActivities, setImportedActivities] = useState<NormalizedRunningActivity[]>([]);
  const [data, setData] = useState<StravaActivitiesResponse | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [selectedActivity, setSelectedActivity] =
    useState<NormalizedRunningActivity | null>(null);

  const [includePrivate, setIncludePrivate] = useState(false);
  const [demoMode, setDemoMode] = useState(false);
  const [dayFilter, setDayFilter] = useState<DayFilter>('90');
  const [sportFilter, setSportFilter] = useState<SportFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [cooldownSec, setCooldownSec] = useState(0);

  const loadActivities = useCallback(
    async (opts?: { refresh?: boolean; demo?: boolean; days?: DayFilter; sport?: SportFilter }) => {
      const useDemo = opts?.demo ?? demoMode;
      const days = opts?.days ?? dayFilter;
      const sport = opts?.sport ?? sportFilter;
      const refresh = Boolean(opts?.refresh);

      if (refresh) {
        setSyncing(true);
      } else {
        setLoadingActivities(true);
      }
      setErrorMessage(null);

      try {
        const params = new URLSearchParams({
          days: days === 'all' ? '3650' : days,
          sportType: sport,
        });
        if (refresh) params.set('refresh', 'true');
        if (useDemo) params.set('demo', '1');

        const res = await fetch(`/api/strava/activities?${params.toString()}`, {
          cache: 'no-store',
        });

        const payload = (await res.json()) as StravaActivitiesResponse & {
          error?: string;
          revoked?: boolean;
        };

        if (!res.ok) {
          if (res.status === 401 && payload.revoked) {
            setSession((prev) =>
              prev ? { ...prev, connected: false, revoked: true } : prev
            );
          }
          setErrorMessage(
            payload.error || 'Gagal mengambil riwayat aktivitas lari.'
          );
          return;
        }

        setData(payload);
        setCooldownSec(payload.cooldownRemainingSec || 0);
        if (refresh && payload.source === 'strava') {
          setStatusMessage('Riwayat lari berhasil disinkronkan dari Strava.');
        }
      } catch {
        setErrorMessage('Terjadi gangguan jaringan saat memuat aktivitas lari.');
      } finally {
        setLoadingActivities(false);
        setSyncing(false);
      }
    },
    [dayFilter, demoMode, sportFilter]
  );

  const refreshSessionAndData = useCallback(async () => {
    try {
      const res = await fetch('/api/strava/session', { cache: 'no-store' });
      const json = (await res.json()) as SessionResponse;
      setSession(json);
      setCooldownSec(json.cooldownRemainingSec || 0);
      if (json.connected) {
        setDemoMode(false);
        setActiveTab('oauth');
        await loadActivities({ demo: false });
      }
    } catch {
      setErrorMessage('Gagal memeriksa status koneksi Strava.');
    } finally {
      setLoadingSession(false);
    }
  }, [loadActivities]);

  // Initial boot: restore locally imported Strava CSV/GPX runs and check optional OAuth session
  useEffect(() => {
    let active = true;

    let restoredRuns: NormalizedRunningActivity[] = [];
    try {
      const rawSaved = window.localStorage.getItem(LOCAL_IMPORT_STORAGE_KEY);
      if (rawSaved) {
        const parsed = JSON.parse(rawSaved) as NormalizedRunningActivity[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          restoredRuns = parsed;
        }
      }
    } catch {
      // Ignore malformed local cache
    }

    (async () => {
      try {
        const res = await fetch('/api/strava/session', { cache: 'no-store' });
        const json = (await res.json()) as SessionResponse;
        if (!active) return;
        setSession(json);
        setCooldownSec(json.cooldownRemainingSec || 0);

        if (json.connected) {
          setDemoMode(false);
          setActiveTab('oauth');
          const actRes = await fetch('/api/strava/activities?days=90&sportType=all', {
            cache: 'no-store',
          });
          if (actRes.ok && active) {
            const actPayload = (await actRes.json()) as StravaActivitiesResponse;
            setData(actPayload);
            setCooldownSec(actPayload.cooldownRemainingSec || 0);
          }
        } else if (restoredRuns.length > 0 && active) {
          setImportedActivities(restoredRuns);
          setData(buildLocalResponse(restoredRuns, 'cache'));
        }
      } catch {
        if (active && restoredRuns.length > 0) {
          setImportedActivities(restoredRuns);
          setData(buildLocalResponse(restoredRuns, 'cache'));
        }
      } finally {
        if (active) {
          setLoadingSession(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (cooldownSec <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownSec((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownSec]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin || '';
      const isTrustedOrigin =
        origin.endsWith('.run.app') ||
        origin.includes('localhost') ||
        origin === window.location.origin;

      if (!isTrustedOrigin) return;

      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'strava') {
        setStatusMessage('Akun Strava berhasil terhubung. Memuat riwayat lari...');
        setErrorMessage(null);
        setDemoMode(false);
        refreshSessionAndData();
      } else if (
        event.data?.type === 'STRAVA_OAUTH_ERROR' &&
        event.data?.provider === 'strava'
      ) {
        setErrorMessage(event.data.message || 'Otorisasi Strava tidak selesai.');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [refreshSessionAndData]);

  const handleImportActivities = (
    incoming: NormalizedRunningActivity[],
    meta: { fileCount: number; skippedNonRunning: number; warnings: string[] }
  ) => {
    setErrorMessage(null);
    setStatusMessage(null);

    if (meta.warnings.length > 0 && incoming.length === 0) {
      setErrorMessage(meta.warnings[0]);
      return;
    }

    if (incoming.length === 0) {
      setErrorMessage(
        meta.skippedNonRunning > 0
          ? `Tidak ada aktivitas lari ditemukan (${meta.skippedNonRunning} aktivitas non-lari dilewati).`
          : 'Tidak ada aktivitas lari valid yang ditemukan di file tersebut.'
      );
      return;
    }

    const merged = mergeActivities(importedActivities, incoming);
    setImportedActivities(merged);
    setDemoMode(false);
    setDayFilter('all'); // Show full imported history immediately regardless of export date
    setSportFilter('all');
    setData(buildLocalResponse(merged, 'cache', meta.warnings[0] ?? null));

    try {
      window.localStorage.setItem(LOCAL_IMPORT_STORAGE_KEY, JSON.stringify(merged));
    } catch {
      // Ignore storage quota errors
    }

    const skippedNote =
      meta.skippedNonRunning > 0
        ? ` (${meta.skippedNonRunning} aktivitas non-lari dilewati)`
        : '';
    setStatusMessage(
      `Berhasil mengimpor ${incoming.length} aktivitas lari dari ${meta.fileCount} file${skippedNote}.`
    );
  };

  const handleClearImported = () => {
    setImportedActivities([]);
    setData(null);
    setStatusMessage('Data impor aktivitas lari telah dihapus dari perangkat ini.');
    setErrorMessage(null);
    try {
      window.localStorage.removeItem(LOCAL_IMPORT_STORAGE_KEY);
    } catch {
      // Ignore
    }
  };

  const handleConnectStrava = async () => {
    setErrorMessage(null);
    setStatusMessage(null);

    try {
      const res = await fetch(
        `/api/strava/auth/url?includePrivate=${includePrivate ? 'true' : 'false'}`,
        { cache: 'no-store' }
      );
      const json = (await res.json()) as {
        configured?: boolean;
        url?: string;
        error?: string;
      };

      if (!res.ok || !json.url) {
        setErrorMessage(
          json.error ||
            'Kredensial OAuth Strava belum tersedia. Gunakan tab Impor File CSV / GPX.'
        );
        return;
      }

      const popup = window.open(
        json.url,
        'strava_oauth_popup',
        'width=600,height=720,scrollbars=yes,resizable=yes'
      );

      if (!popup) {
        setErrorMessage(
          'Popup otorisasi diblokir browser. Izinkan popup untuk situs ini lalu coba lagi.'
        );
      }
    } catch {
      setErrorMessage('Gagal membuat tautan otorisasi Strava.');
    }
  };

  const handleLoadDemo = async () => {
    setDemoMode(true);
    setStatusMessage(null);
    setErrorMessage(null);
    setDayFilter('90');
    setSportFilter('all');
    await loadActivities({ demo: true, days: '90', sport: 'all' });
  };

  const handleFilterDays = async (nextDays: DayFilter) => {
    setDayFilter(nextDays);
    if ((session?.connected || demoMode) && importedActivities.length === 0) {
      await loadActivities({ days: nextDays });
    }
  };

  const handleFilterSport = async (nextSport: SportFilter) => {
    setSportFilter(nextSport);
    if ((session?.connected || demoMode) && importedActivities.length === 0) {
      await loadActivities({ sport: nextSport });
    }
  };

  const handleDisconnect = async (clearCache: boolean) => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/strava/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCache }),
      });

      if (res.ok) {
        setShowDisconnectModal(false);
        setSession((prev) =>
          prev
            ? {
                ...prev,
                connected: false,
                athlete: null,
                scope: null,
                lastSyncedAt: null,
              }
            : prev
        );
        if (clearCache) {
          setData(
            importedActivities.length > 0
              ? buildLocalResponse(importedActivities, 'cache')
              : null
          );
        }
        setDemoMode(false);
        setStatusMessage('Koneksi akun Strava berhasil diputuskan.');
      }
    } catch {
      setErrorMessage('Gagal memutuskan koneksi Strava.');
    } finally {
      setDisconnecting(false);
    }
  };

  const filteredActivities = useMemo(() => {
    if (!data?.activities) return [];
    const q = searchQuery.trim().toLowerCase();
    const refMs = data.syncedAt ? Date.parse(data.syncedAt) : NaN;
    const daysNum = dayFilter === 'all' ? null : Number(dayFilter);
    const cutoffMs =
      daysNum && !Number.isNaN(refMs)
        ? refMs - daysNum * 24 * 60 * 60 * 1000
        : null;

    return data.activities.filter((act) => {
      if (cutoffMs !== null && !demoMode) {
        const actMs = Date.parse(act.startDateUtc);
        if (!Number.isNaN(actMs) && actMs < cutoffMs) return false;
      }
      if (sportFilter !== 'all' && act.sportType !== sportFilter) {
        return false;
      }
      if (q) {
        return (
          act.name.toLowerCase().includes(q) ||
          act.sportLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, dayFilter, demoMode, searchQuery, sportFilter]);

  const athleteFullName = session?.athlete
    ? `${session.athlete.firstname} ${session.athlete.lastname}`.trim()
    : null;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Bar Contract: Brand wordmark — Nav links — 1 Primary Action */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-8 px-4 py-3.5 sm:px-6">
          <a
            href="#ringkasan"
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            PaceCraft
          </a>

          <nav
            aria-label="Navigasi utama"
            className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex"
          >
            <a
              href="#ringkasan"
              className="transition-colors hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Impor Data
            </a>
            <a
              href="#riwayat-lari"
              className="transition-colors hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Riwayat Lari
            </a>
            <a
              href="#integrasi-api"
              className="transition-colors hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              Integrasi API
            </a>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {session?.connected ? (
              <button
                type="button"
                onClick={() => loadActivities({ refresh: true })}
                disabled={syncing || cooldownSec > 0}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {syncing
                  ? 'Menyinkronkan...'
                  : cooldownSec > 0
                    ? `Tunggu ${cooldownSec}d`
                    : 'Sinkronkan'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setActiveTab('import');
                  document.getElementById('strava-file-input')?.click();
                }}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-700 whitespace-nowrap shrink-0"
              >
                Impor CSV / GPX
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
        {/* Feedback Banners */}
        {errorMessage && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
            <div className="flex-1">
              <p className="font-medium">Gagal Memproses Permintaan</p>
              <p className="mt-0.5 text-red-800">{errorMessage}</p>
            </div>
          </div>
        )}

        {statusMessage && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900"
          >
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <p className="font-medium">{statusMessage}</p>
          </div>
        )}

        {data?.warning && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          >
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
            <p>{data.warning}</p>
          </div>
        )}

        {/* Section 1: Data Source Panel (File Import Primary + OAuth API Tab) */}
        <section
          id="ringkasan"
          className="rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
            <div
              className="flex items-center gap-1 rounded-xl bg-slate-100 p-1"
              role="tablist"
              aria-label="Sumber data Strava"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'import'}
                onClick={() => setActiveTab('import')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'import'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Impor File CSV / GPX (Gratis)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'oauth'}
                onClick={() => setActiveTab('oauth')}
                className={`min-h-[36px] rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === 'oauth'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                OAuth Strava API
              </button>
            </div>

            {importedActivities.length > 0 && (
              <span className="font-mono text-xs text-slate-600">
                {importedActivities.length} aktivitas tersimpan lokal
              </span>
            )}
          </div>

          {activeTab === 'import' ? (
            <ImportActivitiesPanel
              importedCount={importedActivities.length}
              onImport={handleImportActivities}
              onLoadDemo={handleLoadDemo}
              onClearImported={handleClearImported}
            />
          ) : loadingSession ? (
            <div className="space-y-3" aria-busy="true" aria-label="Memuat status koneksi">
              <div className="h-6 w-56 rounded bg-slate-100" />
              <div className="h-4 w-96 max-w-full rounded bg-slate-100" />
            </div>
          ) : session?.connected && session.athlete ? (
            <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-100 text-base font-semibold text-slate-700">
                  {session.athlete.firstname.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-emerald-700">Terhubung ke Strava</span>
                    <span aria-hidden="true">·</span>
                    <span>Scope: {session.scope || 'read,activity:read'}</span>
                    {data?.syncedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Diperbarui {formatShortDate(data.syncedAt)}</span>
                      </>
                    )}
                  </div>
                  <h1 className="mt-1 text-xl font-semibold text-slate-900">
                    {athleteFullName}
                  </h1>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowDisconnectModal(true)}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <Unlink className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  Putuskan Koneksi
                </button>
              </div>
            </div>
          ) : (
            <div className="grid gap-8 lg:grid-cols-12 lg:items-center">
              <div className="lg:col-span-7">
                <h1 className="text-balance text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Sinkronkan Riwayat Lari via Strava OAuth
                </h1>
                <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">
                  Opsi ini memerlukan Strava Client ID & Secret (membutuhkan akun pemilik
                  aplikasi dengan Strava Subscription aktif). Jika akun Anda gratis, gunakan
                  tab Impor File CSV / GPX.
                </p>

                <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
                  <span className="inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                    Akses baca-saja (read-only)
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>Tanpa posting otomatis ke Strava</span>
                </div>

                <label className="mt-5 flex cursor-pointer items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={includePrivate}
                    onChange={(e) => setIncludePrivate(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-orange-600 focus:ring-orange-600"
                  />
                  <span>
                    Sertakan aktivitas privat (minta izin{' '}
                    <code className="font-mono text-xs text-slate-900">activity:read_all</code>)
                  </span>
                </label>

                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleConnectStrava}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-orange-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-700 whitespace-nowrap shrink-0"
                  >
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                    Hubungkan dengan Strava
                  </button>

                  <button
                    type="button"
                    onClick={handleLoadDemo}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Activity className="h-4 w-4 text-slate-500" aria-hidden="true" />
                    Muat Data Contoh
                  </button>
                </div>
              </div>

              <div className="border-t border-slate-200 pt-5 lg:col-span-5 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
                <h2 className="text-sm font-semibold text-slate-900">
                  Status Konfigurasi OAuth Server
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                  {session?.configured
                    ? 'Kredensial STRAVA_CLIENT_ID dan STRAVA_CLIENT_SECRET terdeteksi aktif di server.'
                    : 'Kredensial STRAVA_CLIENT_ID dan STRAVA_CLIENT_SECRET belum diisi di environment AI Studio.'}
                </p>
                <div className="mt-4 space-y-2 border-t border-slate-200 pt-3 text-xs">
                  <div>
                    <span className="font-medium text-slate-700">Callback URL Terdaftar:</span>
                    <p className="mt-0.5 break-all font-mono text-slate-600">
                      {session?.redirectUri || '/auth/callback'}
                    </p>
                  </div>
                  <div>
                    <span className="font-medium text-slate-700">Scope Default:</span>
                    <p className="mt-0.5 font-mono text-slate-600">
                      {includePrivate ? 'read,activity:read_all' : 'read,activity:read'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Section 2: 4-Week Running KPI Strip & 8-Week Chart */}
        {data && (
          <>
            <section
              aria-label="Ringkasan performa lari"
              className="grid grid-cols-2 gap-4 lg:grid-cols-4"
            >
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Rata-rata 4 Minggu</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                  {data.summary.fourWeekAvgKm.toFixed(1).replace('.', ',')} km
                </p>
                <p className="mt-1 text-xs text-slate-500">Basis volume per minggu</p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Total 30 Hari</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                  {data.summary.thirtyDayTotalKm.toFixed(1).replace('.', ',')} km
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {data.summary.thirtyDayRunCount} sesi lari tercatat
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Pace Rata-rata</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-orange-600">
                  {data.summary.formattedAvgPace}
                </p>
                <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
                  {data.summary.avgSpeedKmh.toFixed(1).replace('.', ',')} km/jam
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-xs font-medium text-slate-500">Lari Terjauh (30 Hari)</p>
                <p className="mt-2 font-mono text-2xl font-bold tabular-nums text-slate-900">
                  {data.summary.longestRunKm.toFixed(2).replace('.', ',')} km
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Sumber:{' '}
                  {data.source === 'demo'
                    ? 'Data Contoh'
                    : importedActivities.length > 0
                      ? 'File Impor Strava'
                      : 'Strava API'}
                </p>
              </div>
            </section>

            <WeeklyVolumeChart series={data.summary.weeklySeries} />
          </>
        )}

        {/* Section 3: Historical Running Activity Feed */}
        <section
          id="riwayat-lari"
          className="rounded-2xl border border-slate-200 bg-white p-6"
        >
          <div className="flex flex-col gap-4 border-b border-slate-200 pb-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">
                Riwayat Latihan Lari
              </h2>
              <p className="mt-0.5 text-sm text-slate-600">
                Menampilkan jarak, waktu bergerak, pace, kecepatan, dan pratinjau rute.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {/* Timeframe segmented filter */}
                <div
                  className="flex items-center gap-1 rounded-xl bg-slate-100 p-1"
                  role="group"
                  aria-label="Filter rentang waktu"
                >
                  {(
                    [
                      { value: '7', label: '7 Hari' },
                      { value: '30', label: '30 Hari' },
                      { value: '90', label: '90 Hari' },
                      { value: 'all', label: 'Semua Waktu' },
                    ] as { value: DayFilter; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFilterDays(opt.value)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        dayFilter === opt.value
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* Sport type segmented filter */}
                <div
                  className="flex items-center gap-1 rounded-xl bg-slate-100 p-1"
                  role="group"
                  aria-label="Filter tipe lari"
                >
                  {(
                    [
                      { value: 'all', label: 'Semua' },
                      { value: 'Run', label: 'Jalan Raya' },
                      { value: 'TrailRun', label: 'Trail' },
                      { value: 'VirtualRun', label: 'Virtual' },
                    ] as { value: SportFilter; label: string }[]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => handleFilterSport(opt.value)}
                      className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        sportFilter === opt.value
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search input */}
              <div className="relative w-full sm:w-64">
                <label htmlFor="activity-search" className="sr-only">
                  Cari nama aktivitas lari
                </label>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  id="activity-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Cari judul lari..."
                  className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 pl-9 text-sm text-slate-900 placeholder:text-slate-400 focus:border-orange-600 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {loadingActivities ? (
            <div className="mt-6 space-y-4" aria-busy="true" aria-label="Memuat aktivitas">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-28 rounded-xl border border-slate-200 bg-slate-50"
                />
              ))}
            </div>
          ) : !data ? (
            <div className="py-14 text-center">
              <p className="text-base font-medium text-slate-900">
                Belum ada data riwayat lari dimuat
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Unggah file <code className="font-mono text-xs">activities.csv</code> /{' '}
                <code className="font-mono text-xs">.gpx</code> dari Strava atau muat data contoh.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => document.getElementById('strava-file-input')?.click()}
                  className="min-h-[44px] rounded-xl bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700 whitespace-nowrap shrink-0"
                >
                  Pilih File CSV / GPX
                </button>
                <button
                  type="button"
                  onClick={handleLoadDemo}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  Muat Data Contoh
                </button>
              </div>
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="py-14 text-center">
              <p className="text-base font-medium text-slate-900">
                Tidak ada aktivitas lari yang cocok dengan filter
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Coba pilih filter &ldquo;Semua Waktu&rdquo; atau reset kata kunci pencarian.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setDayFilter('all');
                  setSportFilter('all');
                }}
                className="mt-4 min-h-[40px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Reset Filter
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredActivities.map((activity) => (
                <button
                  key={activity.id}
                  type="button"
                  onClick={() => setSelectedActivity(activity)}
                  className="flex w-full flex-col gap-4 py-5 text-left transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between sm:px-2"
                >
                  <div className="flex items-center gap-4">
                    <RoutePreview
                      summaryPolyline={activity.summaryPolyline}
                      activityName={activity.name}
                      className="h-20 w-32 shrink-0"
                    />

                    <div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{activity.sportLabel}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatShortDate(activity.startDateLocal)}</span>
                        <span aria-hidden="true">·</span>
                        <span>+{activity.elevationGainM} m</span>
                      </div>
                      <h3 className="mt-1 text-base font-semibold text-slate-900">
                        {activity.name}
                      </h3>
                      {activity.averageHeartrate && (
                        <p className="mt-1 font-mono text-xs tabular-nums text-slate-500">
                          HR rata-rata {activity.averageHeartrate} bpm
                        </p>
                      )}
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-6 sm:text-right">
                    <div>
                      <dt className="text-[11px] font-medium text-slate-500">Jarak</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {activity.distanceKm.toFixed(2).replace('.', ',')} km
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-slate-500">Waktu</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {activity.formattedDuration}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-slate-500">Pace</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-orange-600">
                        {activity.formattedPace}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[11px] font-medium text-slate-500">Kecepatan</dt>
                      <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900">
                        {activity.averageSpeedKmh.toFixed(1).replace('.', ',')} km/j
                      </dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Section 4: Implemented API Endpoints Summary */}
        <section
          id="integrasi-api"
          className="rounded-2xl border border-slate-200 bg-white p-6"
        >
          <h2 className="text-lg font-semibold text-slate-900">
            Endpoint API Strava OAuth & Sinkronisasi
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Seluruh pertukaran token dan pembaruan sesi diproses di sisi server agar{' '}
            <code className="font-mono text-xs text-slate-900">client_secret</code> dan{' '}
            <code className="font-mono text-xs text-slate-900">refresh_token</code> tidak
            pernah terekspos ke browser.
          </p>

          <div className="mt-5 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="py-2.5 pr-4">Metode & Rute</th>
                  <th className="py-2.5 pr-4">Fungsi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-slate-700">
                <tr>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                    GET /api/strava/auth/url
                  </td>
                  <td className="py-3 pr-4">
                    Membuat tautan otorisasi Strava OAuth dengan proteksi CSRF state dan pilihan scope{' '}
                    <code className="font-mono text-xs">activity:read</code> atau{' '}
                    <code className="font-mono text-xs">activity:read_all</code>.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                    GET /auth/callback
                  </td>
                  <td className="py-3 pr-4">
                    Menukar kode otorisasi menjadi token, memverifikasi izin aktivitas, menyimpan cookie{' '}
                    <code className="font-mono text-xs">HttpOnly; SameSite=None; Secure</code>, dan menutup popup via{' '}
                    <code className="font-mono text-xs">postMessage</code>.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                    GET /api/strava/activities
                  </td>
                  <td className="py-3 pr-4">
                    Menyegarkan token otomatis jika mendekati kedaluwarsa, menarik aktivitas lari (90 hari awal / inkremental), memetakan rute polyline, serta menerapkan deduplikasi & batas cooldown 60 detik.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                    POST /api/strava/disconnect
                  </td>
                  <td className="py-3 pr-4">
                    Mencabut token ke endpoint <code className="font-mono text-xs">deauthorize</code> Strava dan membersihkan sesi serta cache.
                  </td>
                </tr>
                <tr>
                  <td className="py-3 pr-4 font-mono text-xs text-slate-900">
                    GET / POST /api/strava/webhook
                  </td>
                  <td className="py-3 pr-4">
                    Verifikasi langganan webhook Strava (<code className="font-mono text-xs">hub.challenge</code>) dan pemrosesan event penghapusan/pencabutan akses.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <ActivityDetailModal
        activity={selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      <DisconnectModal
        open={showDisconnectModal}
        busy={disconnecting}
        onCancel={() => setShowDisconnectModal(false)}
        onConfirm={handleDisconnect}
      />
    </div>
  );
}

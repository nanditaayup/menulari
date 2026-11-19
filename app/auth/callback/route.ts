import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForStravaTokens } from '@/lib/strava/client';
import {
  consumeOAuthStateCookie,
  setStravaSessionCookie,
} from '@/lib/strava/session';

function renderPopupResultHtml(payload: {
  type: 'OAUTH_AUTH_SUCCESS' | 'STRAVA_OAUTH_ERROR';
  provider: 'strava';
  error?: string;
  message: string;
}) {
  const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
  return new NextResponse(
    `<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Otorisasi Strava</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .box { max-width: 420px; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; text-align: center; }
      p { font-size: 14px; color: #475569; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="box">
      <p id="status-msg">${payload.message.replace(/</g, '&lt;')}</p>
    </div>
    <script>
      (function () {
        var data = ${serialized};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(data, '*');
          setTimeout(function () { window.close(); }, 300);
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`,
    {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }
  );
}

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const oauthError = searchParams.get('error');
  const code = searchParams.get('code');
  const returnedScope = searchParams.get('scope') || '';
  const returnedState = searchParams.get('state') || '';

  if (oauthError === 'access_denied') {
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: 'access_denied',
      message: 'Koneksi Strava dibatalkan oleh pengguna.',
    });
  }

  if (oauthError) {
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: oauthError,
      message: 'Terjadi gangguan saat otorisasi Strava.',
    });
  }

  const savedState = await consumeOAuthStateCookie();
  if (!savedState || !returnedState || savedState.state !== returnedState) {
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: 'invalid_state',
      message: 'Sesi otorisasi tidak valid atau kedaluwarsa. Silakan coba lagi.',
    });
  }

  if (!code) {
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: 'missing_code',
      message: 'Kode otorisasi Strava tidak ditemukan.',
    });
  }

  const grantedScopes = returnedScope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasActivityScope =
    grantedScopes.includes('activity:read') ||
    grantedScopes.includes('activity:read_all');

  if (!hasActivityScope) {
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: 'missing_scope',
      message:
        'Izin membaca aktivitas (activity:read) belum dicentang. Silakan hubungkan ulang dan centang izin aktivitas.',
    });
  }

  try {
    const exchanged = await exchangeCodeForStravaTokens(code);

    await setStravaSessionCookie({
      athlete: exchanged.athlete,
      tokens: exchanged.tokens,
      scope: grantedScopes.join(','),
      lastSyncedAt: null,
      revoked: false,
    });

    return renderPopupResultHtml({
      type: 'OAUTH_AUTH_SUCCESS',
      provider: 'strava',
      message: 'Akun Strava berhasil terhubung. Menutup jendela ini...',
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : 'Gagal menukar kode otorisasi dengan Strava.';
    return renderPopupResultHtml({
      type: 'STRAVA_OAUTH_ERROR',
      provider: 'strava',
      error: 'token_exchange_failed',
      message,
    });
  }
}

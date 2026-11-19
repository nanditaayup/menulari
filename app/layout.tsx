import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'PaceCraft — Strava Running Sync',
  description:
    'Strava OAuth integration and historical running activity analyzer with pace, speed, distance, and route visualization.',
  openGraph: {
    title: 'PaceCraft — Strava Running Sync',
    description:
      'Strava OAuth integration and historical running activity analyzer with pace, speed, distance, and route visualization.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'PaceCraft — Strava Running Sync',
    description:
      'Strava OAuth integration and historical running activity analyzer with pace, speed, distance, and route visualization.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${plusJakarta.variable} ${jetbrainsMono.variable}`}>
      <body
        className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}

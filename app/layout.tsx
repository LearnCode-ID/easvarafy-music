import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import { AppUpdateModal } from '@/components/AppUpdateModal';
import { NotificationBootstrap } from '@/components/notifications/NotificationBootstrap';
import { BackButtonBridge } from '@/components/native/BackButtonBridge';
import './globals.css';
import './liquid-glass.css';

const plusJakarta = localFont({
  src: '../public/fonts/plus-jakarta-sans-latin.woff2',
  weight: '500 700',
  variable: '--font-jakarta',
  display: 'swap',
});

const dmSans = localFont({
  src: '../public/fonts/dm-sans-latin.woff2',
  weight: '400 700',
  variable: '--font-dm-sans',
  display: 'swap',
});

const jetbrainsMono = localFont({
  src: '../public/fonts/jetbrains-mono-latin.woff2',
  weight: '400 500',
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Easvarafy — Dengerin Musik Tanpa Batas',
  description:
    'Easvarafy — Dengerin Musik Tanpa Batas. Pemutar musik modern dengan lirik sinkron, equalizer, playlist, dan sleep timer.',
  applicationName: 'Easvarafy',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.svg',
    shortcut: '/favicon.svg',
    apple: '/favicon.svg',
  },
  openGraph: {
    title: 'Easvarafy — Dengerin Musik Tanpa Batas',
    description:
      'Easvarafy — Dengerin Musik Tanpa Batas. Pemutar musik modern dengan lirik sinkron, equalizer, playlist, dan sleep timer.',
    siteName: 'Easvarafy',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Easvarafy — Dengerin Musik Tanpa Batas',
    description:
      'Easvarafy — Dengerin Musik Tanpa Batas. Pemutar musik modern dengan lirik sinkron, equalizer, playlist, dan sleep timer.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="id"
      className={`dark ${plusJakarta.variable} ${dmSans.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-[var(--m3-bg)] text-[#1A1C20] dark:text-[#E6E8EE] selection:bg-[var(--m3-primary-soft)] selection:text-[var(--m3-primary)] transition-colors duration-200"
        suppressHydrationWarning
      >
        <AuthProvider>
          {children}
          <NotificationBootstrap />
          <AppUpdateModal />
          <BackButtonBridge />
        </AuthProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}

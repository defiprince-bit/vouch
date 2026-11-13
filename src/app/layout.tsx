import type { Metadata } from 'next';
import { Syne, Figtree, DM_Mono } from 'next/font/google';
import './globals.css';
import { Banner } from '@/components/Banner';
import { WalletProvider } from '@/components/WalletProvider';

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', weight: ['600', '700', '800'] });
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', weight: ['400', '500', '600', '700'] });
const dmMono = DM_Mono({ subsets: ['latin'], variable: '--font-dm-mono', weight: ['400', '500'] });

// Landing (/) only: pick the motion mode before first paint so revealed sections don't flash.
// ?static=1, ?shot=1 or reduced motion render the final frame (vl-still); otherwise vl-anim.
const LANDING_MOTION_SCRIPT = `(function(){try{if(location.pathname!=='/')return;var q=new URLSearchParams(location.search);var s=q.has('static')||q.has('shot')||matchMedia('(prefers-reduced-motion: reduce)').matches;document.documentElement.classList.add(s?'vl-still':'vl-anim');}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'Vouch: stake BCH on a habit',
  description: 'Stake BCH on a habit. Keep the streak, the covenant returns your coins. Break it, the stake pays someone else.',
  icons: {
    icon: [
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: { url: '/brand/favicon-180.png', sizes: '180x180' },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below adds vl-anim / vl-still to <html> before paint.
    <html lang="en" className={`${syne.variable} ${figtree.variable} ${dmMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LANDING_MOTION_SCRIPT }} />
      </head>
      <body>
        <WalletProvider>
          <Banner />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}

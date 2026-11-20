import type { Metadata } from 'next';
import { Syne, Figtree, DM_Mono } from 'next/font/google';
import './globals.css';
import { Banner } from '@/components/Banner';
import { WalletProvider } from '@/components/WalletProvider';

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', weight: ['600', '700', '800'] });
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', weight: ['400', '500', '600', '700', '800'] });
const dmMono = DM_Mono({ subsets: ['latin'], variable: '--font-dm-mono', weight: ['400', '500'] });

// Landing (/) only: pick the motion mode before first paint so revealed sections don't flash.
// ?static=1, ?shot=1 or reduced motion render the final frame (vl-still); otherwise vl-anim.
// The hidden "before" states only apply under vl-anim. If the meadow chunk is late, a
// 1.2s fallback adds vl-revealed so nothing stays at opacity 0. LandingRoot cancels
// that timer by setting vl-motion-ready.
const LANDING_MOTION_SCRIPT = `(function(){try{if(location.pathname!=='/')return;var h=document.documentElement;var q=new URLSearchParams(location.search);var s=q.has('static')||q.has('shot')||matchMedia('(prefers-reduced-motion: reduce)').matches;h.classList.add(s?'vl-still':'vl-anim');if(!s)setTimeout(function(){if(!h.classList.contains('vl-motion-ready'))h.classList.add('vl-revealed');},1200);}catch(e){}})();`;

export const metadata: Metadata = {
  title: 'Vouch: put your money where your mouth is',
  description: 'Put your money where your mouth is. Lock BCH on a promise: deliver, and you get your money back. Don’t, and your coins go to whoever you picked.',
  openGraph: {
    title: 'Vouch: put your money where your mouth is',
    description: 'Deliver, and you get your money back. Don’t, and your coins go to whoever you picked. A CashScript covenant on Bitcoin Cash.',
    siteName: 'Vouch',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Vouch: put your money where your mouth is',
    description: 'Deliver, and you get your money back. Don’t, and your coins go to whoever you picked.',
  },
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

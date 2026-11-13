import type { Metadata } from 'next';
import { Syne, Figtree, DM_Mono } from 'next/font/google';
import './globals.css';
import { Banner } from '@/components/Banner';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { WalletProvider } from '@/components/WalletProvider';

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', weight: ['600', '700', '800'] });
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree', weight: ['400', '500', '600', '700'] });
const dmMono = DM_Mono({ subsets: ['latin'], variable: '--font-dm-mono', weight: ['400', '500'] });

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
    <html lang="en" className={`${syne.variable} ${figtree.variable} ${dmMono.variable}`}>
      <body>
        <WalletProvider>
          <Banner />
          <Header />
          {children}
          <Footer />
        </WalletProvider>
      </body>
    </html>
  );
}

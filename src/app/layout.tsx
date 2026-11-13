import type { Metadata } from 'next';
import { Syne, Figtree, DM_Mono } from 'next/font/google';
import './globals.css';
import { Banner } from '@/components/Banner';
import { Header } from '@/components/Header';
import { WalletProvider } from '@/components/WalletProvider';

const syne = Syne({ subsets: ['latin'], variable: '--font-syne', weight: ['600', '700', '800'] });
const figtree = Figtree({ subsets: ['latin'], variable: '--font-figtree' });
const dmMono = DM_Mono({ subsets: ['latin'], variable: '--font-dm-mono', weight: ['400', '500'] });

export const metadata: Metadata = {
  title: 'CommitCash: stake BCH on a habit',
  description: 'Stake BCH on a habit. Keep the streak, the covenant returns your coins. Break it, the stake pays someone else.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${figtree.variable} ${dmMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-neutral-950 text-neutral-100">
        <WalletProvider>
          <Banner />
          <Header />
          <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}

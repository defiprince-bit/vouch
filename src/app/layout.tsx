import type { Metadata } from 'next';
import './globals.css';
import { Banner } from '@/components/Banner';
import { Header } from '@/components/Header';
import { WalletProvider } from '@/components/WalletProvider';

export const metadata: Metadata = {
  title: 'CommitCash: stake BCH on a habit',
  description: 'Stake BCH on a habit. Keep the streak, the covenant returns your coins. Break it, the stake pays someone else.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
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

import type { Metadata } from 'next';
import { Newsreader } from 'next/font/google';
import { WallView } from './WallView';

const newsreader = Newsreader({ subsets: ['latin'], style: ['italic'], weight: '400', variable: '--font-newsreader', display: 'swap' });

export const metadata: Metadata = {
  title: 'The wall — Vouch',
  description: 'Listed Vouch pledges: the habit, the stake, the deadline, and how each one ended. Read from the chain.',
};

export default function WallPage() {
  return (
    <div className={`is-wall ${newsreader.variable}`}>
      <WallView />
    </div>
  );
}

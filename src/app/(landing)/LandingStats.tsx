'use client';
// Landing figures band (design/mocks/stats-strip.html, landing variant). Real numbers only: the
// same chain-derived figures as /wall, with loading and zero states. An empty mainnet wall shows
// chipnet's figures, labelled as such.
import Link from 'next/link';
import { useNetwork } from '@/lib/useNetwork';
import { useWall } from '@/lib/useWall';
import { StatsStrip } from '@/components/StatsStrip';

export function LandingStats() {
  const network = useNetwork();
  const { data, error } = useWall(network);
  return (
    <section className="stats-band" aria-label="Figures from the wall" data-testid="landing-stats">
      <div className="wrap">
        <StatsStrip stats={data?.stats ?? null} network={data?.network ?? network} variant="landing" error={error} />
        <p className="vl-foot-note" style={{ marginTop: 18 }}>
          Read from the chain for every pledge listed on the wall. <Link href="/wall">See the wall</Link>
        </p>
      </div>
    </section>
  );
}

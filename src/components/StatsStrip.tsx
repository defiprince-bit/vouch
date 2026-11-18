// Wall figures (design/mocks/stats-strip.html): filled, loading and zero states. Every number comes
// from GET /api/wall, which derives it from the chain. Nothing here is sample data.
import type { WallStats } from '@/lib/wall';
import { formatBch } from '@/lib/format';
import { networkLabel, type BchNetwork } from '@/lib/network';

export function StatsStrip({
  stats,
  network,
  variant = 'wall',
  error,
}: {
  /** null = loading */
  stats: WallStats | null;
  network: BchNetwork;
  variant?: 'wall' | 'landing';
  error?: string | null;
}) {
  const loading = !stats && !error;
  const s = stats ?? { vouchesMade: 0, bchLockedSats: '0', keptCount: 0, paidCount: 0 };
  const endings = s.keptCount + s.paidCount;
  const keptPct = endings ? Math.round((s.keptCount / endings) * 100) : 0;
  const locked = formatBch(s.bchLockedSats).replace(/ BCH$/, '');
  const cls = `stats-strip${variant === 'landing' ? ' is-landing' : ''}${loading ? ' is-loading' : ''}${error ? ' is-error' : ''}`;
  return (
    <section className={cls} aria-label={`Wall figures on ${networkLabel(network)}`} aria-busy={loading} data-testid="stats-strip">
      {variant === 'landing' && (
        <div>
          <p className="stats-kicker">On {networkLabel(network)}</p>
          <p className="stats-intro">
            So far, <span className="serif-accent">in public.</span>
          </p>
        </div>
      )}
      <div className="stat">
        <p className="stat-label">Vouches made</p>
        <p className="stat-value" data-testid="stat-made">{error ? '–' : s.vouchesMade}</p>
        <p className="stat-hint">{error ? 'Couldn’t load the figures' : s.vouchesMade ? 'Listed on the wall, this network' : 'None on this network yet'}</p>
      </div>
      <div className="stat">
        <p className="stat-label">BCH locked</p>
        <p className="stat-value" data-testid="stat-locked">{error ? '–' : locked}</p>
        <p className="stat-hint">{BigInt(s.bchLockedSats) > 0n ? 'Still in active contracts' : 'Nothing locked right now'}</p>
      </div>
      <div className="stat ratio">
        <p className="stat-label">Kept vs paid</p>
        <div className={`ratio-bar${endings ? '' : ' is-empty'}`} aria-hidden="true">
          <i style={{ width: `${keptPct}%` }}></i>
          <b style={{ width: `${endings ? 100 - keptPct : 0}%` }}></b>
        </div>
        <p className="ratio-meta" data-testid="stat-ratio">
          {endings ? (
            <>
              <span className="is-kept"><b>{s.keptCount}</b> kept</span>
              <span className="is-paid"><b>{s.paidCount}</b> paid</span>
            </>
          ) : (
            <span>No endings yet</span>
          )}
        </p>
        <p className="stat-hint">Paid means broken or expired — the stake went to the beneficiary.</p>
      </div>
    </section>
  );
}

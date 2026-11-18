'use client';
// /wall (design/mocks/wall.html): listed vouches per network, a stats strip, filters. Everything
// shown is derived from the chain by /api/wall; the beneficiary never appears on a card.
import { useState } from 'react';
import Link from 'next/link';
import { useNetwork } from '@/lib/useNetwork';
import { useWall } from '@/lib/useWall';
import { networkLabel, NETWORKS, type BchNetwork } from '@/lib/network';
import type { WallState } from '@/lib/wall';
import { StatsStrip } from '@/components/StatsStrip';
import { SealSymbols } from '@/components/SealSymbols';
import { WallCardView } from './WallCard';

type Filter = 'all' | WallState;
const FILTERS: Array<[Filter, string]> = [
  ['all', 'All'],
  ['active', 'Active'],
  ['kept', 'Kept'],
  ['paid', 'Paid'],
];

export function WallView() {
  const appNetwork = useNetwork();
  const [picked, setPicked] = useState<BchNetwork | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [attempt, setAttempt] = useState(0);
  const tab = picked ?? appNetwork;
  const { data, error, fellBackFrom } = useWall(tab, attempt);
  const shown = data?.network ?? tab;
  const cards = data?.cards ?? [];
  const count = (f: Filter) => (f === 'all' ? cards.length : cards.filter((c) => c.state === f).length);
  const visible = filter === 'all' ? cards : cards.filter((c) => c.state === filter);

  return (
    <main className="wrap page">
      <SealSymbols />
      <header className="screen-head">
        <div>
          <p className="crumbs">
            <Link href="/">Vouch</Link> / Wall
          </p>
          <h1>
            What’s been sealed, <span className="serif-accent">in public.</span>
          </h1>
          <p className="lede">
            Listed vouches on {networkLabel(shown)}. The goal, stake, deadline, and how it ended — not the full address, and not an unlisted pledge.
          </p>
        </div>
        <Link className="btn btn-primary" href="/create">
          Create a pledge
        </Link>
      </header>

      <div className="wall-toolbar">
        <div className="wall-tabs" role="tablist" aria-label="Network">
          {NETWORKS.map((n) => (
            <button key={n} type="button" role="tab" aria-selected={tab === n} onClick={() => setPicked(n)} data-testid={`wall-tab-${n}`}>
              {networkLabel(n)}
            </button>
          ))}
        </div>
      </div>

      {fellBackFrom && (
        <p className="callout wall-note" role="note" data-testid="wall-fallback">
          Nothing is listed on {networkLabel(fellBackFrom)} yet, so this is the {networkLabel(shown)} wall: test coins, real contracts.
        </p>
      )}

      <StatsStrip stats={data?.stats ?? null} network={shown} error={error} />

      {error ? (
        <div className="wall-empty" style={{ marginTop: 18 }} role="alert">
          <h2>The wall didn’t load.</h2>
          <p>{error}</p>
          <button className="btn btn-primary" type="button" onClick={() => setAttempt((a) => a + 1)}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div className="wall-toolbar" style={{ marginTop: 18 }}>
            <div className="filter-row" role="tablist" aria-label="Filter listed vouches">
              {FILTERS.map(([f, label]) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={`filter-btn${filter === f ? ' is-on' : ''}`} onClick={() => setFilter(f)}>
                  {label} <span className="count">{data ? count(f) : '·'}</span>
                </button>
              ))}
            </div>
          </div>
          {!data ? (
            <div className="wall-grid" aria-busy="true">
              {[0, 1].map((i) => (
                <div key={i} className="wall-card" style={{ minHeight: 190, opacity: 0.5 }} aria-hidden="true" />
              ))}
            </div>
          ) : visible.length ? (
            <div className="wall-grid" data-testid="wall-grid">
              {visible.map((c) => (
                <WallCardView key={c.pledgeId} c={c} />
              ))}
            </div>
          ) : cards.length ? (
            <div className="wall-empty">
              <h2>None {filter === 'paid' ? 'paid' : filter} here yet.</h2>
              <p>Try another filter: {cards.length} listed on {networkLabel(shown)}.</p>
            </div>
          ) : (
            <div className="wall-empty" data-testid="wall-empty">
              <svg className="wax-seal-lg" viewBox="0 0 120 120" aria-hidden="true">
                <use href="#vseal" />
              </svg>
              <h2>
                The wall is still blank <span className="serif-accent">on {networkLabel(shown)}.</span>
              </h2>
              <p>When someone lists a pledge, the goal, stake, deadline and outcome show up here. Unlisted pledges stay off it.</p>
              <Link className="btn btn-primary" href="/create">
                Be the first
              </Link>
            </div>
          )}
        </>
      )}
    </main>
  );
}

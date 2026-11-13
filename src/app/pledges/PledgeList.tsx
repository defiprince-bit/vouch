'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { StoredPledge } from '@/lib/pledges';
import { pledgeContract } from '@/lib/walletActions';
import { formatBch, formatDateTime } from '@/lib/format';

type RowState = 'loading' | 'active' | 'unfunded' | 'closed' | 'error';

function rowBadge(p: StoredPledge, s: RowState): [string, string] {
  if (s === 'active') return ['Active', ''];
  if (s === 'unfunded') return ['Not funded', 'badge-wait'];
  if (s === 'closed') {
    if (p.outcome === 'kept') return ['Kept', ''];
    if (p.outcome === 'broken') return ['Broken', 'badge-bad'];
    if (p.outcome === 'settled') return ['Settled', 'badge-bad'];
    return ['Closed', 'badge-off'];
  }
  return [s === 'error' ? 'Offline' : 'Checking', 'badge-off'];
}

function Row({ pledge }: { pledge: StoredPledge }) {
  const [state, setState] = useState<RowState>('loading');
  useEffect(() => {
    let alive = true;
    pledgeContract(pledge)
      .contract.getUtxos()
      .then((u) => alive && setState(u.length ? 'active' : pledge.lastTxid || pledge.outcome ? 'closed' : 'unfunded'))
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [pledge]);
  const [label, cls] = rowBadge(pledge, state);
  const meta =
    state === 'closed' && pledge.outcome === 'kept'
      ? 'Refunded'
      : state === 'closed' && pledge.outcome
        ? 'Paid to the beneficiary'
        : `Deadline ${pledge.deadlineAt ? formatDateTime(pledge.deadlineAt) : `block ${pledge.deadline}`}`;
  return (
    <Link className="pledge-row" href={`/pledges/${pledge.id}`}>
      <div>
        <h2>{pledge.promise}</h2>
        <p className="meta">{formatBch(pledge.stakeSats)} · {meta}</p>
      </div>
      <span className={`badge ${cls}`}>{label}</span>
      <span className={`network-badge${pledge.network === 'mainnet' ? ' is-mainnet' : ''}`}>{pledge.network === 'mainnet' ? 'Mainnet' : 'Chipnet'}</span>
    </Link>
  );
}

export function PledgeList({ pledges }: { pledges: StoredPledge[] }) {
  return (
    <>
      <header className="screen-head">
        <div>
          <p className="crumbs"><Link href="/">Vouch</Link> / Pledges</p>
          <h1>Your pledges</h1>
        </div>
        <Link className="btn btn-primary" href="/create">Create a pledge</Link>
      </header>
      {pledges.length === 0 ? (
        <div className="empty">
          <p style={{ margin: '0 0 12px' }}>No pledges in this browser yet.</p>
          <Link className="btn btn-primary" href="/create">Create a pledge</Link>
        </div>
      ) : (
        <div className="pledge-list">{pledges.map((p) => <Row key={p.id} pledge={p} />)}</div>
      )}
      <p className="footnote" style={{ marginTop: 16 }}>Pledges are listed from this browser. The coins themselves live in each pledge’s contract on Bitcoin Cash.</p>
    </>
  );
}

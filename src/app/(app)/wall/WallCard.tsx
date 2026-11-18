import type { WallCard as Card } from '@/lib/wall';
import { formatBch, formatDateTime } from '@/lib/format';
import { explorerAddr, networkLabel } from '@/lib/network';
import { BrandMark } from '@/components/Logo';

const TAG = { active: 'In progress', kept: 'Refunded', paid: 'Paid to the beneficiary' } as const;

function Seals({ on, total, title }: { on: number; total: number; title: string }) {
  return (
    <div className="seal-progress" title={title}>
      <span className="dots" aria-hidden="true">
        {Array.from({ length: total }, (_, i) => (
          <svg key={i} className={`seal-dot${i < on ? ' is-on' : ''}`} viewBox="0 0 120 120">
            <use href="#vseal" />
          </svg>
        ))}
      </span>
    </div>
  );
}

/** One listed pledge. The beneficiary is never shown; the staker only as a shortened address. */
export function WallCardView({ c }: { c: Card }) {
  const n = c.verifierCount;
  const m = c.threshold ?? 1;
  const seals = c.sealsCollected;
  const sealsText =
    c.version === 2
      ? c.state === 'active'
        ? `${m} of ${n} needed`
        : seals !== null && seals > 0
          ? `${seals} of ${n} collected`
          : `${m} of ${n}`
      : null;
  const verifierText = c.verifierType === 'demo' ? 'Vouch demo' : 'A friend';
  return (
    <a className="wall-card" data-state={c.state} href={explorerAddr(c.network, c.contractAddress)} target="_blank" rel="noreferrer" data-testid="wall-card">
      <div className="ticket-stub">
        <BrandMark />
        <span className="stub-label">Vouch</span>
      </div>
      <div className="wall-card-body">
        <div className="wall-card-top">
          <div>
            <p className="ticket-kicker">
              Listed vouch{c.legacy && <span className="legacy-tag"> · test run</span>}
            </p>
            <p className="example-tag">{TAG[c.state]}</p>
          </div>
          {c.state === 'active' ? (
            <Seals on={0} total={n} title={c.version === 2 ? `${m} of ${n} seals needed` : 'One verifier'} />
          ) : (
            <div className={`stamp ${c.state === 'kept' ? 'stamp-kept' : 'stamp-broke'}`} aria-label={c.state === 'kept' ? 'Kept' : 'Paid'}>
              {c.state === 'kept' ? 'Kept' : 'Paid'}
            </div>
          )}
        </div>
        <h2>{c.habit}</h2>
        <p className="staker addr">{c.stakerShort}</p>
        <div className="wall-meta">
          <div>
            <p className="field-label">Stake</p>
            <p className="field-value">{formatBch(c.stakeSats)}</p>
          </div>
          {c.state === 'paid' ? (
            <div>
              <p className="field-label">Outcome</p>
              <p className="field-value">{c.paidHow === 'forfeited' ? 'Forfeited after the deadline' : c.paidHow === 'broken' ? 'Ruled broken' : 'Paid out'}</p>
            </div>
          ) : sealsText ? (
            <div>
              <p className="field-label">Seals</p>
              <p className="field-value">{sealsText}</p>
            </div>
          ) : (
            <div>
              <p className="field-label">Verifier</p>
              <p className="field-value">{verifierText}</p>
            </div>
          )}
          <div>
            <p className="field-label">{c.state === 'active' ? 'Deadline' : 'Ended'}</p>
            <p className="field-value">
              {c.state === 'active'
                ? c.deadlineAt
                  ? formatDateTime(c.deadlineAt)
                  : `Block ${c.deadline}`
                : c.endedAt
                  ? formatDateTime(c.endedAt).replace(/, \d\d:\d\d.*$/, '')
                  : '—'}
            </p>
          </div>
          <div>
            <p className="field-label">Network</p>
            <p className="field-value net-name">{networkLabel(c.network)}</p>
          </div>
        </div>
      </div>
    </a>
  );
}

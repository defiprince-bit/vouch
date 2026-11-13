import type { ReactNode } from 'react';
import { BrandMark } from './Logo';

export interface TicketProps {
  kicker?: string;
  tag: string;
  stamp: string;
  stampClass?: '' | 'stamp-wait' | 'stamp-kept' | 'stamp-broke' | 'stamp-expired';
  habit: string;
  stake: string;
  deadline: string;
  verifier: string;
  verifierNote?: string;
  beneficiary: string;
  beneficiaryAddr?: string;
  keepCopy: ReactNode;
  breakCopy: ReactNode;
}

/** The pledge "ticket": the design's core object, reused on landing, create (draft) and status. */
export function Ticket(p: TicketProps) {
  return (
    <article className="ticket">
      <div className="ticket-stub">
        <BrandMark />
        <span className="stub-label">CommitCash</span>
      </div>
      <div className="ticket-body">
        <div className="ticket-top">
          <div>
            <p className="ticket-kicker">{p.kicker ?? 'Pledge ticket'}</p>
            <p className="example-tag">{p.tag}</p>
          </div>
          <div className={`stamp ${p.stampClass ?? ''}`} aria-hidden="true">{p.stamp}</div>
        </div>
        <h2 className="ticket-habit">{p.habit}</h2>
        <div className="ticket-grid">
          <div>
            <p className="field-label">Stake</p>
            <p className="field-value">{p.stake}</p>
          </div>
          <div>
            <p className="field-label">Deadline</p>
            <p className="field-value">{p.deadline}</p>
          </div>
          <div>
            <p className="field-label">Verifier</p>
            <p className="field-value">{p.verifier}</p>
            {p.verifierNote && <p className="footnote">{p.verifierNote}</p>}
          </div>
          <div>
            <p className="field-label">Beneficiary</p>
            <p className="field-value">{p.beneficiary}</p>
            {p.beneficiaryAddr && <p className="addr">{p.beneficiaryAddr}</p>}
          </div>
        </div>
        <div className="ticket-outcomes">
          <p className="outcome"><b>If you keep it</b> {p.keepCopy}</p>
          <p className="outcome is-forfeit"><b>If you don’t</b> {p.breakCopy}</p>
        </div>
      </div>
    </article>
  );
}

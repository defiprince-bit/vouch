import { EXPLORER_TX } from '@/lib/config';

/** Prominent explorer link for a transaction. */
export function TxLink({ txid, label = 'Transaction' }: { txid: string; label?: string }) {
  return (
    <a className="tx-link" href={EXPLORER_TX + txid} target="_blank" rel="noreferrer">
      <strong>{label}: view on the explorer ↗</strong>
      <span className="addr">{txid}</span>
    </a>
  );
}

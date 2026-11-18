import { explorerTx, type BchNetwork } from '@/lib/network';

/** Prominent explorer link for a transaction on `network`. */
export function TxLink({ txid, network, label = 'Transaction' }: { txid: string; network: BchNetwork; label?: string }) {
  return (
    <a className="tx-link" href={explorerTx(network, txid)} target="_blank" rel="noreferrer">
      <strong>{label}: view on the explorer ↗</strong>
      <span className="addr">{txid}</span>
    </a>
  );
}

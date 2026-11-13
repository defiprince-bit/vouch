import { EXPLORER_TX } from '@/lib/config';

/** Prominent explorer link for a transaction. */
export function TxLink({ txid, label = 'View transaction' }: { txid: string; label?: string }) {
  return (
    <a
      href={EXPLORER_TX + txid}
      target="_blank"
      rel="noreferrer"
      className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm hover:bg-emerald-500/20"
    >
      <span className="font-semibold text-emerald-300">{label} on the explorer ↗</span>
      <span className="truncate font-mono text-xs text-neutral-400">{txid}</span>
    </a>
  );
}

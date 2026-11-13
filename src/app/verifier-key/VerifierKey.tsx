'use client';
import { useWallet } from '@/components/WalletProvider';

export function VerifierKey() {
  const w = useWallet();
  if (w.state !== 'connected' || !w.stakerPubkeyHex) return <p className="text-neutral-300">Connect your wallet (top right) to see your verifier key.</p>;
  return (
    <div className="max-w-xl space-y-2">
      <code className="block break-all rounded bg-black/40 p-3 text-sm">{w.stakerPubkeyHex}</code>
      <button onClick={() => navigator.clipboard.writeText(w.stakerPubkeyHex!)} className="rounded-full border border-neutral-600 px-4 py-2 text-sm">
        Copy key
      </button>
    </div>
  );
}

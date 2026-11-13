'use client';
import { useWallet } from './WalletProvider';

export function ConnectWallet() {
  const w = useWallet();
  if (w.state === 'connected') {
    return (
      <button onClick={() => w.disconnect()} className="rounded-full border border-emerald-400/50 px-4 py-2 text-sm text-emerald-300">
        {w.walletName ?? 'Wallet'} connected · Disconnect
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => w.connect()}
        disabled={w.state === 'connecting'}
        className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
      >
        {w.state === 'connecting' ? 'Waiting for wallet…' : 'Connect Wallet'}
      </button>
      {w.error && <span className="text-xs text-red-400">{w.error}</span>}
    </div>
  );
}

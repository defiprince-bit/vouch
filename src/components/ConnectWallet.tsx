'use client';
import { useMemo } from 'react';
import { hexToBin } from '@bitauth/libauth';
import { stakerP2pkhAddress } from '@/lib/vouch';
import { useWallet } from './WalletProvider';
import { useNetwork } from '@/lib/useNetwork';

const short = (a: string) => a.replace(/^(\w+:\w{4})\w+(\w{4})$/, '$1…$2');

export function ConnectWallet({ size, variant = 'primary' }: { size?: 'lg'; variant?: 'primary' | 'ghost' }) {
  const w = useWallet();
  const network = useNetwork();
  const addr = useMemo(() => (w.stakerPubkeyHex ? stakerP2pkhAddress(hexToBin(w.stakerPubkeyHex), network) : null), [w.stakerPubkeyHex, network]);
  if (w.state === 'connected') {
    return (
      <button type="button" className="wallet-chip" onClick={() => w.disconnect()} title={`Connected via WizardConnect${addr ? ` as ${addr}` : ''}. Click to disconnect.`}>
        <i />
        <span className="addr">{addr ? short(addr) : (w.walletName ?? 'Wallet')}</span>
        <span className="chip-label">Connected</span>
      </button>
    );
  }
  const cls = `btn ${variant === 'ghost' ? 'btn-ghost' : 'btn-primary'}${size === 'lg' ? ' btn-lg' : ''}`;
  if (w.resuming) {
    // A saved session is being resumed with no QR on screen; let the user start over.
    return (
      <button type="button" className={cls} onClick={() => void w.restart()} title="Reconnecting to your last wallet. Click to connect fresh.">
        Reconnecting… tap to connect fresh
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cls}
      onClick={() => w.connect()}
      disabled={w.state === 'connecting'}
      title={w.error ?? undefined}
    >
      {w.state === 'connecting' ? 'Waiting for wallet…' : 'Connect wallet'}
    </button>
  );
}

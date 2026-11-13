'use client';
import { useMemo } from 'react';
import { hexToBin } from '@bitauth/libauth';
import { stakerP2pkhAddress } from '@/lib/commitcash';
import { useWallet } from './WalletProvider';

const short = (a: string) => a.replace(/^(\w+:\w{4})\w+(\w{4})$/, '$1…$2');

export function ConnectWallet({ size }: { size?: 'lg' }) {
  const w = useWallet();
  const addr = useMemo(() => (w.stakerPubkeyHex ? stakerP2pkhAddress(hexToBin(w.stakerPubkeyHex)) : null), [w.stakerPubkeyHex]);
  if (w.state === 'connected') {
    return (
      <button type="button" className="wallet-chip" onClick={() => w.disconnect()} title={`Connected via WizardConnect${addr ? ` as ${addr}` : ''}. Click to disconnect.`}>
        <i />
        <span className="addr">{addr ? short(addr) : (w.walletName ?? 'Wallet')}</span>
        <span className="chip-label">Connected</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      className={`btn btn-primary${size === 'lg' ? ' btn-lg' : ''}`}
      onClick={() => w.connect()}
      disabled={w.state === 'connecting'}
      title={w.error ?? undefined}
    >
      {w.state === 'connecting' ? 'Waiting for wallet…' : 'Connect wallet'}
    </button>
  );
}

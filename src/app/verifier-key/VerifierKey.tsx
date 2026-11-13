'use client';
import { useState } from 'react';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';

export function VerifierKey() {
  const w = useWallet();
  const [copied, setCopied] = useState(false);
  if (w.state !== 'connected' || !w.stakerPubkeyHex) {
    return (
      <div className="panel" style={{ maxWidth: 560 }}>
        <h2>Your verifier key</h2>
        <p className="hint" style={{ marginBottom: 12 }}>Connect your wallet to see it.</p>
        <ConnectWallet size="lg" />
      </div>
    );
  }
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>Your verifier key</h2>
      <div className="copy-link">
        <input readOnly value={w.stakerPubkeyHex} aria-label="Verifier key" onFocus={(e) => e.currentTarget.select()} />
        <button className="btn btn-primary" type="button" onClick={async () => { await navigator.clipboard.writeText(w.stakerPubkeyHex!).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>
          {copied ? 'Copied' : 'Copy key'}
        </button>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>This is a public key, safe to share.</p>
    </div>
  );
}

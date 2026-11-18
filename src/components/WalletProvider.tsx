'use client';
// WizardConnect wallet context: exposes the connected wallet's first receive pubkey (used as the staker key).
import { createContext, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { childIndexOfPathName } from '@wizardconnect/core';
import { binToHex } from '@bitauth/libauth';
import { useNetwork } from '@/lib/useNetwork';

interface WalletCtx {
  state: string;
  walletName: string | null;
  stakerPubkeyHex: string | null;
  connect: () => boolean;
  disconnect: () => Promise<void>;
  error: string | null;
  /** True while resuming a saved session (no QR shown). */
  resuming: boolean;
  /** Drop any stuck or saved session and show a fresh QR. */
  restart: () => Promise<void>;
  manager: ReturnType<typeof useWizardConnect>['manager'];
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wc = useWizardConnect({ dappName: 'Vouch' });
  const stakerPubkeyHex = useMemo(() => {
    if (wc.state !== 'connected' || !wc.manager) return null;
    const child = childIndexOfPathName('receive') ?? 0;
    const pk = wc.manager.getPubkey(child, 0n);
    return pk ? binToHex(pk) : null;
  }, [wc.state, wc.manager]);

  // Resuming a saved session shows no QR. If the wallet already ended that session on its
  // side (e.g. disconnected in Paytaca), it never answers and the button would stay on
  // "Waiting for wallet…". Give it 12s, then drop the stale session.
  const resuming = (wc.state === 'connecting' && !wc.qrUri) || wc.state === 'reconnecting';
  const { disconnect } = wc;
  useEffect(() => {
    if (!resuming) return;
    const t = setTimeout(() => void disconnect(), 12_000);
    return () => clearTimeout(t);
  }, [resuming, disconnect]);
  // A WizardConnect session is tied to the network the wallet was on when it paired, so a
  // network switch drops it; the user reconnects with their wallet on the new network.
  const network = useNetwork();
  const lastNetwork = useRef(network);
  useEffect(() => {
    if (lastNetwork.current === network) return;
    lastNetwork.current = network;
    if (wc.state === 'connected' || wc.state === 'connecting' || wc.state === 'reconnecting') void disconnect();
  }, [network, wc.state, disconnect]);

  // Clicking the QR code copies the connection URI (the dialog only copies from its URI row).
  // React events bubble through portals, so a wrapper here sees clicks inside the dialog.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uri = wc.uri;
  const onDialogClick = (e: MouseEvent) => {
    if (!uri || !(e.target instanceof HTMLCanvasElement)) return;
    void copyText(uri).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    });
  };

  const restart = async () => {
    await wc.disconnect();
    wc.connect();
  };

  return (
    <Ctx.Provider
      value={{
        state: wc.state,
        walletName: wc.walletName,
        stakerPubkeyHex,
        connect: wc.connect,
        disconnect: wc.disconnect,
        error: wc.error,
        resuming,
        restart,
        manager: wc.manager,
      }}
    >
      {children}
      {wc.uri && wc.qrUri && (
        <div style={{ display: 'contents' }} onClick={onDialogClick}>
        <WizardConnectQRDialog
          className="wc-dialog"
          show={wc.state === 'connecting'}
          onClose={wc.disconnect}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="Connect a BCH wallet"
          subtitle={`Scan with a WizardConnect wallet on ${network} (e.g. Paytaca). Tap the code to copy the link.`}
        />
        </div>
      )}
      {copied && wc.state === 'connecting' && (
        <div className="wc-copied-toast" role="status">
          Copied connection link
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for browsers without async clipboard permission.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

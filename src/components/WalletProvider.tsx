'use client';
// WizardConnect wallet context: exposes the connected wallet's first receive pubkey (used as the staker key).
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useWizardConnect, WizardConnectQRDialog } from '@wizardconnect/react';
import { childIndexOfPathName } from '@wizardconnect/core';
import { binToHex } from '@bitauth/libauth';

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
        <WizardConnectQRDialog
          show={wc.state === 'connecting'}
          onClose={wc.disconnect}
          uri={wc.uri}
          qrUri={wc.qrUri}
          title="Connect a BCH wallet"
          subtitle="Scan with a WizardConnect wallet (e.g. Paytaca)"
        />
      )}
    </Ctx.Provider>
  );
}

export function useWallet(): WalletCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet outside WalletProvider');
  return v;
}

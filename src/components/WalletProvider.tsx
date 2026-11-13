'use client';
// WizardConnect wallet context: exposes the connected wallet's first receive pubkey (used as the staker key).
import { createContext, useContext, useMemo, type ReactNode } from 'react';
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
  manager: ReturnType<typeof useWizardConnect>['manager'];
}

const Ctx = createContext<WalletCtx | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const wc = useWizardConnect({ dappName: 'CommitCash' });
  const stakerPubkeyHex = useMemo(() => {
    if (wc.state !== 'connected' || !wc.manager) return null;
    const child = childIndexOfPathName('receive') ?? 0;
    const pk = wc.manager.getPubkey(child, 0n);
    return pk ? binToHex(pk) : null;
  }, [wc.state, wc.manager]);

  return (
    <Ctx.Provider
      value={{
        state: wc.state,
        walletName: wc.walletName,
        stakerPubkeyHex,
        connect: wc.connect,
        disconnect: wc.disconnect,
        error: wc.error,
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

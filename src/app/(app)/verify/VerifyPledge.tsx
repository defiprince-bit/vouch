'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import type { VerifyRequest } from '@/lib/share';
import { decodeAnyVerifyRequest, isQuorumRequest, type QuorumVerifyRequest } from '@/lib/quorumShare';
import { VerifyQuorum } from './VerifyQuorum';
import { stakerP2pkhAddress, verifyByHeight } from '@/lib/vouch';
import { formatBch, formatDateTime, shortAddr, BLOCK_SECONDS } from '@/lib/format';
import { TxLink } from '@/components/TxLink';
import { Ticket } from '@/components/Ticket';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { useNetwork } from '@/lib/useNetwork';
import { networkLabel, storeNetwork } from '@/lib/network';
import { pledgeContract, findWalletIndex, approveKeepAsVerifier } from '@/lib/walletActions';

// Link data lives in the URL fragment, which browsers never send to the server. A `?pledge=` form
// is accepted too (moved into the fragment on load), but the app only ever generates # links.
function readLinkData(): string {
  const q = new URLSearchParams(window.location.search).get('pledge');
  if (q && !window.location.hash) {
    window.history.replaceState(null, '', `${window.location.pathname}#pledge=${q}`);
  }
  return window.location.hash || (q ? `#pledge=${q}` : '');
}

function useHash(): string | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    readLinkData,
    () => null,
  );
}

type Done = { txid: string; kind: 'kept' | 'broken' };

export function VerifyPledge() {
  const hash = useHash();
  const parsed = useMemo((): { req: VerifyRequest | QuorumVerifyRequest | null; error: string | null } => {
    if (hash === null) return { req: null, error: null };
    if (!hash || hash === '#') return { req: null, error: 'This link is missing its pledge details. Ask your friend to copy the whole link again.' };
    try {
      return { req: decodeAnyVerifyRequest(hash), error: null };
    } catch (e) {
      return { req: null, error: (e as Error).message };
    }
  }, [hash]);
  // VerifyQuorum keeps its own copy (it rewrites the hash as signatures are added); remount only for another pledge/lock.
  if (parsed.req && isQuorumRequest(parsed.req)) return <VerifyQuorum key={`${parsed.req.pledge.contractAddress}:${parsed.req.utxo.txid}`} initial={parsed.req} />;
  return <VerifyV1 hash={hash} parsed={parsed as { req: VerifyRequest | null; error: string | null }} />;
}

function VerifyV1({ hash, parsed }: { hash: string | null; parsed: { req: VerifyRequest | null; error: string | null } }) {
  const wallet = useWallet();
  const network = useNetwork();
  const demo = useDemoVerifier();
  const req = parsed.req;
  const [chain, setChain] = useState<{ height: number; locked: boolean; at: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req) return;
    const { provider, contract } = pledgeContract(req.pledge);
    Promise.all([provider.getBlockHeight(), contract.getUtxos()])
      .then(([height, utxos]) => setChain({ height, locked: utxos.some((u) => u.txid === req.utxo.txid && u.vout === req.utxo.vout), at: Date.now() }))
      .catch((e: Error) => setMsg(e.message));
  }, [req]);

  if (hash === null) return <p className="hint" style={{ marginTop: 32 }}>Loading…</p>;
  if (!req) {
    return (
      <>
        <header className="screen-head">
          <div>
            <p className="crumbs">Verify</p>
            <h1>This link doesn’t work</h1>
            <p className="lede">{parsed.error}</p>
          </div>
        </header>
        <p>Want to be someone’s verifier? <Link href="/verifier-key">Get your verifier key</Link>.</p>
      </>
    );
  }

  const p = req.pledge;
  const verifyBy = verifyByHeight(p.deadline);
  const deadlineMs = chain ? chain.at + (p.deadline - chain.height) * BLOCK_SECONDS * 1000 : (p.deadlineAt ?? 0);
  const verifyByMs = deadlineMs ? deadlineMs - (p.deadline - verifyBy) * BLOCK_SECONDS * 1000 : 0;
  const tooLate = chain !== null && chain.height >= verifyBy;
  const settled = chain !== null && !chain.locked && !done;
  const isDemoVerifier = !!demo.pubkey && demo.pubkey === p.verifierPubkey.toLowerCase();
  const connected = wallet.state === 'connected' && !!wallet.manager;
  const walletIndex = connected ? findWalletIndex(wallet.manager!, p.verifierPubkey) : null;
  const stake = formatBch(p.stakeSats);
  const beneName = p.beneficiaryName ?? 'the beneficiary';
  const stakerAddr = stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network);
  const blocked = busy || tooLate || settled;
  const netOk = p.network === network;

  async function go(kind: Done['kind'], f: () => Promise<{ txid: string }>) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await f();
      setDone({ txid: r.txid, kind });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const demoApprove = () =>
    go('kept', async () => {
      const res = await fetch('/api/verifier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'keep', pledge: { ...p }, confirm: true, note: 'approved via verify link', stakerSig: req.stakerSig }),
      });
      const j = (await res.json()) as { txid?: string; error?: string };
      if (!res.ok || !j.txid) throw new Error(j.error ?? 'The demo verifier refused');
      return { txid: j.txid };
    });

  const title = done ? (done.kind === 'kept' ? 'Refund signed' : 'Ruled broken') : settled ? 'Already settled' : 'Sign this refund';
  const lede = done
    ? done.kind === 'kept' ? 'You signed the refund transaction in your wallet. It has been sent.' : `You signed the payout to ${beneName}. It has been sent.`
    : settled ? 'The stake has already left this contract, so there’s nothing left to sign.'
    : 'You’re asked to confirm this habit was kept, then sign the refund transaction in your wallet — not a message.';
  const [badge, badgeCls] = done ? (done.kind === 'kept' ? ['Signed', ''] : ['Broken', 'badge-bad']) : settled ? ['Closed', 'badge-off'] : tooLate ? ['Window closed', 'badge-off'] : ['Awaiting your signature', 'badge-wait'];

  return (
    <>
      <header className="screen-head">
        <div>
          <p className="crumbs">Verify</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          {p.network === 'mainnet' && <p className="footnote">Mainnet pledge: real BCH.</p>}
        </div>
        <span className={`badge ${badgeCls}`}>{badge}</span>
      </header>

      <div className="layout-2">
        <Ticket
          tag="Shared with you to verify"
          stamp={done ? (done.kind === 'kept' ? 'Signed' : 'Broken') : 'Sign'}
          stampClass={done ? (done.kind === 'kept' ? 'stamp-kept' : 'stamp-broke') : 'stamp-wait'}
          habit={p.promise}
          stake={stake}
          deadline={deadlineMs ? formatDateTime(deadlineMs) : `Block ${p.deadline}`}
          verifier="Your friend (staker)"
          verifierNote={shortAddr(stakerAddr)}
          beneficiary={p.beneficiaryName ?? 'Beneficiary'}
          beneficiaryAddr={shortAddr(p.beneficiaryAddress)}
          keepCopy={
            p.verifierRefund
              ? `The ${stake} returns to your friend’s refund address, fixed when they locked it. Your signature is all it needs.`
              : `The ${stake} returns to your friend. Their signature is already on this refund.`
          }
          breakCopy={`After the deadline, anyone can settle the forfeit to ${beneName}.`}
        />

        <aside className="sticky-aside">
          <div className="panel">
            <h2>{done ? 'Signed' : 'Your signature'}</h2>
            {done ? (
              <div className="callout" style={done.kind === 'kept' ? { background: 'var(--keep-tint)', borderColor: '#B7D8CA' } : { background: 'var(--forfeit-tint)', borderColor: '#E4C4B8' }}>
                <strong>{done.kind === 'kept' ? 'You signed the refund' : 'You ruled it broken'}</strong>
                <p>{done.kind === 'kept' ? `${stake} is on its way back to your friend.` : `${stake} is on its way to ${beneName}.`}</p>
              </div>
            ) : (
              <>
                <p className="hint" style={{ marginBottom: 16 }}>
                  {tooLate
                    ? 'The verify-by time has passed: a refund now could lose the race to a forfeit.'
                    : `Get it signed by ${verifyByMs ? formatDateTime(verifyByMs) : `block ${verifyBy}`}. After the deadline, a forfeit can still win the race.`}
                </p>
                {settled ? (
                  <div className="callout"><strong>Nothing to sign</strong><p>This pledge has already been settled.</p></div>
                ) : isDemoVerifier && p.verifierRefund ? (
                  <div className="callout">
                    <strong>The staker asks the demo verifier</strong>
                    <p>This pledge uses the Vouch demo verifier. Your friend asks it for the refund from their own pledge page; there’s nothing to sign here.</p>
                  </div>
                ) : isDemoVerifier ? (
                  <>
                    <button className="btn btn-keep btn-lg btn-block" type="button" disabled={blocked} onClick={demoApprove}>
                      {busy ? 'Sending…' : 'Approve with the Vouch demo verifier'}
                    </button>
                    <p className="footnote" style={{ marginTop: 10 }}>This pledge uses the demo verifier, which is run by Vouch.</p>
                  </>
                ) : !netOk ? (
                  <div className="callout callout-warn" role="note" data-testid="network-mismatch">
                    <strong>This pledge is on {p.network}</strong>
                    <p>The app is on {network}. Switch the app to {p.network}, then connect a wallet on {p.network} to sign.</p>
                    <button className="btn btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => storeNetwork(p.network)}>
                      Switch to {networkLabel(p.network)}
                    </button>
                  </div>
                ) : !connected ? (
                  <>
                    <div className="callout">
                      <strong>Connect your wallet</strong>
                      <p>Use the wallet whose verifier key your friend used.</p>
                    </div>
                    <ConnectWallet size="lg" />
                  </>
                ) : walletIndex === null ? (
                  <div className="callout" style={{ background: 'var(--forfeit-tint)', borderColor: '#E4C4B8' }}>
                    <strong>Wrong wallet</strong>
                    <p>This wallet doesn’t hold the verifier key named in this pledge.</p>
                  </div>
                ) : (
                  <button className="btn btn-keep btn-lg btn-block" type="button" disabled={blocked} onClick={() => go('kept', () => approveKeepAsVerifier(wallet.manager!, req, walletIndex))}>
                    {busy ? 'Waiting for wallet…' : 'Sign the refund in your wallet'}
                  </button>
                )}
              </>
            )}
            {msg && <p className="error-text">{msg}</p>}
            {done && <TxLink txid={done.txid} network={p.network} label={done.kind === 'kept' ? 'Refund tx' : 'Payout tx'} />}
          </div>
        </aside>
      </div>
    </>
  );
}

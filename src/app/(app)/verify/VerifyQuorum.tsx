'use client';
// /verify for a v2 (quorum) link: shows who has signed, lets a verifier add their approval (or break
// vote) from their wallet, and passes on an updated link. Whoever completes M of N broadcasts.
import { useEffect, useMemo, useState } from 'react';
import { hexToBin } from '@bitauth/libauth';
import { verifyByHeight, stakerP2pkhAddress } from '@/lib/vouch';
import { formatBch, formatDateTime, shortAddr, BLOCK_SECONDS } from '@/lib/format';
import { networkLabel, storeNetwork } from '@/lib/network';
import { useNetwork } from '@/lib/useNetwork';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { TxLink } from '@/components/TxLink';
import { Ticket } from '@/components/Ticket';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';
import { findWalletIndex } from '@/lib/walletActions';
import { checkRequestSigs, quorumContract, quorumVerifyLink, slotLabels, encodeQuorumRequest, type QuorumVerifyRequest } from '@/lib/quorumShare';
import { signQuorumSlot, demoQuorumSig, broadcastQuorumKeep, broadcastQuorumBreak } from '@/lib/quorumActions';

type Done = { txid: string; kind: 'kept' | 'broken' };

export function VerifyQuorum({ initial }: { initial: QuorumVerifyRequest }) {
  const wallet = useWallet();
  const network = useNetwork();
  const [r, setR] = useState(initial);
  const p = r.pledge;
  const demo = useDemoVerifier(p.network);
  const st = useMemo(() => checkRequestSigs(r), [r]);
  const [chain, setChain] = useState<{ height: number; locked: boolean; at: number } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const c = quorumContract(p);
    Promise.all([c.provider.getBlockHeight(), c.getUtxos()])
      .then(([height, utxos]) => setChain({ height, locked: utxos.some((u) => u.txid === r.utxo.txid && u.vout === r.utxo.vout), at: Date.now() }))
      .catch((e: Error) => setMsg(e.message));
  }, [p, r.utxo.txid, r.utxo.vout]);

  // Keep the address bar in sync, so the page's own URL is always the latest link to pass on.
  useEffect(() => {
    window.history.replaceState(null, '', `${window.location.pathname}#pledge=${encodeQuorumRequest({ ...r, keepSigs: st.keepSigs, breakSigs: st.breakSigs })}`);
  }, [r, st]);

  const m = p.threshold;
  const n = p.verifiers.length;
  const labels = slotLabels(p, demo.pubkey);
  const verifyBy = verifyByHeight(p.deadline);
  const deadlineMs = chain ? chain.at + (p.deadline - chain.height) * BLOCK_SECONDS * 1000 : (p.deadlineAt ?? 0);
  const verifyByMs = deadlineMs ? deadlineMs - (p.deadline - verifyBy) * BLOCK_SECONDS * 1000 : 0;
  const tooLate = chain !== null && chain.height >= verifyBy;
  const settled = chain !== null && !chain.locked && !done;
  const netOk = p.network === network;
  const connected = wallet.state === 'connected' && !!wallet.manager;
  const stake = formatBch(p.stakeSats);
  const beneName = p.beneficiaryName ?? 'the beneficiary';
  const stakerAddr = stakerP2pkhAddress(hexToBin(p.stakerPubkey), p.network);
  // Which verifier slot(s) this wallet holds.
  const mySlots = connected ? labels.map((l) => ({ ...l, index: findWalletIndex(wallet.manager!, l.pubkey) })).filter((l) => l.index !== null) : [];
  const mySlot = mySlots.find((l) => !st.keepSigs[l.slot] && !st.breakSigs[l.slot]) ?? mySlots[0];
  const demoSlot = labels.find((l) => l.isDemo && !st.keepSigs[l.slot]);
  const blocked = !!busy || tooLate || settled || !!done || !st.stakerSigOk;
  const link = typeof window !== 'undefined' ? quorumVerifyLink(window.location.origin, { ...r, keepSigs: st.keepSigs, breakSigs: st.breakSigs }) : '';

  async function go(label: string, f: () => Promise<void>) {
    setBusy(label);
    setMsg(null);
    setOkMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  /** Add a signature; if that completes the quorum, broadcast right away. */
  async function addAndMaybeSend(next: QuorumVerifyRequest, kind: 'keep' | 'break') {
    setR(next);
    const s = checkRequestSigs(next);
    const count = kind === 'keep' ? s.keepCount : s.breakCount;
    if (count >= m) {
      const tx = kind === 'keep' ? await broadcastQuorumKeep(next) : await broadcastQuorumBreak(next);
      setDone({ txid: tx.txid, kind: kind === 'keep' ? 'kept' : 'broken' });
    } else {
      setOkMsg(`Signed. ${count} of ${m} ${kind === 'keep' ? 'approvals' : 'break votes'}: pass the link below to the next verifier.`);
    }
  }

  const title = done ? (done.kind === 'kept' ? 'Refund sent' : 'Ruled broken') : settled ? 'Already settled' : `Approve as one of ${n} verifiers`;
  const lede = done
    ? done.kind === 'kept' ? `${m} of ${n} verifiers approved. The refund has been sent.` : `${m} of ${n} verifiers ruled it broken. The stake has been sent to ${beneName}.`
    : settled ? 'The stake has already left this contract, so there’s nothing left to sign.'
    : `Any ${m} of the ${n} verifiers below must sign for your friend to get the stake back. Signatures are added one by one; the link carries them.`;

  return (
    <>
      <header className="screen-head">
        <div>
          <p className="crumbs">Verify</p>
          <h1>{title}</h1>
          <p className="lede">{lede}</p>
          {p.network === 'mainnet' && <p className="footnote">Mainnet pledge: real BCH.</p>}
        </div>
        <span className={`badge ${done ? (done.kind === 'broken' ? 'badge-bad' : '') : settled || tooLate ? 'badge-off' : 'badge-wait'}`} data-testid="quorum-progress">
          {st.keepCount} of {m} approved
        </span>
      </header>

      <div className="layout-2">
        <Ticket
          tag={`Shared with you to verify · ${m} of ${n}`}
          stamp={done ? (done.kind === 'kept' ? 'Kept' : 'Broken') : 'Sign'}
          stampClass={done ? (done.kind === 'kept' ? 'stamp-kept' : 'stamp-broke') : 'stamp-wait'}
          habit={p.promise}
          stake={stake}
          deadline={deadlineMs ? formatDateTime(deadlineMs) : `Block ${p.deadline}`}
          verifier="Your friend (staker)"
          verifierNote={shortAddr(stakerAddr)}
          beneficiary={p.beneficiaryName ?? 'Beneficiary'}
          beneficiaryAddr={shortAddr(p.beneficiaryAddress)}
          keepCopy={`The ${stake} returns to your friend once ${m} of ${n} verifiers sign. Their own signature is already in this link.`}
          breakCopy={`${m} of ${n} verifiers can rule it broken: the stake goes to ${beneName}. After the deadline anyone can settle it there.`}
        />

        <aside className="sticky-aside">
          <div className="panel">
            <h2>Verifiers</h2>
            <dl className="kv" data-testid="quorum-signers">
              {labels.map((l) => (
                <div className="kv-row" key={l.slot}>
                  <dt>{l.name}{mySlots.some((s) => s.slot === l.slot) ? ' (you)' : ''}</dt>
                  <dd>
                    {st.keepSigs[l.slot] ? <span className="badge">Approved</span> : st.breakSigs[l.slot] ? <span className="badge badge-bad">Voted broken</span> : <span className="badge badge-wait">Not yet</span>}
                  </dd>
                </div>
              ))}
            </dl>
            {!st.stakerSigOk && <p className="error-text">The staker’s signature in this link is invalid. Ask them for a fresh link.</p>}
            {st.dropped.length > 0 && <p className="error-text">{st.dropped.length} signature(s) in this link didn’t check out and were ignored.</p>}

            {!done && !settled && (
              <div style={{ marginTop: 14 }}>
                <p className="hint" style={{ marginBottom: 12 }}>
                  {tooLate
                    ? 'The verify-by time has passed: a refund now could lose the race to a forfeit.'
                    : `Get it signed by ${verifyByMs ? formatDateTime(verifyByMs) : `block ${verifyBy}`}.`}
                </p>
                {!netOk ? (
                  <div className="callout callout-warn" role="note" data-testid="network-mismatch">
                    <strong>This pledge is on {p.network}</strong>
                    <p>The app is on {network}. Switch the app to {p.network}, then connect a wallet on {p.network} to sign.</p>
                    <button className="btn btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => storeNetwork(p.network)}>
                      Switch to {networkLabel(p.network)}
                    </button>
                  </div>
                ) : st.keepCount >= m ? (
                  <button className="btn btn-keep btn-lg btn-block" type="button" disabled={blocked} onClick={() => go('send', async () => setDone({ txid: (await broadcastQuorumKeep(r)).txid, kind: 'kept' }))}>
                    {busy === 'send' ? 'Sending…' : `${m} of ${n} approved — send the refund`}
                  </button>
                ) : (
                  <div className="actions-stack" style={{ display: 'grid', gap: 10 }}>
                    {demoSlot && demo.enabled && (
                      <button className="btn btn-ghost btn-block" type="button" disabled={blocked} onClick={() => go('demo', async () => addAndMaybeSend(await demoQuorumSig(r, 'approved via quorum verify link'), 'keep'))}>
                        {busy === 'demo' ? 'Asking…' : 'Add the Vouch demo verifier’s approval'}
                      </button>
                    )}
                    {!connected ? (
                      <>
                        <div className="callout">
                          <strong>Are you one of the verifiers?</strong>
                          <p>Connect the wallet whose verifier key your friend used.</p>
                        </div>
                        <ConnectWallet size="lg" />
                      </>
                    ) : !mySlot ? (
                      <div className="callout" style={{ background: 'var(--forfeit-tint)', borderColor: '#E4C4B8' }}>
                        <strong>Wrong wallet</strong>
                        <p>This wallet doesn’t hold any of the verifier keys named in this pledge.</p>
                      </div>
                    ) : st.keepSigs[mySlot.slot] || st.breakSigs[mySlot.slot] ? (
                      <div className="callout">
                        <strong>You’ve signed</strong>
                        <p>Pass the link below to another verifier.</p>
                      </div>
                    ) : (
                      <>
                        <button className="btn btn-keep btn-lg btn-block" type="button" disabled={blocked} onClick={() => go('keep', async () => addAndMaybeSend(await signQuorumSlot(wallet.manager!, r, mySlot.slot, mySlot.index!, 'keep'), 'keep'))}>
                          {busy === 'keep' ? 'Waiting for wallet…' : `Approve as ${mySlot.name}: sign the refund`}
                        </button>
                        <button
                          className="btn btn-danger btn-block"
                          type="button"
                          disabled={blocked}
                          onClick={() =>
                            window.confirm(`Vote that “${p.promise}” was broken? With ${m} votes, ${stake} goes to ${beneName}.`) &&
                            go('break', async () => addAndMaybeSend(await signQuorumSlot(wallet.manager!, r, mySlot.slot, mySlot.index!, 'break'), 'break'))
                          }
                        >
                          {busy === 'break' ? 'Waiting for wallet…' : 'It was broken: vote to pay the beneficiary'}
                        </button>
                      </>
                    )}
                    {st.breakCount >= m && (
                      <button className="btn btn-danger btn-block" type="button" disabled={blocked} onClick={() => go('sendbreak', async () => setDone({ txid: (await broadcastQuorumBreak(r)).txid, kind: 'broken' }))}>
                        {m} of {n} voted broken — send the payout
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {!done && !settled && (st.keepCount > 0 || st.breakCount > 0) && st.keepCount < m && (
              <div style={{ marginTop: 14 }}>
                <p className="field-label" style={{ marginBottom: 6 }}>Pass it on</p>
                <div className="copy-link">
                  <input type="text" readOnly value={link} aria-label="Updated signing link" onFocus={(e) => e.currentTarget.select()} />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(link).catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>This link carries every signature so far. Send it to the next verifier, or back to your friend.</p>
              </div>
            )}

            {okMsg && <p className="ok-text">{okMsg}</p>}
            {msg && <p className="error-text">{msg}</p>}
            {done && <TxLink txid={done.txid} network={p.network} label={done.kind === 'kept' ? 'Refund tx' : 'Payout tx'} />}
          </div>
        </aside>
      </div>
    </>
  );
}

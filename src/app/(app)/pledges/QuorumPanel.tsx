'use client';
// Staker's view of a v2 (quorum) pledge: who has approved, the one signing link to pass around,
// a box to paste links that come back, the demo verifier's approval, and the final broadcast.
import { useMemo, useState } from 'react';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import {
  checkRequestSigs,
  decodeAnyVerifyRequest,
  isQuorumRequest,
  mergeRequests,
  quorumVerifyLink,
  slotLabels,
  type QuorumVerifyRequest,
} from '@/lib/quorumShare';
import { quorumTerms, progressOf, demoQuorumSig, broadcastQuorumKeep, broadcastQuorumBreak, stakerProofOf } from '@/lib/quorumActions';
import { QUORUM_FEE, quorumSignVerb } from '@/lib/quorum';
import { shortAddr } from '@/lib/format';
import { stakerP2pkhAddress } from '@/lib/vouch';
import { hexToBin } from '@bitauth/libauth';

/** The pledge's saved progress as a request (null until the link exists; v2: until the staker has pre-signed). */
export function savedRequest(p: StoredPledge): QuorumVerifyRequest | null {
  if (!p.quorum || (!p.verifierRefund && !p.quorum.stakerSig)) return null;
  return {
    v: 2,
    pledge: quorumTerms(p),
    utxo: p.quorum.utxo,
    fee: QUORUM_FEE.toString(),
    stakerSig: p.verifierRefund ? '' : p.quorum.stakerSig!,
    keepSigs: p.quorum.keepSigs,
    breakSigs: p.quorum.breakSigs,
  };
}

export function QuorumPanel(props: {
  pledge: StoredPledge;
  active: boolean;
  demoPubkey: string | null;
  demoEnabled: boolean;
  onSent: (txid: string, outcome: 'kept' | 'broken') => void;
}) {
  const { pledge, active, demoPubkey, demoEnabled, onSent } = props;
  const req = savedRequest(pledge);
  const state = useMemo(() => {
    const r = savedRequest(pledge);
    return r ? checkRequestSigs(r) : null;
  }, [pledge]);
  const labels = slotLabels(pledgeTermsLite(pledge), demoPubkey);
  const m = pledge.threshold ?? 1;
  const n = pledge.verifiers?.length ?? 0;
  const [paste, setPaste] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState(false);
  const keepCount = state?.keepCount ?? 0;
  const breakCount = state?.breakCount ?? 0;
  const link = req && typeof window !== 'undefined' ? quorumVerifyLink(window.location.origin, req) : null;
  const demoSlot = labels.find((l) => l.isDemo);

  function save(r: QuorumVerifyRequest) {
    const st = checkRequestSigs(r);
    savePledge({ ...pledge, quorum: progressOf({ ...r, keepSigs: st.keepSigs, breakSigs: st.breakSigs }) });
    return st;
  }

  async function act(label: string, f: () => Promise<void>) {
    setBusy(label);
    setMsg(null);
    try {
      await f();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const mergePaste = () =>
    act('Merge', async () => {
      if (!req) throw new Error('Tap Keep first to pre-sign your refund.');
      const other = decodeAnyVerifyRequest(paste.trim().replace(/^.*#/, '#'));
      if (!isQuorumRequest(other)) throw new Error('That’s a single-verifier link, not one for this pledge');
      const before = keepCount + breakCount;
      const st = save(mergeRequests(req, other));
      setPaste('');
      setMsg(st.keepCount + st.breakCount > before ? `Added. ${st.keepCount} of ${m} approved.` : 'No new signatures in that link.');
    });

  return (
    <div data-testid="quorum-panel">
      <p className="field-label" style={{ marginBottom: 6 }}>
        {m} of {n} must approve
      </p>
      <p style={{ margin: '0 0 10px', fontWeight: 600 }} data-testid="quorum-progress">
        {keepCount} of {m} approved{breakCount ? ` · ${breakCount} of ${m} voted broken` : ''}
      </p>
      <dl className="kv">
        {labels.map((l) => (
          <div className="kv-row" key={l.slot}>
            <dt>{l.name}</dt>
            <dd>
              {state?.keepSigs[l.slot] ? (
                <span className="badge">Approved</span>
              ) : state?.breakSigs[l.slot] ? (
                <span className="badge badge-bad">Voted broken</span>
              ) : (
                <span className="badge badge-wait">Not yet</span>
              )}{' '}
              <span className="addr">{l.isDemo ? 'demo key' : shortAddr(stakerP2pkhAddress(hexToBin(l.pubkey), pledge.network))}</span>
            </dd>
          </div>
        ))}
      </dl>

      {active && req && keepCount >= m && (
        <button
          className="btn btn-keep btn-lg btn-block"
          type="button"
          style={{ marginTop: 12 }}
          disabled={!!busy}
          onClick={() => act('Refund', async () => onSent((await broadcastQuorumKeep(req)).txid, 'kept'))}
        >
          {busy === 'Refund' ? 'Sending…' : `${keepCount} of ${m} approved — send my refund`}
        </button>
      )}
      {active && req && breakCount >= m && keepCount < m && (
        <button
          className="btn btn-danger btn-lg btn-block"
          type="button"
          style={{ marginTop: 12 }}
          disabled={!!busy}
          onClick={() => act('Payout', async () => onSent((await broadcastQuorumBreak(req)).txid, 'broken'))}
        >
          {busy === 'Payout' ? 'Sending…' : 'Verifiers ruled it broken — send the payout'}
        </button>
      )}

      {active && req && demoSlot && demoEnabled && !state?.keepSigs[demoSlot.slot] && keepCount < m && (
        <div className="confirm-box">
          <label htmlFor="q-demo-note">Ask the demo verifier: what did you do?</label>
          <textarea id="q-demo-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ran on Monday, Wednesday and Friday." />
          <button
            className="btn btn-ghost"
            type="button"
            disabled={note.trim().length < 3 || !!busy}
            onClick={() =>
              act('Demo', async () => {
                const st = save(await demoQuorumSig(req, note, pledge.verifierRefund ? stakerProofOf(pledge) : null));
                setMsg(`The demo verifier approved. ${st.keepCount} of ${m}.`);
              })
            }
          >
            {busy === 'Demo' ? 'Asking…' : 'Add the demo verifier’s approval'}
          </button>
        </div>
      )}

      {active && link && keepCount < m && (
        <div style={{ marginTop: 12 }}>
          <p className="field-label" style={{ marginBottom: 6 }}>
            Signing link for your verifiers
          </p>
          <div className="copy-link">
            <input type="text" readOnly value={link} aria-label="Verifier signing link" onFocus={(e) => e.currentTarget.select()} />
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
          <p className="hint" style={{ marginTop: 6 }}>
            Send it to any verifier. Each one signs, then gets a new link carrying their signature to pass to the next verifier, or back to you. Whoever completes {m} of {n} sends the refund. The link always carries everything collected so far.
          </p>
          <div className="field" style={{ marginTop: 10 }}>
            <label htmlFor="q-paste">Got a link back? Paste it here</label>
            <div className="copy-link">
              <input id="q-paste" type="text" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="https://…/verify#pledge=…" spellCheck={false} />
              <button className="btn btn-ghost" type="button" disabled={!paste.trim() || !!busy} onClick={mergePaste}>
                Add
              </button>
            </div>
          </div>
        </div>
      )}
      {active && !req && (
        <p className="hint" style={{ marginTop: 10 }}>
          {pledge.verifierRefund
            ? `Tap “I kept it” to get the signing link. You don’t sign: any ${m} of your ${n === 1 ? 'verifier' : 'verifiers'} ${quorumSignVerb(m)} the refund back to your address.`
            : 'Tap “I kept it” to pre-sign your refund and get the signing link.'}
        </p>
      )}
      {state && state.dropped.length > 0 && <p className="error-text">Dropped {state.dropped.length} signature(s) that didn’t check out.</p>}
      {msg && <p className={/^(Added|The demo|No new)/.test(msg) ? 'ok-text' : 'error-text'}>{msg}</p>}
    </div>
  );
}

const pledgeTermsLite = (p: StoredPledge) => ({ verifiers: (p.verifiers ?? []).map((v) => ({ pubkey: v.pubkey, name: v.name })) });

'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { createPledgeContract, getProvider, newPledgeId, validatePledge, verifyByHeight, MIN_STAKE, DEFAULT_MAX_FEE } from '@/lib/vouch';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import { NETWORK, EXPLORER_ADDR } from '@/lib/config';
import { bchToSats, blocksUntil, formatBch, formatDateTime, formatSats, toDateTimeLocal, estimateBlockTime } from '@/lib/format';
import { TxLink } from '@/components/TxLink';
import { Ticket } from '@/components/Ticket';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { lockFromWallet } from '@/lib/walletActions';
import { useNow } from '@/lib/useNow';

type Step = 'details' | 'review' | 'done';
const MIN_DEADLINE_BLOCKS = 12;
const SAME_ADDR = 'The verifier and the beneficiary can’t be the same. If they were, they could agree the habit was broken and take the stake.';

export function CreatePledgeForm() {
  const wallet = useWallet();
  const demo = useDemoVerifier();
  const [step, setStep] = useState<Step>('details');
  const [habit, setHabit] = useState('');
  const [amount, setAmount] = useState('0.0001');
  const clientNow = useNow();
  const [deadlinePicked, setDeadlineLocal] = useState<string | null>(null);
  const deadlineLocal = deadlinePicked ?? (clientNow ? toDateTimeLocal(clientNow + 7 * 86_400_000) : '');
  const [verifierMode, setVerifierMode] = useState<'demo' | 'friend'>('demo');
  const [friendName, setFriendName] = useState('');
  const [friendKey, setFriendKey] = useState('');
  const [beneName, setBeneName] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [manualStaker, setManualStaker] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [draft, setDraft] = useState<StoredPledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);
  const [lockTxid, setLockTxid] = useState<string | null>(null);

  const sats = bchToSats(amount);
  const minFail = sats !== null && sats < MIN_STAKE;
  const deadlineMs = new Date(deadlineLocal).getTime();
  const stakerHex = wallet.stakerPubkeyHex ?? manualStaker.trim();
  const verifierHex = verifierMode === 'demo' ? (demo.pubkey ?? '') : friendKey.trim();
  const verifierLabel = verifierMode === 'demo' ? 'Vouch demo' : friendName.trim() || 'Your friend';
  const beneLabel = beneName.trim() || 'The beneficiary';
  const sameAddr = errors.includes(SAME_ADDR);
  const preview = useMemo(
    () => ({
      habit: habit.trim() || 'Your habit, in one line.',
      stake: sats && sats > 0n ? formatBch(sats) : '—',
      deadline: Number.isFinite(deadlineMs) ? formatDateTime(deadlineMs) : '—',
    }),
    [habit, sats, deadlineMs],
  );

  async function review(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const errs: string[] = [];
    if (!habit.trim()) errs.push('Write the habit in one line.');
    if (sats === null || sats < MIN_STAKE) errs.push(`The stake must be at least ${formatSats(MIN_STAKE)} (${formatBch(MIN_STAKE)}), so the payout stays above dust after fees.`);
    if (!Number.isFinite(deadlineMs) || deadlineMs - Date.now() < MIN_DEADLINE_BLOCKS * 600_000) errs.push('Pick a deadline at least 2 hours from now.');
    if (!/^[0-9a-f]{66}$/i.test(stakerHex)) errs.push('Connect your wallet first (or paste your public key below).');
    if (!/^[0-9a-f]{66}$/i.test(verifierHex)) {
      errs.push(verifierMode === 'demo' ? 'The demo verifier is not available on this deployment. Pick a friend.' : 'Paste your friend’s verifier key. They get it from the /verifier-key page.');
    }
    if (errs.length) return setErrors(errs);
    setBusy(true);
    try {
      const provider = getProvider();
      const height = await provider.getBlockHeight();
      const now = Date.now();
      const deadline = height + blocksUntil(deadlineMs, now, MIN_DEADLINE_BLOCKS);
      const params = {
        stakerPubkey: hexToBin(stakerHex),
        verifierPubkey: hexToBin(verifierHex),
        beneficiaryAddress: beneficiary.trim(),
        deadline,
        pledgeId: newPledgeId(),
      };
      const issues = validatePledge(params, sats!).map((i) => (i === 'Verifier must not be the beneficiary' ? SAME_ADDR : i));
      const hard = issues.filter((i) => !i.startsWith('Verifier is the staker'));
      if (hard.length) return setErrors(hard);
      const contract = createPledgeContract(params, provider);
      setDraft({
        id: params.pledgeId,
        promise: habit.trim(),
        stakeSats: sats!.toString(),
        deadline,
        deadlineAt: estimateBlockTime(deadline, height, now),
        beneficiaryAddress: params.beneficiaryAddress,
        beneficiaryName: beneName.trim() || undefined,
        stakerPubkey: stakerHex,
        verifierPubkey: verifierHex,
        verifierKind: verifierMode,
        verifierName: verifierMode === 'friend' ? friendName.trim() || undefined : undefined,
        contractAddress: contract.address,
        network: NETWORK,
        createdAt: now,
      });
      setStep('review');
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function signAndLock() {
    if (!draft) return;
    savePledge(draft);
    if (!wallet.manager) return setLockMsg('Connect your wallet to sign the lock.');
    setBusy(true);
    setLockMsg('Check your wallet to approve the lock…');
    try {
      const { txid } = await lockFromWallet(wallet.manager, draft);
      savePledge({ ...draft, lastTxid: txid, lockTxid: txid });
      setLockTxid(txid);
      setLockMsg(null);
      setStep('done');
    } catch (e) {
      setLockMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function saveUnfunded() {
    if (!draft) return;
    savePledge(draft);
    setStep('done');
  }

  const head = (
    <header className="screen-head">
      <div>
        <p className="crumbs"><Link href="/">Vouch</Link> / Create</p>
        <h1>Create a pledge</h1>
        <p className="lede">Name the habit, amount, verifier, and who is paid if you slip.</p>
      </div>
      <p className="progress">
        <span className={step === 'details' ? 'is-on' : ''}><span className="dot" /> 1 Details</span>
        <span className={step !== 'details' ? 'is-on' : ''}><span className="dot" /> 2 Review &amp; sign</span>
      </p>
    </header>
  );

  const ticket = (
    <Ticket
      tag={step === 'done' ? (lockTxid ? 'Locked in contract' : 'Saved — waiting for funds') : 'Draft — not yet locked'}
      stamp={step === 'done' && lockTxid ? 'Active' : 'Draft'}
      stampClass={step === 'done' && lockTxid ? '' : 'stamp-wait'}
      habit={preview.habit}
      stake={preview.stake}
      deadline={draft?.deadlineAt ? formatDateTime(draft.deadlineAt) : preview.deadline}
      verifier={verifierLabel}
      verifierNote={verifierMode === 'demo' ? 'Demo verifier is run by Vouch.' : undefined}
      beneficiary={beneLabel}
      beneficiaryAddr={beneficiary.trim() || undefined}
      keepCopy="Coins return to you after you sign and the verifier signs the refund in their wallet."
      breakCopy="Paid to the beneficiary. Same if time runs out."
    />
  );

  return (
    <>
      {head}
      <div className="layout-2">
        {step === 'details' && (
          <section>
            <form className="form-section" onSubmit={review} noValidate>
              <div className="field">
                <label htmlFor="habit">The habit</label>
                <textarea id="habit" maxLength={140} required value={habit} onChange={(e) => setHabit(e.target.value)} placeholder="Run three mornings this week." />
              </div>
              <div className="field-row">
                <div className={`field${minFail ? ' is-invalid' : ''}`}>
                  <label htmlFor="amount">Stake</label>
                  <div className="suffix-field">
                    <input id="amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
                    <span className="suffix">BCH</span>
                  </div>
                  {minFail ? (
                    <p className="field-error" role="alert">That stake is below the minimum of {formatSats(MIN_STAKE)}.</p>
                  ) : (
                    <p className="hint">
                      {sats ? `${formatSats(sats)}. ` : ''}Minimum {formatSats(MIN_STAKE)}; fees (max {formatSats(DEFAULT_MAX_FEE)}) come out of it.
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="deadline">Deadline</label>
                  <input id="deadline" type="datetime-local" required value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} />
                  <p className="hint">Stored as a block height (~10 min a block), so it can drift a little.</p>
                </div>
              </div>
              <fieldset className="choice-set">
                <legend>Verifier</legend>
                <div className="choice-row">
                  <label className="choice">
                    <input type="radio" name="verifier-type" checked={verifierMode === 'demo'} onChange={() => setVerifierMode('demo')} />
                    <span>
                      <b>Vouch demo verifier</b>
                      <span className="choice-help">Default. The app signs the refund in the demo wallet.</span>
                    </span>
                  </label>
                  <label className="choice">
                    <input type="radio" name="verifier-type" checked={verifierMode === 'friend'} onChange={() => setVerifierMode('friend')} />
                    <span>
                      <b>A friend</b>
                      <span className="choice-help">Share a signing link after you lock. They sign the refund in their wallet.</span>
                    </span>
                  </label>
                </div>
                {verifierMode === 'demo' && (
                  <p className="footnote" style={{ marginTop: 8 }}>
                    {!demo.loading && !demo.pubkey
                      ? 'The demo verifier is not configured on this deployment. Pick a friend.'
                      : 'Honour system: the demo verifier approves any refund you ask for. For real stakes, pick a friend.'}
                  </p>
                )}
                {verifierMode === 'friend' && (
                  <div className="field-row" style={{ marginTop: 12 }}>
                    <div className="field">
                      <label htmlFor="friend-name">Friend’s name</label>
                      <input id="friend-name" value={friendName} onChange={(e) => setFriendName(e.target.value)} placeholder="Amaka" />
                    </div>
                    <div className={`field${sameAddr ? ' is-invalid' : ''}`}>
                      <label htmlFor="friend-key">Friend’s verifier key</label>
                      <input id="friend-key" spellCheck={false} value={friendKey} onChange={(e) => setFriendKey(e.target.value)} placeholder="02… or 03…" />
                      <p className="hint">They open <Link href="/verifier-key">/verifier-key</Link> with their wallet and send you the key. Must not be the beneficiary.</p>
                    </div>
                  </div>
                )}
              </fieldset>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="bene-name">Beneficiary name <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>(optional)</span></label>
                  <input id="bene-name" value={beneName} onChange={(e) => setBeneName(e.target.value)} placeholder="Chidi" />
                </div>
                <div className={`field${sameAddr ? ' is-invalid' : ''}`}>
                  <label htmlFor="beneficiary">Beneficiary address</label>
                  <input id="beneficiary" required spellCheck={false} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder={NETWORK === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'} />
                  {sameAddr ? <p className="field-error" role="alert">{SAME_ADDR}</p> : <p className="hint">Paid in full if you break it or time runs out. Can’t be changed later.</p>}
                </div>
              </div>
              {!wallet.stakerPubkeyHex && (
                <div className="field">
                  <label htmlFor="manual-staker">No wallet connected? <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>Connect one above, or paste your public key</span></label>
                  <input id="manual-staker" spellCheck={false} value={manualStaker} onChange={(e) => setManualStaker(e.target.value)} placeholder="02… or 03…" />
                </div>
              )}
              {errors.filter((m) => m !== SAME_ADDR).map((m) => <p key={m} className="field-error" role="alert">{m}</p>)}
              <div className="form-actions">
                <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Review where the coins go'}</button>
                <Link className="btn btn-ghost" href="/">Cancel</Link>
              </div>
            </form>
          </section>
        )}

        {step === 'review' && draft && (
          <section id="step-review">
            <div className="review-card">
              <h2>Where the coins go</h2>
              <p className="hint" style={{ marginBottom: 16 }}>Nothing is locked until you sign this with your wallet.</p>
              <div className="split-outcomes">
                <div className="outcome-panel keep">
                  <h3>If you keep it</h3>
                  <p className="amount-lg">{formatBch(draft.stakeSats)}</p>
                  <p>Returns to your wallet after you sign, and <strong>{verifierLabel}</strong> signs the refund transaction. The contract will not refund on your signature alone.</p>
                </div>
                <div className="outcome-panel break">
                  <h3>Break or expiry</h3>
                  <p className="amount-lg">{formatBch(draft.stakeSats)}</p>
                  <p>Paid to <strong>{beneLabel}</strong>.</p>
                  <p className="addr" style={{ marginTop: 6 }}>{draft.beneficiaryAddress}</p>
                </div>
              </div>
              <dl className="kv">
                <div className="kv-row"><dt>Habit</dt><dd>{draft.promise}</dd></div>
                <div className="kv-row"><dt>Deadline</dt><dd>{draft.deadlineAt ? formatDateTime(draft.deadlineAt) : ''} <span className="addr">(block {draft.deadline})</span></dd></div>
                <div className="kv-row"><dt>Verify by</dt><dd>block {verifyByHeight(draft.deadline)}, about an hour before the deadline</dd></div>
                <div className="kv-row"><dt>Verifier</dt><dd>{verifierLabel}{draft.verifierKind === 'demo' && <span className="footnote" style={{ display: 'block' }}>Demo verifier is run by Vouch.</span>}</dd></div>
                <div className="kv-row"><dt>Contract</dt><dd className="addr"><a href={EXPLORER_ADDR + draft.contractAddress} target="_blank" rel="noreferrer">{draft.contractAddress}</a></dd></div>
              </dl>
              {lockMsg && <p className="callout" style={{ marginTop: 12 }}>{lockMsg}</p>}
              <div className="form-actions">
                {wallet.state === 'connected' ? (
                  <button className="btn btn-primary btn-lg" type="button" onClick={signAndLock} disabled={busy}>{busy ? 'Waiting for wallet…' : 'Sign and lock with wallet'}</button>
                ) : (
                  <ConnectWallet size="lg" />
                )}
                <button className="btn btn-ghost" type="button" onClick={() => { setStep('details'); setLockMsg(null); }}>Edit details</button>
              </div>
              <p className="footnote" style={{ marginTop: 14 }}>
                Signing opens your WizardConnect wallet. No wallet? <button type="button" className="link-button" onClick={saveUnfunded}>Save the pledge</button> and send exactly {formatSats(draft.stakeSats)} to the contract address yourself.
              </p>
            </div>
          </section>
        )}

        {step === 'done' && draft && (
          <section>
            <div className="review-card">
              <h2>{lockTxid ? 'Locked.' : 'Pledge saved'}</h2>
              {lockTxid ? (
                <TxLink txid={lockTxid} label="Lock transaction" />
              ) : (
                <p className="lede" style={{ margin: '0 0 12px' }}>Send exactly <strong>{formatSats(draft.stakeSats)}</strong> to <span className="addr">{draft.contractAddress}</span> to lock it.</p>
              )}
              <p className="lede" style={{ margin: '16px 0' }}>
                {draft.verifierKind === 'friend'
                  ? `When you’ve kept it, open the pledge and tap Keep: it makes a signing link for ${verifierLabel}. They sign the refund in their wallet.`
                  : 'When you’ve kept it, open the pledge and tap Keep before the verify-by time. The demo verifier signs the refund.'}
              </p>
              <div className="form-actions">
                <Link className="btn btn-primary btn-lg" href={`/pledges/${draft.id}`}>View the pledge</Link>
                <button className="btn btn-ghost" type="button" onClick={() => { setDraft(null); setLockTxid(null); setHabit(''); setStep('details'); }}>Make another</button>
              </div>
            </div>
          </section>
        )}

        <aside className="sticky-aside" aria-label="Live ticket preview">{ticket}</aside>
      </div>
    </>
  );
}

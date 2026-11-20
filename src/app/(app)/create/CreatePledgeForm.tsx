'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { createPledgeContract, getProvider, validatePledge, verifyByHeight, stakerP2pkhAddress, MIN_STAKE, DEFAULT_MAX_FEE } from '@/lib/vouch';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import { checkAddress, explorerAddr } from '@/lib/network';
import { useNetwork } from '@/lib/useNetwork';
import { bchToSats, blocksUntil, formatBch, formatDateTime, formatSats, toDateTimeLocal, estimateBlockTime } from '@/lib/format';
import { TxLink } from '@/components/TxLink';
import { Ticket } from '@/components/Ticket';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { lockFromWallet, walletBalance } from '@/lib/walletActions';
import { createQuorumContract, quorumPledgeIssues, quorumShapeIssues, quorumPowerCopy } from '@/lib/quorum';
import { QuorumFields, rowKeyError, type VerifierRow } from './QuorumFields';
import { useNow } from '@/lib/useNow';
import { defaultVisibility, VISIBILITY_COPY, HABIT_MAX, type Visibility } from '@/lib/wall';
import { listOnWall } from '@/lib/wallActions';
import { newListSecret, newListNonce, listSecretHash, listPledgeId } from '@/lib/listSecret';

type Step = 'details' | 'review' | 'done';
const MIN_DEADLINE_BLOCKS = 12;
const SAME_ADDR = 'The verifier and the beneficiary can’t be the same. If they were, they could agree the habit was broken and take the stake.';

export function CreatePledgeForm() {
  const wallet = useWallet();
  const network = useNetwork();
  const demo = useDemoVerifier(network);
  const [step, setStep] = useState<Step>('details');
  const [habit, setHabit] = useState('');
  const [amount, setAmount] = useState('0.0001');
  const clientNow = useNow();
  const [deadlinePicked, setDeadlineLocal] = useState<string | null>(null);
  const deadlineLocal = deadlinePicked ?? (clientNow ? toDateTimeLocal(clientNow + 7 * 86_400_000) : '');
  const [verifierModePicked, setVerifierMode] = useState<'demo' | 'friend' | 'group'>('demo');
  // The demo verifier doesn't sign on mainnet (unless the server allows it): fall back to a friend.
  const demoOk = demo.enabled;
  const verifierMode = verifierModePicked === 'demo' && !demo.loading && !demoOk ? 'friend' : verifierModePicked;
  const [groupRows, setGroupRows] = useState<VerifierRow[]>([{ name: '', key: '' }, { name: '', key: '' }]);
  const [groupDemo, setGroupDemo] = useState(false);
  const [threshold, setThreshold] = useState(2);
  const groupKeys = [...(groupDemo && demoOk && demo.pubkey ? [{ pubkey: demo.pubkey, name: 'Vouch demo', kind: 'demo' as const }] : []), ...groupRows.filter((r) => r.key.trim()).map((r) => ({ pubkey: r.key.trim().toLowerCase(), name: r.name.trim() || undefined, kind: 'friend' as const }))];
  // Not clamped: an M larger than the real verifier count is refused, never silently lowered.
  const groupM = threshold;
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
  const [visibilityPicked, setVisibility] = useState<Visibility | null>(null);
  const visibility = visibilityPicked ?? defaultVisibility(network);
  const [wallMsg, setWallMsg] = useState<{ kind: 'busy' | 'ok' | 'err'; text: string } | null>(null);

  const [walletSats, setWalletSats] = useState<bigint | null>(null);
  const connected = wallet.state === 'connected' && !!wallet.manager;
  const balance = connected ? walletSats : null;
  useEffect(() => {
    if (wallet.state !== 'connected' || !wallet.manager) return;
    let live = true;
    walletBalance(wallet.manager, network)
      .then((b) => live && setWalletSats(b))
      .catch(() => live && setWalletSats(null));
    return () => {
      live = false;
    };
  }, [wallet.state, wallet.manager, step, network]);

  // A draft is built for one network; if the user switches, send them back to edit it.
  const [draftNetwork, setDraftNetwork] = useState(network);
  if (draftNetwork !== network) {
    setDraftNetwork(network);
    if (step === 'review') {
      setDraft(null);
      setLockMsg(null);
      setStep('details');
    }
    setErrors([]);
  }
  const beneCheck = beneficiary.trim() ? checkAddress(beneficiary, network) : null;
  // Wrong-network addresses are flagged as soon as they're pasted; malformed ones after the first submit.
  const [triedSubmit, setTriedSubmit] = useState(false);
  const beneError = beneCheck && !beneCheck.ok && (beneCheck.network || triedSubmit) ? beneCheck.error : null;

  const sats = bchToSats(amount);
  const minFail = sats !== null && sats < MIN_STAKE;
  const deadlineMs = new Date(deadlineLocal).getTime();
  const stakerHex = wallet.stakerPubkeyHex ?? manualStaker.trim();
  const verifierHex = verifierMode === 'demo' ? (demo.pubkey ?? '') : friendKey.trim();
  const verifierLabel = verifierMode === 'demo' ? 'Vouch demo' : verifierMode === 'group' ? `${groupM} of ${groupKeys.length || '…'} verifiers` : friendName.trim() || 'Your friend';
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
    setTriedSubmit(true);
    const errs: string[] = [];
    if (!habit.trim()) errs.push('Write the habit in one line.');
    else if (habit.trim().length > HABIT_MAX) errs.push(`Keep the habit to ${HABIT_MAX} characters.`);
    if (sats === null || sats < MIN_STAKE) errs.push(`The stake must be at least ${formatSats(MIN_STAKE)} (${formatBch(MIN_STAKE)}), so the payout stays above dust after fees.`);
    if (!Number.isFinite(deadlineMs) || deadlineMs - Date.now() < MIN_DEADLINE_BLOCKS * 600_000) errs.push('Pick a deadline at least 2 hours from now.');
    if (!/^[0-9a-f]{66}$/i.test(stakerHex)) errs.push('Connect your wallet first (or paste your public key below).');
    if (!beneficiary.trim()) errs.push('Enter the beneficiary’s address.');
    else if (beneCheck && !beneCheck.ok) errs.push(`Beneficiary: ${beneCheck.error}`);
    if (verifierMode === 'group') {
      if (groupKeys.length < 1) errs.push('Add at least one verifier key.');
      const bad = groupRows.map((r) => rowKeyError(r.key)).find(Boolean);
      if (bad) errs.push(bad);
      else if (groupKeys.length) {
        // Same shape rules the verify page and the server apply (M range, duplicates, staker in a slot).
        const shape = quorumShapeIssues(stakerHex, groupKeys.map((v) => v.pubkey), groupM).filter((i) => !i.startsWith('Every verifier'));
        errs.push(...shape);
      }
    } else if (!/^[0-9a-f]{66}$/i.test(verifierHex)) {
      errs.push(verifierMode === 'demo' ? 'The demo verifier is not available here. Pick a friend.' : 'Paste your friend’s verifier key. They get it from the /verifier-key page.');
    }
    if (errs.length) return setErrors(errs);
    setBusy(true);
    try {
      const provider = getProvider(network);
      const height = await provider.getBlockHeight();
      const now = Date.now();
      const deadline = height + blocksUntil(deadlineMs, now, MIN_DEADLINE_BLOCKS);
      // A block height, comfortably past the verify-by margin (the contract would read >= 500M as a clock time).
      if (deadline <= height + 6 || deadline >= 500_000_000) return setErrors(['Pick a deadline at least 2 hours from now.']);
      const beneficiaryAddress = beneCheck && beneCheck.ok ? beneCheck.address : beneficiary.trim();
      // Wall-listing proof: the pledge id commits to a nonce, the habit and sha256(listSecret).
      // The secret and nonce stay in this browser's pledge storage only.
      const listSecret = newListSecret();
      const listNonce = newListNonce();
      const pledgeId = listPledgeId(listNonce, habit.trim(), listSecretHash(listSecret));
      if (verifierMode === 'group') {
        const qParams = {
          stakerPubkey: hexToBin(stakerHex),
          verifierPubkeys: groupKeys.map((v) => hexToBin(v.pubkey)),
          threshold: groupM,
          beneficiaryAddress,
          deadline,
          pledgeId,
          // v2.1: the verifiers alone sign the refund back to you (contracts/VouchQuorum21.cash).
          verifierRefund: true,
        };
        const qIssues = quorumPledgeIssues(qParams).map((i) => (i === 'Verifier must not be the beneficiary' ? SAME_ADDR : i));
        if (qIssues.length) return setErrors(qIssues);
        const contract = createQuorumContract(qParams, provider);
        setDraft({
          id: qParams.pledgeId,
          promise: habit.trim(),
          stakeSats: sats!.toString(),
          deadline,
          deadlineAt: estimateBlockTime(deadline, height, now),
          beneficiaryAddress,
          beneficiaryName: beneName.trim() || undefined,
          stakerPubkey: stakerHex,
          verifierPubkey: groupKeys[0].pubkey,
          verifierKind: 'friend',
          version: 2,
          verifierRefund: true,
          verifiers: groupKeys,
          threshold: groupM,
          contractAddress: contract.address,
          network,
          createdAt: now,
          visibility,
          listSecret,
          listNonce,
        });
        setStep('review');
        return;
      }
      const params = {
        stakerPubkey: hexToBin(stakerHex),
        verifierPubkey: hexToBin(verifierHex),
        beneficiaryAddress,
        deadline,
        pledgeId,
        // v1.1: the verifier alone signs the refund back to you (contracts/Vouch11.cash).
        verifierRefund: true,
      };
      const issues = validatePledge(params, sats!, network).map((i) => (i === 'Verifier must not be the beneficiary' ? SAME_ADDR : i));
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
        verifierRefund: true,
        verifierKind: verifierMode,
        verifierName: verifierMode === 'friend' ? friendName.trim() || undefined : undefined,
        contractAddress: contract.address,
        network,
        createdAt: now,
        visibility,
        listSecret,
        listNonce,
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
      if (draft.network !== network) throw new Error(`This draft is for ${draft.network}, but the app is on ${network}. Edit the details to rebuild it.`);
      const { txid } = await lockFromWallet(wallet.manager, draft);
      const locked = { ...draft, lastTxid: txid, lockTxid: txid };
      savePledge(locked);
      setDraft(locked);
      setLockTxid(txid);
      setLockMsg(null);
      setStep('done');
      if (locked.visibility === 'public') void listIt(locked);
    } catch (e) {
      setLockMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** "List on the wall": registers the lock and lists it in one call, proven by this browser's listSecret. */
  async function listIt(p: StoredPledge) {
    setWallMsg({ kind: 'busy', text: 'Listing on the wall…' });
    let res = await listOnWall(p);
    // The lock can take a few seconds to show up on the indexer.
    for (let i = 0; i < 3 && !res.ok && /no locked stake/i.test(res.error); i++) {
      await new Promise((r) => setTimeout(r, 4000));
      res = await listOnWall(p);
    }
    if (res.ok) {
      setDraft({ ...p, visibility: 'public', listedAt: res.listedAt });
      setWallMsg({ kind: 'ok', text: 'Listed on the wall.' });
    } else setWallMsg({ kind: 'err', text: `Not listed: ${res.error}` });
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
      keepCopy="Your verifier signs it back to your refund address. You don’t need to sign."
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
              {network === 'mainnet' ? (
                <div className="callout callout-warn" role="note" data-testid="mainnet-warning">
                  <strong>Mainnet: this locks real BCH</strong>
                  <p>Use a tiny amount you’re fine losing (the minimum is {formatSats(MIN_STAKE)}). If you break the pledge or miss the deadline, the stake really goes to the beneficiary. Your wallet must be on mainnet too.</p>
                </div>
              ) : (
                <p className="footnote" style={{ margin: '0 0 12px' }} data-testid="chipnet-note">On chipnet: test coins with no value. Switch to mainnet with the network badge at the top.</p>
              )}
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
                      {balance !== null ? ` Your wallet has ${formatSats(balance)}.` : ''}
                    </p>
                  )}
                </div>
                <div className="field">
                  <label htmlFor="deadline">Deadline</label>
                  <input id="deadline" type="datetime-local" required value={deadlineLocal} onChange={(e) => setDeadlineLocal(e.target.value)} />
                  <p className="hint">Stored as a block height (~10 min a block), so it can drift a little.</p>
                </div>
              </div>
              <fieldset className="choice-set" id="visibility-set">
                <legend>Who can see this</legend>
                <div className="choice-row">
                  {(['public', 'unlisted'] as const).map((v) => (
                    <label key={v} className="choice">
                      <input type="radio" name="visibility" value={v} checked={visibility === v} onChange={() => setVisibility(v)} data-testid={`visibility-${v}`} />
                      <span>
                        <b>{VISIBILITY_COPY[v].label}</b>
                        <span className="choice-help">{VISIBILITY_COPY[v].help}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <p className="footnote vis-note">
                  {visibility === 'unlisted'
                    ? 'Hidden from the wall, still visible on-chain to anyone with the address or txid.'
                    : `Listed pledges show on the ${network === 'mainnet' ? 'Mainnet' : 'Chipnet'} wall after you lock. The beneficiary isn’t shown there.`}
                </p>
              </fieldset>
              <fieldset className="choice-set">
                <legend>Verifier</legend>
                <div className="choice-row">
                  {(demoOk || demo.loading) && (
                  <label className="choice">
                    <input type="radio" name="verifier-type" checked={verifierMode === 'demo'} onChange={() => setVerifierMode('demo')} />
                    <span>
                      <b>Vouch demo verifier</b>
                      <span className="choice-help">Default. The app signs the refund in the demo wallet.</span>
                    </span>
                  </label>
                  )}
                  <label className="choice">
                    <input type="radio" name="verifier-type" checked={verifierMode === 'friend'} onChange={() => setVerifierMode('friend')} />
                    <span>
                      <b>A friend</b>
                      <span className="choice-help">Share a signing link after you lock. They sign the refund in their wallet.</span>
                    </span>
                  </label>
                  <label className="choice">
                    <input type="radio" name="verifier-type" checked={verifierMode === 'group'} onChange={() => setVerifierMode('group')} data-testid="verifier-group" />
                    <span>
                      <b>A group</b>
                      <span className="choice-help">Up to 5 verifiers; pick how many must approve (2 of 3, 3 of 5…).</span>
                    </span>
                  </label>
                </div>
                {!demo.loading && !demoOk && network === 'mainnet' && (
                  <p className="footnote" style={{ marginTop: 8 }}>On mainnet the demo verifier is off: name a friend or a group.</p>
                )}
                {verifierMode === 'group' && (
                  <QuorumFields rows={groupRows} setRows={setGroupRows} includeDemo={groupDemo} setIncludeDemo={setGroupDemo} demoAvailable={demoOk} threshold={groupM} setThreshold={setThreshold} stakerHex={stakerHex} demoPubkey={demo.pubkey} />
                )}
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
                <div className={`field${sameAddr || beneError ? ' is-invalid' : ''}`}>
                  <label htmlFor="beneficiary">Beneficiary address</label>
                  <input id="beneficiary" required spellCheck={false} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder={network === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'} aria-invalid={!!beneError} />
                  {beneError ? (
                    <p className="field-error" role="alert" data-testid="beneficiary-error">{beneError}</p>
                  ) : sameAddr ? (
                    <p className="field-error" role="alert">{SAME_ADDR}</p>
                  ) : (
                    <p className="hint">A {network} address ({network === 'mainnet' ? 'bitcoincash:' : 'bchtest:'}…). Paid in full if you break it or time runs out. Can’t be changed later.</p>
                  )}
                </div>
              </div>
              {!wallet.stakerPubkeyHex && (
                <div className="field">
                  <label htmlFor="manual-staker">No wallet connected? <span style={{ fontWeight: 400, color: 'var(--ink-muted)' }}>Connect one above, or paste your public key</span></label>
                  <input id="manual-staker" spellCheck={false} value={manualStaker} onChange={(e) => setManualStaker(e.target.value)} placeholder="02… or 03…" />
                </div>
              )}
              {errors.filter((m) => m !== SAME_ADDR && !m.startsWith('Beneficiary: ')).map((m) => <p key={m} className="field-error" role="alert">{m}</p>)}
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
                  <p>Returns to your wallet when <strong>{verifierLabel}</strong> signs the refund. You don’t sign it: the contract only lets the refund pay your own address, <span className="addr">{stakerP2pkhAddress(hexToBin(draft.stakerPubkey), draft.network)}</span>, so the verifier can’t send it anywhere else. Your signature alone can’t refund it.</p>
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
                <div className="kv-row"><dt>Verifier</dt><dd>{draft.version === 2 ? `${draft.threshold} of ${draft.verifiers!.length}: ${draft.verifiers!.map((v, i) => v.name ?? `Verifier ${i + 1}`).join(', ')}` : verifierLabel}{draft.version === 2 && (() => {
                  const pc = quorumPowerCopy(draft.threshold!, draft.verifiers!.length);
                  return (
                    <>
                      <span className="footnote" style={{ display: 'block' }} data-testid="review-quorum-power">{pc.summary}</span>
                      {pc.warning && <span className="field-error" style={{ display: 'block' }} role="note">{pc.warning}</span>}
                    </>
                  );
                })()}{draft.verifierKind === 'demo' && <span className="footnote" style={{ display: 'block' }}>Demo verifier is run by Vouch.</span>}</dd></div>
                <div className="kv-row"><dt>Visibility</dt><dd data-testid="review-visibility">{VISIBILITY_COPY[draft.visibility ?? 'unlisted'].label}<span className="footnote" style={{ display: 'block' }}>{draft.visibility === 'public' ? 'Listed right after the lock. Only this browser can list it later, too.' : 'Hidden from the wall, still on-chain.'}</span></dd></div>
                <div className="kv-row"><dt>Contract</dt><dd className="addr"><a href={explorerAddr(draft.network, draft.contractAddress)} target="_blank" rel="noreferrer">{draft.contractAddress}</a></dd></div>
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
                <TxLink txid={lockTxid} network={draft.network} label="Lock transaction" />
              ) : (
                <p className="lede" style={{ margin: '0 0 12px' }}>Send exactly <strong>{formatSats(draft.stakeSats)}</strong> to <span className="addr">{draft.contractAddress}</span> to lock it.</p>
              )}
              <p className="lede" style={{ margin: '16px 0' }}>
                {draft.version === 2
                  ? `When you’ve kept it, open the pledge and tap Keep: it makes one signing link for your verifiers. Any ${draft.threshold} of the ${draft.verifiers!.length} sign, one after another, and the coins come back to you. You don’t sign. The same ${draft.threshold} could instead vote it broken and pay the beneficiary.`
                  : draft.verifierKind === 'friend'
                  ? `When you’ve kept it, open the pledge and tap Keep: it makes a signing link for ${verifierLabel}. They sign the refund in their wallet and the coins come back to you. You don’t sign.`
                  : 'When you’ve kept it, open the pledge and tap Keep before the verify-by time. The demo verifier signs the refund back to you. You don’t sign.'}
              </p>
              {lockTxid && (
                <div className="wall-list-row" data-testid="wall-list-row">
                  {wallMsg && <p className={wallMsg.kind === 'err' ? 'field-error' : 'callout'} role="status" style={{ margin: '0 0 10px' }}>{wallMsg.text}{wallMsg.kind === 'ok' && <> <Link href="/wall">See the wall</Link></>}</p>}
                  {!draft.listedAt && wallMsg?.kind !== 'busy' && (
                    <button className="btn btn-ghost" type="button" onClick={() => void listIt(draft)} data-testid="list-on-wall">List on the wall</button>
                  )}
                  {!draft.listedAt && !wallMsg && <p className="footnote" style={{ marginTop: 6 }}>Unlisted. Listing shows the habit, stake, deadline and outcome; the beneficiary stays off the wall. Only this browser can list it.</p>}
                </div>
              )}
              <div className="form-actions">
                <Link className="btn btn-primary btn-lg" href={`/pledges/${draft.id}`}>View the pledge</Link>
                <button className="btn btn-ghost" type="button" onClick={() => { setDraft(null); setLockTxid(null); setWallMsg(null); setHabit(''); setStep('details'); }}>Make another</button>
              </div>
            </div>
          </section>
        )}

        <aside className="sticky-aside" aria-label="Live ticket preview">{ticket}</aside>
      </div>
    </>
  );
}

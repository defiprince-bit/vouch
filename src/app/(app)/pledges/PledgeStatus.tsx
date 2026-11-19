'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import { shouldAutoForfeit, stakerP2pkhAddress, verifyByHeight } from '@/lib/vouch';
import { explorerAddr, explorerTx, networkLabel, storeNetwork } from '@/lib/network';
import { useNetwork } from '@/lib/useNetwork';
import { formatBch, formatCountdown, formatDateTime, shortAddr, BLOCK_SECONDS } from '@/lib/format';
import { TxLink } from '@/components/TxLink';
import { Ticket } from '@/components/Ticket';
import { ConnectWallet } from '@/components/ConnectWallet';
import { useWallet } from '@/components/WalletProvider';
import { anyPledgeContract, lockFromWallet, keepWithDemoVerifier, prepareVerifyRequest, breakFromWallet, settleExpiredPledge } from '@/lib/walletActions';
import { verifyLink } from '@/lib/share';
import { isQuorumPledge } from '@/lib/pledges';
import { prepareQuorumRequest, progressOf } from '@/lib/quorumActions';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { QuorumPanel } from './QuorumPanel';
import { useNow } from '@/lib/useNow';
import { listOnWall, canListHere, LIST_ELSEWHERE_COPY } from '@/lib/wallActions';

type Chain = { kind: 'loading' } | { kind: 'error'; msg: string } | { kind: 'ok'; sats: bigint; height: number; at: number };
type Phase = 'loading' | 'offline' | 'unfunded' | 'active' | 'expired' | 'closed';
const txid = (r: { txid: string } | string) => (typeof r === 'string' ? r : r.txid);

export function PledgeStatus({ pledge }: { pledge: StoredPledge }) {
  const wallet = useWallet();
  const network = useNetwork();
  const netOk = pledge.network === network;
  const [chain, setChain] = useState<Chain>({ kind: 'loading' });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const now = useNow();
  const autoTried = useRef(false);
  const quorum = isQuorumPledge(pledge);
  const demo = useDemoVerifier(pledge.network);
  const isDemo = !quorum && pledge.verifierKind !== 'friend';
  const verifierName = quorum ? `${pledge.threshold} of ${pledge.verifiers?.length ?? 0} verifiers` : isDemo ? 'Vouch demo' : (pledge.verifierName ?? 'Your friend');
  const beneName = pledge.beneficiaryName ?? 'the beneficiary';

  // Mobile: the mock pins "Your move" to the bottom of the screen on the status page.
  useEffect(() => {
    document.body.classList.add('is-status');
    return () => document.body.classList.remove('is-status');
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { provider, contract } = anyPledgeContract(pledge);
      const [utxos, height] = await Promise.all([contract.getUtxos(), provider.getBlockHeight()]);
      setChain({
        kind: 'ok',
        sats: utxos.reduce((s, u) => s + u.satoshis, 0n),
        height,
        at: Date.now(),
      });
    } catch (e) {
      setChain({ kind: 'error', msg: (e as Error).message });
    }
  }, [pledge]);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const height = chain.kind === 'ok' ? chain.height : null;
  const locked = chain.kind === 'ok' ? chain.sats : 0n;
  const expired = shouldAutoForfeit(height, pledge.deadline, locked);
  const phase: Phase =
    chain.kind === 'loading'
      ? 'loading'
      : chain.kind === 'error'
        ? 'offline'
        : locked > 0n
          ? expired
            ? 'expired'
            : 'active'
          : pledge.lastTxid || pledge.outcome
            ? 'closed'
            : 'unfunded';

  const verifyBy = verifyByHeight(pledge.deadline);
  const blockMs = (h: number) => (chain.kind === 'ok' ? chain.at + (h - chain.height) * BLOCK_SECONDS * 1000 : (pledge.deadlineAt ?? 0));
  const deadlineMs = chain.kind === 'ok' ? blockMs(pledge.deadline) : (pledge.deadlineAt ?? 0);
  const verifyByMs = deadlineMs - (pledge.deadline - verifyBy) * BLOCK_SECONDS * 1000;
  const tooLateToVerify = height !== null && height >= verifyBy;
  const connected = wallet.state === 'connected' && !!wallet.manager;
  const mine = netOk && connected && wallet.stakerPubkeyHex === pledge.stakerPubkey;

  const record = useCallback(
    (id: string, patch: Partial<StoredPledge>) => {
      savePledge({ ...pledge, lastTxid: id, ...patch });
      setTimeout(refresh, 3000);
    },
    [pledge, refresh],
  );

  const run = useCallback(
    async (label: string, f: () => Promise<{ txid: string } | string>, patch: (id: string) => Partial<StoredPledge>) => {
      setBusy(label);
      setMsg(null);
      try {
        const id = txid(await f());
        record(id, patch(id));
        setMsg(`${label}: sent.`);
      } catch (e) {
        setMsg(`${label}: ${(e as Error).message}`);
      } finally {
        setBusy(null);
      }
    },
    [record],
  );

  // Past the deadline and still locked: settle to the beneficiary automatically (anyone may). "Settle" is the manual backup.
  useEffect(() => {
    if (!expired || autoTried.current) return;
    autoTried.current = true;
    void Promise.resolve().then(() =>
      run(
        'Settle',
        () => settleExpiredPledge(pledge),
        () => ({ outcome: 'settled' }),
      ),
    );
  }, [expired, pledge, run]);

  const [wallBusy, setWallBusy] = useState(false);
  const [wallErr, setWallErr] = useState<string | null>(null);
  async function listHere() {
    setWallBusy(true);
    setWallErr(null);
    const res = await listOnWall(pledge);
    setWallBusy(false);
    if (!res.ok) setWallErr(`Not listed: ${res.error}`);
  }

  async function askFriend() {
    if (!wallet.manager) return;
    setBusy('Keep');
    setMsg(null);
    try {
      if (quorum) {
        const q = await prepareQuorumRequest(wallet.manager, pledge);
        savePledge({ ...pledge, quorum: progressOf(q) });
        setMsg('Refund pre-signed. Share the signing link below with your verifiers.');
        return;
      }
      const req = await prepareVerifyRequest(wallet.manager, pledge);
      setShareUrl(verifyLink(window.location.origin, req));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // —— header badge, stamp, countdown copy per phase ——
  const outcome = pledge.outcome;
  const [badge, badgeCls, stamp, stampCls, kicker] =
    phase === 'active'
      ? busy
        ? ['Awaiting signature', 'badge-wait', 'Sign', 'stamp-wait', 'Waiting on a signature']
        : ['Active', '', 'Active', '', 'Locked in contract']
      : phase === 'expired'
        ? ['Settling', 'badge-bad', 'Expired', 'stamp-expired', 'Deadline passed — settling']
        : phase === 'unfunded'
          ? ['Not funded', 'badge-wait', 'Draft', 'stamp-wait', 'Waiting for the lock']
          : phase === 'closed'
            ? outcome === 'kept'
              ? ['Kept', '', 'Kept', 'stamp-kept', 'Refunded to you']
              : outcome === 'broken'
                ? ['Broken', 'badge-bad', 'Broken', 'stamp-broke', 'Paid to the beneficiary']
                : outcome === 'settled'
                  ? ['Settled', 'badge-bad', 'Settled', 'stamp-expired', 'Settled — paid to the beneficiary']
                  : ['Closed', 'badge-off', 'Closed', 'stamp-wait', 'The stake has left the contract']
            : phase === 'offline'
              ? ['Offline', 'badge-off', '…', 'stamp-wait', 'Can’t reach the network']
              : ['Checking', 'badge-off', '…', 'stamp-wait', 'Checking the contract'];

  const live = phase === 'active' || phase === 'unfunded' || phase === 'loading' || phase === 'offline';
  const countLabel = live ? 'Time left to keep it' : 'Closed';
  const countTime = live
    ? deadlineMs && now
      ? formatCountdown(deadlineMs - now)
      : '…'
    : phase === 'expired'
      ? 'Expired'
      : outcome === 'kept'
        ? 'Kept'
        : outcome === 'broken'
          ? 'Broken'
          : outcome === 'settled'
            ? 'Settled'
            : 'Closed';
  const countSub = live
    ? 'After the deadline, keep and forfeit can race — send Keep as soon as the verifier signs the refund.'
    : phase === 'expired'
      ? `The deadline passed. Vouch is settling the forfeit to ${beneName}.`
      : outcome === 'kept'
        ? 'You and the verifier signed the refund. The stake was returned.'
        : outcome === 'broken'
          ? `You forfeited before the deadline. The stake was paid to ${beneName}.`
          : outcome === 'settled'
            ? `The deadline passed and the forfeit was settled. The stake was paid to ${beneName}.`
            : 'The stake has left the contract. Check the explorer for where it went.';

  const latestHref = pledge.lastTxid ? explorerTx(pledge.network, pledge.lastTxid) : explorerAddr(pledge.network, pledge.contractAddress);
  const stake = formatBch(pledge.stakeSats);

  return (
    <>
      <header className="screen-head">
        <div>
          <p className="crumbs">
            <Link href="/">Vouch</Link> / <Link href="/pledges">Pledges</Link> / This pledge
          </p>
          <h1>{pledge.promise}</h1>
        </div>
        <span className={`badge ${badgeCls}`}>{badge}</span>
      </header>

      <div className="status-top">
        <div className="countdown-block">
          <div className="countdown">
            <p className="field-label">{countLabel}</p>
            <p className="countdown-time">{countTime}</p>
            {live && verifyByMs > 0 && (
              <p className="verify-by">{tooLateToVerify ? 'Verify-by has passed' : `Get it verified by ${formatDateTime(verifyByMs)}`}</p>
            )}
            <p>{countSub}</p>
            {height !== null && (
              <p>
                Block {height.toLocaleString('en-US')} now · deadline block {pledge.deadline.toLocaleString('en-US')} · verify by block{' '}
                {verifyBy.toLocaleString('en-US')}
              </p>
            )}
          </div>
          <a className="explorer-link" href={latestHref} target="_blank" rel="noreferrer">
            {pledge.lastTxid ? 'View latest transaction on explorer' : 'View contract on explorer'} <span aria-hidden="true">→</span>
          </a>
        </div>

        <aside>
          <div className="panel" id="actions-panel">
            <h2 id="actions-title">Your move</h2>

            {phase === 'loading' && <p className="hint">Checking the contract…</p>}
            {phase === 'offline' && (
              <div className="callout">
                <strong>Can’t reach the network</strong>
                <p>{chain.kind === 'error' ? chain.msg : ''}</p>
                <button
                  className="btn btn-ghost"
                  type="button"
                  onClick={() => {
                    setChain({ kind: 'loading' });
                    void refresh();
                  }}
                  style={{ marginTop: 10 }}
                >
                  Try again
                </button>
              </div>
            )}

            {!netOk && (
              <div className="callout callout-warn" role="note" data-testid="network-mismatch">
                <strong>This pledge is on {pledge.network}</strong>
                <p>
                  The app is on {network}. The status below is read from {pledge.network}, but to sign for this pledge, switch the app
                  {wallet.state === 'connected' ? ' (your wallet will disconnect)' : ''} and connect a wallet on {pledge.network}.
                </p>
                <button className="btn btn-ghost" type="button" style={{ marginTop: 10 }} onClick={() => storeNetwork(pledge.network)}>
                  Switch to {networkLabel(pledge.network)}
                </button>
              </div>
            )}
            {netOk && (phase === 'active' || phase === 'unfunded') && !connected && (
              <>
                <div className="callout">
                  <strong>Wallet not connected</strong>
                  <p>Connect with WizardConnect to sign {phase === 'unfunded' ? 'the lock' : 'Keep or Break'}.</p>
                </div>
                <ConnectWallet size="lg" />
              </>
            )}
            {netOk && (phase === 'active' || phase === 'unfunded') && connected && !mine && (
              <div className="callout">
                <strong>Different wallet</strong>
                <p>This wallet isn’t the staker on this pledge. Connect the wallet that created it.</p>
              </div>
            )}

            {phase === 'unfunded' && mine && (
              <div className="action-bar actions-stack">
                <button
                  className="btn btn-keep btn-lg"
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    run(
                      'Lock',
                      () => lockFromWallet(wallet.manager!, pledge),
                      (id) => ({ lockTxid: id }),
                    )
                  }
                >
                  {busy === 'Lock' ? 'Waiting for wallet…' : `Lock ${stake} from my wallet`}
                </button>
              </div>
            )}

            {phase === 'active' && mine && busy && (
              <div className="callout">
                <strong>Waiting for a signature</strong>
                <p>Approve the {busy.toLowerCase()} in your wallet.</p>
              </div>
            )}

            {phase === 'active' && mine && !busy && !confirming && (
              <>
                <div className="action-bar actions-stack">
                  <button className="btn btn-keep btn-lg" type="button" disabled={tooLateToVerify} onClick={isDemo ? () => setConfirming(true) : askFriend}>
                    {isDemo ? 'I kept it — request refund' : quorum ? (pledge.quorum?.stakerSig ? 'Refresh my signing link' : `I kept it — ask ${pledge.threshold} of ${pledge.verifiers?.length} to sign`) : `I kept it — ask ${verifierName} to sign`}
                  </button>
                  <div>
                    <button
                      className="btn btn-danger btn-lg btn-block"
                      type="button"
                      onClick={() =>
                        window.confirm(`Pay ${stake} to ${beneName}? This can’t be undone once you sign in your wallet.`) &&
                        run(
                          'Break',
                          () => breakFromWallet(wallet.manager!, pledge),
                          () => ({ outcome: 'broken' }),
                        )
                      }
                    >
                      I broke it — pay {pledge.beneficiaryName ?? 'the beneficiary'}
                    </button>
                    <p className="footnote" style={{ marginTop: 8 }}>
                      You sign this yourself.
                    </p>
                  </div>
                </div>
                {tooLateToVerify && (
                  <p className="confirm-note" style={{ marginTop: 8 }}>
                    The verify-by time has passed, so a refund can lose the race to a forfeit.
                  </p>
                )}
              </>
            )}

            {phase === 'active' && mine && !busy && confirming && (
              <div className="confirm-box">
                <label htmlFor="keep-note">What did you do?</label>
                <textarea id="keep-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ran on Monday, Wednesday and Friday." />
                <p className="hint">
                  Honour system: the demo verifier approves any refund you ask for. It’s run by Vouch for trying the app; for real stakes, use a friend.
                </p>
                <div className="action-bar actions-stack">
                  <button
                    className="btn btn-keep btn-lg"
                    type="button"
                    disabled={note.trim().length < 3}
                    onClick={() => {
                      setConfirming(false);
                      void run(
                        'Refund',
                        () => keepWithDemoVerifier(wallet.manager!, pledge, note),
                        () => ({ outcome: 'kept' }),
                      );
                    }}
                  >
                    I confirm — sign the refund
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => setConfirming(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {phase === 'expired' && (
              <>
                <div
                  className="callout"
                  style={{
                    background: 'var(--forfeit-tint)',
                    borderColor: '#E4C4B8',
                  }}
                >
                  <strong>
                    Sending {stake} to {beneName}…
                  </strong>
                  <p>Vouch is settling the forfeit. The contract doesn’t send it by itself. If it hasn’t landed, Settle broadcasts it.</p>
                </div>
                <div className="action-bar actions-stack">
                  <button
                    className="btn btn-danger btn-lg"
                    type="button"
                    disabled={!!busy}
                    onClick={() =>
                      run(
                        'Settle',
                        () => settleExpiredPledge(pledge),
                        () => ({ outcome: 'settled' }),
                      )
                    }
                  >
                    {busy === 'Settle' ? 'Settling…' : 'Settle'}
                  </button>
                </div>
              </>
            )}

            {phase === 'closed' && (
              <div
                className="callout"
                style={
                  outcome === 'kept'
                    ? { background: 'var(--keep-tint)', borderColor: '#B7D8CA' }
                    : outcome
                      ? {
                          background: 'var(--forfeit-tint)',
                          borderColor: '#E4C4B8',
                        }
                      : undefined
                }
              >
                <strong>{outcome === 'kept' ? 'You kept it' : outcome === 'broken' ? 'You broke it' : outcome === 'settled' ? 'Settled' : 'Closed'}</strong>
                <p>
                  {outcome === 'kept' ? `${stake} was returned to your wallet.` : outcome ? `${stake} was paid to ${beneName}.` : 'Nothing left to do here.'}
                </p>
              </div>
            )}

            {msg && <p className={msg.endsWith('sent.') || msg.startsWith('Refund pre-signed') ? 'ok-text' : 'error-text'}>{msg}</p>}
            {pledge.lastTxid && <TxLink txid={pledge.lastTxid} network={pledge.network} label={outcome === 'kept' ? 'Refund tx' : outcome ? 'Payout tx' : 'Latest tx'} />}
          </div>
        </aside>
      </div>

      <div className="status-detail">
        <Ticket
          tag={kicker}
          stamp={stamp}
          stampClass={stampCls as '' | 'stamp-wait'}
          habit={pledge.promise}
          stake={stake}
          deadline={deadlineMs ? formatDateTime(deadlineMs) : `Block ${pledge.deadline}`}
          verifier={verifierName}
          beneficiary={pledge.beneficiaryName ?? 'Beneficiary'}
          beneficiaryAddr={shortAddr(pledge.beneficiaryAddress)}
          keepCopy="Coins return to you after you sign and the verifier signs the refund in their wallet."
          breakCopy={`Paid to ${beneName}. Same if the deadline passes.`}
        />

        <aside>
          <div className="panel">
            <h2>{quorum ? 'Verifiers' : 'Verifier'}</h2>
            {quorum ? (
              <QuorumPanel
                pledge={pledge}
                active={phase === 'active' && netOk}
                demoPubkey={demo.pubkey}
                demoEnabled={demo.enabled}
                onSent={(id, outcome) => {
                  record(id, { outcome });
                  setMsg(`${outcome === 'kept' ? 'Refund' : 'Payout'}: sent.`);
                }}
              />
            ) : (
            <>
            <dl className="kv">
              <div className="kv-row">
                <dt>Name</dt>
                <dd>{verifierName}</dd>
              </div>
              <div className="kv-row">
                <dt>Key</dt>
                <dd className="addr">{isDemo ? 'Demo key (run by this app)' : shortAddr(stakerP2pkhAddress(hexToBin(pledge.verifierPubkey), pledge.network))}</dd>
              </div>
              <div className="kv-row">
                <dt>Status</dt>
                <dd>
                  {outcome === 'kept' ? (
                    <span className="badge">Signed the refund — kept</span>
                  ) : outcome === 'broken' ? (
                    <span className="badge badge-off">Not required</span>
                  ) : phase === 'expired' || outcome === 'settled' ? (
                    <span className="badge badge-off">Window closed</span>
                  ) : (
                    <span className="badge badge-wait">Has not signed yet</span>
                  )}
                </dd>
              </div>
            </dl>
            {isDemo && (
              <p className="footnote" style={{ marginTop: 12 }}>
                Honour system: the demo verifier approves any refund you ask for. For real stakes, pick a friend.
              </p>
            )}
            {shareUrl && (
              <div style={{ marginTop: 12 }}>
                <p className="field-label" style={{ marginBottom: 6 }}>
                  Signing link
                </p>
                <div className="copy-link">
                  <input type="text" readOnly value={shareUrl} aria-label="Friend signing link" onFocus={(e) => e.currentTarget.select()} />
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(shareUrl).catch(() => {});
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1200);
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="hint" style={{ marginTop: 6 }}>
                  {verifierName} opens this /verify#… link and signs the refund in their wallet. Pledge data stays in the hash, so it never reaches the server.
                </p>
              </div>
            )}
            </>
            )}
          </div>

          <div className="panel">
            <h2>Contract</h2>
            <dl className="kv">
              <div className="kv-row">
                <dt>Address</dt>
                <dd className="addr">
                  <a href={explorerAddr(pledge.network, pledge.contractAddress)} target="_blank" rel="noreferrer">
                    {pledge.contractAddress}
                  </a>
                </dd>
              </div>
              <div className="kv-row">
                <dt>Locked</dt>
                <dd>{chain.kind === 'ok' ? formatBch(locked) : '…'}</dd>
              </div>
              <div className="kv-row">
                <dt>Network</dt>
                <dd>{pledge.network === 'mainnet' ? 'Mainnet · real BCH' : 'Chipnet · test coins'}</dd>
              </div>
              <div className="kv-row">
                <dt>Wall</dt>
                <dd data-testid="pledge-wall">
                  {pledge.listedAt ? (
                    <>Listed · <Link href="/wall">See the wall</Link></>
                  ) : (
                    <>
                      Unlisted
                      {locked > 0n && canListHere(pledge) && (
                        <>
                          {' · '}
                          <button className="link-btn" type="button" disabled={wallBusy} onClick={() => void listHere()} data-testid="list-on-wall">
                            {wallBusy ? 'Listing…' : 'List on the wall'}
                          </button>
                        </>
                      )}
                      {!canListHere(pledge) && (
                        <span className="footnote" style={{ display: 'block' }} data-testid="list-elsewhere">
                          {LIST_ELSEWHERE_COPY}
                        </span>
                      )}
                      {wallErr && <span className="field-error" style={{ display: 'block' }} role="alert">{wallErr}</span>}
                    </>
                  )}
                </dd>
              </div>
            </dl>
            {pledge.lockTxid && <TxLink txid={pledge.lockTxid} network={pledge.network} label="Lock tx" />}
          </div>
        </aside>
      </div>
    </>
  );
}

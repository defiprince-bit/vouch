'use client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { parsePledges, savePledge, PLEDGES_KEY, type StoredPledge } from '@/lib/pledges';
import { shouldAutoForfeit, verifyByHeight } from '@/lib/commitcash';
import { EXPLORER_ADDR } from '@/lib/config';
import { TxLink } from '@/components/TxLink';
import { useWallet } from '@/components/WalletProvider';
import {
  pledgeContract,
  lockFromWallet,
  keepWithDemoVerifier,
  prepareVerifyRequest,
  breakFromWallet,
  settleExpiredPledge,
} from '@/lib/walletActions';
import { verifyLink } from '@/lib/share';

type Status = { kind: 'loading' } | { kind: 'empty' } | { kind: 'locked'; sats: bigint } | { kind: 'error'; msg: string };

function PledgeCard({ pledge }: { pledge: StoredPledge }) {
  const wallet = useWallet();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [height, setHeight] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(pledge.lastTxid ?? null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const autoTried = useRef(false);
  const isDemo = pledge.verifierKind !== 'friend';

  const refresh = useCallback(async () => {
    try {
      const { provider, contract } = pledgeContract(pledge);
      const [utxos, h] = await Promise.all([contract.getUtxos(), provider.getBlockHeight()]);
      setHeight(h);
      const sats = utxos.reduce((s, u) => s + u.satoshis, 0n);
      setStatus(sats > 0n ? { kind: 'locked', sats } : { kind: 'empty' });
    } catch (e) {
      setStatus({ kind: 'error', msg: (e as Error).message });
    }
  }, [pledge]);

  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const done = (id: string, label: string) => {
    setTxid(id);
    savePledge({ ...pledge, lastTxid: id });
    setMsg(label);
    setTimeout(refresh, 3000);
  };

  const run = useCallback(
    async (label: string, f: () => Promise<{ txid: string } | string>) => {
      setBusy(true);
      setMsg(`${label}: check your wallet…`);
      try {
        const r = await f();
        done(typeof r === 'string' ? r : r.txid, `${label}: sent.`);
      } catch (e) {
        setMsg(`${label}: ${(e as Error).message}`);
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pledge],
  );

  const lockedSats = status.kind === 'locked' ? status.sats : 0n;
  const expired = shouldAutoForfeit(height, pledge.deadline, lockedSats);

  // Past the deadline and still locked: settle to the beneficiary automatically (anyone may).
  useEffect(() => {
    if (!expired || autoTried.current) return;
    autoTried.current = true;
    void Promise.resolve().then(() => run('Deadline passed, settling to the beneficiary', () => settleExpiredPledge(pledge)));
  }, [expired, pledge, run]);

  const verifyBy = verifyByHeight(pledge.deadline);
  const tooLateToVerify = height !== null && height >= verifyBy;
  const connected = wallet.state === 'connected' && !!wallet.manager;
  const mine = connected && wallet.stakerPubkeyHex === pledge.stakerPubkey;

  async function askFriend() {
    if (!wallet.manager) return;
    setBusy(true);
    setMsg('Pre-sign your refund in your wallet (nothing is sent yet)…');
    try {
      const req = await prepareVerifyRequest(wallet.manager, pledge);
      setShareUrl(verifyLink(window.location.origin, req));
      setMsg('Send this link to your verifier. When they sign the refund in their wallet, it goes out immediately.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const blocksLeft = height === null ? null : pledge.deadline - height;
  const verifyLeft = height === null ? null : verifyBy - height;

  const moveButtons = (
    <div className="flex flex-col gap-2">
      {status.kind === 'empty' && !txid && mine && (
        <button disabled={busy} onClick={() => run('Lock', () => lockFromWallet(wallet.manager!, pledge))} className="rounded-full bg-emerald-500 px-4 py-3 font-semibold text-black disabled:opacity-50">
          Lock {pledge.stakeSats} sats from wallet
        </button>
      )}
      {status.kind === 'locked' && !expired && mine && !tooLateToVerify && (
        <button
          disabled={busy}
          onClick={isDemo ? () => setConfirming(true) : askFriend}
          className="rounded-full bg-emerald-500 px-4 py-3 font-semibold text-black disabled:opacity-50"
        >
          {isDemo ? 'Keep: I did it' : 'Keep: ask my verifier'}
        </button>
      )}
      {status.kind === 'locked' && !expired && mine && (
        <button disabled={busy} onClick={() => run('Break', () => breakFromWallet(wallet.manager!, pledge))} className="rounded-full border border-red-500/60 px-4 py-3 text-red-300 disabled:opacity-50">
          Break: I didn’t make it
        </button>
      )}
      {status.kind === 'locked' && (
        <button
          disabled={busy || !expired}
          onClick={() => run('Settle', () => settleExpiredPledge(pledge))}
          className="rounded-full border border-neutral-600 px-4 py-2 text-sm disabled:opacity-40"
          title="After the deadline anyone can send the stake to the beneficiary. This happens automatically; the button is a backup."
        >
          Settle to beneficiary
        </button>
      )}
      {!connected && status.kind !== 'empty' && <p className="text-xs text-neutral-500">Connect your wallet to keep or break.</p>}
      {connected && !mine && status.kind === 'locked' && <p className="text-xs text-neutral-500">This wallet isn’t the staker for this pledge.</p>}
      {status.kind === 'empty' && txid && <p className="text-sm text-neutral-400">Settled. Nothing left to do.</p>}
    </div>
  );

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="grid gap-6 md:grid-cols-[1fr_280px]">
        <div>
          <h3 className="text-xl font-bold">{pledge.promise}</h3>
          <p className="mt-1 text-sm text-neutral-300">
            Stake {pledge.stakeSats} sats →{' '}
            {status.kind === 'loading' && 'checking…'}
            {status.kind === 'empty' && (txid ? 'settled' : 'not funded yet')}
            {status.kind === 'locked' && <b className="text-emerald-300">{String(status.sats)} sats locked</b>}
            {status.kind === 'error' && <span className="text-red-400">{status.msg}</span>}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-xs uppercase tracking-wider text-neutral-500">Deadline</p>
              <p className="font-mono text-2xl">{blocksLeft === null ? '…' : blocksLeft > 0 ? `${blocksLeft} blk` : 'passed'}</p>
              <p className="text-xs text-neutral-500">
                {blocksLeft !== null && blocksLeft > 0 && `~${approx(blocksLeft)} · `}block {pledge.deadline}
              </p>
            </div>
            <div className="rounded-xl bg-black/30 p-3">
              <p className="text-xs uppercase tracking-wider text-neutral-500">Verify by</p>
              <p className={`font-mono text-2xl ${tooLateToVerify ? 'text-amber-300' : ''}`}>
                {verifyLeft === null ? '…' : verifyLeft > 0 ? `${verifyLeft} blk` : 'closed'}
              </p>
              <p className="text-xs text-neutral-500">deadline − ~1h · block {verifyBy}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            Verifier: {isDemo ? 'CommitCash demo verifier (operated by this app)' : 'a friend, who approves by signing the refund in their wallet'}.
          </p>
          <a className="font-mono text-xs text-neutral-500 underline" href={EXPLORER_ADDR + pledge.contractAddress} target="_blank" rel="noreferrer">
            {pledge.contractAddress}
          </a>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="mb-3 font-display text-sm font-bold uppercase tracking-wider text-emerald-300">Your move</p>
          {moveButtons}
        </div>
      </div>

      {confirming && (
        <div className="mt-4 space-y-2 rounded-xl border border-emerald-500/30 p-4">
          <p className="text-sm">The demo verifier approves when you confirm. Then you sign the refund in your wallet and it goes out right away.</p>
          <input className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do? (e.g. ran 5km on all 7 days)" />
          <div className="flex gap-2">
            <button
              disabled={busy || note.trim().length < 3}
              onClick={() => {
                setConfirming(false);
                void run('Keep', () => keepWithDemoVerifier(wallet.manager!, pledge, note));
              }}
              className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
            >
              I confirm I kept it
            </button>
            <button onClick={() => setConfirming(false)} className="rounded-full border border-neutral-600 px-4 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {shareUrl && (
        <div className="mt-3 space-y-1">
          <input readOnly value={shareUrl} className="w-full rounded bg-black/40 p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          <button onClick={() => navigator.clipboard.writeText(shareUrl)} className="text-xs underline">Copy verify link</button>
        </div>
      )}
      {msg && <p className="mt-3 break-all text-sm text-neutral-300">{msg}</p>}
      {txid && <TxLink txid={txid} label="Latest transaction" />}
    </div>
  );
}

/** ~10 minutes per block. */
function approx(blocks: number): string {
  const mins = blocks * 10;
  if (mins < 120) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h`;
  return `${Math.round(mins / 1440)} days`;
}

export function PledgeList() {
  const raw = useSyncExternalStore(
    (cb) => {
      window.addEventListener('storage', cb);
      return () => window.removeEventListener('storage', cb);
    },
    () => window.localStorage.getItem(PLEDGES_KEY) ?? '[]',
    () => null,
  );
  const pledges = useMemo(() => (raw === null ? null : parsePledges(raw)), [raw]);
  if (pledges === null) return <p className="text-neutral-400">Loading…</p>;
  if (pledges.length === 0) {
    return (
      <p className="text-neutral-400">
        No pledges yet. <Link className="underline" href="/create">Make one</Link>.
      </p>
    );
  }
  return <div className="space-y-4">{pledges.map((p) => <PledgeCard key={p.id} pledge={p} />)}</div>;
}

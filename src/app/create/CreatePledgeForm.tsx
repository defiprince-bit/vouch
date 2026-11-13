'use client';
import { useState } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { createPledgeContract, getProvider, newPledgeId, validatePledge, verifyByHeight, MIN_STAKE } from '@/lib/commitcash';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import { NETWORK, EXPLORER_ADDR } from '@/lib/config';
import { TxLink } from '@/components/TxLink';
import { useWallet } from '@/components/WalletProvider';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { lockFromWallet } from '@/lib/walletActions';

const BLOCKS_PER_DAY = 144;

export function CreatePledgeForm() {
  const wallet = useWallet();
  const demo = useDemoVerifier();
  const [promise, setPromise] = useState('');
  const [stake, setStake] = useState(String(MIN_STAKE * 2n));
  const [days, setDays] = useState('7');
  const [beneficiary, setBeneficiary] = useState('');
  const [verifierMode, setVerifierMode] = useState<'demo' | 'friend'>('demo');
  const [friendKey, setFriendKey] = useState('');
  const [manualStaker, setManualStaker] = useState('');
  const [error, setError] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [created, setCreated] = useState<StoredPledge | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockMsg, setLockMsg] = useState<string | null>(null);

  const stakerHex = wallet.stakerPubkeyHex ?? manualStaker.trim();
  const verifierHex = verifierMode === 'demo' ? demo.pubkey ?? '' : friendKey.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError([]);
    setWarnings([]);
    setBusy(true);
    try {
      if (!/^[0-9a-f]{66}$/i.test(stakerHex)) throw new Error('Connect a wallet (or paste your 33-byte staker public key)');
      if (!/^[0-9a-f]{66}$/i.test(verifierHex)) {
        throw new Error(verifierMode === 'demo' ? 'The demo verifier is not available on this deployment. Pick a friend.' : "Paste your friend's verifier key (they can get it at /verifier-key)");
      }
      const provider = getProvider();
      const height = await provider.getBlockHeight();
      const deadline = height + Math.max(12, Math.round(Number(days) * BLOCKS_PER_DAY));
      const params = {
        stakerPubkey: hexToBin(stakerHex),
        verifierPubkey: hexToBin(verifierHex),
        beneficiaryAddress: beneficiary.trim(),
        deadline,
        pledgeId: newPledgeId(),
      };
      const issues = validatePledge(params, BigInt(stake));
      const hard = issues.filter((i) => !i.startsWith('Verifier is the staker'));
      if (hard.length) {
        setError(hard);
        return;
      }
      setWarnings(issues.filter((i) => i.startsWith('Verifier is the staker')));
      const contract = createPledgeContract(params, provider);
      const pledge: StoredPledge = {
        id: params.pledgeId,
        promise,
        stakeSats: stake,
        deadline,
        beneficiaryAddress: params.beneficiaryAddress,
        stakerPubkey: stakerHex,
        verifierPubkey: verifierHex,
        verifierKind: verifierMode,
        contractAddress: contract.address,
        network: NETWORK,
        createdAt: Date.now(),
      };
      savePledge(pledge);
      setCreated(pledge);
    } catch (err) {
      setError([(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  async function lock() {
    if (!created || !wallet.manager) return;
    setLockMsg('Check your wallet to approve the lock…');
    try {
      const { txid } = await lockFromWallet(wallet.manager, created);
      savePledge({ ...created, lastTxid: txid });
      setLockMsg(`Locked. ${txid}`);
    } catch (e) {
      setLockMsg((e as Error).message);
    }
  }

  const field = 'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2';

  if (created) {
    return (
      <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <h2 className="text-xl font-semibold">Pledge created: “{created.promise}”</h2>
        {wallet.state === 'connected' ? (
          <button onClick={lock} className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black">
            Lock {created.stakeSats} sats from my wallet
          </button>
        ) : (
          <p className="text-sm text-neutral-300">Connect your wallet to lock it, or send exactly <b>{created.stakeSats} sats</b> to:</p>
        )}
        {lockMsg && (lockMsg.startsWith('Locked. ') ? <TxLink txid={lockMsg.slice(8)} label="Locked: view transaction" /> : <p className="break-all text-sm text-neutral-200">{lockMsg}</p>)}
        <code className="block break-all rounded bg-black/40 p-3 text-xs">{created.contractAddress}</code>
        <p className="text-xs text-neutral-400">
          Deadline: block {created.deadline}. Your verifier must approve by block {verifyByHeight(created.deadline)} (about 1 hour before the deadline).{' '}
          <a className="underline" href={EXPLORER_ADDR + created.contractAddress} target="_blank" rel="noreferrer">Explorer</a>
        </p>
        {warnings.map((w) => <p key={w} className="text-xs text-amber-300">⚠ {w}</p>)}
        <Link href="/pledges" className="inline-block rounded-full border border-neutral-600 px-4 py-2">View my pledges</Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="max-w-xl space-y-4">
      <label className="block">
        <span className="text-sm text-neutral-400">Your promise</span>
        <input className={field} required maxLength={120} value={promise} onChange={(e) => setPromise(e.target.value)} placeholder="Run 5km every day this week" />
      </label>
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-neutral-400">Stake (sats, min {String(MIN_STAKE)})</span>
          <input className={field} required inputMode="numeric" pattern="[0-9]+" value={stake} onChange={(e) => setStake(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-400">Deadline (days from now)</span>
          <input className={field} required inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      <label className="block">
        <span className="text-sm text-neutral-400">Beneficiary address (gets the stake if you break it, can’t be changed later)</span>
        <input className={field} required value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} placeholder={NETWORK === 'mainnet' ? 'bitcoincash:q…' : 'bchtest:q…'} />
      </label>
      <fieldset className="space-y-2 rounded-xl border border-neutral-800 p-4">
        <legend className="px-1 text-sm text-neutral-400">Who confirms you kept it?</legend>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" checked={verifierMode === 'demo'} onChange={() => setVerifierMode('demo')} />
          <span>
            CommitCash demo verifier <span className="text-neutral-500">(operated by this app; approves when you confirm. Fine for trying it, not a real referee)</span>
            {verifierMode === 'demo' && !demo.loading && !demo.pubkey && <span className="block text-amber-300">Not configured on this deployment.</span>}
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="radio" checked={verifierMode === 'friend'} onChange={() => setVerifierMode('friend')} />
          <span>A friend: they approve by signing the refund in their own wallet</span>
        </label>
        {verifierMode === 'friend' && (
          <input className={field} value={friendKey} onChange={(e) => setFriendKey(e.target.value)} placeholder="Friend's verifier key (they get it at /verifier-key)" />
        )}
      </fieldset>
      {!wallet.stakerPubkeyHex && (
        <label className="block">
          <span className="text-sm text-neutral-400">No wallet connected? Paste your staker public key (hex)</span>
          <input className={field} value={manualStaker} onChange={(e) => setManualStaker(e.target.value)} placeholder="02… / 03…" />
        </label>
      )}
      {error.map((m) => <p key={m} className="text-sm text-red-400">{m}</p>)}
      <button disabled={busy} className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black disabled:opacity-60">
        {busy ? 'Creating…' : 'Create pledge'}
      </button>
      <p className="text-xs text-neutral-500">Network: {NETWORK}. Fees are capped on-chain at 2,000 sats per settlement.</p>
    </form>
  );
}

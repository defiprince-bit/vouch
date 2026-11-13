'use client';
import { useState } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { createPledgeContract, getProvider, newPledgeId, validatePledge, MIN_STAKE } from '@/lib/commitcash';
import { savePledge, type StoredPledge } from '@/lib/pledges';
import { NETWORK, DEFAULT_VERIFIER_PUBKEY, EXPLORER_ADDR } from '@/lib/config';
import { useWallet } from '@/components/WalletProvider';

const BLOCKS_PER_DAY = 144;

export function CreatePledgeForm() {
  const wallet = useWallet();
  const [promise, setPromise] = useState('');
  const [stake, setStake] = useState(String(MIN_STAKE * 2n));
  const [days, setDays] = useState('7');
  const [beneficiary, setBeneficiary] = useState('');
  const [verifier, setVerifier] = useState(DEFAULT_VERIFIER_PUBKEY);
  const [manualStaker, setManualStaker] = useState('');
  const [error, setError] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [created, setCreated] = useState<StoredPledge | null>(null);
  const [busy, setBusy] = useState(false);

  const stakerHex = wallet.stakerPubkeyHex ?? manualStaker.trim();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError([]);
    setWarnings([]);
    setBusy(true);
    try {
      if (!/^[0-9a-f]{66}$/i.test(stakerHex)) throw new Error('Connect a wallet (or paste your 33-byte staker pubkey hex)');
      if (!/^[0-9a-f]{66}$/i.test(verifier.trim())) throw new Error('Verifier pubkey must be 33-byte hex');
      const provider = getProvider();
      const height = await provider.getBlockHeight();
      const deadline = height + Math.max(1, Math.round(Number(days) * BLOCKS_PER_DAY));
      const params = {
        stakerPubkey: hexToBin(stakerHex),
        verifierPubkey: hexToBin(verifier.trim()),
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
        verifierPubkey: verifier.trim(),
        contractAddress: contract.address,
        network: NETWORK,
        createdAt: Date.now(),
      };
      savePledge(pledge);
      setCreated(pledge);
      // TODO(lock): build the funding tx (wallet P2PKH UTXOs -> contract.address, `stake` sats) and send it
      // to the wallet via wallet.manager.signTransaction({ transaction, inputPaths }) with broadcast.
    } catch (err) {
      setError([(err as Error).message]);
    } finally {
      setBusy(false);
    }
  }

  const field = 'w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2';

  if (created) {
    return (
      <div className="space-y-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-6">
        <h2 className="text-xl font-semibold">Pledge created: “{created.promise}”</h2>
        <p className="text-sm text-neutral-300">Send exactly <b>{created.stakeSats} sats</b> to lock it:</p>
        <code className="block break-all rounded bg-black/40 p-3 text-sm">{created.contractAddress}</code>
        <p className="text-xs text-neutral-400">
          Deadline: block {created.deadline}. Ask your verifier to co-sign the keep before then.{' '}
          <a className="underline" href={EXPLORER_ADDR + created.contractAddress} target="_blank" rel="noreferrer">Explorer</a>
        </p>
        {warnings.map((w) => <p key={w} className="text-xs text-amber-300">⚠ {w}</p>)}
        <Link href="/pledges" className="inline-block rounded-full bg-emerald-500 px-4 py-2 font-semibold text-black">View my pledges</Link>
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
      <label className="block">
        <span className="text-sm text-neutral-400">Verifier pubkey (accountability partner, defaults to the CommitCash demo verifier)</span>
        <input className={field} value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="02… / 03… (33-byte hex)" />
      </label>
      {!wallet.stakerPubkeyHex && (
        <label className="block">
          <span className="text-sm text-neutral-400">No wallet connected? Paste your staker pubkey (hex)</span>
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

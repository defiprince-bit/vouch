'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { hexToBin } from '@bitauth/libauth';
import { parsePledges, savePledge, PLEDGES_KEY, type StoredPledge } from '@/lib/pledges';
import { createPledgeContract, getProvider, buildForfeit } from '@/lib/commitcash';
import { EXPLORER_TX, EXPLORER_ADDR } from '@/lib/config';

type Status = { kind: 'loading' } | { kind: 'empty' } | { kind: 'locked'; sats: bigint } | { kind: 'error'; msg: string };

function contractFor(p: StoredPledge) {
  const provider = getProvider(p.network);
  const contract = createPledgeContract(
    {
      stakerPubkey: hexToBin(p.stakerPubkey),
      verifierPubkey: hexToBin(p.verifierPubkey),
      beneficiaryAddress: p.beneficiaryAddress,
      deadline: p.deadline,
      pledgeId: p.id,
    },
    provider,
  );
  return { provider, contract };
}

function PledgeCard({ pledge }: { pledge: StoredPledge }) {
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [height, setHeight] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const { provider, contract } = contractFor(pledge);
    Promise.all([contract.getUtxos(), provider.getBlockHeight()])
      .then(([utxos, h]) => {
        setHeight(h);
        const sats = utxos.reduce((s, u) => s + u.satoshis, 0n);
        setStatus(sats > 0n ? { kind: 'locked', sats } : { kind: 'empty' });
      })
      .catch((e: Error) => setStatus({ kind: 'error', msg: e.message }));
  }, [pledge]);

  const pastDeadline = height !== null && height >= pledge.deadline;

  async function forfeit() {
    // Real: forfeit needs no signature, so the app (or anyone) can settle after the deadline.
    try {
      const { provider, contract } = contractFor(pledge);
      const [utxo] = await contract.getUtxos();
      if (!utxo) throw new Error('Nothing locked');
      const tx = await buildForfeit({ contract, provider, utxo, beneficiaryAddress: pledge.beneficiaryAddress, deadline: pledge.deadline }).send();
      savePledge({ ...pledge, lastTxid: tx.txid });
      setMsg(`Settled to beneficiary: ${tx.txid}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  function stub(action: string) {
    // TODO(wizardconnect): build the keep / breakByStaker tx with placeholder signatures
    // (cashscript generateWcTransactionObject + placeholderSignature/placeholderPublicKey), send it via
    // wallet.manager.signTransaction(...) for the staker sig, and get the verifier co-signature
    // (verifier's own WizardConnect session, or the demo verifier API route).
    setMsg(`${action}: wallet signing not wired yet (see TODO in PledgeList.tsx)`);
  }

  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">{pledge.promise}</h3>
        <span className="text-xs text-neutral-400">{pledge.network} · deadline block {pledge.deadline}{height !== null && ` (now ${height})`}</span>
      </div>
      <p className="mt-1 text-sm text-neutral-300">
        Stake {pledge.stakeSats} sats →{' '}
        {status.kind === 'loading' && 'checking…'}
        {status.kind === 'empty' && 'not funded / already settled'}
        {status.kind === 'locked' && <b className="text-emerald-300">{String(status.sats)} sats locked</b>}
        {status.kind === 'error' && <span className="text-red-400">{status.msg}</span>}
      </p>
      <a className="text-xs text-neutral-500 underline" href={EXPLORER_ADDR + pledge.contractAddress} target="_blank" rel="noreferrer">{pledge.contractAddress}</a>
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => stub('Keep')} className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-black">Kept it (needs verifier)</button>
        <button onClick={() => stub('Break')} className="rounded-full border border-red-500/60 px-4 py-2 text-sm text-red-300">I broke it</button>
        <button onClick={forfeit} disabled={!pastDeadline || status.kind !== 'locked'} className="rounded-full border border-neutral-600 px-4 py-2 text-sm disabled:opacity-40">
          Settle after deadline
        </button>
      </div>
      {msg && <p className="mt-3 break-all text-xs text-neutral-300">{msg}</p>}
      {pledge.lastTxid && (
        <a className="mt-1 block text-xs underline" href={EXPLORER_TX + pledge.lastTxid} target="_blank" rel="noreferrer">Last tx</a>
      )}
    </div>
  );
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

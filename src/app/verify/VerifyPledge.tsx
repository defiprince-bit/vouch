'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { decodeVerifyRequest, type VerifyRequest } from '@/lib/share';
import { verifyByHeight } from '@/lib/commitcash';
import { TxLink } from '@/components/TxLink';
import { useWallet } from '@/components/WalletProvider';
import { useDemoVerifier } from '@/lib/useDemoVerifier';
import { pledgeContract, findWalletIndex, approveKeepAsVerifier, breakAsVerifier } from '@/lib/walletActions';

function useHash(): string | null {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('hashchange', cb);
      return () => window.removeEventListener('hashchange', cb);
    },
    () => window.location.hash,
    () => null,
  );
}

export function VerifyPledge() {
  const hash = useHash();
  const wallet = useWallet();
  const demo = useDemoVerifier();
  const parsed = useMemo((): { req: VerifyRequest | null; error: string | null } => {
    if (hash === null) return { req: null, error: null };
    try {
      return { req: decodeVerifyRequest(hash), error: null };
    } catch (e) {
      return { req: null, error: (e as Error).message };
    }
  }, [hash]);
  const req = parsed.req;
  const [height, setHeight] = useState<number | null>(null);
  const [stillLocked, setStillLocked] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [txid, setTxid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!req) return;
    const { provider, contract } = pledgeContract(req.pledge);
    Promise.all([provider.getBlockHeight(), contract.getUtxos()])
      .then(([h, utxos]) => {
        setHeight(h);
        setStillLocked(utxos.some((u) => u.txid === req.utxo.txid && u.vout === req.utxo.vout));
      })
      .catch((e: Error) => setMsg(e.message));
  }, [req]);

  if (hash === null) return <p className="text-neutral-400">Loading…</p>;
  if (!req) return <p className="text-red-400">{parsed.error ?? 'This link is missing its pledge details.'}</p>;

  const verifyBy = verifyByHeight(req.pledge.deadline);
  const tooLate = height !== null && height >= verifyBy;
  const isDemoVerifier = !!demo.pubkey && demo.pubkey === req.pledge.verifierPubkey.toLowerCase();
  const walletIndex = wallet.manager && wallet.state === 'connected' ? findWalletIndex(wallet.manager, req.pledge.verifierPubkey) : null;

  async function go(label: string, f: () => Promise<{ txid: string }>) {
    setBusy(true);
    setMsg(`${label}: check your wallet…`);
    try {
      const r = await f();
      setTxid(r.txid);
      setMsg(`${label}: sent.`);
      setStillLocked(false);
    } catch (e) {
      setMsg(`${label}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function demoApprove() {
    setBusy(true);
    setMsg('Asking the CommitCash demo verifier…');
    try {
      const res = await fetch('/api/verifier', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'keep', pledge: { ...req!.pledge }, confirm: true, note: 'approved via verify link', stakerSig: req!.stakerSig }),
      });
      const j = (await res.json()) as { txid?: string; error?: string };
      if (!res.ok || !j.txid) throw new Error(j.error ?? 'Verifier refused');
      setTxid(j.txid);
      setStillLocked(false);
      setMsg('Approved and sent.');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6">
      <h2 className="text-2xl font-semibold">“{req.pledge.promise}”</h2>
      <ul className="space-y-1 text-sm text-neutral-300">
        <li>Stake: {req.pledge.stakeSats} sats ({req.pledge.network})</li>
        <li>If you approve: the stake goes back to your friend.</li>
        <li>If you rule it broken (or nobody approves in time): it goes to <code className="break-all">{req.pledge.beneficiaryAddress}</code></li>
        <li>
          Approve before block {verifyBy} (about 1 hour before the deadline, block {req.pledge.deadline}){height !== null && `; now ${height}`}.
        </li>
        {stillLocked === false && !txid && <li className="text-amber-300">This pledge has already been settled.</li>}
        {tooLate && <li className="text-amber-300">Too late to approve: the deadline is about to pass.</li>}
      </ul>

      {isDemoVerifier ? (
        <button disabled={busy || tooLate || stillLocked === false} onClick={demoApprove} className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black disabled:opacity-50">
          Approve with the CommitCash demo verifier
        </button>
      ) : wallet.state !== 'connected' ? (
        <p className="text-sm text-neutral-300">Connect the wallet whose verifier key your friend used (top right). You approve by signing the refund in your wallet.</p>
      ) : walletIndex === null ? (
        <p className="text-sm text-red-400">This wallet doesn&apos;t hold the verifier key named in this pledge.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || tooLate || stillLocked === false}
            onClick={() => go('Approve', () => approveKeepAsVerifier(wallet.manager!, req, walletIndex))}
            className="rounded-full bg-emerald-500 px-5 py-3 font-semibold text-black disabled:opacity-50"
          >
            They kept it: sign the refund
          </button>
          <button
            disabled={busy || stillLocked === false}
            onClick={() => go('Rule broken', () => breakAsVerifier(wallet.manager!, req, walletIndex))}
            className="rounded-full border border-red-500/60 px-5 py-3 text-red-300 disabled:opacity-50"
          >
            They broke it
          </button>
        </div>
      )}
      {msg && <p className="break-all text-sm text-neutral-300">{msg}</p>}
      {txid && <TxLink txid={txid} />}
    </div>
  );
}

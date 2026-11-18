// Server-only: the Vouch demo verifier and the keeper that settles expired pledges.
// The verifier key comes from COMMITCASH_VERIFIER_WIF (server env, never NEXT_PUBLIC_, never committed).
// Only import this from route handlers / scripts.
import { SignatureTemplate, type NetworkProvider, type SpendableUtxo } from 'cashscript';
import { binToHex, hexToBin } from '@bitauth/libauth';
import {
  createPledgeContract,
  buildKeep,
  buildForfeit,
  verifierKeepSignature,
  verifyByHeight,
  stakerP2pkhAddress,
  DEFAULT_FEE,
  type BchNetwork,
} from '@/lib/vouch';
import { checkAddress } from '@/lib/network';

export interface PledgeTerms {
  id: string;
  deadline: number;
  beneficiaryAddress: string;
  stakerPubkey: string;
  verifierPubkey: string;
  network: BchNetwork;
}

export class VerifierError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function loadVerifierKey(wif = process.env.COMMITCASH_VERIFIER_WIF): SignatureTemplate | null {
  if (!wif) return null;
  return new SignatureTemplate(wif.trim());
}

export function verifierPubkeyHex(key: SignatureTemplate): string {
  return binToHex(key.publicKey);
}

function parseTerms(t: unknown): PledgeTerms {
  const p = t as Partial<PledgeTerms>;
  const hex33 = /^[0-9a-f]{66}$/i;
  if (!p || typeof p !== 'object') throw new VerifierError('Missing pledge');
  if (!/^[0-9a-f]{32}$/i.test(p.id ?? '')) throw new VerifierError('Bad pledge id');
  if (!Number.isInteger(p.deadline) || (p.deadline as number) <= 0) throw new VerifierError('Bad deadline');
  if (!hex33.test(p.stakerPubkey ?? '') || !hex33.test(p.verifierPubkey ?? '')) throw new VerifierError('Bad pubkeys');
  if (p.network !== 'chipnet' && p.network !== 'mainnet') throw new VerifierError('Bad network');
  if (typeof p.beneficiaryAddress !== 'string') throw new VerifierError('Bad beneficiary');
  const bene = checkAddress(p.beneficiaryAddress, p.network);
  if (!bene.ok) throw new VerifierError(`Beneficiary: ${bene.error}`);
  return p as PledgeTerms;
}

async function loadPledge(termsIn: unknown, provider: NetworkProvider) {
  const terms = parseTerms(termsIn);
  if (provider.network !== terms.network) throw new VerifierError('Network mismatch');
  const contract = createPledgeContract(
    {
      stakerPubkey: hexToBin(terms.stakerPubkey),
      verifierPubkey: hexToBin(terms.verifierPubkey),
      beneficiaryAddress: terms.beneficiaryAddress,
      deadline: terms.deadline,
      pledgeId: terms.id,
    },
    provider,
  );
  // Never trust a client-supplied UTXO: read what is actually locked at the contract.
  const utxos = await contract.getUtxos();
  const utxo = utxos.filter((u) => !u.token).sort((a, b) => (b.satoshis > a.satoshis ? 1 : -1))[0];
  if (!utxo) throw new VerifierError('Nothing is locked in this pledge', 404);
  return { terms, contract, utxo };
}

const utxoJson = (u: SpendableUtxo) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString() });

/**
 * Demo verifier approves a keep. Rules: the pledge names this verifier, the requester confirmed
 * and described what they did, and it's before deadline - ~1h.
 * - With `stakerSig` (staker signed first): assemble the full keep and broadcast it now.
 * - Without: return the verifier signature; the staker's wallet completes and broadcasts.
 */
export async function approveKeep(
  body: { pledge: unknown; confirm?: boolean; note?: string; stakerSig?: string },
  provider: NetworkProvider,
  key: SignatureTemplate,
) {
  if (body.confirm !== true || !body.note || body.note.trim().length < 3) {
    throw new VerifierError('Confirm the promise was kept and say what you did');
  }
  const { terms, contract, utxo } = await loadPledge(body.pledge, provider);
  if (terms.verifierPubkey.toLowerCase() !== verifierPubkeyHex(key)) {
    throw new VerifierError('This pledge names a different verifier', 403);
  }
  const height = await provider.getBlockHeight();
  if (height >= verifyByHeight(terms.deadline)) {
    throw new VerifierError(`Too late: keep must be approved before block ${verifyByHeight(terms.deadline)} (now ${height})`, 409);
  }
  const stakerAddress = stakerP2pkhAddress(hexToBin(terms.stakerPubkey), terms.network);
  if (body.stakerSig) {
    if (!/^[0-9a-f]{130}$/i.test(body.stakerSig)) throw new VerifierError('Bad staker signature');
    const tx = await buildKeep({ contract, provider, utxo, stakerSig: hexToBin(body.stakerSig), verifierSig: key, stakerAddress }).send();
    return { txid: tx.txid, utxo: utxoJson(utxo) };
  }
  const verifierSig = verifierKeepSignature({ contract, provider, utxo, verifier: key, stakerAddress });
  return { verifierSig: binToHex(verifierSig), utxo: utxoJson(utxo), fee: DEFAULT_FEE.toString() };
}

/** Demo verifier rules the promise broken: stake goes to the beneficiary. */
/**
 * The demo verifier only ever co-signs KEEP. It never signs breakByVerifier: this endpoint can't
 * authenticate the caller, so anyone holding a pledge's terms (the beneficiary included) could
 * otherwise force a demo pledge to break. A demo pledge ends by keep, by expiry (forfeit), or by
 * the staker's own breakByStaker, which the staker signs alone in their wallet.
 */
export const DEMO_BREAK_REFUSED =
  'The demo verifier never signs a break. To break your own pledge, sign "I broke it" in your wallet; after the deadline anyone can settle it to the beneficiary.';

export async function demoVerifierAction(
  body: { action?: string; pledge: unknown; confirm?: boolean; note?: string; stakerSig?: string },
  provider: NetworkProvider,
  key: SignatureTemplate,
) {
  if (body.action === 'keep') return approveKeep(body, provider, key);
  if (body.action === 'break') throw new VerifierError(DEMO_BREAK_REFUSED, 403);
  throw new VerifierError('action must be keep');
}

/** Anyone may settle an expired pledge to its beneficiary; no key needed. */
export async function settleExpired(body: { pledge: unknown }, provider: NetworkProvider) {
  const { terms, contract, utxo } = await loadPledge(body.pledge, provider);
  const height = await provider.getBlockHeight();
  if (height < terms.deadline) throw new VerifierError(`Deadline not reached (block ${terms.deadline}, now ${height})`, 409);
  const tx = await buildForfeit({ contract, provider, utxo, beneficiaryAddress: terms.beneficiaryAddress, deadline: terms.deadline }).send();
  return { txid: tx.txid };
}

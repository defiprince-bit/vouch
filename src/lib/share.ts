// "Verify my pledge" share links. Everything the verifier needs travels in the URL fragment
// (never sent to our server by the browser): pledge terms, the locked UTXO, and the staker's
// pre-signed keep signature.
import { binToHex, hexToBin } from '@bitauth/libauth';
import type { StoredPledge } from './pledges';
import { addressNetwork, isNetwork } from './network';

export interface VerifyRequest {
  v: 1;
  pledge: Pick<
    StoredPledge,
    'id' | 'promise' | 'stakeSats' | 'deadline' | 'beneficiaryAddress' | 'stakerPubkey' | 'verifierPubkey' | 'contractAddress' | 'network'
  > &
    Partial<Pick<StoredPledge, 'beneficiaryName' | 'deadlineAt'>>; // display only; never used to build transactions
  utxo: { txid: string; vout: number; satoshis: string };
  fee: string;
  /** Staker's signature over the deterministic keep tx (hex). */
  stakerSig: string;
}

export function toB64Url(s: string): string {
  const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(s))) : Buffer.from(s, 'utf8').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  return typeof atob === 'function' ? decodeURIComponent(escape(atob(b64))) : Buffer.from(b64, 'base64').toString('utf8');
}

export function encodeVerifyRequest(r: VerifyRequest): string {
  return toB64Url(JSON.stringify(r));
}

export function decodeVerifyRequest(fragment: string): VerifyRequest {
  let r: VerifyRequest;
  try {
    r = JSON.parse(fromB64Url(fragment.replace(/^#/, '').replace(/^pledge=/, ''))) as VerifyRequest;
  } catch {
    throw new Error('Invalid verify link: ask your friend to copy the whole link again');
  }
  if (!r || r.v !== 1 || !r.pledge || !r.utxo || !/^[0-9a-f]{130}$/i.test(r.stakerSig)) throw new Error('Invalid verify link');
  if (!/^[0-9a-f]{64}$/i.test(r.utxo.txid)) throw new Error('Invalid verify link');
  checkLinkNetwork(r.pledge);
  return r;
}

/** A link's addresses must all be on the network it claims (chipnet: bchtest:, mainnet: bitcoincash:). */
export function checkLinkNetwork(p: Pick<StoredPledge, 'network' | 'beneficiaryAddress' | 'contractAddress'>) {
  if (!isNetwork(p.network)) throw new Error('Invalid verify link: unknown network');
  const bene = addressNetwork(p.beneficiaryAddress ?? '');
  if (bene !== p.network) {
    throw new Error(`Invalid verify link: the beneficiary address is ${bene ? `a ${bene}` : 'not a valid'} address, but the pledge is on ${p.network}`);
  }
  const contract = addressNetwork(p.contractAddress ?? '');
  if (contract !== p.network) {
    throw new Error(`Invalid verify link: the contract address is ${contract ? `a ${contract}` : 'not a valid'} address, but the pledge is on ${p.network}`);
  }
}

/** `/verify#pledge=…`: the data stays in the fragment, which browsers never send to the server. */
export function verifyLink(origin: string, r: VerifyRequest): string {
  return `${origin}/verify#pledge=${encodeVerifyRequest(r)}`;
}

export const sigToHex = (s: Uint8Array) => binToHex(s);
export const sigFromHex = (s: string) => hexToBin(s);

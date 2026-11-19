// Wall listing proof. At create time the staker's browser makes a random 32-byte listSecret and a
// 16-byte nonce and keeps both ONLY in its pledge storage (never in a verify link or share URL).
// The pledge id commits to them and to the habit:
//
//   pledgeId = sha256(DOMAIN || nonce || utf8(habit) || sha256(listSecret))[0..16)
//
// The pledge id is a contract constructor arg, so it's baked into the contract address before
// anything is shared. To list, the server needs the secret whose hash, with the nonce and the
// habit, rebuilds that id. A verify-link holder has the id but not the secret, and can't
// pre-register under a secret of their own: the id already pins sha256(listSecret), so
// registration order doesn't matter. The registry stores sha256(listSecret), never the secret.
//
// Why not a wallet signature: WizardConnect (hdwalletv1) only has sign_transaction_request, no
// message signing; and the keep pre-signature can't be the proof because it travels in every
// verify link.
import { binToHex, hexToBin, sha256, utf8ToBin } from '@bitauth/libauth';

export const LIST_DOMAIN = 'vouch-wall-list:v1';
export const isListSecret = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
export const isListNonce = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);

const randomHex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return binToHex(b);
};
export const newListSecret = () => randomHex(32);
export const newListNonce = () => randomHex(16);

/** sha256(listSecret), hex. What the registry stores; safe to share. */
export const listSecretHash = (listSecret: string): string => binToHex(sha256.hash(hexToBin(listSecret)));

/** The 16-byte pledge id (hex) committing to nonce, habit and sha256(listSecret). */
export function listPledgeId(nonce: string, habit: string, secretHash: string): string {
  if (!isListNonce(nonce) || !/^[0-9a-f]{64}$/.test(secretHash)) throw new Error('Bad listing commitment');
  const pre = new Uint8Array([...utf8ToBin(LIST_DOMAIN), ...hexToBin(nonce), ...utf8ToBin(habit), ...hexToBin(secretHash)]);
  return binToHex(sha256.hash(pre).slice(0, 16));
}

/** Does this secret (with the nonce and habit) rebuild the pledge id? */
export function secretMatchesPledge(listSecret: unknown, nonce: unknown, habit: unknown, pledgeId: string): boolean {
  if (!isListSecret(listSecret) || !isListNonce(nonce) || typeof habit !== 'string') return false;
  const a = listPledgeId(nonce, habit, listSecretHash(listSecret));
  const b = pledgeId.toLowerCase();
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

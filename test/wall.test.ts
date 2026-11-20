// Public wall: listing validation (listSecret proof, on-chain lock, address + network checks, spam
// guards) and state derivation from the chain.
import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, placeholderSignature } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, hexToBin } from '@bitauth/libauth';
import { createPledgeContract, buildKeep, buildForfeit, buildBreakByVerifier, stakerP2pkhAddress, newPledgeId, DEFAULT_FEE } from '@/lib/vouch';
import { toWcSignRequest, keepSignaturesFromTx, DUMMY_SIGNATURE } from '@/lib/wc';
import { encodeVerifyRequest, verifyLink, type VerifyRequest } from '@/lib/share';
import { newListSecret, newListNonce, listPledgeId, listSecretHash, secretMatchesPledge } from '@/lib/listSecret';
import { wallTerms, canListHere } from '@/lib/wallActions';
import { quorumTerms } from '@/lib/quorumActions';
import type { StoredPledge } from '@/lib/pledges';
import { buildQuorumKeep, buildQuorumBreakByVerifier, quorumSigsFromTx, QUORUM_FEE } from '@/lib/quorum';
import { quorumContract, requestSpends, encodeQuorumRequest, quorumVerifyLink, decodeAnyVerifyRequest, type QuorumTerms, type QuorumVerifyRequest } from '@/lib/quorumShare';
import { cleanHabit, statsOf, shortAddress, HABIT_MAX, defaultVisibility, VISIBILITY_COPY } from '@/lib/wall';
import { listPledge, readWall, LIST_LIMITS, _test } from '@/server/wall';
import { MemoryWallStore, type ListingRow } from '@/server/wallStore';
import { deriveState, type ChainReader } from '@/server/wallState';
import { VerifierError, type PledgeTerms } from '@/server/verifier';
import type { AddressHistoryTx } from '@/lib/providers';
import { LEGACY_LISTINGS } from '@/server/wallLegacy';
import { mockWalletSign } from './mock-wallet';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, hex: binToHex(pub), address, sig: new SignatureTemplate(priv) };
}

const DEADLINE = 1000;
const STAKE = 20_000n;
const staker = makeKey();
const beneficiary = makeKey();
const verifier = makeKey();
const vs = [makeKey(), makeKey(), makeKey()];

let provider: MockNetworkProvider;
let store: MemoryWallStore;
/** History rows the fake indexer returns, keyed by address. */
let history: Record<string, AddressHistoryTx[]>;
let raw: Record<string, string>;

const chain: ChainReader = {
  utxos: async (_n, a) => (await provider.getUtxos(a)).map((u) => ({ txid: u.txid, vout: u.vout, satoshis: u.satoshis })),
  history: async (_n, a) => history[a] ?? [],
  rawTx: async (_n, t) => {
    if (!raw[t]) throw new Error('no tx');
    return raw[t];
  },
  height: async () => DEADLINE - 100,
};
const deps = () => ({ store, chain, provider: () => provider as never });

beforeEach(() => {
  provider = new MockNetworkProvider();
  (provider as unknown as { network: string }).network = 'chipnet';
  provider.setBlockHeight(DEADLINE - 100);
  store = new MemoryWallStore();
  history = {};
  raw = {};
  _test.clearCache();
});

// --- pledge builders (what the browser does) -----------------------------------------------------

/** A fresh listSecret + nonce and the pledge id that commits to them (what the create form does). */
function commitment(habit: string) {
  const listSecret = newListSecret();
  const listNonce = newListNonce();
  return { listSecret, listNonce, id: listPledgeId(listNonce, habit, listSecretHash(listSecret)) };
}

const HABIT = 'Run 5k every Saturday';

function v1Pledge(opts: { lock?: boolean; habit?: string } = {}) {
  const habit = opts.habit ?? HABIT;
  const { listSecret, listNonce, id } = commitment(habit);
  const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
  const utxo = opts.lock === false ? { ...randomUtxo({ satoshis: STAKE }) } : provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
  const stored: StoredPledge = {
    id, promise: habit, stakeSats: STAKE.toString(), deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex,
    verifierPubkey: verifier.hex, verifierKind: 'friend', contractAddress: contract.address, network: 'chipnet', createdAt: 1, visibility: 'unlisted', listSecret, listNonce,
  };
  return { stored, listSecret, listNonce, contract, utxo, body: { pledge: wallTerms(stored), listSecret, listNonce, habit } };
}

/** The verify link the staker shares for a v1 pledge, with their real keep pre-signature. */
function verifyLinkFor(p: ReturnType<typeof v1Pledge>) {
  const builder = buildKeep({ contract: p.contract, provider, utxo: { ...p.utxo, lockingBytecode: p.contract.lockingBytecode } as never, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress: stakerP2pkhAddress(staker.pub, 'chipnet') });
  const req = toWcSignRequest(builder, [[0, 'receive', 0]], { broadcast: false, userPrompt: 'pre-sign' });
  const { stakerSig } = keepSignaturesFromTx(mockWalletSign(req, { 'receive/0': staker.priv }));
  const s = p.stored;
  const r: VerifyRequest = {
    v: 1,
    pledge: { id: s.id, promise: s.promise, stakeSats: s.stakeSats, deadline: s.deadline, beneficiaryAddress: s.beneficiaryAddress, stakerPubkey: s.stakerPubkey, verifierPubkey: s.verifierPubkey, contractAddress: s.contractAddress, network: s.network },
    utxo: { txid: p.utxo.txid, vout: p.utxo.vout, satoshis: p.utxo.satoshis.toString() },
    fee: DEFAULT_FEE.toString(),
    stakerSig: binToHex(stakerSig!),
  };
  return { r, url: verifyLink('https://vouch.example', r) };
}

function v2Pledge() {
  const habit = 'Write 500 words';
  const { listSecret, listNonce, id } = commitment(habit);
  const t = {
    id,
    promise: habit,
    stakeSats: STAKE.toString(),
    deadline: DEADLINE,
    beneficiaryAddress: beneficiary.address,
    stakerPubkey: staker.hex,
    network: 'chipnet' as const,
    verifiers: vs.map((v) => ({ pubkey: v.hex })),
    threshold: 2,
    contractAddress: '',
  };
  const terms: QuorumTerms = { ...t, contractAddress: quorumContract(t, provider).address };
  const c = quorumContract(terms, provider);
  const utxo = provider.addUtxo(c.address, randomUtxo({ satoshis: STAKE }));
  const stored: StoredPledge = {
    id, promise: habit, stakeSats: t.stakeSats, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex, verifierPubkey: vs[0].hex,
    version: 2, verifiers: t.verifiers, threshold: 2, contractAddress: terms.contractAddress, network: 'chipnet', createdAt: 1, listSecret, listNonce,
  };
  const base: QuorumVerifyRequest = { v: 2, pledge: quorumTerms(stored), utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() }, fee: QUORUM_FEE.toString(), stakerSig: '', keepSigs: [null, null, null], breakSigs: [null, null, null] };
  const s = requestSpends(base, provider);
  const req = toWcSignRequest(buildQuorumKeep({ ...s, stakerSig: placeholderSignature(), verifierSigs: [] }), [[0, 'receive', 0]], { broadcast: false, userPrompt: 'pre-sign' });
  const stakerSig = quorumSigsFromTx(mockWalletSign(req, { 'receive/0': staker.priv }), 'keep').stakerSig!;
  const r = { ...base, stakerSig: binToHex(stakerSig) };
  return { r, stored, listSecret, listNonce, contract: c, utxo, body: { pledge: wallTerms(stored), listSecret, listNonce, habit }, url: quorumVerifyLink('https://vouch.example', r) };
}

type Body = { pledge: unknown; listSecret: unknown; listNonce: unknown; habit: unknown };
const list = (body: Body, ip = '1.2.3.4') => listPledge({ ...body, ip }, deps());
const withTerms = (body: Body, patch: Record<string, unknown>) => ({ ...body, pledge: { ...(body.pledge as object), ...patch } });
const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'expected a refusal').toBeInstanceOf(VerifierError);
  return e as VerifierError;
};

// --- listing -------------------------------------------------------------------------------------

describe('listing (POST /api/wall)', () => {
  it('a correct secret is accepted (v1); stores sha256(secret), never the secret; refuses it twice', async () => {
    const p = v1Pledge();
    const res = await list(p.body);
    expect(res.contractAddress).toBe(p.contract.address);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ habit: HABIT, network: 'chipnet', version: 1, stakerPubkey: staker.hex, state: 'active', legacy: false, hidden: false });
    expect(store.rows[0].listSecretHash).toBe(listSecretHash(p.listSecret));
    expect(JSON.stringify(store.rows[0])).not.toContain(p.listSecret);
    expect(store.rows[0].termsJson).not.toMatch(/stakerSig|promise|beneficiaryName|listSecret|listNonce/);
    expect((await err(list(p.body))).status).toBe(409);
  });

  it('v1.1 (verifier-only refund): lists with its flag, stores it, and derives kept from a verifier-only keep', async () => {
    const habit = 'Run 3 times before the clock hits zero';
    const { listSecret, listNonce, id } = commitment(habit);
    const contract = createPledgeContract(
      { stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id, verifierRefund: true },
      provider,
    );
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const stored: StoredPledge = {
      id, promise: habit, stakeSats: STAKE.toString(), deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex,
      verifierPubkey: verifier.hex, verifierRefund: true, verifierKind: 'friend', contractAddress: contract.address, network: 'chipnet', createdAt: 1, listSecret, listNonce,
    };
    const body = { pledge: wallTerms(stored), listSecret, listNonce, habit };
    // without the flag the terms rebuild the v1 address, which doesn't match
    expect((await err(list(withTerms(body, { verifierRefund: undefined })))).message).toMatch(/don’t match/);
    await list(body);
    expect(JSON.parse(store.rows[0].termsJson).verifierRefund).toBe(true);
    const stakerAddress = stakerP2pkhAddress(staker.pub, 'chipnet');
    const hex = buildKeep({ contract, provider, utxo, verifierSig: new SignatureTemplate(verifier.priv), stakerAddress }).build();
    const st = await deriveState(JSON.parse(store.rows[0].termsJson), { ...chain, utxos: async () => [], history: async () => [{ hash: 'aa'.repeat(32), blockHeight: 1, timestamp: 1, inputs: [{ address: contract.address, value: Number(STAKE) }], outputs: [{ address: stakerAddress, value: Number(STAKE - DEFAULT_FEE) }] }] as never, rawTx: async () => hex }, provider);
    expect(st).toMatchObject({ state: 'kept', sealsCollected: 1 });
  });

  it('a correct secret is accepted (v2 quorum)', async () => {
    await list(v2Pledge().body);
    expect(store.rows[0]).toMatchObject({ version: 2, habit: 'Write 500 words' });
    expect(JSON.parse(store.rows[0].termsJson)).toMatchObject({ version: 2, threshold: 2 });
  });

  it('a verify-link holder can’t list: terms, UTXO and the staker’s keep pre-signature are no proof', async () => {
    const p1 = v1Pledge();
    const p2 = v2Pledge();
    const links = [
      { r: verifyLinkFor(p1).r as VerifyRequest | QuorumVerifyRequest, terms: p1.body.pledge },
      { r: p2.r as VerifyRequest | QuorumVerifyRequest, terms: p2.body.pledge },
    ];
    let n = 0;
    store.countAttempts = async () => 0; // many guesses here; the limits are tested below
    for (const { r, terms } of links) {
      // everything a link holder has: terms, habit, utxo, the signature; guesses for the secret
      for (const listSecret of [undefined, '', r.stakerSig, r.stakerSig.slice(0, 64), r.pledge.id + r.pledge.id]) {
        for (const listNonce of [undefined, r.pledge.id]) {
          const e = await err(list({ pledge: { ...terms, stakerSig: r.stakerSig, utxo: r.utxo }, listSecret, listNonce, habit: r.pledge.promise }, `5.0.0.${n++}`));
          expect(e.status).toBe(403);
          expect(e.message).toMatch(/browser that created it/);
        }
      }
      // the old request shape (the encoded verify link itself) is no proof either
      const link = 'keepSigs' in r ? encodeQuorumRequest(r) : encodeVerifyRequest(r);
      expect((await err(listPledge({ link, habit: r.pledge.promise, ip: '1.1.1.1' } as never, deps()))).message).toMatch(/Missing pledge/);
    }
    expect(store.rows).toHaveLength(0);
  });

  it('a verify-link holder can’t front-run with a secret of their own (registration order doesn’t matter)', async () => {
    const p = v1Pledge();
    const { r } = verifyLinkFor(p);
    // The attacker lists first, with their own secret + nonce (and any habit they like).
    const mine = { secret: newListSecret(), nonce: newListNonce() };
    for (const habit of [r.pledge.promise, 'Totally different habit']) {
      const e = await err(list({ pledge: p.body.pledge, listSecret: mine.secret, listNonce: mine.nonce, habit }));
      expect(e.status).toBe(403);
    }
    // nothing got registered under the attacker's hash, so the real staker still lists fine
    expect(store.rows).toHaveLength(0);
    await list(p.body);
    expect(store.rows[0].listSecretHash).toBe(listSecretHash(p.listSecret));
    expect(store.rows[0].listSecretHash).not.toBe(listSecretHash(mine.secret));
  });

  it('a wrong secret is rejected, including one valid for another pledge, and a changed habit or nonce', async () => {
    const a = v1Pledge();
    const b = v1Pledge();
    expect((await err(list({ ...a.body, listSecret: newListSecret() }))).status).toBe(403);
    expect((await err(list({ ...a.body, listSecret: b.listSecret }))).status).toBe(403);
    expect((await err(list({ ...a.body, listSecret: b.listSecret, listNonce: b.listNonce }))).status).toBe(403);
    expect((await err(list({ ...a.body, listSecret: a.listSecret.toUpperCase() }))).status).toBe(403);
    expect((await err(list({ ...a.body, listNonce: newListNonce() }))).status).toBe(403);
    // the habit is committed too: the secret holder can't list it under a different habit
    expect((await err(list({ ...a.body, habit: 'Something nicer-sounding' }))).status).toBe(403);
    expect(store.rows).toHaveLength(0);
    await list(a.body);
    expect(store.rows).toHaveLength(1);
  });

  it('a pledge made before list secrets (random id) can’t be newly listed', async () => {
    const id = newPledgeId();
    const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
    provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const stored: StoredPledge = { ...v1Pledge().stored, id, contractAddress: contract.address, listSecret: undefined, listNonce: undefined };
    expect(canListHere(stored)).toBe(false);
    expect((await err(list({ pledge: wallTerms(stored), listSecret: newListSecret(), listNonce: newListNonce(), habit: HABIT }))).status).toBe(403);
  });

  it('rejects an address mismatch: terms that rebuild to a different contract', async () => {
    const a = v1Pledge();
    const b = v1Pledge();
    const e = await err(list(withTerms(a.body, { contractAddress: b.contract.address })));
    expect(e.message).toMatch(/don’t match the contract address/);
    expect(store.rows).toHaveLength(0);
  });

  it('rejects a pledge with no on-chain lock', async () => {
    expect((await err(list(v1Pledge({ lock: false }).body))).message).toMatch(/No locked stake/);
  });

  it('rejects the wrong network', async () => {
    const p = v1Pledge();
    expect((await err(list(withTerms(p.body, { network: 'mainnet' })))).message).toMatch(/chipnet|mainnet|network/i);
    expect((await err(list(withTerms(p.body, { contractAddress: p.contract.address.replace('bchtest:', 'bitcoincash:') })))).message).toMatch(/network|address|chipnet|mainnet/i);
    await err(list(withTerms(p.body, { beneficiaryAddress: encodeCashAddress({ prefix: 'bitcoincash', type: CashAddressType.p2pkh, payload: hash160(beneficiary.pub) }).address })));
    expect(store.rows).toHaveLength(0);
  });

  it('caps the habit at 140 characters and strips control characters', async () => {
    expect((await err(list(v1Pledge({ habit: 'x'.repeat(HABIT_MAX + 1) }).body))).message).toMatch(/140/);
    expect((await err(list({ ...v1Pledge().body, habit: '   ' }))).message).toMatch(/140/);
    await list(v1Pledge({ habit: '<b>Run</b>\u202e\u0007 5k' }).body);
    expect(store.rows[0].habit).toBe('<b>Run</b> 5k'); // stored as text; React escapes it on render
    expect(cleanHabit('a'.repeat(HABIT_MAX))).toHaveLength(HABIT_MAX);
  });

  it('caps each staker at 5 active listings', async () => {
    for (let i = 0; i < 5; i++) await list(v1Pledge().body, `10.0.0.${i}`);
    const e = await err(list(v1Pledge().body, '10.0.1.1'));
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/5 active/);
  });

  it('rate-limits per hashed IP (counted in the registry, not memory)', async () => {
    for (let i = 0; i < LIST_LIMITS.perIpPerHour; i++) await list({ pledge: null, listSecret: null, listNonce: null, habit: 'x' }, '9.9.9.9').catch(() => {});
    expect((await err(list(v1Pledge().body, '9.9.9.9'))).status).toBe(429);
    expect(store.attempts.every((a) => a.ipHash !== '9.9.9.9' && /^[0-9a-f]{32}$/.test(a.ipHash))).toBe(true);
    await list(v1Pledge().body, '8.8.8.8');
  });

  it('rate-limits per staker key', async () => {
    const bodies = Array.from({ length: LIST_LIMITS.perStakerPerHour + 1 }, () => v1Pledge().body);
    for (let i = 0; i < LIST_LIMITS.perStakerPerHour; i++) await list({ ...bodies[i], habit: 'x'.repeat(200) }, `7.0.0.${i}`).catch(() => {});
    expect((await err(list(bodies[LIST_LIMITS.perStakerPerHour], '7.0.9.9'))).status).toBe(429);
  });

  it('refuses to list when only the bundled legacy list is available', async () => {
    store.kind = 'legacy-only';
    expect((await err(list(v1Pledge().body))).status).toBe(503);
  });
});

describe('listSecret', () => {
  it('the pledge id commits to nonce, habit and sha256(secret); only the matching secret passes', () => {
    const s = newListSecret();
    const n = newListNonce();
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(n).toMatch(/^[0-9a-f]{32}$/);
    const id = listPledgeId(n, HABIT, listSecretHash(s));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(secretMatchesPledge(s, n, HABIT, id)).toBe(true);
    expect(secretMatchesPledge(newListSecret(), n, HABIT, id)).toBe(false);
    expect(secretMatchesPledge(s, newListNonce(), HABIT, id)).toBe(false);
    expect(secretMatchesPledge(s, n, HABIT + ' ', id)).toBe(false);
    expect(secretMatchesPledge(listSecretHash(s), n, HABIT, id)).toBe(false); // the hash alone isn't the secret
    expect(secretMatchesPledge('zz', n, HABIT, id)).toBe(false);
  });

  it('never appears in encoded verify links or share URLs', () => {
    const p1 = v1Pledge();
    const p2 = v2Pledge();
    const { r: r1, url: u1 } = verifyLinkFor(p1);
    const encoded = [u1, encodeVerifyRequest(r1), p2.url, encodeQuorumRequest(p2.r)];
    const decoded = [JSON.stringify(decodeAnyVerifyRequest(u1.split('#')[1])), JSON.stringify(decodeAnyVerifyRequest(p2.url.split('#')[1]))];
    for (const x of [...encoded, ...decoded]) {
      for (const secret of [p1.listSecret, p2.listSecret]) expect(x).not.toContain(secret);
      expect(x).not.toMatch(/listSecret|listNonce/);
    }
    // link terms are built from the stored pledge (which holds the secret) by quorumTerms(): no secret field
    expect(JSON.stringify(quorumTerms(p2.stored))).not.toContain(p2.listSecret);
    expect(JSON.stringify(wallTerms(p1.stored))).not.toContain(p1.listSecret);
  });
});

// --- state derivation ----------------------------------------------------------------------------

const v1Terms = (c: { id: string }) => ({ id: c.id, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex, verifierPubkey: verifier.hex, network: 'chipnet' }) as PledgeTerms;
const spendRow = (txid: string, from: string, value: bigint, to: string, ts = 1_795_000_000): AddressHistoryTx => ({
  hash: txid,
  inputs: [{ address: from, value: Number(value) }],
  outputs: [{ address: to, value: Number(value) - 1000 }],
  blockHeight: 900,
  timestamp: ts,
});

describe('state derivation (chain only)', () => {
  function locked() {
    const id = newPledgeId();
    const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    return { id, contract, utxo: { ...utxo, lockingBytecode: contract.lockingBytecode } };
  }
  /** Spend it for real on the mock chain, and feed the indexer the same tx. */
  async function spend(p: ReturnType<typeof locked>, builder: { build(): string; send(): Promise<{ txid: string }> }, to: string) {
    const hex = builder.build();
    const { txid } = await builder.send();
    raw[txid] = hex;
    history[p.contract.address] = [spendRow(txid, p.contract.address, STAKE, to)];
  }

  it('active while a UTXO sits at the contract', async () => {
    const p = locked();
    expect(await deriveState(v1Terms(p), chain, provider)).toEqual({ state: 'active', stakeSats: STAKE.toString(), sealsCollected: null });
  });

  it('kept when spent back to the staker (keep)', async () => {
    const p = locked();
    await spend(p, buildKeep({ contract: p.contract, provider, utxo: p.utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress: stakerP2pkhAddress(staker.pub, 'chipnet') }), staker.address);
    const d = await deriveState(v1Terms(p), chain, provider);
    expect(d).toMatchObject({ state: 'kept', stakeSats: STAKE.toString(), sealsCollected: 1, endedAt: 1_795_000_000_000 });
    expect(d?.paidHow).toBeUndefined();
  });

  it('paid (broken) when a verifier breaks it', async () => {
    const p = locked();
    await spend(p, buildBreakByVerifier({ contract: p.contract, provider, utxo: p.utxo, verifierSig: verifier.sig, beneficiaryAddress: beneficiary.address }), beneficiary.address);
    expect(await deriveState(v1Terms(p), chain, provider)).toMatchObject({ state: 'paid', paidHow: 'broken' });
  });

  it('paid (forfeited) after the deadline', async () => {
    const p = locked();
    provider.setBlockHeight(DEADLINE + 1);
    await spend(p, buildForfeit({ contract: p.contract, provider, utxo: p.utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE }), beneficiary.address);
    expect(await deriveState(v1Terms(p), chain, provider)).toMatchObject({ state: 'paid', paidHow: 'forfeited', sealsCollected: 0 });
  });

  it('v2: counts the seals in the spend that ended it', async () => {
    const { r, contract, utxo } = v2Pledge();
    const s = requestSpends(r, provider);
    const keep = buildQuorumKeep({ ...s, stakerSig: staker.sig, verifierSigs: [vs[0].sig, undefined, vs[2].sig] });
    const hex = keep.build();
    const { txid } = await keep.send();
    raw[txid] = hex;
    history[contract.address] = [spendRow(txid, contract.address, utxo.satoshis, staker.address)];
    const terms = { id: r.pledge.id, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex, verifierPubkey: vs[0].hex, network: 'chipnet', version: 2, verifierPubkeys: vs.map((v) => v.hex), threshold: 2 } as PledgeTerms;
    expect(await deriveState(terms, chain, provider)).toMatchObject({ state: 'kept', sealsCollected: 2 });
    // and a verifier break
    const p2 = v2Pledge();
    const s2 = requestSpends(p2.r, provider);
    const brk = buildQuorumBreakByVerifier({ ...s2, beneficiaryAddress: beneficiary.address, verifierSigs: [undefined, vs[1].sig, vs[2].sig] });
    const hex2 = brk.build();
    const sent = await brk.send();
    raw[sent.txid] = hex2;
    history[p2.contract.address] = [spendRow(sent.txid, p2.contract.address, STAKE, beneficiary.address)];
    expect(await deriveState({ ...terms, id: p2.r.pledge.id }, chain, provider)).toMatchObject({ state: 'paid', paidHow: 'broken', sealsCollected: 2 });
  });

  it('ignores client claims: a pledge with nothing ever locked has no state', async () => {
    const id = newPledgeId();
    expect(await deriveState({ ...v1Terms({ id }) }, chain, provider)).toBeNull();
  });

  it('still knows kept vs paid if the raw tx is unavailable (detail only is lost)', async () => {
    const p = locked();
    await provider.getUtxos(p.contract.address); // spend it on the indexer only
    history[p.contract.address] = [spendRow('ab'.repeat(32), p.contract.address, STAKE, beneficiary.address)];
    (provider as unknown as { utxoSet: unknown[] }).utxoSet = [];
    const d = await deriveState(v1Terms(p), { ...chain, utxos: async () => [] }, provider);
    expect(d).toMatchObject({ state: 'paid', sealsCollected: null });
  });
});

// --- reading the wall ----------------------------------------------------------------------------

function row(over: Partial<ListingRow> & { terms: PledgeTerms; address: string }): ListingRow {
  const { terms, address, ...rest } = over;
  return {
    pledgeId: terms.id,
    contractAddress: address,
    network: 'chipnet',
    version: 1,
    habit: 'Run',
    stakerPubkey: staker.hex,
    termsJson: JSON.stringify(terms),
    createdAt: 1,
    legacy: false,
    hidden: false,
    state: null,
    stateJson: null,
    checkedAt: null,
    ...rest,
  };
}

describe('wall + stats', () => {
  it('derives every card and figure from the chain; hidden and never-locked rows are left out', async () => {
    const mk = () => {
      const id = newPledgeId();
      const c = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
      return { id, c, terms: v1Terms({ id }) };
    };
    const a = mk(); // active
    provider.addUtxo(a.c.address, randomUtxo({ satoshis: 30_000n }));
    const b = mk(); // kept
    history[b.c.address] = [spendRow('11'.repeat(32), b.c.address, 5000n, staker.address)];
    const c = mk(); // paid
    history[c.c.address] = [spendRow('22'.repeat(32), c.c.address, 7000n, beneficiary.address)];
    const d = mk(); // hidden (would be active)
    provider.addUtxo(d.c.address, randomUtxo({ satoshis: 50_000n }));
    const e = mk(); // never locked: client claimed it, chain disagrees
    // a client "claim" in the stored state is ignored once the row is stale
    store = new MemoryWallStore([
      row({ terms: a.terms, address: a.c.address, state: 'kept', stateJson: JSON.stringify({ state: 'active', stakeSats: '1' }), checkedAt: 0 }),
      row({ terms: b.terms, address: b.c.address }),
      row({ terms: c.terms, address: c.c.address }),
      row({ terms: d.terms, address: d.c.address, hidden: true }),
      row({ terms: e.terms, address: e.c.address }),
    ]);
    const wall = await readWall('chipnet', { ...deps(), fresh: true, demoPubkey: verifier.hex, now: 10_000_000 });
    expect(wall.cards.map((x) => x.state).sort()).toEqual(['active', 'kept', 'paid']);
    expect(wall.stats).toEqual({ vouchesMade: 3, bchLockedSats: '30000', keptCount: 1, paidCount: 1 });
    const active = wall.cards.find((x) => x.state === 'active')!;
    expect(active.stakerShort).toBe(shortAddress(staker.address));
    expect(active.stakerShort).not.toBe(staker.address);
    expect(active.verifierType).toBe('demo');
    expect(active.deadlineAt).toBe(10_000_000 + 100 * 600_000);
    expect(JSON.stringify(wall)).not.toContain(beneficiary.address); // public cards hide the beneficiary
    // states were saved with a checkedAt
    expect(store.rows.find((r) => r.pledgeId === b.id)).toMatchObject({ state: 'kept', checkedAt: 10_000_000 });
  });

  it('final states are never re-read; active ones only after the TTL', async () => {
    const id = newPledgeId();
    const c = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
    history[c.address] = [spendRow('33'.repeat(32), c.address, 5000n, staker.address)];
    store = new MemoryWallStore([row({ terms: v1Terms({ id }), address: c.address })]);
    let calls = 0;
    const counting: ChainReader = { ...chain, history: async (n, a) => (calls++, chain.history(n, a)) };
    await readWall('chipnet', { store, chain: counting, provider: () => provider as never, fresh: true, now: 1 });
    await readWall('chipnet', { store, chain: counting, provider: () => provider as never, fresh: true, now: 10 ** 12 });
    expect(calls).toBe(1);
  });

  it('stats: zero state, active-only BCH locked', () => {
    expect(statsOf([])).toEqual({ vouchesMade: 0, bchLockedSats: '0', keptCount: 0, paidCount: 0 });
  });

  it('the legacy seed rebuilds to the addresses it names', () => {
    for (const r of LEGACY_LISTINGS) {
      const t = JSON.parse(r.termsJson) as PledgeTerms;
      const c = t.version === 2
        ? quorumContract({ id: t.id, deadline: t.deadline, beneficiaryAddress: t.beneficiaryAddress, stakerPubkey: t.stakerPubkey, network: 'chipnet', verifiers: t.verifierPubkeys!.map((pubkey) => ({ pubkey })), threshold: t.threshold! }, provider)
        : createPledgeContract({ stakerPubkey: hexToBin(t.stakerPubkey), verifierPubkey: hexToBin(t.verifierPubkey), beneficiaryAddress: t.beneficiaryAddress, deadline: t.deadline, pledgeId: t.id }, provider);
      expect(c.address).toBe(r.contractAddress);
      expect(r).toMatchObject({ legacy: true, network: 'chipnet' });
    }
    expect(LEGACY_LISTINGS).toHaveLength(10);
  });

  it('visibility copy and defaults', () => {
    expect(defaultVisibility('chipnet')).toBe('public');
    expect(defaultVisibility('mainnet')).toBe('unlisted');
    expect(VISIBILITY_COPY.unlisted.help).toBe('Hidden from the wall. The coins, amount and payout are still visible on-chain to anyone with the address.');
    expect(JSON.stringify(VISIBILITY_COPY).toLowerCase()).not.toContain('private');
  });
});

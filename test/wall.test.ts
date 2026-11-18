// Public wall: listing validation (staker-proof, on-chain lock, address + network checks, spam
// guards) and state derivation from the chain.
import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, placeholderSignature } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, hexToBin } from '@bitauth/libauth';
import { createPledgeContract, buildKeep, buildForfeit, buildBreakByVerifier, stakerP2pkhAddress, newPledgeId, DEFAULT_FEE } from '@/lib/vouch';
import { toWcSignRequest, keepSignaturesFromTx, DUMMY_SIGNATURE } from '@/lib/wc';
import { encodeVerifyRequest, type VerifyRequest } from '@/lib/share';
import { buildQuorumKeep, buildQuorumBreakByVerifier, quorumSigsFromTx, QUORUM_FEE } from '@/lib/quorum';
import { quorumContract, requestSpends, encodeQuorumRequest, type QuorumTerms, type QuorumVerifyRequest } from '@/lib/quorumShare';
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
type Key = ReturnType<typeof makeKey>;

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

function v1Pledge(opts: { lock?: boolean; who?: Key } = {}) {
  const id = newPledgeId();
  const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
  const utxo = opts.lock === false ? { ...randomUtxo({ satoshis: STAKE }) } : provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
  const builder = buildKeep({ contract, provider, utxo: { ...utxo, lockingBytecode: contract.lockingBytecode } as never, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress: stakerP2pkhAddress(staker.pub, 'chipnet') });
  const req = toWcSignRequest(builder, [[0, 'receive', 0]], { broadcast: false, userPrompt: 'list' });
  const { stakerSig } = keepSignaturesFromTx(mockWalletSign(req, { 'receive/0': (opts.who ?? staker).priv }));
  const r: VerifyRequest = {
    v: 1,
    pledge: { id, promise: 'Run 5k', stakeSats: STAKE.toString(), deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: staker.hex, verifierPubkey: verifier.hex, contractAddress: contract.address, network: 'chipnet' },
    utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() },
    fee: DEFAULT_FEE.toString(),
    stakerSig: binToHex(stakerSig),
  };
  return { r, contract, utxo, link: `#pledge=${encodeVerifyRequest(r)}` };
}

function v2Pledge() {
  const t = {
    id: newPledgeId(),
    promise: 'Write 500 words',
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
  const base: QuorumVerifyRequest = { v: 2, pledge: terms, utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() }, fee: QUORUM_FEE.toString(), stakerSig: '', keepSigs: [null, null, null], breakSigs: [null, null, null] };
  const s = requestSpends(base, provider);
  const req = toWcSignRequest(buildQuorumKeep({ ...s, stakerSig: placeholderSignature(), verifierSigs: [] }), [[0, 'receive', 0]], { broadcast: false, userPrompt: 'list' });
  const stakerSig = quorumSigsFromTx(mockWalletSign(req, { 'receive/0': staker.priv }), 'keep').stakerSig!;
  const r = { ...base, stakerSig: binToHex(stakerSig) };
  return { r, contract: c, utxo, link: `#pledge=${encodeQuorumRequest(r)}` };
}

const list = (link: string, habit: unknown = 'Run 5k every Saturday', ip = '1.2.3.4') => listPledge({ link, habit, ip }, deps());
const err = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x) => x);
  expect(e, 'expected a refusal').toBeInstanceOf(VerifierError);
  return e as VerifierError;
};

// --- listing -------------------------------------------------------------------------------------

describe('listing (POST /api/wall)', () => {
  it('lists a locked v1 pledge with the staker’s proof, and refuses the same pledge twice', async () => {
    const { link, contract } = v1Pledge();
    const res = await list(link);
    expect(res.contractAddress).toBe(contract.address);
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({ habit: 'Run 5k every Saturday', network: 'chipnet', version: 1, stakerPubkey: staker.hex, state: 'active', legacy: false, hidden: false });
    // only what's needed to rebuild the contract is stored: no signature, no names
    expect(store.rows[0].termsJson).not.toMatch(/stakerSig|promise|beneficiaryName/);
    expect((await err(list(link))).status).toBe(409);
  });

  it('lists a locked v2 (quorum) pledge', async () => {
    const { link } = v2Pledge();
    await list(link);
    expect(store.rows[0]).toMatchObject({ version: 2 });
    expect(JSON.parse(store.rows[0].termsJson)).toMatchObject({ version: 2, threshold: 2 });
  });

  it('rejects an address mismatch: terms that rebuild to a different contract', async () => {
    const a = v1Pledge();
    const b = v1Pledge();
    const swapped = { ...a.r, pledge: { ...a.r.pledge, contractAddress: b.contract.address } };
    const e = await err(list(`#pledge=${encodeVerifyRequest(swapped)}`));
    expect(e.message).toMatch(/don’t match the contract address/);
    expect(store.rows).toHaveLength(0);
  });

  it('rejects a pledge with no on-chain lock', async () => {
    const { link } = v1Pledge({ lock: false });
    expect((await err(list(link))).message).toMatch(/No locked stake/);
  });

  it('rejects a lock that has already been spent or never matched the claimed UTXO', async () => {
    const { r } = v1Pledge();
    const wrongUtxo = { ...r, utxo: { ...r.utxo, satoshis: '19999' } };
    expect((await err(list(`#pledge=${encodeVerifyRequest(wrongUtxo)}`))).message).toMatch(/No locked stake/);
  });

  it('rejects the wrong network', async () => {
    const { r } = v1Pledge();
    // claims mainnet while every address is chipnet
    const mainnet = { ...r, pledge: { ...r.pledge, network: 'mainnet' as const } };
    expect((await err(list(`#pledge=${encodeVerifyRequest(mainnet)}`))).message).toMatch(/chipnet|mainnet|network/i);
    // chipnet terms, mainnet contract address
    const mixed = { ...r, pledge: { ...r.pledge, contractAddress: r.pledge.contractAddress.replace('bchtest:', 'bitcoincash:') } };
    expect((await err(list(`#pledge=${encodeVerifyRequest(mixed)}`))).message).toMatch(/network|address|chipnet|mainnet/i);
    // beneficiary on the other network
    const bene = { ...r, pledge: { ...r.pledge, beneficiaryAddress: encodeCashAddress({ prefix: 'bitcoincash', type: CashAddressType.p2pkh, payload: hash160(beneficiary.pub) }).address } };
    await err(list(`#pledge=${encodeVerifyRequest(bene)}`));
    expect(store.rows).toHaveLength(0);
  });

  it('rejects a listing without the staker’s signature (someone else’s wallet)', async () => {
    const { link } = v1Pledge({ who: makeKey() });
    const e = await err(list(link));
    expect(e.status).toBe(403);
    expect(e.message).toMatch(/Only the staker/);
  });

  it('caps the habit at 140 characters and strips control characters', async () => {
    expect((await err(list(v1Pledge().link, 'x'.repeat(HABIT_MAX + 1)))).message).toMatch(/140/);
    expect((await err(list(v1Pledge().link, '   '))).message).toMatch(/140/);
    await list(v1Pledge().link, '<b>Run</b>\u202e\u0007 5k');
    expect(store.rows[0].habit).toBe('<b>Run</b> 5k'); // stored as text; React escapes it on render
    expect(cleanHabit('a'.repeat(HABIT_MAX))).toHaveLength(HABIT_MAX);
  });

  it('caps each staker at 5 active listings', async () => {
    for (let i = 0; i < 5; i++) await list(v1Pledge().link, 'Run', `10.0.0.${i}`);
    const e = await err(list(v1Pledge().link, 'Run', '10.0.1.1'));
    expect(e.status).toBe(409);
    expect(e.message).toMatch(/5 active/);
  });

  it('rate-limits per hashed IP (counted in the registry, not memory)', async () => {
    for (let i = 0; i < LIST_LIMITS.perIpPerHour; i++) await list('#pledge=bad', 'x', '9.9.9.9').catch(() => {});
    expect((await err(list(v1Pledge().link, 'Run', '9.9.9.9'))).status).toBe(429);
    expect(store.attempts.every((a) => a.ipHash !== '9.9.9.9' && /^[0-9a-f]{32}$/.test(a.ipHash))).toBe(true);
    // another IP is fine
    await list(v1Pledge().link, 'Run', '8.8.8.8');
  });

  it('rate-limits per staker key', async () => {
    const links = Array.from({ length: LIST_LIMITS.perStakerPerHour + 1 }, () => v1Pledge().link);
    for (let i = 0; i < LIST_LIMITS.perStakerPerHour; i++) await list(links[i], 'x'.repeat(200), `7.0.0.${i}`).catch(() => {});
    expect((await err(list(links[LIST_LIMITS.perStakerPerHour], 'Run', '7.0.9.9'))).status).toBe(429);
  });

  it('refuses to list when only the bundled legacy list is available', async () => {
    store.kind = 'legacy-only';
    expect((await err(list(v1Pledge().link))).status).toBe(503);
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

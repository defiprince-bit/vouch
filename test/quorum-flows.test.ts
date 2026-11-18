import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockNetworkProvider, randomUtxo, placeholderSignature } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, encodePrivateKeyWif, hexToBin } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import { stakerP2pkhAddress, newPledgeId } from '@/lib/vouch';
import { toWcSignRequest, STAKER_PATH, type WcSignRequest } from '@/lib/wc';
import { buildQuorumKeep, quorumSigsFromTx, QUORUM_FEE } from '@/lib/quorum';
import {
  decodeAnyVerifyRequest,
  encodeQuorumRequest,
  quorumContract,
  checkRequestSigs,
  mergeRequests,
  requestSpends,
  isQuorumRequest,
  type QuorumTerms,
  type QuorumVerifyRequest,
} from '@/lib/quorumShare';
import { encodeVerifyRequest } from '@/lib/share';
import { signQuorumSlot } from '@/lib/quorumActions';
import { approveKeep, settleExpired, loadVerifierKey, VerifierError } from '@/server/verifier';
import { mockWalletSign } from './mock-wallet';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, address, wif: encodePrivateKeyWif(priv, 'testnet') };
}
/** A WizardConnect manager stand-in: the wallet holds `priv` at receive/<index>. */
function fakeManager(priv: Uint8Array, index = 0): DappConnectionManager {
  return {
    signTransaction: async (req: WcSignRequest) => ({ signedTransaction: mockWalletSign(req, { [`${STAKER_PATH.name}/${index}`]: priv }) }),
  } as unknown as DappConnectionManager;
}

const DEADLINE = 1000;
const STAKE = 20_000n;
const staker = makeKey();
const beneficiary = makeKey();
const demo = makeKey();
const demoKey = loadVerifierKey(demo.wif)!;
const vs = [makeKey(), makeKey(), makeKey()];

let provider: MockNetworkProvider;
beforeEach(() => {
  provider = new MockNetworkProvider();
  (provider as unknown as { network: string }).network = 'chipnet';
  provider.setBlockHeight(DEADLINE - 100);
});

function terms(verifiers: Uint8Array[], threshold: number): QuorumTerms {
  const t = {
    id: newPledgeId(),
    promise: 'Run 5k',
    stakeSats: STAKE.toString(),
    deadline: DEADLINE,
    beneficiaryAddress: beneficiary.address,
    stakerPubkey: binToHex(staker.pub),
    network: 'chipnet' as const,
    verifiers: verifiers.map((pk, i) => ({ pubkey: binToHex(pk), name: `V${i + 1}` })),
    threshold,
    contractAddress: '',
  };
  return { ...t, contractAddress: quorumContract(t, provider).address };
}

/** Lock + staker pre-signs through the (mock) wallet, as prepareQuorumRequest does. */
function lockAndPresign(t: QuorumTerms): QuorumVerifyRequest {
  const c = quorumContract(t, provider);
  const utxo = provider.addUtxo(c.address, randomUtxo({ satoshis: STAKE }));
  const base: QuorumVerifyRequest = {
    v: 2,
    pledge: t,
    utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() },
    fee: QUORUM_FEE.toString(),
    stakerSig: '',
    keepSigs: t.verifiers.map(() => null),
    breakSigs: t.verifiers.map(() => null),
  };
  const s = requestSpends(base, provider);
  const req = toWcSignRequest(buildQuorumKeep({ ...s, stakerSig: placeholderSignature(), verifierSigs: [] }), [[0, 'receive', 0]], { broadcast: false, userPrompt: 'pre-sign' });
  const stakerSig = quorumSigsFromTx(mockWalletSign(req, { 'receive/0': staker.priv }), 'keep').stakerSig!;
  return { ...base, stakerSig: binToHex(stakerSig) };
}

async function broadcastWith(r: QuorumVerifyRequest) {
  const st = checkRequestSigs(r, provider);
  const s = requestSpends(r, provider);
  return buildQuorumKeep({ ...s, stakerSig: hexToBin(r.stakerSig), verifierSigs: st.keepSigs.map((x) => (x ? hexToBin(x) : null)) }).send();
}

describe('quorum link relay', () => {
  it('v2 links round-trip, and v1 links still decode', () => {
    const r = lockAndPresign(terms(vs.map((v) => v.pub), 2));
    const back = decodeAnyVerifyRequest(`#pledge=${encodeQuorumRequest(r)}`);
    expect(isQuorumRequest(back)).toBe(true);
    expect(back).toEqual(r);
    const v1 = encodeVerifyRequest({
      v: 1,
      pledge: { id: newPledgeId(), promise: 'x', stakeSats: '5000', deadline: 10, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(vs[0].pub), contractAddress: r.pledge.contractAddress, network: 'chipnet' },
      utxo: r.utxo,
      fee: '1000',
      stakerSig: r.stakerSig,
    });
    expect(decodeAnyVerifyRequest(`#pledge=${v1}`).v).toBe(1);
  });

  it('a link whose terms were edited (threshold, verifiers) no longer matches its contract and is refused', () => {
    const r = lockAndPresign(terms(vs.map((v) => v.pub), 2));
    const lowered = { ...r, pledge: { ...r.pledge, threshold: 1 } };
    expect(() => decodeAnyVerifyRequest(`#${encodeQuorumRequest(lowered)}`)).toThrow(/contract address/);
    const dup = { ...r, pledge: { ...r.pledge, verifiers: [r.pledge.verifiers[0], r.pledge.verifiers[0]] } };
    expect(() => decodeAnyVerifyRequest(`#${encodeQuorumRequest(dup)}`)).toThrow(/twice/);
    const mainnetBene = { ...r, pledge: { ...r.pledge, beneficiaryAddress: beneficiary.address.replace('bchtest:', 'bitcoincash:') } };
    expect(() => decodeAnyVerifyRequest(`#${encodeQuorumRequest(mainnetBene)}`)).toThrow();
    const clock = { ...r, pledge: { ...r.pledge, deadline: 1_700_000_000 } };
    expect(() => decodeAnyVerifyRequest(`#${encodeQuorumRequest(clock)}`)).toThrow(/deadline/);
  });

  it('2-of-3: verifiers sign at different times via the wallet, in any order; M-1 can’t send, M can', async () => {
    const t = terms(vs.map((v) => v.pub), 2);
    let r = lockAndPresign(t);
    expect(checkRequestSigs(r, provider).stakerSigOk).toBe(true);
    // verifier 3 opens link#0 and signs (their wallet holds the key at receive/4)
    r = await signQuorumSlot(fakeManager(vs[2].priv, 4), r, 2, 4, 'keep');
    // the link they pass on survives a URL round-trip
    r = decodeAnyVerifyRequest(`#pledge=${encodeQuorumRequest(r)}`) as QuorumVerifyRequest;
    expect(checkRequestSigs(r, provider).keepCount).toBe(1);
    await expect(broadcastWith(r)).rejects.toThrow('n >= threshold');
    // later, verifier 1 adds theirs
    r = await signQuorumSlot(fakeManager(vs[0].priv), r, 0, 0, 'keep');
    expect(checkRequestSigs(r, provider).keepCount).toBe(2);
    await broadcastWith(r);
    expect((await provider.getUtxos(stakerP2pkhAddress(staker.pub, 'chipnet')))[0].satoshis).toBe(STAKE - QUORUM_FEE);
  });

  it('partial links from two verifiers merge on the staker’s page', async () => {
    const r0 = lockAndPresign(terms(vs.map((v) => v.pub), 2));
    const a = await signQuorumSlot(fakeManager(vs[0].priv), r0, 0, 0, 'keep');
    const b = await signQuorumSlot(fakeManager(vs[1].priv), r0, 1, 0, 'keep');
    const merged = mergeRequests(a, b);
    expect(checkRequestSigs(merged, provider).keepCount).toBe(2);
    await broadcastWith(merged);
  });

  it('a wallet that doesn’t hold the slot key is caught before anything is broadcast', async () => {
    const r = lockAndPresign(terms(vs.map((v) => v.pub), 2));
    await expect(signQuorumSlot(fakeManager(vs[1].priv), r, 0, 0, 'keep')).rejects.toThrow(/didn’t check out/);
  });

  it('a forged signature placed in a link is dropped, so it can’t poison the broadcast (NULLFAIL)', async () => {
    const r = lockAndPresign(terms(vs.map((v) => v.pub), 2));
    const a = await signQuorumSlot(fakeManager(vs[0].priv), r, 0, 0, 'keep');
    const forged = { ...a, keepSigs: [a.keepSigs[0], a.keepSigs[0], null] }; // A's sig copied into B's slot
    const st = checkRequestSigs(forged, provider);
    expect(st.keepCount).toBe(1);
    expect(st.dropped).toEqual([1]);
  });
});

describe('server: demo verifier as one of the quorum', () => {
  const prevEnv = process.env.DEMO_VERIFIER_MAINNET;
  afterEach(() => {
    process.env.DEMO_VERIFIER_MAINNET = prevEnv;
  });
  const serverTerms = (t: QuorumTerms) => ({ ...t, version: 2 as const, verifierPubkeys: t.verifiers.map((v) => v.pubkey) });

  it('signs its own slot; with one friend that completes a 2-of-3', async () => {
    const t = terms([vs[0].pub, demo.pub, vs[1].pub], 2);
    let r = lockAndPresign(t);
    const res = await approveKeep({ pledge: serverTerms(t), confirm: true, note: 'ran' }, provider, demoKey);
    expect(res.slot).toBe(1);
    r = { ...r, keepSigs: [null, res.verifierSig!, null] };
    expect(checkRequestSigs(r, provider).keepCount).toBe(1);
    r = await signQuorumSlot(fakeManager(vs[1].priv), r, 2, 0, 'keep');
    await broadcastWith(r);
  });

  it('refuses a quorum that doesn’t name it, clock-time deadlines, and mainnet unless DEMO_VERIFIER_MAINNET=1', async () => {
    const t = terms(vs.map((v) => v.pub), 2);
    lockAndPresign(t);
    await expect(approveKeep({ pledge: serverTerms(t), confirm: true, note: 'ran' }, provider, demoKey)).rejects.toThrow(/doesn’t name/);
    await expect(approveKeep({ pledge: { ...serverTerms(t), deadline: 600_000_000 }, confirm: true, note: 'ran' }, provider, demoKey)).rejects.toThrow(/block height/);
    const mainnet = { ...serverTerms(t), network: 'mainnet', beneficiaryAddress: encodeCashAddress({ prefix: 'bitcoincash', type: CashAddressType.p2pkh, payload: hash160(beneficiary.pub) }).address };
    delete process.env.DEMO_VERIFIER_MAINNET;
    const err = await approveKeep({ pledge: mainnet, confirm: true, note: 'ran' }, provider, demoKey).catch((e) => e);
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).status).toBe(403);
  });

  it('settleExpired handles v2 pledges', async () => {
    const t = terms(vs.map((v) => v.pub), 2);
    lockAndPresign(t);
    provider.setBlockHeight(DEADLINE + 1);
    const res = await settleExpired({ pledge: serverTerms(t) }, provider);
    expect(res.txid).toHaveLength(64);
  });
});

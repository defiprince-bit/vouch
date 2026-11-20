// v1.1 (contracts/Vouch11.cash) and v2.1 (contracts/VouchQuorum21.cash): the verifier(s) alone sign
// the refund, which can only pay the staker's P2PKH. Plus backward compatibility: pledges made before
// these versions rebuild their original contract and keep their original (staker + verifier) refund.
import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, TransactionBuilder, placeholderSignature } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, hexToBin, encodePrivateKeyWif } from '@bitauth/libauth';
import type { DappConnectionManager } from '@wizardconnect/dapp';
import {
  createPledgeContract,
  buildKeep,
  buildBreakByStaker,
  buildBreakByVerifier,
  buildForfeit,
  keepNeedsStaker,
  stakerP2pkhAddress,
  newPledgeId,
  verifierKeepSignature,
  DEFAULT_FEE,
  DEFAULT_MAX_FEE,
} from '@/lib/vouch';
import { keepSignaturesFromTx, STAKER_PATH, type WcSignRequest } from '@/lib/wc';
import { createQuorumContract, buildQuorumKeep, buildQuorumForfeit, buildQuorumBreakByStaker, quorumSigsFromTx, QUORUM_FEE } from '@/lib/quorum';
import { decodeAnyVerifyRequest, encodeQuorumRequest, quorumContract, checkRequestSigs, requestSpends, type QuorumTerms, type QuorumVerifyRequest } from '@/lib/quorumShare';
import { encodeVerifyRequest, decodeVerifyRequest, type VerifyRequest } from '@/lib/share';
import { signQuorumSlot } from '@/lib/quorumActions';
import { normalizePledge, parsePledges } from '@/lib/pledges';
import { newListNonce, newListSecret, listPledgeId, listSecretHash } from '@/lib/listSecret';
import { approveKeep, settleExpired, loadVerifierKey, parseTerms, VerifierError, STAKER_PROOF_REQUIRED } from '@/server/verifier';
import { contractForTerms, readSpend } from '@/server/wallState';
import legacyV1 from '../contracts/Vouch.json';
import legacyV2 from '../contracts/VouchQuorum.json';
import v11 from '../contracts/Vouch11.json';
import v21 from '../contracts/VouchQuorum21.json';
import { mockWalletSign } from './mock-wallet';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, address, sig: new SignatureTemplate(priv), wif: encodePrivateKeyWif(priv, 'testnet') };
}
function fakeManager(priv: Uint8Array, index = 0): DappConnectionManager {
  return {
    signTransaction: async (req: WcSignRequest) => ({ signedTransaction: mockWalletSign(req, { [`${STAKER_PATH.name}/${index}`]: priv }) }),
  } as unknown as DappConnectionManager;
}

const STAKE = 100_000n;
const DEADLINE = 1000;
const staker = makeKey();
const verifier = makeKey();
const beneficiary = makeKey();
const stranger = makeKey();
const demo = makeKey();
const demoKey = loadVerifierKey(demo.wif)!;
const vs = [makeKey(), makeKey(), makeKey()];
const stakerAddress = stakerP2pkhAddress(staker.pub, 'chipnet');

let provider: MockNetworkProvider;
beforeEach(() => {
  provider = new MockNetworkProvider();
  (provider as unknown as { network: string }).network = 'chipnet';
  provider.setBlockHeight(DEADLINE - 100);
});

// ———————————————————————————————————————————————————————————————————————————— v1.1
describe('Vouch v1.1: verifier-only refund', () => {
  function pledge(verifierRefund = true, verifierPub = verifier.pub) {
    const contract = createPledgeContract(
      { stakerPubkey: staker.pub, verifierPubkey: verifierPub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId(), verifierRefund },
      provider,
    );
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    return { contract, utxo };
  }

  it('compiles to its own artifact; keep takes only the verifier signature', () => {
    const { contract } = pledge();
    expect(contract.name).toBe('Vouch11');
    expect(keepNeedsStaker(contract)).toBe(false);
    expect(v11.abi[0]).toEqual({ name: 'keep', inputs: [{ name: 'verifierSig', type: 'sig' }] });
    // the other three paths are byte-for-byte the v1 ABI
    expect(v11.abi.slice(1)).toEqual(legacyV1.abi.slice(1));
    expect(v11.constructorInputs).toEqual(legacyV1.constructorInputs);
  });

  it('verifier alone refunds to the staker (full stake minus the fee)', async () => {
    const { contract, utxo } = pledge();
    await buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress }).send();
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
    expect(await contract.getUtxos()).toHaveLength(0);
  });

  it('works after the deadline too (no deadline guard on keep, same as v1)', async () => {
    const { contract, utxo } = pledge();
    provider.setBlockHeight(DEADLINE + 10);
    await buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress }).send();
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('verifier cannot redirect the refund to any other address', async () => {
    const { contract, utxo } = pledge();
    for (const to of [stranger.address, verifier.address, beneficiary.address]) {
      await expect(buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress: to }).send()).rejects.toThrow();
    }
  });

  it('verifier cannot burn the stake into fees (fee cap)', async () => {
    const { contract, utxo } = pledge();
    await expect(buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress, fee: DEFAULT_MAX_FEE + 1n }).send()).rejects.toThrow();
    // exactly at the cap is fine
    await buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress, fee: DEFAULT_MAX_FEE }).send();
  });

  it('staker alone cannot refund (their signature in the verifier slot fails)', async () => {
    const { contract, utxo } = pledge();
    await expect(buildKeep({ contract, provider, utxo, verifierSig: staker.sig, stakerAddress }).send()).rejects.toThrow();
  });

  it('a stranger cannot refund', async () => {
    const { contract, utxo } = pledge();
    await expect(buildKeep({ contract, provider, utxo, verifierSig: stranger.sig, stakerAddress }).send()).rejects.toThrow();
  });

  it('a verifier refund signature for one pledge cannot be replayed on another pledge', async () => {
    const a = pledge();
    const b = pledge();
    const sigA = keepSignaturesFromTx(buildKeep({ contract: a.contract, provider, utxo: a.utxo, verifierSig: verifier.sig, stakerAddress }).build()).verifierSig;
    await expect(buildKeep({ contract: b.contract, provider, utxo: b.utxo, verifierSig: sigA, stakerAddress }).send()).rejects.toThrow();
    await buildKeep({ contract: a.contract, provider, utxo: a.utxo, verifierSig: sigA, stakerAddress }).send();
  });

  it('a refund signature cannot be turned into a break', async () => {
    const { contract, utxo } = pledge();
    const sig = verifierKeepSignature({ contract, provider, utxo, verifier: verifier.sig, stakerAddress });
    await expect(buildBreakByVerifier({ contract, provider, utxo, verifierSig: sig, beneficiaryAddress: beneficiary.address }).send()).rejects.toThrow();
  });

  it('keep must pay out at the pledge input index (two pledges in one tx can’t share one payout)', async () => {
    const a = pledge();
    const b = pledge();
    const tx = new TransactionBuilder({ provider })
      .addInput(a.utxo, (a.contract.unlock.keep as unknown as (s: SignatureTemplate) => never)(verifier.sig))
      .addInput(b.utxo, (b.contract.unlock.keep as unknown as (s: SignatureTemplate) => never)(verifier.sig))
      .addOutput({ to: stakerAddress, amount: STAKE * 2n - DEFAULT_FEE - STAKE });
    await expect(tx.send()).rejects.toThrow();
  });

  it('forfeit before the deadline fails; after, anyone sends it to the beneficiary; never elsewhere', async () => {
    const { contract, utxo } = pledge();
    // nLocktime below the deadline: the covenant's tx.time >= deadline fails
    const early = new TransactionBuilder({ provider })
      .addInput(utxo, contract.unlock.forfeit())
      .addOutput({ to: beneficiary.address, amount: STAKE - DEFAULT_FEE })
      .setLocktime(DEADLINE - 1);
    await expect(early.send()).rejects.toThrow();
    provider.setBlockHeight(DEADLINE + 1);
    await expect(buildForfeit({ contract, provider, utxo, beneficiaryAddress: stranger.address, deadline: DEADLINE }).send()).rejects.toThrow();
    await buildForfeit({ contract, provider, utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE }).send();
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('breakByStaker and breakByVerifier still pay the beneficiary only', async () => {
    const a = pledge();
    await expect(buildBreakByStaker({ ...a, provider, stakerSig: staker.sig, beneficiaryAddress: stranger.address }).send()).rejects.toThrow();
    await buildBreakByStaker({ ...a, provider, stakerSig: staker.sig, beneficiaryAddress: beneficiary.address }).send();
    const b = pledge();
    await expect(buildBreakByVerifier({ ...b, provider, verifierSig: staker.sig, beneficiaryAddress: beneficiary.address }).send()).rejects.toThrow();
    await buildBreakByVerifier({ ...b, provider, verifierSig: verifier.sig, beneficiaryAddress: beneficiary.address }).send();
  });

  it('the v1.1 keep layout is [verifierSig, selector, redeem] (no staker push)', () => {
    const { contract, utxo } = pledge();
    const hex = buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress }).build();
    const s = keepSignaturesFromTx(hex);
    expect(s.stakerSig).toBeUndefined();
    expect(s.verifierSig).toHaveLength(65);
    expect(readSpend(hex, contract.bytecode, 1)).toEqual({ fn: 0, seals: 1 });
  });
});

// ———————————————————————————————————————————————————————————————————————————— v2.1
describe('VouchQuorum v2.1: M-of-N verifier-only refund', () => {
  function qpledge(threshold = 2, verifierRefund = true) {
    const contract = createQuorumContract(
      { stakerPubkey: staker.pub, verifierPubkeys: vs.map((v) => v.pub), threshold, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId(), verifierRefund },
      provider,
    );
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    return { contract, utxo, provider };
  }
  const slots = (idx: number[], who = vs) => idx.reduce<Array<SignatureTemplate | null>>((a, i) => ((a[i] = who[i].sig), a), []);

  it('compiles to its own artifact; keep takes the five slot signatures only', () => {
    const { contract } = qpledge();
    expect(contract.name).toBe('VouchQuorum21');
    expect(keepNeedsStaker(contract)).toBe(false);
    expect(v21.abi[0].inputs.map((i) => i.name)).toEqual(['s0', 's1', 's2', 's3', 's4']);
    expect(v21.abi.slice(1)).toEqual(legacyV2.abi.slice(1));
    expect(v21.constructorInputs).toEqual(legacyV2.constructorInputs);
  });

  it('any M verifiers refund to the staker, no staker signature', async () => {
    for (const pick of [[0, 1], [1, 2], [0, 2], [0, 1, 2]]) {
      const q = qpledge(2);
      await buildQuorumKeep({ ...q, verifierSigs: slots(pick), stakerAddress }).send();
      expect(await q.contract.getUtxos()).toHaveLength(0);
    }
    const paid = await provider.getUtxos(stakerAddress);
    expect(paid).toHaveLength(4);
    expect(paid.every((u) => u.satoshis === STAKE - QUORUM_FEE)).toBe(true);
  });

  it('fails with too few verifier signatures', async () => {
    const q = qpledge(2);
    await expect(buildQuorumKeep({ ...q, verifierSigs: slots([1]), stakerAddress }).send()).rejects.toThrow();
    await expect(buildQuorumKeep({ ...q, verifierSigs: [], stakerAddress }).send()).rejects.toThrow();
    const q3 = qpledge(3);
    await expect(buildQuorumKeep({ ...q3, verifierSigs: slots([0, 2]), stakerAddress }).send()).rejects.toThrow();
    await buildQuorumKeep({ ...q3, verifierSigs: slots([0, 1, 2]), stakerAddress }).send();
  });

  it('M verifiers cannot redirect the refund to any other address', async () => {
    const q = qpledge(2);
    for (const to of [stranger.address, vs[0].address, beneficiary.address]) {
      await expect(buildQuorumKeep({ ...q, verifierSigs: slots([0, 1, 2]), stakerAddress: to }).send()).rejects.toThrow();
    }
  });

  it('fee cap holds', async () => {
    const q = qpledge(2);
    await expect(buildQuorumKeep({ ...q, verifierSigs: slots([0, 1]), stakerAddress, fee: DEFAULT_MAX_FEE + 1n }).send()).rejects.toThrow();
  });

  it('staker-only fails, and the staker’s key in a slot doesn’t count', async () => {
    const q = qpledge(1);
    const stakerInSlot = [staker.sig, null, null];
    await expect(buildQuorumKeep({ ...q, verifierSigs: stakerInSlot, stakerAddress }).send()).rejects.toThrow();
    // staker sig passed as stakerSig is ignored by v2.1 (no slot signed): still fails
    await expect(buildQuorumKeep({ ...q, stakerSig: staker.sig, verifierSigs: [], stakerAddress }).send()).rejects.toThrow();
  });

  it('one verifier signing two slots counts once (fails NULLFAIL in the wrong slot)', async () => {
    const q = qpledge(2);
    await expect(buildQuorumKeep({ ...q, verifierSigs: [vs[0].sig, vs[0].sig, null], stakerAddress }).send()).rejects.toThrow();
  });

  it('forfeit is unchanged: after the deadline, anyone, beneficiary only', async () => {
    const q = qpledge(2);
    const early = new TransactionBuilder({ provider })
      .addInput(q.utxo, q.contract.unlock.forfeit())
      .addOutput({ to: beneficiary.address, amount: STAKE - QUORUM_FEE })
      .setLocktime(DEADLINE - 1);
    await expect(early.send()).rejects.toThrow();
    provider.setBlockHeight(DEADLINE);
    await expect(buildQuorumForfeit({ ...q, beneficiaryAddress: stranger.address, deadline: DEADLINE }).send()).rejects.toThrow();
    await buildQuorumForfeit({ ...q, beneficiaryAddress: beneficiary.address, deadline: DEADLINE }).send();
  });

  it('breakByStaker unchanged', async () => {
    const q = qpledge(2);
    await buildQuorumBreakByStaker({ ...q, stakerSig: staker.sig, beneficiaryAddress: beneficiary.address }).send();
  });

  it('keep layout has no staker push; seals counted from the slots', () => {
    const q = qpledge(2);
    const hex = buildQuorumKeep({ ...q, verifierSigs: slots([0, 2]), stakerAddress }).build();
    const r = quorumSigsFromTx(hex, 'keep');
    expect(r.stakerSig).toBeUndefined();
    expect(r.slots.filter((s) => s.length === 65)).toHaveLength(2);
    expect(readSpend(hex, q.contract.bytecode, 2)).toEqual({ fn: 0, seals: 2 });
  });

  it('link relay: no staker signature, verifiers sign in their wallets one after another, then it broadcasts', async () => {
    const t0 = {
      id: newPledgeId(),
      promise: 'Run 5k',
      stakeSats: STAKE.toString(),
      deadline: DEADLINE,
      beneficiaryAddress: beneficiary.address,
      stakerPubkey: binToHex(staker.pub),
      network: 'chipnet' as const,
      verifiers: vs.map((v, i) => ({ pubkey: binToHex(v.pub), name: `V${i + 1}` })),
      threshold: 2,
      verifierRefund: true as const,
      contractAddress: '',
    };
    const t: QuorumTerms = { ...t0, contractAddress: quorumContract(t0, provider).address };
    const c = quorumContract(t, provider);
    const u = provider.addUtxo(c.address, randomUtxo({ satoshis: STAKE }));
    const r0: QuorumVerifyRequest = {
      v: 2,
      pledge: t,
      utxo: { txid: u.txid, vout: u.vout, satoshis: u.satoshis.toString() },
      fee: QUORUM_FEE.toString(),
      stakerSig: '',
      keepSigs: [null, null, null],
      breakSigs: [null, null, null],
    };
    // the link round-trips with no staker signature in it
    const r = decodeAnyVerifyRequest('#pledge=' + encodeQuorumRequest(r0)) as QuorumVerifyRequest;
    expect(r.stakerSig).toBe('');
    expect(checkRequestSigs(r, provider).stakerSigOk).toBe(true);
    const r1 = await signQuorumSlot(fakeManager(vs[2].priv), r, 2, 0, 'keep');
    const r2 = await signQuorumSlot(fakeManager(vs[0].priv), decodeAnyVerifyRequest('#pledge=' + encodeQuorumRequest(r1)) as QuorumVerifyRequest, 0, 0, 'keep');
    const st = checkRequestSigs(r2, provider);
    expect(st.keepCount).toBe(2);
    const s = requestSpends(r2, provider);
    await buildQuorumKeep({ ...s, verifierSigs: st.keepSigs.map((x) => (x ? hexToBin(x) : null)) }).send();
    expect((await provider.getUtxos(stakerAddress)).some((x) => x.satoshis === STAKE - QUORUM_FEE)).toBe(true);
  });

  it('a legacy v2 link without a staker signature is still rejected', () => {
    const t0 = {
      id: newPledgeId(),
      promise: 'x',
      stakeSats: '5000',
      deadline: DEADLINE,
      beneficiaryAddress: beneficiary.address,
      stakerPubkey: binToHex(staker.pub),
      network: 'chipnet' as const,
      verifiers: vs.map((v) => ({ pubkey: binToHex(v.pub) })),
      threshold: 2,
      contractAddress: '',
    };
    const t = { ...t0, contractAddress: quorumContract(t0, provider).address };
    const r = { v: 2, pledge: t, utxo: { txid: 'ab'.repeat(32), vout: 0, satoshis: '5000' }, fee: '1500', stakerSig: '', keepSigs: [], breakSigs: [] };
    expect(() => decodeAnyVerifyRequest('#pledge=' + encodeQuorumRequest(r as QuorumVerifyRequest))).toThrow(/Invalid verify link/);
  });
});

// ———————————————————————————————————————————————————————————————————————————— server
describe('demo verifier on v1.1 / v2.1', () => {
  function proofPledge(verifierPub: Uint8Array, habit = 'Run 3 times') {
    const listSecret = newListSecret();
    const listNonce = newListNonce();
    const id = listPledgeId(listNonce, habit, listSecretHash(listSecret));
    const contract = createPledgeContract(
      { stakerPubkey: staker.pub, verifierPubkey: verifierPub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id, verifierRefund: true },
      provider,
    );
    provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const terms = { id, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(verifierPub), network: 'chipnet' as const, verifierRefund: true as const };
    return { contract, terms, proof: { listSecret, listNonce, habit } };
  }

  it('v1.1: with the staker proof, the demo verifier signs and broadcasts the refund to the staker', async () => {
    const { contract, terms, proof } = proofPledge(demo.pub);
    const res = await approveKeep({ pledge: terms, confirm: true, note: 'ran x3', ...proof }, provider, demoKey);
    expect(res.txid).toHaveLength(64);
    expect(await contract.getUtxos()).toHaveLength(0);
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('v1.1: without the proof (anyone else who knows the terms) it refuses', async () => {
    const { contract, terms, proof } = proofPledge(demo.pub);
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran x3' }, provider, demoKey)).rejects.toThrow(STAKER_PROOF_REQUIRED);
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran x3', ...proof, listSecret: newListSecret() }, provider, demoKey)).rejects.toThrow(VerifierError);
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran x3', ...proof, habit: 'something else' }, provider, demoKey)).rejects.toThrow(VerifierError);
    expect(await contract.getUtxos()).toHaveLength(1);
  });

  it('v1.1: still refuses after the verify-by height', async () => {
    const { terms, proof } = proofPledge(demo.pub);
    provider.setBlockHeight(DEADLINE - 1);
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran x3', ...proof }, provider, demoKey)).rejects.toThrow(/Too late/);
  });

  it('v1.1: a pledge naming a different verifier is refused', async () => {
    const { terms, proof } = proofPledge(verifier.pub);
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran x3', ...proof }, provider, demoKey)).rejects.toThrow(/different verifier/);
  });

  it('v2.1: with the proof, it returns its slot signature (client broadcasts once M are in)', async () => {
    const listSecret = newListSecret();
    const listNonce = newListNonce();
    const habit = 'Run 5k';
    const id = listPledgeId(listNonce, habit, listSecretHash(listSecret));
    const keys = [demo.pub, vs[0].pub];
    const contract = createQuorumContract(
      { stakerPubkey: staker.pub, verifierPubkeys: keys, threshold: 2, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id, verifierRefund: true },
      provider,
    );
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const terms = { id, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), network: 'chipnet', version: 2, verifierPubkeys: keys.map(binToHex), threshold: 2, verifierRefund: true };
    await expect(approveKeep({ pledge: terms, confirm: true, note: 'ran' }, provider, demoKey)).rejects.toThrow(STAKER_PROOF_REQUIRED);
    const res = await approveKeep({ pledge: terms, confirm: true, note: 'ran', listSecret, listNonce, habit }, provider, demoKey);
    expect(res.slot).toBe(0);
    // demo alone (1 of 2) can't refund
    await expect(buildQuorumKeep({ contract, provider, utxo, verifierSigs: [hexToBin(res.verifierSig!)], stakerAddress }).send()).rejects.toThrow();
    await buildQuorumKeep({ contract, provider, utxo, verifierSigs: [hexToBin(res.verifierSig!), vs[0].sig], stakerAddress }).send();
  });

  it('settle (forfeit) still works for v1.1 after the deadline', async () => {
    const { contract, terms } = proofPledge(verifier.pub);
    provider.setBlockHeight(DEADLINE);
    const res = await settleExpired({ pledge: terms }, provider);
    expect(res.txid).toHaveLength(64);
    expect(await contract.getUtxos()).toHaveLength(0);
  });

  it('parseTerms accepts only verifierRefund: true, and drops a false flag', () => {
    const base = { id: newPledgeId(), deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(verifier.pub), network: 'chipnet' };
    expect(parseTerms({ ...base, verifierRefund: true }).verifierRefund).toBe(true);
    expect('verifierRefund' in parseTerms({ ...base, verifierRefund: false })).toBe(false);
    expect(() => parseTerms({ ...base, verifierRefund: 'yes' })).toThrow(VerifierError);
  });
});

// ———————————————————————————————————————————————————————————————————————————— backward compatibility
describe('backward compatibility: pledges made before v1.1 / v2.1', () => {
  // Douglas's real chipnet v1 pledge ("run this week 3 times", demo verifier), locked in
  // tx a0a255e4f93d3df4fe401b412babc8c63cca7ea9770faa5e2afa4dfb5f2007ea to the address below.
  // Terms as stored on the wall registry. Its browser record has no verifierRefund flag.
  const DOUGLAS = {
    id: '867c7d69cb86b9e533e6e520b4c5fa23',
    deadline: 338959,
    beneficiaryAddress: 'bchtest:zzskjdy0ea232pghcu4pkg8glpca7ssl0y6j45tw3j',
    stakerPubkey: '03a8df27577ada3ac89b2d63ae102e4484c1649b37d749ba4351dbdd65b46918d0',
    verifierPubkey: '025bffce85c91de33432f6230c7a77da9fabebea1ceb42cd1149dc7bb1211451c6',
    network: 'chipnet' as const,
  };
  const DOUGLAS_ADDRESS = 'bchtest:pdhffm4ft6hwnngc0r8ugkly6je8wsc6ln3c0ndkscg5d8qru0hscr2c6atpl';

  it('Douglas’s real chipnet lock still rebuilds its address with the v1 artifact', () => {
    const c = createPledgeContract(
      { stakerPubkey: hexToBin(DOUGLAS.stakerPubkey), verifierPubkey: hexToBin(DOUGLAS.verifierPubkey), beneficiaryAddress: DOUGLAS.beneficiaryAddress, deadline: DOUGLAS.deadline, pledgeId: DOUGLAS.id },
      provider,
    );
    expect(c.address).toBe(DOUGLAS_ADDRESS);
    expect(c.name).toBe('Vouch');
    expect(keepNeedsStaker(c)).toBe(true);
    // the server (wall, settle, demo verifier) rebuilds it the same way from its stored terms
    expect(contractForTerms(parseTerms({ ...DOUGLAS }), provider).address).toBe(DOUGLAS_ADDRESS);
    // with the new flag it would be a different contract, so the flag can't be confused
    expect(contractForTerms(parseTerms({ ...DOUGLAS, verifierRefund: true }), provider).address).not.toBe(DOUGLAS_ADDRESS);
  });

  it('Douglas’s saved browser record (no flag) normalizes without the flag and rebuilds the same address', () => {
    const stored = { ...DOUGLAS, promise: 'run this week 3 times', stakeSats: '10000', verifierKind: 'demo', contractAddress: DOUGLAS_ADDRESS, createdAt: 1, lockTxid: 'a0a255e4f93d3df4fe401b412babc8c63cca7ea9770faa5e2afa4dfb5f2007ea' };
    const [p] = parsePledges(JSON.stringify([stored]));
    expect(p.verifierRefund).toBeUndefined();
    const c = createPledgeContract(
      { stakerPubkey: hexToBin(p.stakerPubkey), verifierPubkey: hexToBin(p.verifierPubkey), beneficiaryAddress: p.beneficiaryAddress, deadline: p.deadline, pledgeId: p.id, verifierRefund: p.verifierRefund === true },
      provider,
    );
    expect(c.address).toBe(DOUGLAS_ADDRESS);
    expect(normalizePledge({ ...stored, verifierRefund: true })!.verifierRefund).toBe(true);
    expect(normalizePledge({ ...stored, verifierRefund: 'x' })!.verifierRefund).toBeUndefined();
  });

  // Addresses computed with the code at a320097 (before v1.1 / v2.1), for fixed keys 1..5.
  const k = (n: number) => {
    const priv = new Uint8Array(32);
    priv[31] = n;
    const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
    return { pub, addr: encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address };
  };
  it('legacy v1 and v2 addresses are byte-for-byte what a320097 produced', () => {
    const [s, v, b, v2, v3] = [k(1), k(2), k(3), k(4), k(5)];
    const id = '00112233445566778899aabbccddeeff';
    const c1 = createPledgeContract({ stakerPubkey: s.pub, verifierPubkey: v.pub, beneficiaryAddress: b.addr, deadline: 300000, pledgeId: id }, provider);
    const c2 = createQuorumContract({ stakerPubkey: s.pub, verifierPubkeys: [v.pub, v2.pub, v3.pub], threshold: 2, beneficiaryAddress: b.addr, deadline: 300000, pledgeId: id }, provider);
    expect(c1.address).toBe('bchtest:pwl988cgtgslc926zlcxrxy92hsw380jfdacgzxq7s30jflen5eaczzzrl6w4');
    expect(c2.address).toBe('bchtest:p08rahsuu2cwqagxypc4vucf8v30hjwywyf7f6h04ztpfh9xqy7p2yhecjrff');
  });

  it('legacy v1 keep still needs the staker: verifier-only fails, staker + verifier works', async () => {
    const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId() }, provider);
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    expect(() => buildKeep({ contract, provider, utxo, verifierSig: verifier.sig, stakerAddress })).toThrow(/staker/);
    await expect(buildKeep({ contract, provider, utxo, stakerSig: placeholderSignature(), verifierSig: verifier.sig, stakerAddress }).send()).rejects.toThrow();
    await buildKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress }).send();
  });

  it('legacy v2 keep still needs the staker', async () => {
    const contract = createQuorumContract({ stakerPubkey: staker.pub, verifierPubkeys: vs.map((v) => v.pub), threshold: 2, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId() }, provider);
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    expect(contract.name).toBe('VouchQuorum');
    expect(() => buildQuorumKeep({ contract, provider, utxo, verifierSigs: [vs[0].sig, vs[1].sig], stakerAddress })).toThrow(/staker/);
    await buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: [vs[0].sig, vs[1].sig], stakerAddress }).send();
  });

  it('legacy demo verifier flow is unchanged: no proof needed, returns a sig for the staker to complete', async () => {
    const id = newPledgeId();
    const contract = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: demo.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id }, provider);
    provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const terms = { id, deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(demo.pub), network: 'chipnet' as const };
    const res = await approveKeep({ pledge: terms, confirm: true, note: 'ran' }, provider, demoKey);
    expect(res.verifierSig).toMatch(/^[0-9a-f]{130}$/);
    expect(res.txid).toBeUndefined();
    expect(await contract.getUtxos()).toHaveLength(1);
  });

  it('v1 links: legacy needs the staker signature; v1.1 carries none', () => {
    const c = createPledgeContract({ stakerPubkey: staker.pub, verifierPubkey: verifier.pub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId(), verifierRefund: true }, provider);
    const base: VerifyRequest = {
      v: 1,
      pledge: { id: newPledgeId(), promise: 'x', stakeSats: '5000', deadline: DEADLINE, beneficiaryAddress: beneficiary.address, stakerPubkey: binToHex(staker.pub), verifierPubkey: binToHex(verifier.pub), contractAddress: c.address, network: 'chipnet' },
      utxo: { txid: 'ab'.repeat(32), vout: 0, satoshis: '5000' },
      fee: '1000',
      stakerSig: '',
    };
    expect(() => decodeVerifyRequest(encodeVerifyRequest(base))).toThrow(/Invalid verify link/);
    const r = decodeVerifyRequest(encodeVerifyRequest({ ...base, pledge: { ...base.pledge, verifierRefund: true } }));
    expect(r.stakerSig).toBe('');
    expect(r.pledge.verifierRefund).toBe(true);
  });

  it('old artifacts are untouched', () => {
    expect(legacyV1.contractName).toBe('Vouch');
    expect(legacyV1.abi[0].inputs.map((i) => i.name)).toEqual(['stakerSig', 'verifierSig']);
    expect(legacyV2.contractName).toBe('VouchQuorum');
    expect(legacyV2.abi[0].inputs.map((i) => i.name)).toEqual(['stakerSig', 's0', 's1', 's2', 's3', 's4']);
  });
});

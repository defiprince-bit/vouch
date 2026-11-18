import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, randomToken, placeholderSignature, TransactionBuilder } from 'cashscript';
import { createHash } from 'node:crypto';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, hexToBin, binToHex } from '@bitauth/libauth';
import { stakerP2pkhAddress, newPledgeId, type Signer } from '@/lib/vouch';
import {
  createQuorumContract,
  buildQuorumKeep,
  buildQuorumBreakByVerifier,
  buildQuorumBreakByStaker,
  buildQuorumForfeit,
  quorumShapeIssues,
  quorumSigsFromTx,
  spendSighash,
  validSlotSigs,
  isValidSpendSig,
  slotSignature,
  unusedSlotKey,
  UNUSED_SLOT_KEYS,
  QUORUM_FEE,
  type SlotSigners,
} from '@/lib/quorum';
import quorumArtifact from '@/lib/VouchQuorum.artifact';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, address, sig: new SignatureTemplate(priv) };
}
type Key = ReturnType<typeof makeKey>;

const STAKE = 100_000n;
const DEADLINE = 1000;
const staker = makeKey();
const beneficiary = makeKey();
const stranger = makeKey();
const stakerAddress = stakerP2pkhAddress(staker.pub, 'chipnet');

let provider: MockNetworkProvider;
beforeEach(() => {
  provider = new MockNetworkProvider();
  provider.setBlockHeight(DEADLINE - 10);
});

function newPledge(verifiers: Key[], threshold: number, pledgeId = newPledgeId()) {
  const contract = createQuorumContract(
    { stakerPubkey: staker.pub, verifierPubkeys: verifiers.map((v) => v.pub), threshold, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId },
    provider,
  );
  const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
  return { contract, utxo };
}

/** Signers for the given slots (others empty). */
function slots(verifiers: Key[], which: number[]): SlotSigners {
  const s: SlotSigners = [];
  for (const i of which) s[i] = verifiers[i].sig;
  return s;
}

const SHAPES: Array<[number, number]> = [
  [1, 1],
  [2, 3],
  [3, 5],
  [4, 5],
  [1, 5],
];

describe('VouchQuorum artifact', () => {
  it('compiled script fits the 520-byte P2SH element limit with all five slots and a p2sh32 beneficiary', () => {
    const vs = Array.from({ length: 5 }, makeKey);
    const { contract } = newPledge(vs, 3);
    expect(hexToBin(contract.bytecode).length).toBeLessThanOrEqual(520);
    // worst case: the beneficiary is itself a 32-byte P2SH (e.g. another contract)
    const big = createQuorumContract(
      { stakerPubkey: staker.pub, verifierPubkeys: vs.map((v) => v.pub), threshold: 5, beneficiaryAddress: contract.address, deadline: 499_999_999, pledgeId: newPledgeId(), maxFee: 2_000_000n },
      provider,
    );
    expect(hexToBin(big.bytecode).length).toBeLessThanOrEqual(520);
  });

  it('bytecode is pinned: changing the contract changes every v2 pledge address', () => {
    expect(createHash('sha256').update(quorumArtifact.bytecode).digest('hex')).toBe('6c18c280687a879d636290c6cc2d2a980f9a18f7130eea6bc56a00c5ef1d368b');
    const c = createQuorumContract(
      {
        stakerPubkey: hexToBin('0243d3dbb0fbdd8022babc7d6eba3ff29954e921938bcc15a77e10453150ccf74e'),
        verifierPubkeys: [hexToBin('03c04a6ec7e8a81edab12aac89e4446c32c3da494634f6ebc3403c2de8e73f21ae'), hexToBin(UNUSED_SLOT_KEYS[0].replace(/^02/, '03'))],
        threshold: 2,
        beneficiaryAddress: 'bchtest:qp34e56f9uvf90zw48z2mmng4963r46seqp57s4td2',
        deadline: 333190,
        pledgeId: '1f77c2d9173e1097656cd0bd80f1de32',
      },
      new MockNetworkProvider(),
    );
    expect(c.address).toBe('bchtest:pd8ulspsyym5angg9t3uq33kl33ugd2k3dufsak5w9vnf3z8g6cus46y4ysfp');
  });

  it('unused-slot keys are the pinned nothing-up-my-sleeve points', () => {
    UNUSED_SLOT_KEYS.forEach((k, i) => expect(unusedSlotKey(i)).toBe(k));
    expect(quorumArtifact.contractName).toBe('VouchQuorum');
  });

  it('rejects bad quorum shapes', () => {
    const v = makeKey();
    const vh = binToHex(v.pub);
    expect(quorumShapeIssues(binToHex(staker.pub), [], 1)).not.toHaveLength(0);
    expect(quorumShapeIssues(binToHex(staker.pub), [vh], 0)).not.toHaveLength(0);
    expect(quorumShapeIssues(binToHex(staker.pub), [vh], 2)).not.toHaveLength(0);
    expect(quorumShapeIssues(binToHex(staker.pub), [vh, vh], 1).join(' ')).toMatch(/twice/);
    expect(quorumShapeIssues(binToHex(staker.pub), [binToHex(staker.pub)], 1).join(' ')).toMatch(/vouch for yourself/);
    expect(quorumShapeIssues(binToHex(staker.pub), Array.from({ length: 6 }, () => binToHex(makeKey().pub)), 1)).not.toHaveLength(0);
    expect(() =>
      createQuorumContract({ stakerPubkey: staker.pub, verifierPubkeys: [v.pub, v.pub], threshold: 1, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId() }, provider),
    ).toThrow(/twice/);
  });
});

describe.each(SHAPES)('VouchQuorum %i-of-%i', (m, n) => {
  const verifiers = Array.from({ length: n }, makeKey);
  // the first M slots, and (when possible) a different set: the last M slots
  const first = Array.from({ length: m }, (_, i) => i);
  const last = Array.from({ length: m }, (_, i) => n - m + i);

  it(`keep: staker + ${m} verifier signature(s) pays the staker`, async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, first), stakerAddress }).send();
    expect((await provider.getUtxos(stakerAddress)).some((u) => u.satoshis === STAKE - QUORUM_FEE)).toBe(true);
  });

  it('keep: any M of the N work (last M slots)', async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, last), stakerAddress }).send();
  });

  it(`keep: ${m - 1} verifier signature(s) fails`, async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await expect(
      buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, first.slice(1)), stakerAddress }).send(),
    ).rejects.toThrow('n >= threshold');
  });

  it('keep: M verifiers but no staker signature fails', async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await expect(
      buildQuorumKeep({ contract, provider, utxo, stakerSig: stranger.sig, verifierSigs: slots(verifiers, first), stakerAddress }).send(),
    ).rejects.toThrow('checkSig(stakerSig, stakerPk)');
  });

  it('keep: one verifier’s signature reused in another slot fails (no double counting)', async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    const builder = buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, [0]), stakerAddress });
    const sig0 = quorumSigsFromTx(builder.build(), 'keep').slots[0];
    // verifier 0’s real signature copied into all five slots (padding included): only slot 0 can verify it
    const dup: SlotSigners = Array.from({ length: 5 }, () => sig0);
    await expect(buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: dup, stakerAddress }).send()).rejects.toThrow();
    if (m > 1) {
      // and verifier 0 signing slot 0 twice over still only counts once
      const sameTwice: SlotSigners = [verifiers[0].sig, verifiers[0].sig];
      await expect(buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: sameTwice, stakerAddress }).send()).rejects.toThrow();
    }
  });

  it('keep: a non-verifier key fails', async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    const s = slots(verifiers, first.slice(1));
    s[first[0]] = stranger.sig;
    await expect(buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: s, stakerAddress }).send()).rejects.toThrow();
    // a stranger can't use an unused padding slot either
    if (n < 5) {
      const pad = slots(verifiers, first.slice(1));
      pad[4] = stranger.sig;
      await expect(buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: pad, stakerAddress }).send()).rejects.toThrow();
    }
  });

  it('keep: signatures for pledge A cannot be replayed on pledge B (same keys)', async () => {
    const a = newPledge(verifiers, m);
    const b = newPledge(verifiers, m);
    const hexA = buildQuorumKeep({ contract: a.contract, provider, utxo: a.utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, first), stakerAddress }).build();
    const { slots: sigsA, stakerSig: stakerSigA } = quorumSigsFromTx(hexA, 'keep');
    await expect(
      buildQuorumKeep({ contract: b.contract, provider, utxo: b.utxo, stakerSig: stakerSigA!, verifierSigs: sigsA.map((s) => (s.length ? s : null)), stakerAddress }).send(),
    ).rejects.toThrow();
    // positive control: the same signatures do spend pledge A
    await buildQuorumKeep({ contract: a.contract, provider, utxo: a.utxo, stakerSig: stakerSigA!, verifierSigs: sigsA.map((s) => (s.length ? s : null)), stakerAddress }).send();
  });

  it('keep: cannot pay anyone but the staker', async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await expect(
      buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(verifiers, first), stakerAddress: verifiers[0].address }).send(),
    ).rejects.toThrow('LockingBytecodeP2PKH');
  });

  it(`breakByVerifier: ${m} verifier(s) pay the beneficiary`, async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await buildQuorumBreakByVerifier({ contract, provider, utxo, verifierSigs: slots(verifiers, last), beneficiaryAddress: beneficiary.address }).send();
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - QUORUM_FEE);
  });

  it(`breakByVerifier: ${m - 1} fails, a stranger fails, paying a verifier fails`, async () => {
    const { contract, utxo } = newPledge(verifiers, m);
    await expect(
      buildQuorumBreakByVerifier({ contract, provider, utxo, verifierSigs: slots(verifiers, first.slice(1)), beneficiaryAddress: beneficiary.address }).send(),
    ).rejects.toThrow('n >= threshold');
    const s = slots(verifiers, first.slice(1));
    s[first[0]] = stranger.sig;
    await expect(buildQuorumBreakByVerifier({ contract, provider, utxo, verifierSigs: s, beneficiaryAddress: beneficiary.address }).send()).rejects.toThrow();
    await expect(
      buildQuorumBreakByVerifier({ contract, provider, utxo, verifierSigs: slots(verifiers, first), beneficiaryAddress: verifiers[0].address }).send(),
    ).rejects.toThrow('beneficiaryLock');
  });

  it('breakByVerifier: replay from another pledge fails', async () => {
    const a = newPledge(verifiers, m);
    const b = newPledge(verifiers, m);
    const hexA = buildQuorumBreakByVerifier({ contract: a.contract, provider, utxo: a.utxo, verifierSigs: slots(verifiers, first), beneficiaryAddress: beneficiary.address }).build();
    const sigsA = quorumSigsFromTx(hexA, 'break').slots.map((s) => (s.length ? s : null));
    await expect(buildQuorumBreakByVerifier({ contract: b.contract, provider, utxo: b.utxo, verifierSigs: sigsA, beneficiaryAddress: beneficiary.address }).send()).rejects.toThrow();
  });

  it('tokens: a payout that strips the token category fails; carrying it over works', async () => {
    const { contract } = newPledge(verifiers, m);
    const tokenUtxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE, token: randomToken() }));
    const sigs = Array.from({ length: 5 }, (_, i) => (first.includes(i) ? verifiers[i].sig : new Uint8Array(0))) as [Signer, Signer, Signer, Signer, Signer];
    // the builder's own burn guard is off, so only the covenant stands in the way
    const strip = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .addInput(tokenUtxo, contract.unlock.keep(staker.sig, ...sigs))
      .addOutput({ to: stakerAddress, amount: STAKE - QUORUM_FEE });
    await expect(strip.send()).rejects.toThrow('tokenCategory');
    const stripBreak = new TransactionBuilder({ provider, allowImplicitFungibleTokenBurn: true })
      .addInput(tokenUtxo, contract.unlock.breakByStaker(staker.sig))
      .addOutput({ to: beneficiary.address, amount: STAKE - QUORUM_FEE });
    await expect(stripBreak.send()).rejects.toThrow('tokenCategory');
    // carrying the token over unchanged is allowed
    await new TransactionBuilder({ provider })
      .addInput(tokenUtxo, contract.unlock.keep(staker.sig, ...sigs))
      .addOutput({ to: encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkhWithTokens, payload: hash160(staker.pub) }).address, amount: STAKE - QUORUM_FEE, token: tokenUtxo.token })
      .send();
  });

  it('breakByStaker and forfeit are unchanged', async () => {
    const a = newPledge(verifiers, m);
    await buildQuorumBreakByStaker({ contract: a.contract, provider, utxo: a.utxo, stakerSig: staker.sig, beneficiaryAddress: beneficiary.address }).send();
    const b = newPledge(verifiers, m);
    await expect(buildQuorumForfeit({ contract: b.contract, provider, utxo: b.utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE - 1 }).send()).rejects.toThrow(
      'tx.time >= deadline',
    );
    provider.setBlockHeight(DEADLINE + 1);
    await buildQuorumForfeit({ contract: b.contract, provider, utxo: b.utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE }).send();
    await expect(
      buildQuorumForfeit({ contract: b.contract, provider, utxo: provider.addUtxo(b.contract.address, randomUtxo({ satoshis: STAKE })), beneficiaryAddress: stranger.address, deadline: DEADLINE }).send(),
    ).rejects.toThrow('beneficiaryLock');
  });
});

describe('VouchQuorum link relay (signatures collected at different times, any order)', () => {
  it('2-of-3: staker pre-signs, verifier C then A add sigs one by one, sigs verify off-chain, then it broadcasts', async () => {
    const vs = Array.from({ length: 3 }, makeKey);
    const { contract, utxo } = newPledge(vs, 2);
    const base = { contract, provider, utxo, stakerAddress, beneficiaryAddress: beneficiary.address };
    // staker pre-signs with every verifier slot empty
    const pre = buildQuorumKeep({ ...base, stakerSig: staker.sig, verifierSigs: [] }).build();
    const stakerSig = quorumSigsFromTx(pre, 'keep').stakerSig!;
    // each verifier signs on their own, with a placeholder staker sig (as a wallet would see it)
    const sigC = slotSignature('keep', { ...base, slot: 2, signer: vs[2].sig });
    const sigA = slotSignature('keep', { ...base, slot: 0, signer: vs[0].sig });
    const sighash = spendSighash(contract, buildQuorumKeep({ ...base, stakerSig: placeholderSignature(), verifierSigs: [] }));
    expect(isValidSpendSig(sighash, stakerSig, staker.pub)).toBe(true);
    const bundle = validSlotSigs(sighash, vs.map((v) => v.pub), [binToHex(sigA), null, binToHex(sigC)]);
    expect(bundle.filter(Boolean)).toHaveLength(2);
    // a sig in the wrong slot / from a stranger is dropped by the off-chain check
    expect(validSlotSigs(sighash, vs.map((v) => v.pub), [binToHex(sigC), binToHex(slotSignature('keep', { ...base, slot: 1, signer: stranger.sig })), null]).filter(Boolean)).toHaveLength(0);
    await buildQuorumKeep({ ...base, stakerSig, verifierSigs: bundle.map((s) => (s ? hexToBin(s) : null)) }).send();
  });

  it('break votes are a different sighash: a keep signature can’t be used to break', async () => {
    const vs = Array.from({ length: 3 }, makeKey);
    const { contract, utxo } = newPledge(vs, 2);
    const base = { contract, provider, utxo, stakerAddress, beneficiaryAddress: beneficiary.address };
    const keepA = slotSignature('keep', { ...base, slot: 0, signer: vs[0].sig });
    const keepB = slotSignature('keep', { ...base, slot: 1, signer: vs[1].sig });
    await expect(buildQuorumBreakByVerifier({ ...base, verifierSigs: [keepA, keepB] }).send()).rejects.toThrow();
  });

  it('a 1-in-1-out 5-of-5 keep stays under the fixed fee at 1 sat/byte', async () => {
    const vs = Array.from({ length: 5 }, makeKey);
    const { contract, utxo } = newPledge(vs, 5);
    const hex = buildQuorumKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSigs: slots(vs, [0, 1, 2, 3, 4]), stakerAddress }).build();
    expect(hex.length / 2).toBeLessThan(Number(QUORUM_FEE));
  });
});

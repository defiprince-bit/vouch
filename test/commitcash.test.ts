import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, TransactionBuilder } from 'cashscript';
import {
  secp256k1,
  generatePrivateKey,
  encodeCashAddress,
  CashAddressType,
  hash160,
  hexToBin,
  decodeTransaction,
  decodeAuthenticationInstructions,
  type AuthenticationInstructionPush,
} from '@bitauth/libauth';
import {
  createPledgeContract,
  buildKeep,
  buildBreakByStaker,
  buildBreakByVerifier,
  buildForfeit,
  stakerP2pkhAddress,
  newPledgeId,
  validatePledge,
  DEFAULT_FEE,
  type PledgeContract,
} from '@/lib/commitcash';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, address, sig: new SignatureTemplate(priv) };
}

const STAKE = 100_000n;
const DEADLINE = 1000;

describe('CommitCash covenant', () => {
  let provider: MockNetworkProvider;
  const staker = makeKey();
  const verifier = makeKey();
  const beneficiary = makeKey();
  const stranger = makeKey();
  const stakerAddress = stakerP2pkhAddress(staker.pub, 'chipnet');

  function newPledge(pledgeId = newPledgeId()) {
    const contract = createPledgeContract(
      {
        stakerPubkey: staker.pub,
        verifierPubkey: verifier.pub,
        beneficiaryAddress: beneficiary.address,
        deadline: DEADLINE,
        pledgeId,
      },
      provider,
    );
    const utxo = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    return { contract, utxo };
  }

  beforeEach(() => {
    provider = new MockNetworkProvider();
    provider.setBlockHeight(DEADLINE - 10);
  });

  it('stakerP2pkhAddress matches the test key address', () => {
    expect(stakerAddress).toBe(staker.address);
  });

  // ---- keep ----
  it('keep: staker + verifier pays the staker', async () => {
    const { contract, utxo } = newPledge();
    const tx = await buildKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress }).send();
    expect(tx.txid).toHaveLength(64);
    const out = (await provider.getUtxos(stakerAddress))[0];
    expect(out.satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('keep: fails with only one valid signature (stranger as verifier)', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSig: stranger.sig, stakerAddress }).send(),
    ).rejects.toThrow('checkSig(verifierSig, verifierPk)');
  });

  it('keep: fails with verifier but no staker signature', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildKeep({ contract, provider, utxo, stakerSig: stranger.sig, verifierSig: verifier.sig, stakerAddress }).send(),
    ).rejects.toThrow('checkSig(stakerSig, stakerPk)');
  });

  it('keep: fails when paying anyone other than the staker', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress: verifier.address }).send(),
    ).rejects.toThrow('LockingBytecodeP2PKH');
  });

  it('keep: fails with a fee above maxFee', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildKeep({ contract, provider, utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress, fee: 5000n }).send(),
    ).rejects.toThrow('maxFee');
  });

  // ---- break ----
  it('breakByStaker: pays the beneficiary, any time', async () => {
    const { contract, utxo } = newPledge();
    await buildBreakByStaker({ contract, provider, utxo, stakerSig: staker.sig, beneficiaryAddress: beneficiary.address }).send();
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('breakByStaker: cannot redirect to the staker', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildBreakByStaker({ contract, provider, utxo, stakerSig: staker.sig, beneficiaryAddress: staker.address }).send(),
    ).rejects.toThrow('beneficiaryLock');
  });

  it('breakByVerifier: pays the beneficiary', async () => {
    const { contract, utxo } = newPledge();
    await buildBreakByVerifier({ contract, provider, utxo, verifierSig: verifier.sig, beneficiaryAddress: beneficiary.address }).send();
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('breakByVerifier: verifier cannot pay itself', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildBreakByVerifier({ contract, provider, utxo, verifierSig: verifier.sig, beneficiaryAddress: verifier.address }).send(),
    ).rejects.toThrow('beneficiaryLock');
  });

  it('breakByVerifier: stranger signature fails', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildBreakByVerifier({ contract, provider, utxo, verifierSig: stranger.sig, beneficiaryAddress: beneficiary.address }).send(),
    ).rejects.toThrow('checkSig(verifierSig, verifierPk)');
  });

  it('break: fee above maxFee fails', async () => {
    const { contract, utxo } = newPledge();
    await expect(
      buildBreakByStaker({ contract, provider, utxo, stakerSig: staker.sig, beneficiaryAddress: beneficiary.address, fee: 2001n }).send(),
    ).rejects.toThrow('maxFee');
  });

  // ---- forfeit ----
  it('forfeit: fails before the deadline', async () => {
    const { contract, utxo } = newPledge();
    // locktime below the deadline: the covenant's tx.time check fails
    await expect(
      buildForfeit({ contract, provider, utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE - 1 }).send(),
    ).rejects.toThrow('tx.time >= deadline');
    // locktime at the deadline but chain not there yet: non-final, the network rejects it
    await expect(
      buildForfeit({ contract, provider, utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE }).send(),
    ).rejects.toThrow();
  });

  it('forfeit: anyone can settle to the beneficiary after the deadline', async () => {
    provider.setBlockHeight(DEADLINE + 1);
    const { contract, utxo } = newPledge();
    const txb = buildForfeit({ contract, provider, utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE });
    // nSequence must be non-final for nLocktime to be enforced
    const decoded = decodeTransaction(hexToBin(txb.build()));
    if (typeof decoded === 'string') throw new Error(decoded);
    expect(decoded.inputs[0].sequenceNumber).not.toBe(0xffffffff);
    expect(decoded.locktime).toBe(DEADLINE);
    await txb.send();
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('forfeit: high-fee forfeit fails (no miner drain)', async () => {
    provider.setBlockHeight(DEADLINE + 1);
    const { contract, utxo } = newPledge();
    await expect(
      buildForfeit({ contract, provider, utxo, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, fee: 50_000n }).send(),
    ).rejects.toThrow('maxFee');
  });

  it('forfeit: wrong output address fails', async () => {
    provider.setBlockHeight(DEADLINE + 1);
    const { contract, utxo } = newPledge();
    await expect(
      buildForfeit({ contract, provider, utxo, beneficiaryAddress: stranger.address, deadline: DEADLINE }).send(),
    ).rejects.toThrow('beneficiaryLock');
  });

  // ---- bundling ----
  it('two-pledge bundle paying out only once fails', async () => {
    provider.setBlockHeight(DEADLINE + 1);
    const pledgeId = newPledgeId();
    const { contract, utxo: utxo1 } = newPledge(pledgeId);
    const utxo2 = provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));
    const tx = new TransactionBuilder({ provider })
      .addInput(utxo1, contract.unlock.forfeit())
      .addInput(utxo2, contract.unlock.forfeit())
      .addOutput({ to: beneficiary.address, amount: STAKE })
      .addOutput({ to: stranger.address, amount: STAKE - 2000n })
      .setLocktime(DEADLINE);
    await expect(tx.send()).rejects.toThrow('beneficiaryLock');
  });

  it('two separate pledges bundled with index-aligned beneficiary outputs is fine', async () => {
    provider.setBlockHeight(DEADLINE + 1);
    const a = newPledge();
    const b = newPledge();
    await new TransactionBuilder({ provider })
      .addInput(a.utxo, a.contract.unlock.forfeit())
      .addInput(b.utxo, b.contract.unlock.forfeit())
      .addOutput({ to: beneficiary.address, amount: STAKE - 1000n })
      .addOutput({ to: beneficiary.address, amount: STAKE - 1000n })
      .setLocktime(DEADLINE)
      .send();
    expect(await provider.getUtxos(beneficiary.address)).toHaveLength(2);
  });

  // ---- replay ----
  it("a verifier's KEEP signature for pledge A cannot be replayed on pledge B", async () => {
    const a = newPledge();
    const b = newPledge();
    const hexA = buildKeep({ contract: a.contract, provider, utxo: a.utxo, stakerSig: staker.sig, verifierSig: verifier.sig, stakerAddress }).build();
    const verifierSigA = extractFirstPush(hexA);
    expect(verifierSigA.length).toBe(65);

    // positive control: the extracted signature is the real verifier sig for A
    await buildKeep({ contract: a.contract, provider, utxo: a.utxo, stakerSig: staker.sig, verifierSig: verifierSigA, stakerAddress }).send();

    // replay on B (same staker, same verifier key, different pledge) fails
    await expect(
      buildKeep({ contract: b.contract, provider, utxo: b.utxo, stakerSig: staker.sig, verifierSig: verifierSigA, stakerAddress }).send(),
    ).rejects.toThrow('checkSig(verifierSig, verifierPk)');
  });

  // ---- UI guards ----
  it('validatePledge flags tiny stakes and verifier == beneficiary', () => {
    const params = {
      stakerPubkey: staker.pub,
      verifierPubkey: verifier.pub,
      beneficiaryAddress: verifier.address,
      deadline: DEADLINE,
      pledgeId: newPledgeId(),
    };
    const issues = validatePledge(params, 1000n);
    expect(issues.join(' ')).toMatch(/at least/);
    expect(issues.join(' ')).toMatch(/beneficiary/);
  });
});

/** CashScript pushes function args in reverse, so the first push of a keep unlock is verifierSig. */
function extractFirstPush(txHex: string): Uint8Array {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(tx);
  const instr = decodeAuthenticationInstructions(tx.inputs[0].unlockingBytecode);
  return (instr[0] as AuthenticationInstructionPush).data;
}

// keep type import used
export type _C = PledgeContract;

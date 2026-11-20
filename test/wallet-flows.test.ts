import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, placeholderSignature, type NetworkProvider } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, hexToBin, decodeTransaction, encodePrivateKeyWif } from '@bitauth/libauth';
import {
  createPledgeContract,
  buildLock,
  buildKeep,
  buildBreakByStaker,
  verifierKeepSignature,
  shouldAutoForfeit,
  verifyByHeight,
  stakerP2pkhAddress,
  newPledgeId,
  DEFAULT_FEE,
} from '@/lib/vouch';
import { toWcSignRequest, keepSignaturesFromTx, DUMMY_SIGNATURE, STAKER_PATH } from '@/lib/wc';
import { encodeVerifyRequest, decodeVerifyRequest, verifyLink, type VerifyRequest } from '@/lib/share';
import { FallbackNetworkProvider } from '@/lib/providers';
import { approveKeep, demoVerifierAction, settleExpired, loadVerifierKey, verifierPubkeyHex, VerifierError } from '@/server/verifier';
import { mockWalletSign } from './mock-wallet';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, address, wif: encodePrivateKeyWif(priv, 'testnet') };
}

const DEADLINE = 1000;
const STAKE = 20_000n;

describe('wallet + verifier flows', () => {
  let provider: MockNetworkProvider;
  const staker = makeKey();
  const friend = makeKey();
  const beneficiary = makeKey();
  const demo = makeKey();
  const demoKey = loadVerifierKey(demo.wif)!;
  const stakerWallet = { [`${STAKER_PATH.name}/${STAKER_PATH.index}`]: staker.priv };
  const stakerAddress = stakerP2pkhAddress(staker.pub, 'chipnet');

  function pledge(verifierPub: Uint8Array) {
    const id = newPledgeId();
    const contract = createPledgeContract(
      { stakerPubkey: staker.pub, verifierPubkey: verifierPub, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: id },
      provider,
    );
    const terms = {
      id,
      deadline: DEADLINE,
      beneficiaryAddress: beneficiary.address,
      stakerPubkey: binToHex(staker.pub),
      verifierPubkey: binToHex(verifierPub),
      network: 'chipnet' as const,
    };
    return { contract, terms };
  }

  const locked = (contract: { address: string }) => provider.addUtxo(contract.address, randomUtxo({ satoshis: STAKE }));

  beforeEach(() => {
    provider = new MockNetworkProvider();
    (provider as unknown as { network: string }).network = 'chipnet';
    provider.setBlockHeight(DEADLINE - 100);
  });

  it('lock: wallet signs placeholder P2PKH inputs and funds the contract', async () => {
    const { contract } = pledge(demo.pub);
    provider.addUtxo(stakerAddress, randomUtxo({ satoshis: 30_000n }));
    provider.addUtxo(stakerAddress, randomUtxo({ satoshis: 5_000n }));
    const walletUtxos = await provider.getUtxos(stakerAddress);
    const { builder, inputs } = buildLock({ provider, walletUtxos, walletAddress: stakerAddress, contractAddress: contract.address, stake: STAKE });
    const req = toWcSignRequest(builder, inputs.map((_, i) => [i, 'receive', 0]), { broadcast: true, userPrompt: 'Lock' });
    // relay-safe: JSON round-trips with no bigint / Uint8Array left
    expect(() => JSON.stringify(req)).not.toThrow();
    // Regression (Paytaca "Error reading Uint32LE: requires 4 bytes"): the wallet runs
    // decodeTransaction(hexToBin(request.transaction.transaction)), so it must be non-empty tx hex.
    const wire = JSON.parse(JSON.stringify(req)) as { transaction: { transaction: unknown; sourceOutputs: unknown[] } };
    expect(typeof wire.transaction.transaction).toBe('string');
    const decoded = decodeTransaction(hexToBin(wire.transaction.transaction as string));
    expect(typeof decoded).not.toBe('string');
    if (typeof decoded === 'string') throw new Error(decoded);
    expect(decoded.inputs).toHaveLength(inputs.length);
    expect(decoded.outputs[0].valueSatoshis).toBe(STAKE);
    expect(decoded.version).toBe(2);
    expect(wire.transaction.sourceOutputs).toHaveLength(inputs.length);
    await provider.sendRawTransaction(mockWalletSign(req, stakerWallet));
    const [u] = await provider.getUtxos(contract.address);
    expect(u.satoshis).toBe(STAKE);
  });

  it('lock: refuses when the wallet cannot cover stake + fees', async () => {
    const { contract } = pledge(demo.pub);
    provider.addUtxo(stakerAddress, randomUtxo({ satoshis: STAKE }));
    const walletUtxos = await provider.getUtxos(stakerAddress);
    expect(() => buildLock({ provider, walletUtxos, walletAddress: stakerAddress, contractAddress: contract.address, stake: STAKE })).toThrow(/need/);
  });

  it('keep, demo verifier first: server returns its sig, wallet completes and broadcasts', async () => {
    const { contract, terms } = pledge(demo.pub);
    locked(contract);
    const res = await approveKeep({ pledge: terms, confirm: true, note: 'ran 5k x7' }, provider, demoKey);
    expect(res.verifierSig).toMatch(/^[0-9a-f]{130}$/);
    const utxo = (await contract.getUtxos())[0];
    const builder = buildKeep({ contract, provider, utxo, stakerSig: placeholderSignature(), verifierSig: Buffer.from(res.verifierSig!, 'hex'), stakerAddress });
    const req = toWcSignRequest(builder, [[0, 'receive', 0]], { broadcast: true, userPrompt: 'Keep' });
    await provider.sendRawTransaction(mockWalletSign(req, stakerWallet));
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('keep, staker first: wallet pre-signs with a dummy verifier slot, demo verifier assembles + broadcasts', async () => {
    const { contract, terms } = pledge(demo.pub);
    const utxo = locked(contract);
    const pre = buildKeep({ contract, provider, utxo, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress });
    const signed = mockWalletSign(toWcSignRequest(pre, [[0, 'receive', 0]], { broadcast: false, userPrompt: 'Keep' }), stakerWallet);
    const { stakerSig, verifierSig } = keepSignaturesFromTx(signed);
    expect(binToHex(verifierSig)).toBe(binToHex(DUMMY_SIGNATURE)); // wallet left the dummy alone
    const res = await approveKeep({ pledge: terms, confirm: true, note: 'done', stakerSig: binToHex(stakerSig!) }, provider, demoKey);
    expect(res.txid).toHaveLength(64);
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('keep via friend link: friend wallet fills the verifier slot and broadcasts', async () => {
    const { contract, terms } = pledge(friend.pub);
    const utxo = locked(contract);
    const pre = buildKeep({ contract, provider, utxo, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress });
    const { stakerSig } = keepSignaturesFromTx(mockWalletSign(toWcSignRequest(pre, [[0, 'receive', 0]], { broadcast: false, userPrompt: 'Keep' }), stakerWallet));
    const link: VerifyRequest = {
      v: 1,
      pledge: { ...terms, promise: 'Run 5k', stakeSats: STAKE.toString(), contractAddress: contract.address },
      utxo: { txid: utxo.txid, vout: utxo.vout, satoshis: utxo.satoshis.toString() },
      fee: DEFAULT_FEE.toString(),
      stakerSig: binToHex(stakerSig!),
    };
    const url = verifyLink('https://app.example', link);
    expect(url).toMatch(/^https:\/\/app\.example\/verify#pledge=[A-Za-z0-9_-]+$/);
    expect(decodeVerifyRequest(new URL(url).hash)).toEqual(decodeVerifyRequest(encodeVerifyRequest(link))); // '#pledge=…' and bare both decode
    const got = decodeVerifyRequest(encodeVerifyRequest(link));
    const friendBuilder = buildKeep({
      contract,
      provider,
      utxo: { ...got.utxo, satoshis: BigInt(got.utxo.satoshis), lockingBytecode: contract.lockingBytecode },
      stakerSig: Buffer.from(got.stakerSig, 'hex'),
      verifierSig: placeholderSignature(),
      stakerAddress,
    });
    const friendWallet = { 'receive/3': friend.priv };
    await provider.sendRawTransaction(mockWalletSign(toWcSignRequest(friendBuilder, [[0, 'receive', 3]], { broadcast: true, userPrompt: 'Approve' }), friendWallet));
    expect((await provider.getUtxos(stakerAddress))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('sanity: the mock network rejects a keep signed by the wrong wallet key', async () => {
    const { contract } = pledge(friend.pub);
    const utxo = locked(contract);
    const b = buildKeep({ contract, provider, utxo, stakerSig: placeholderSignature(), verifierSig: DUMMY_SIGNATURE, stakerAddress });
    const hex = mockWalletSign(toWcSignRequest(b, [[0, 'receive', 0]], { broadcast: true, userPrompt: 'Keep' }), stakerWallet);
    await expect(provider.sendRawTransaction(hex)).rejects.toThrow();
  });

  it('breakByStaker via wallet pays the beneficiary', async () => {
    const { contract } = pledge(demo.pub);
    const utxo = locked(contract);
    const b = buildBreakByStaker({ contract, provider, utxo, stakerSig: placeholderSignature(), beneficiaryAddress: beneficiary.address });
    await provider.sendRawTransaction(mockWalletSign(toWcSignRequest(b, [[0, 'receive', 0]], { broadcast: true, userPrompt: 'Break' }), stakerWallet));
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('demo verifier refuses: no confirm, other verifier, too late, nothing locked', async () => {
    const mine = pledge(demo.pub);
    locked(mine.contract);
    await expect(approveKeep({ pledge: mine.terms, confirm: false, note: 'x' }, provider, demoKey)).rejects.toThrow(/Confirm/);
    const theirs = pledge(friend.pub);
    locked(theirs.contract);
    await expect(approveKeep({ pledge: theirs.terms, confirm: true, note: 'did it' }, provider, demoKey)).rejects.toThrow(/different verifier/);
    provider.setBlockHeight(verifyByHeight(DEADLINE));
    await expect(approveKeep({ pledge: mine.terms, confirm: true, note: 'did it' }, provider, demoKey)).rejects.toThrow(/Too late/);
    const empty = pledge(demo.pub);
    await expect(approveKeep({ pledge: empty.terms, confirm: true, note: 'did it' }, provider, demoKey)).rejects.toBeInstanceOf(VerifierError);
  });

  it('demo verifier refuses to break: anyone holding the terms (e.g. the beneficiary) cannot force a break', async () => {
    const { contract, terms } = pledge(demo.pub);
    locked(contract);
    const err = await demoVerifierAction({ action: 'break', pledge: terms, confirm: true }, provider, demoKey).catch((e) => e);
    expect(err).toBeInstanceOf(VerifierError);
    expect((err as VerifierError).message).toMatch(/never signs a break/);
    expect((await contract.getUtxos())[0].satoshis).toBe(STAKE); // still locked
    expect(await provider.getUtxos(beneficiary.address)).toHaveLength(0);
    await expect(demoVerifierAction({ action: 'whatever', pledge: terms }, provider, demoKey)).rejects.toThrow(/keep/);
    // keep still works through the same entry point
    const r = await demoVerifierAction({ action: 'keep', pledge: terms, confirm: true, note: 'did it' }, provider, demoKey);
    expect(r).toHaveProperty('verifierSig');
  });

  it('settleExpired: refuses before the deadline, settles after (no key)', async () => {
    const { contract, terms } = pledge(demo.pub);
    locked(contract);
    await expect(settleExpired({ pledge: terms }, provider)).rejects.toThrow(/Deadline not reached/);
    provider.setBlockHeight(DEADLINE + 1);
    const r = await settleExpired({ pledge: terms }, provider);
    expect(r.txid).toHaveLength(64);
    expect((await provider.getUtxos(beneficiary.address))[0].satoshis).toBe(STAKE - DEFAULT_FEE);
  });

  it('verifierKeepSignature is the real verifier signature', () => {
    const { contract } = pledge(demo.pub);
    const utxo = locked(contract);
    const sig = verifierKeepSignature({ contract, provider, utxo, verifier: new SignatureTemplate(demo.priv), stakerAddress });
    expect(sig).toHaveLength(65);
    expect(verifierPubkeyHex(demoKey)).toBe(binToHex(demo.pub));
  });
});

describe('helpers', () => {
  it('shouldAutoForfeit', () => {
    expect(shouldAutoForfeit(null, 10, 5n)).toBe(false);
    expect(shouldAutoForfeit(9, 10, 5n)).toBe(false);
    expect(shouldAutoForfeit(10, 10, 5n)).toBe(true);
    expect(shouldAutoForfeit(11, 10, 0n)).toBe(false);
  });

  it('verify link rejects garbage', () => {
    expect(() => decodeVerifyRequest('bm90LWpzb24')).toThrow();
  });

  it('FallbackNetworkProvider uses the secondary on failure, but does not re-broadcast a rejected tx', async () => {
    const bad = { network: 'chipnet', getBlockHeight: async () => { throw new Error('WebSocket: 1006'); }, sendRawTransaction: async () => { throw new Error('mandatory-script-verify-flag-failed'); } } as unknown as NetworkProvider;
    let secondaryBroadcasts = 0;
    const good = { network: 'chipnet', getBlockHeight: async () => 42, sendRawTransaction: async () => { secondaryBroadcasts++; return 'x'; } } as unknown as NetworkProvider;
    const p = new FallbackNetworkProvider(bad, good, 1000);
    expect(await p.getBlockHeight()).toBe(42);
    // a node *rejecting* the tx is not a connection problem: don't retry elsewhere
    const fresh = new FallbackNetworkProvider(bad, good, 1000);
    await expect(fresh.sendRawTransaction('00')).rejects.toThrow(/mandatory/);
    expect(secondaryBroadcasts).toBe(0);
    // once the primary has failed to connect, the provider goes straight to the secondary for a while
    expect(await p.sendRawTransaction('00')).toBe('x');
    expect(secondaryBroadcasts).toBe(1);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { MockNetworkProvider, randomUtxo, randomToken } from 'cashscript';
import { secp256k1, generatePrivateKey, binToHex } from '@bitauth/libauth';
import { buildLock, createPledgeContract, newPledgeId, stakerP2pkhAddress } from '@/lib/vouch';
import { gatherWalletUtxos, lockInputPaths, selectLockUtxos, totalSats, type PubkeySource } from '@/lib/walletUtxos';
import { toWcSignRequest } from '@/lib/wc';
import { mockWalletSign } from './mock-wallet';

// Fake HD wallet: deterministic keys per (path, index), exposed like DappConnectionManager.getPubkey.
function fakeHdWallet(paths: Record<number, string> = { 0: 'receive', 1: 'change' }) {
  const privs = new Map<string, Uint8Array>();
  const priv = (path: string, i: number) => {
    const k = `${path}/${i}`;
    if (!privs.has(k)) privs.set(k, generatePrivateKey());
    return privs.get(k)!;
  };
  const pub = (path: string, i: number) => secp256k1.derivePublicKeyCompressed(priv(path, i)) as Uint8Array;
  const manager: PubkeySource = {
    getPubkey: (child, index) => (paths[child] ? pub(paths[child], Number(index)) : undefined),
    hasPath: (child) => child in paths,
  };
  const address = (path: string, i: number) => stakerP2pkhAddress(pub(path, i), 'chipnet');
  const keys = () => Object.fromEntries(privs);
  return { manager, address, pub, keys };
}

function chipnetProvider() {
  const p = new MockNetworkProvider();
  (p as unknown as { network: string }).network = 'chipnet';
  return p;
}

describe('gatherWalletUtxos', () => {
  it('finds coins on later receive indexes and on change addresses, not just receive/0', async () => {
    const w = fakeHdWallet();
    const provider = chipnetProvider();
    provider.addUtxo(w.address('receive', 3), randomUtxo({ satoshis: 1_500_000n }));
    provider.addUtxo(w.address('change', 1), randomUtxo({ satoshis: 500_000n }));
    provider.addUtxo(w.address('receive', 3), randomUtxo({ satoshis: 9_000n, token: randomToken() })); // token: skipped
    const utxos = await gatherWalletUtxos(w.manager, provider, 'chipnet');
    expect(totalSats(utxos)).toBe(2_000_000n);
    expect(utxos.map((u) => [u.path, u.index, u.satoshis])).toEqual([
      ['receive', 3, 1_500_000n],
      ['change', 1, 500_000n],
    ]);
    expect(utxos[0].address).toBe(w.address('receive', 3));
  });

  it('stops after a gap of empty addresses and respects max', async () => {
    const w = fakeHdWallet({ 0: 'receive' });
    const provider = chipnetProvider();
    const spy = vi.spyOn(provider, 'getUtxos');
    provider.addUtxo(w.address('receive', 2), randomUtxo({ satoshis: 1_000n }));
    provider.addUtxo(w.address('receive', 12), randomUtxo({ satoshis: 7_000n })); // beyond the gap: not seen
    const utxos = await gatherWalletUtxos(w.manager, provider, 'chipnet', { gap: 5, max: 20 });
    expect(totalSats(utxos)).toBe(1_000n);
    expect(spy).toHaveBeenCalledTimes(10); // batches 0-4 (hit at 2), 5-9 (5 empty in a row) -> stop
  });

  it('keeps scanning while coins keep appearing, up to max', async () => {
    const w = fakeHdWallet({ 0: 'receive' });
    const provider = chipnetProvider();
    for (const i of [0, 4, 8, 12, 16]) provider.addUtxo(w.address('receive', i), randomUtxo({ satoshis: 1_000n }));
    const utxos = await gatherWalletUtxos(w.manager, provider, 'chipnet', { gap: 5, max: 20 });
    expect(utxos).toHaveLength(5);
  });

  it('skips paths the wallet did not share', async () => {
    const w = fakeHdWallet({ 0: 'receive' });
    const provider = chipnetProvider();
    const spy = vi.spyOn(provider, 'getUtxos');
    await gatherWalletUtxos(w.manager, provider, 'chipnet');
    expect(spy.mock.calls.every(([a]) => typeof a === 'string' && a.startsWith('bchtest:'))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(5);
  });
});

describe('coin selection + input paths', () => {
  it('picks largest first, only as many as needed', () => {
    const u = (s: bigint) => ({ satoshis: s });
    expect(selectLockUtxos([u(5_000n), u(50_000n), u(20_000n)], 30_000n)).toEqual([u(50_000n)]);
    expect(selectLockUtxos([u(5_000n), u(20_000n), u(15_000n)], 30_000n)).toEqual([u(20_000n), u(15_000n)]);
    expect(selectLockUtxos([u(5_000n)], 30_000n)).toBeNull();
  });

  it('maps each input to its own path and index', () => {
    expect(lockInputPaths([{ path: 'receive', index: 3 }, { path: 'change', index: 1 }, { path: 'receive', index: 0 }])).toEqual([
      [0, 'receive', 3],
      [1, 'change', 1],
      [2, 'receive', 0],
    ]);
  });

  it('error reports the real total across addresses', async () => {
    const w = fakeHdWallet();
    const provider = chipnetProvider();
    provider.addUtxo(w.address('receive', 1), randomUtxo({ satoshis: 3_000n }));
    provider.addUtxo(w.address('change', 0), randomUtxo({ satoshis: 2_000n }));
    const walletUtxos = await gatherWalletUtxos(w.manager, provider, 'chipnet');
    expect(() =>
      buildLock({ provider, walletUtxos, walletAddress: w.address('receive', 0), contractAddress: w.address('receive', 9), stake: 20_000n }),
    ).toThrow('Wallet has 5000 sats; need 20000 + fees');
  });

  it('end to end: lock spends coins from several addresses, each signed by its own key; change to receive/0', async () => {
    const w = fakeHdWallet();
    const provider = chipnetProvider();
    provider.setBlockHeight(900);
    const staker = w.pub('receive', 0);
    const contract = createPledgeContract(
      { stakerPubkey: staker, verifierPubkey: w.pub('receive', 19), beneficiaryAddress: w.address('receive', 18), deadline: 1000, pledgeId: newPledgeId() },
      provider,
    );
    provider.addUtxo(w.address('receive', 2), randomUtxo({ satoshis: 12_000n }));
    provider.addUtxo(w.address('change', 0), randomUtxo({ satoshis: 15_000n }));
    const walletUtxos = await gatherWalletUtxos(w.manager, provider, 'chipnet');
    const stakerAddress = stakerP2pkhAddress(staker, 'chipnet');
    const { builder, inputs } = buildLock({ provider, walletUtxos, walletAddress: stakerAddress, contractAddress: contract.address, stake: 20_000n });
    expect(inputs).toHaveLength(2);
    const req = toWcSignRequest(builder, lockInputPaths(inputs), { broadcast: true, userPrompt: 'Lock' });
    expect(req.inputPaths).toEqual([[0, 'change', 0], [1, 'receive', 2]]);
    await provider.sendRawTransaction(mockWalletSign(req, w.keys()));
    expect((await provider.getUtxos(contract.address))[0].satoshis).toBe(20_000n);
    const change = await provider.getUtxos(stakerAddress);
    expect(change).toHaveLength(1);
    expect(change[0].satoshis).toBeGreaterThan(6_000n);
    expect(binToHex(staker)).toHaveLength(66);
  });
});

import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NetworkProvider } from 'cashscript';
import {
  secp256k1,
  generatePrivateKey,
  encodeCashAddress,
  encodePrivateKeyWif,
  CashAddressType,
  hash160,
  binToHex,
} from '@bitauth/libauth';
import { checkAddress, addressNetwork, resolveNetwork, defaultNetwork, explorerTx, explorerAddr, cashPrefix, isNetwork } from '@/lib/network';
import { createPledgeContract, validatePledge, newPledgeId, MIN_STAKE, DUST, DEFAULT_MAX_FEE } from '@/lib/vouch';
import { decodeVerifyRequest, encodeVerifyRequest, type VerifyRequest } from '@/lib/share';
import { addressParam, networkParam } from '@/server/http';
import { loadVerifierKey, verifierPubkeyHex, settleExpired, VerifierError } from '@/server/verifier';

const pub = () => secp256k1.derivePublicKeyCompressed(generatePrivateKey()) as Uint8Array;
const addr = (prefix: 'bchtest' | 'bitcoincash', type = CashAddressType.p2pkh, pk = pub()) =>
  encodeCashAddress({ prefix, type, payload: hash160(pk) }).address;

const CHIP = addr('bchtest');
const CHIP_TOKEN = addr('bchtest', CashAddressType.p2pkhWithTokens);
const MAIN = addr('bitcoincash');
const MAIN_TOKEN = addr('bitcoincash', CashAddressType.p2pkhWithTokens);
const fakeProvider = (network: string) => ({ network }) as unknown as NetworkProvider;

afterEach(() => vi.unstubAllEnvs());

describe('checkAddress', () => {
  it('accepts chipnet addresses on chipnet, incl. token-aware bchtest:z', () => {
    expect(checkAddress(CHIP, 'chipnet')).toEqual({ ok: true, address: CHIP, network: 'chipnet' });
    expect(CHIP_TOKEN.startsWith('bchtest:z')).toBe(true);
    expect(checkAddress(CHIP_TOKEN, 'chipnet').ok).toBe(true);
  });

  it('accepts mainnet addresses on mainnet, incl. token-aware bitcoincash:z', () => {
    expect(checkAddress(MAIN, 'mainnet').ok).toBe(true);
    expect(MAIN_TOKEN.startsWith('bitcoincash:z')).toBe(true);
    expect(checkAddress(MAIN_TOKEN, 'mainnet').ok).toBe(true);
  });

  it('rejects a mainnet address on chipnet and vice versa, naming both networks', () => {
    const a = checkAddress(MAIN, 'chipnet');
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(a.network).toBe('mainnet');
      expect(a.error).toMatch(/mainnet address/);
      expect(a.error).toMatch(/bchtest:/);
    }
    const b = checkAddress(CHIP_TOKEN, 'mainnet');
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.error).toMatch(/chipnet address.*bitcoincash:/);
  });

  it('reads prefix-less addresses for their network and normalises them', () => {
    const bare = CHIP.split(':')[1];
    expect(checkAddress(bare, 'chipnet')).toEqual({ ok: true, address: CHIP, network: 'chipnet' });
    const r = checkAddress(MAIN.split(':')[1], 'chipnet');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.network).toBe('mainnet');
  });

  it('accepts upper-case and surrounding whitespace', () => {
    expect(checkAddress(`  ${CHIP.toUpperCase()}  `, 'chipnet')).toEqual({ ok: true, address: CHIP, network: 'chipnet' });
  });

  it('rejects garbage, a broken checksum, empty input and regtest addresses', () => {
    expect(checkAddress('hello', 'chipnet').ok).toBe(false);
    expect(checkAddress(CHIP.slice(0, -1) + (CHIP.endsWith('q') ? 'p' : 'q'), 'chipnet').ok).toBe(false);
    expect(checkAddress('', 'chipnet').ok).toBe(false);
    const reg = encodeCashAddress({ prefix: 'bchreg', type: CashAddressType.p2pkh, payload: hash160(pub()) }).address;
    const r = checkAddress(reg, 'chipnet');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/bchreg/);
  });

  it('addressNetwork maps prefixes', () => {
    expect(addressNetwork(CHIP)).toBe('chipnet');
    expect(addressNetwork(MAIN_TOKEN)).toBe('mainnet');
    expect(addressNetwork('nope')).toBeNull();
  });
});

describe('network selection', () => {
  it('defaults to chipnet; NEXT_PUBLIC_BCH_NETWORK=mainnet makes mainnet the default', () => {
    vi.stubEnv('NEXT_PUBLIC_BCH_NETWORK', '');
    expect(defaultNetwork()).toBe('chipnet');
    vi.stubEnv('NEXT_PUBLIC_BCH_NETWORK', 'mainnet');
    expect(defaultNetwork()).toBe('mainnet');
  });

  it('a stored choice wins over the default; junk falls back to it', () => {
    vi.stubEnv('NEXT_PUBLIC_BCH_NETWORK', '');
    expect(resolveNetwork('mainnet')).toBe('mainnet');
    expect(resolveNetwork('chipnet')).toBe('chipnet');
    expect(resolveNetwork('testnet4')).toBe('chipnet');
    expect(resolveNetwork(null)).toBe('chipnet');
    expect(isNetwork('mainnet')).toBe(true);
    expect(isNetwork('regtest')).toBe(false);
  });

  it('explorer links and prefixes follow the network', () => {
    expect(explorerTx('chipnet', 'ab')).toBe('https://chipnet.imaginary.cash/tx/ab');
    expect(explorerAddr('mainnet', MAIN)).toBe(`https://explorer.bitcoinunlimited.info/address/${MAIN}`);
    expect(cashPrefix('mainnet')).toBe('bitcoincash');
    expect(cashPrefix('chipnet')).toBe('bchtest');
  });

  it('the minimum stake covers mainnet dust plus the fee cap', () => {
    expect(MIN_STAKE).toBeGreaterThanOrEqual(DUST + DEFAULT_MAX_FEE);
  });
});

describe('pledge creation guards', () => {
  const params = (beneficiaryAddress: string) => ({
    stakerPubkey: pub(),
    verifierPubkey: pub(),
    beneficiaryAddress,
    deadline: 1000,
    pledgeId: newPledgeId(),
  });

  it('validatePledge flags a beneficiary on the wrong network', () => {
    expect(validatePledge(params(MAIN), 100_000n, 'chipnet').some((i) => i.startsWith('Beneficiary:'))).toBe(true);
    expect(validatePledge(params(CHIP), 100_000n, 'chipnet')).toEqual([]);
    expect(validatePledge(params(MAIN_TOKEN), 100_000n, 'mainnet')).toEqual([]);
  });

  it('createPledgeContract refuses to build when the beneficiary is on another network', () => {
    expect(() => createPledgeContract(params(MAIN), fakeProvider('chipnet'))).toThrow(/Beneficiary: .*mainnet address/);
    expect(() => createPledgeContract(params(CHIP), fakeProvider('mainnet'))).toThrow(/chipnet address/);
  });

  it('builds a mainnet contract with a bitcoincash: address, chipnet with bchtest:', () => {
    expect(createPledgeContract(params(MAIN), fakeProvider('mainnet')).address).toMatch(/^bitcoincash:p/);
    expect(createPledgeContract(params(CHIP), fakeProvider('chipnet')).address).toMatch(/^bchtest:p/);
  });
});

describe('verify links', () => {
  const link = (network: 'chipnet' | 'mainnet', beneficiaryAddress: string, contractAddress: string): string =>
    encodeVerifyRequest({
      v: 1,
      pledge: {
        id: newPledgeId(),
        promise: 'run',
        stakeSats: '10000',
        deadline: 1000,
        beneficiaryAddress,
        stakerPubkey: binToHex(pub()),
        verifierPubkey: binToHex(pub()),
        contractAddress,
        network,
      },
      utxo: { txid: 'ab'.repeat(32), vout: 0, satoshis: '10000' },
      fee: '1000',
      stakerSig: 'cd'.repeat(65),
    } satisfies VerifyRequest);
  const chipContract = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2sh, payload: new Uint8Array(32) }).address;
  const mainContract = encodeCashAddress({ prefix: 'bitcoincash', type: CashAddressType.p2sh, payload: new Uint8Array(32) }).address;

  it('accepts a link whose addresses match its network', () => {
    expect(decodeVerifyRequest(link('chipnet', CHIP, chipContract)).pledge.network).toBe('chipnet');
    expect(decodeVerifyRequest(link('mainnet', MAIN, mainContract)).pledge.network).toBe('mainnet');
  });

  it('rejects mixed-network links and unknown networks', () => {
    expect(() => decodeVerifyRequest(link('chipnet', MAIN, chipContract))).toThrow(/beneficiary address is a mainnet address/);
    expect(() => decodeVerifyRequest(link('mainnet', MAIN, chipContract))).toThrow(/contract address is a chipnet address/);
    expect(() => decodeVerifyRequest(link('testnet' as 'chipnet', CHIP, chipContract))).toThrow(/unknown network/);
  });
});

describe('server network checks', () => {
  it('networkParam only takes chipnet or mainnet', () => {
    expect(networkParam('mainnet')).toBe('mainnet');
    expect(() => networkParam('testnet')).toThrow(VerifierError);
    expect(() => networkParam(undefined)).toThrow(/chipnet or mainnet/);
  });

  it('addressParam requires the address to be on the requested network', () => {
    expect(addressParam(CHIP, 'chipnet')).toBe(CHIP);
    expect(addressParam(MAIN_TOKEN, 'mainnet')).toBe(MAIN_TOKEN);
    expect(() => addressParam(MAIN, 'chipnet')).toThrow(/mainnet address but network is chipnet/);
    expect(() => addressParam('junk', 'mainnet')).toThrow(VerifierError);
  });

  it('settle refuses pledge terms whose beneficiary is on another network', async () => {
    const terms = {
      id: newPledgeId(),
      deadline: 1000,
      beneficiaryAddress: MAIN,
      stakerPubkey: binToHex(pub()),
      verifierPubkey: binToHex(pub()),
      network: 'chipnet',
    };
    await expect(settleExpired({ pledge: terms }, fakeProvider('chipnet'))).rejects.toThrow(/Beneficiary: .*mainnet address/);
  });

  it('one verifier WIF works on both networks (the key is network-agnostic)', () => {
    const priv = generatePrivateKey();
    const a = loadVerifierKey(encodePrivateKeyWif(priv, 'mainnet'))!;
    const b = loadVerifierKey(encodePrivateKeyWif(priv, 'testnet'))!;
    expect(verifierPubkeyHex(a)).toBe(verifierPubkeyHex(b));
    expect(verifierPubkeyHex(a)).toBe(binToHex(secp256k1.derivePublicKeyCompressed(priv) as Uint8Array));
  });
});

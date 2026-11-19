import { describe, expect, it } from 'vitest';
import { normalizePledge, parsePledges, type StoredPledge } from '../src/lib/pledges';
import { pledgeContract, anyPledgeContract } from '../src/lib/walletActions';
import { formatBch } from '../src/lib/format';

const PK1 = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PK2 = '02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5';
const PK3 = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';
const BENE = 'bchtest:qz6x406dnct5dcemesuuag77sakzn39d7v97yzrjh8';
const TX = 'a0a255e4f93d3df4fe401b412babc8c63cca7ea9770faa5e2afa4dfb5f2007ea';

// Shape CreatePledgeForm writes for a single demo-verifier pledge, listed on the wall, after the lock.
const v1: StoredPledge = {
  id: '0b9974b1301c7bafcd61392442b7c2f3',
  promise: 'Run 5km every morning',
  stakeSats: '10000',
  deadline: 340000,
  deadlineAt: 1795166010178,
  beneficiaryAddress: BENE,
  stakerPubkey: PK1,
  verifierPubkey: PK2,
  verifierKind: 'demo',
  contractAddress: 'bchtest:p0adk3z056y3k9c03mmv0tpejszej5kg30s2jw6eu7hegh02s7r5wj5z22hnu',
  network: 'chipnet',
  createdAt: 1795079610178,
  visibility: 'public',
  listSecret: 'ab'.repeat(32),
  listNonce: 'cd'.repeat(16),
  lastTxid: TX,
  lockTxid: TX,
};
const quorum: StoredPledge = {
  ...v1,
  id: '1'.repeat(32),
  verifierKind: 'friend',
  version: 2,
  verifiers: [{ pubkey: PK2, kind: 'demo' }, { pubkey: PK3, name: 'Ada', kind: 'friend' }],
  threshold: 2,
  visibility: 'unlisted',
};
const legacy = { id: '2'.repeat(32), promise: 'Old', stakeSats: '6000', deadline: 290000, beneficiaryAddress: BENE, stakerPubkey: PK1, verifierPubkey: PK2, contractAddress: 'x', network: 'chipnet', createdAt: 1 };

/** Everything the list row and status page do with a record at render / effect time must not throw. */
function renderable(p: StoredPledge) {
  formatBch(p.stakeSats);
  pledgeContract(p);
  anyPledgeContract(p);
}

describe('stored pledges', () => {
  it('keeps the current create-flow shapes (v1 listed, quorum, legacy) intact', () => {
    const got = parsePledges(JSON.stringify([v1, quorum, legacy]));
    expect(got).toHaveLength(3);
    expect(got[0]).toEqual(v1);
    expect(got[1]).toEqual(quorum);
    expect(got[2].id).toBe(legacy.id);
    got.forEach(renderable);
  });

  it('regression: a bad record no longer crashes My pledges; it is repaired or skipped', () => {
    const bad = [
      { ...v1, id: '3'.repeat(32), network: 'mainnet' }, // network disagrees with the bchtest: address -> contract build threw
      { ...v1, id: '4'.repeat(32), stakeSats: '0.0001' }, // BigInt('0.0001') threw in render
      { ...v1, id: '5'.repeat(32), stakeSats: undefined },
      { ...v1, id: '6'.repeat(32), deadline: '340000' }, // string deadline -> "Bad deadline"
      { ...v1, id: '7'.repeat(32), verifierPubkey: 'zz' },
      { ...quorum, id: '8'.repeat(32), threshold: 3 }, // M > N
      { ...quorum, id: '9'.repeat(32), verifiers: undefined },
      null,
      42,
      'nope',
      [],
      { id: 'short' },
    ];
    const got = parsePledges(JSON.stringify([v1, ...bad]));
    expect(got.map((p) => p.id)).toEqual([v1.id, '3'.repeat(32), '6'.repeat(32)]);
    expect(got[1].network).toBe('chipnet'); // the address prefix wins
    expect(got[2].deadline).toBe(340000);
    got.forEach(renderable);
  });

  it('never throws on junk storage', () => {
    for (const raw of [null, '', '{', 'null', '{}', '"x"', '[null]', JSON.stringify({ a: 1 })]) {
      expect(() => parsePledges(raw)).not.toThrow();
      expect(parsePledges(raw)).toEqual([]);
    }
  });

  it('drops malformed quorum progress instead of passing it to the panel', () => {
    const p = normalizePledge({ ...quorum, quorum: { utxo: { txid: TX, vout: 0, satoshis: '10000' }, keepSigs: ['aa', 5], breakSigs: 'x' } });
    expect(p?.quorum).toEqual({ utxo: { txid: TX, vout: 0, satoshis: '10000' }, keepSigs: ['aa', null], breakSigs: [null, null] });
    expect(normalizePledge({ ...quorum, quorum: { utxo: null } })?.quorum).toBeUndefined();
  });
});

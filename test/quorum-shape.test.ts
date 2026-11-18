// Off-chain quorum shape rules, checked in all three places that see a v2 pledge:
//   create  -> quorumShapeIssues / quorumPledgeIssues / createQuorumContract (what the create form runs)
//   verify  -> decodeAnyVerifyRequest (what the /verify page runs on the link)
//   server  -> approveKeep (the /api/verifier POST path)
// Rule 1: M is an integer in 1..(number of real verifiers; padding keys never count).
// Rule 2: the staker's key may not sit in any verifier slot (refused like a duplicate).
import { describe, it, expect, beforeEach } from 'vitest';
import { MockNetworkProvider } from 'cashscript';
import { secp256k1, generatePrivateKey, encodeCashAddress, CashAddressType, hash160, binToHex, hexToBin, encodePrivateKeyWif } from '@bitauth/libauth';
import { newPledgeId } from '@/lib/vouch';
import {
  quorumShapeIssues,
  quorumPledgeIssues,
  createQuorumContract,
  quorumPowerCopy,
  UNUSED_SLOT_KEYS,
  STAKER_AS_VERIFIER,
  DUPLICATE_VERIFIER,
  QUORUM_FEE,
} from '@/lib/quorum';
import { decodeAnyVerifyRequest, encodeQuorumRequest, slotLabels, type QuorumVerifyRequest } from '@/lib/quorumShare';
import { approveKeep, loadVerifierKey, VerifierError } from '@/server/verifier';

function makeKey() {
  const priv = generatePrivateKey();
  const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
  const address = encodeCashAddress({ prefix: 'bchtest', type: CashAddressType.p2pkh, payload: hash160(pub) }).address;
  return { priv, pub, hex: binToHex(pub), address, wif: encodePrivateKeyWif(priv, 'testnet') };
}

const DEADLINE = 1000;
const staker = makeKey();
const beneficiary = makeKey();
const demo = makeKey();
const demoKey = loadVerifierKey(demo.wif)!;
const friends = Array.from({ length: 5 }, makeKey);

let provider: MockNetworkProvider;
beforeEach(() => {
  provider = new MockNetworkProvider();
  (provider as unknown as { network: string }).network = 'chipnet';
  provider.setBlockHeight(DEADLINE - 100);
});

// --- the three places ---------------------------------------------------------------------------

/** Create: the form's shape check, then the same guard createQuorumContract applies. */
function createRefuses(verifiers: string[], threshold: unknown): string[] {
  const shape = quorumShapeIssues(staker.hex, verifiers, threshold);
  let threw: string | null = null;
  try {
    createQuorumContract(
      { stakerPubkey: staker.pub, verifierPubkeys: verifiers.map((v) => hexToBin(v)), threshold: threshold as number, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId() },
      provider,
    );
  } catch (e) {
    threw = (e as Error).message;
  }
  const pledge = quorumPledgeIssues({ stakerPubkey: staker.pub, verifierPubkeys: verifiers.map((v) => hexToBin(v)), threshold: threshold as number, beneficiaryAddress: beneficiary.address, deadline: DEADLINE, pledgeId: newPledgeId() });
  // all create-side checks must agree
  expect(!!threw).toBe(shape.length > 0);
  expect(pledge.length > 0).toBe(shape.length > 0);
  return shape;
}

/** Verify page: decode a link carrying these terms. Shape is checked before the contract address. */
function verifyRefuses(verifiers: string[], threshold: unknown): string | null {
  const r = {
    v: 2,
    pledge: {
      id: newPledgeId(),
      promise: 'Run 5k',
      stakeSats: '20000',
      deadline: DEADLINE,
      beneficiaryAddress: beneficiary.address,
      stakerPubkey: staker.hex,
      network: 'chipnet',
      verifiers: verifiers.map((pubkey, i) => ({ pubkey, name: `V${i + 1}` })),
      threshold,
      contractAddress: 'bchtest:placeholder',
    },
    utxo: { txid: '11'.repeat(32), vout: 0, satoshis: '20000' },
    fee: QUORUM_FEE.toString(),
    stakerSig: '22'.repeat(65),
    keepSigs: verifiers.map(() => null),
    breakSigs: verifiers.map(() => null),
  } as unknown as QuorumVerifyRequest;
  try {
    decodeAnyVerifyRequest(`#pledge=${encodeQuorumRequest(r)}`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Server: /api/verifier POST (approveKeep). The demo key is always in the list, so a refusal is about the shape. */
async function serverRefuses(verifiers: string[], threshold: unknown): Promise<{ status: number; message: string } | null> {
  const pledge = {
    id: newPledgeId(),
    promise: 'Run 5k',
    stakeSats: '20000',
    deadline: DEADLINE,
    beneficiaryAddress: beneficiary.address,
    stakerPubkey: staker.hex,
    network: 'chipnet',
    version: 2,
    verifierPubkeys: verifiers,
    threshold,
  };
  const err = await approveKeep({ pledge: pledge as never, confirm: true, note: 'ran' }, provider, demoKey).catch((e) => e);
  if (!(err instanceof VerifierError)) return null;
  return { status: err.status, message: err.message };
}

async function allRefuse(verifiers: string[], threshold: unknown, pattern: RegExp) {
  const c = createRefuses(verifiers, threshold);
  expect(c.join(' | '), 'create').toMatch(pattern);
  expect(verifyRefuses(verifiers, threshold) ?? '', 'verify page').toMatch(pattern);
  const s = await serverRefuses(verifiers, threshold);
  expect(s?.message ?? '', 'server').toMatch(pattern);
  expect(s?.status, 'server status').toBe(400);
}

// --- rule 1: M range -----------------------------------------------------------------------------

describe('rule 1: M is between 1 and the number of real verifiers', () => {
  const M_RANGE = /approvals needed must be between 1 and/;

  for (let n = 1; n <= 5; n++) {
    const keys = [demo.hex, ...friends.slice(0, n - 1).map((f) => f.hex)];

    it(`${n} verifier(s): every M in 1..${n} is accepted everywhere`, async () => {
      for (let m = 1; m <= n; m++) {
        expect(createRefuses(keys, m)).toEqual([]);
        // verify gets past the shape check (and then fails only on the placeholder contract address)
        expect(verifyRefuses(keys, m)).toMatch(/contract address/);
        // server gets past parseTerms (and then fails only because nothing is locked)
        const s = await serverRefuses(keys, m);
        expect(s?.message ?? '').not.toMatch(M_RANGE);
      }
    });

    it(`${n} verifier(s): M = 0, M = ${n + 1}, M = -1 are refused everywhere`, async () => {
      for (const m of [0, n + 1, -1]) await allRefuse(keys, m, M_RANGE);
    });
  }

  it('non-integer and non-number M are refused everywhere (no "2" strings, no 1.5, no NaN)', async () => {
    const keys = [demo.hex, friends[0].hex, friends[1].hex];
    for (const m of [1.5, '2', null, Number.NaN, Infinity, true]) await allRefuse(keys, m, M_RANGE);
  });

  it('padding (unused-slot) keys never count toward N', async () => {
    // 2 real + 1 padding key: M = 3 is too big, and the padding key is refused on its own too
    const keys = [demo.hex, friends[0].hex, UNUSED_SLOT_KEYS[2]];
    await allRefuse(keys, 3, M_RANGE);
    await allRefuse(keys, 2, /reserved/);
    expect(quorumShapeIssues(staker.hex, [UNUSED_SLOT_KEYS[0]], 1).join(' ')).toMatch(M_RANGE);
  });

  it('M can’t be raised past N by repeating a key', async () => {
    await allRefuse([demo.hex, friends[0].hex, friends[0].hex], 3, /listed twice/);
  });
});

// --- rule 2: staker in a verifier slot -----------------------------------------------------------

describe('rule 2: the staker’s key is in no verifier slot', () => {
  const STAKER = /vouch for yourself/;

  it('refused in any slot position, for every N, everywhere', async () => {
    for (let n = 2; n <= 5; n++) {
      for (let slot = 0; slot < n; slot++) {
        const others = [demo.hex, ...friends.slice(0, n - 2).map((f) => f.hex)];
        const keys = [...others.slice(0, slot), staker.hex, ...others.slice(slot)];
        expect(keys).toHaveLength(n);
        await allRefuse(keys, 1, STAKER);
      }
    }
  });

  it('refused as a 1-of-1 (the staker as the only verifier)', () => {
    expect(createRefuses([staker.hex], 1).join(' ')).toMatch(STAKER);
    expect(verifyRefuses([staker.hex], 1)).toMatch(STAKER);
  });

  it('upper-case hex doesn’t slip past the check', async () => {
    await allRefuse([demo.hex, staker.hex.toUpperCase()], 1, STAKER);
  });

  it('is reported with the duplicate message family, alongside a real duplicate', () => {
    const both = quorumShapeIssues(staker.hex, [demo.hex, demo.hex, staker.hex], 1);
    expect(both).toContain(DUPLICATE_VERIFIER);
    expect(both).toContain(STAKER_AS_VERIFIER);
  });

  it('a clean quorum with the same keys minus the staker is accepted', () => {
    expect(createRefuses([demo.hex, friends[0].hex, friends[1].hex], 2)).toEqual([]);
  });
});

// --- copy helpers used by create + verify ----------------------------------------------------------

describe('M-of-N copy', () => {
  it('says M can also force a break, and warns for 1 of N', () => {
    const two = quorumPowerCopy(2, 3);
    expect(two.summary).toMatch(/any 2 of them can also force a break/);
    expect(two.warning).toBeNull();
    expect(quorumPowerCopy(1, 3).warning).toMatch(/any single verifier can rule it broken/);
    expect(quorumPowerCopy(1, 1).warning).toMatch(/1 of 1/);
    expect(quorumPowerCopy(2, 3, 'verifier').summary).toMatch(/staker’s refund/);
  });

  it('marks the demo verifier by key only: a name can’t claim it', () => {
    const labels = slotLabels({ verifiers: [{ pubkey: demo.hex }, { pubkey: friends[0].hex, name: 'Vouch demo' }] }, demo.hex);
    expect(labels[0]).toMatchObject({ isDemo: true, name: 'Vouch demo verifier' });
    expect(labels[1].isDemo).toBe(false);
    expect(labels[1].name).toMatch(/not the Vouch demo key/);
  });
});

// Rebuild pledge terms for the README chipnet runs from their spend transactions: the spend's
// unlocking bytecode ends with the redeem script, whose leading pushes are the constructor args.
// Each result is checked by rebuilding the contract and comparing the address with the lock output.
// Usage: npx tsx scripts/recover-legacy.mts > /tmp/legacy.json
import { decodeTransaction, hexToBin, binToHex, decodeAuthenticationInstructions, vmNumberToBigInt, lockingBytecodeToCashAddress, type AuthenticationInstructionPush } from '@bitauth/libauth';
import { restUpstream, RestNetworkProvider } from '../src/lib/providers.ts';
import { createPledgeContract } from '../src/lib/vouch.ts';
import { createQuorumContract, UNUSED_SLOT_KEYS } from '../src/lib/quorum.ts';

const RUNS: Array<{ lock: string; spend: string; label: string }> = [
  { lock: 'c36f21baceb7017e56ac8482dd1a8e3f7bfa9978011adf4baf753eccafedb115', spend: 'b088db2f4695df54ea50049a7f188daba9c7c8fee07738157f4953556d306dbe', label: 'keep' },
  { lock: 'b8185ef5c0dd247001a116caaeee970d38b8dd20963625c19fcd4e119be184af', spend: '771e768d99fe5d384635c1c4fdff9bac233767e21726f1992f05518efce13068', label: 'forfeit' },
  { lock: 'b07119645843618e0fbdb450e752163e4dac079c9f5977a359f1952b34cdee7d', spend: 'fc163b6d741c81c3bcef0fa86abad964cd2961f6ca128a7ccfe22271de7b8a6e', label: 'break by verifier' },
  { lock: '5d53c4bbe5d04cc764c41092aff3500886eab294924f73a9c4282a3c3880adf4', spend: 'ee61efe57b340187ad1659319fea07613c4bc78043ba95804855cff3ae3a2dbb', label: 'keep via demo verifier' },
  { lock: 'ee51523823edea99f21e65c543a27521725070ae76c942d1e2c3209edf31351c', spend: '1f3d51735f4fc08330d78dbde6031c82d5310181403439d81abd54a541594919', label: 'keep via verify link' },
  { lock: '2a570cc0607556ca28606c8419b17516481e74fd68f2e0a054e0b3539194d981', spend: '4c7cb19a983b0968aaa1206e134b804d723d2fa3dc180d26239b21d482995a5c', label: 'auto-settled after deadline' },
  { lock: 'd33425c071c52ba3ef38066d55bdf3f04ab9a9c6a4a9be9114fc201afdaf71de', spend: '9b716c9b685943f30fbf7cf387b8058428ad3514c4c179af0cf0849306b78448', label: '2 of 3 keep' },
  { lock: '3101159c5785fa7f8a470323031d30496605ca85cfd08ebc8ba73cd3cf009e62', spend: '6076d72769203fcb178ca50fcb1cbf3b30b35ef07f5795190e24fd40ad7887ea', label: '2 of 3 break' },
  { lock: 'bff62eeb89f5c839ce22bbb69bd5e8212563b131a3e4f335fb7eaa96463527a0', spend: 'cc183853d9c6f4965267b5ec222f6520c025c3ad0e8645aa86faf61a245ad31e', label: '2 of 3 keep with the demo verifier' },
  { lock: '3ae2d5424ddeeaa169c5287d24cb0d85c4233dda65e652fbc685390cf106f7ed', spend: '28db38379d3e98bae7ee50b410dbee5f115f0b58d8e5c47d720449f0ee23f59a', label: '2 of 3 keep, after the wallet fix' },
];

const provider = new RestNetworkProvider('chipnet');
// OP_1..OP_16 carry small numbers with no data: turn them back into a minimal number push.
const pushes = (b: Uint8Array) =>
  decodeAuthenticationInstructions(b).map((i) => {
    const d = (i as AuthenticationInstructionPush).data;
    if (d) return d;
    return i.opcode >= 0x51 && i.opcode <= 0x60 ? Uint8Array.of(i.opcode - 0x50) : new Uint8Array();
  });
const num = (b: Uint8Array) => {
  const n = vmNumberToBigInt(b, { requireMinimalEncoding: false });
  if (typeof n === 'string') throw new Error(n);
  return Number(n);
};
const addr = (lock: Uint8Array) => {
  const a = lockingBytecodeToCashAddress({ bytecode: lock, prefix: 'bchtest' });
  if (typeof a === 'string') throw new Error(a);
  return a.address;
};

const out = [];
for (const run of RUNS) {
  const lockTx = decodeTransaction(hexToBin(await restUpstream.rawTx('chipnet', run.lock)));
  const spendTx = decodeTransaction(hexToBin(await restUpstream.rawTx('chipnet', run.spend)));
  if (typeof lockTx === 'string' || typeof spendTx === 'string') throw new Error('decode');
  const input = spendTx.inputs.find((i) => binToHex(i.outpointTransactionHash) === run.lock)!;
  const p = pushes(input.unlockingBytecode);
  const redeem = p[p.length - 1];
  const args = pushes(redeem);
  let terms: Record<string, unknown>;
  let address: string;
  if (args.length >= 11 && args[10]?.length === 33) {
    // v2: maxFee, pledgeId, deadline, beneficiaryLock, threshold, v4..v0, stakerPk
    const [, pid, dl, bene, th, ...rest] = args;
    const slots = rest.slice(0, 5).reverse().map(binToHex);
    const staker = binToHex(rest[5]);
    const verifierPubkeys = slots.filter((k) => !UNUSED_SLOT_KEYS.includes(k));
    terms = { version: 2, id: binToHex(pid), deadline: num(dl), beneficiaryAddress: addr(bene), stakerPubkey: staker, verifierPubkeys, threshold: num(th), network: 'chipnet' };
    address = createQuorumContract({ stakerPubkey: hexToBin(staker), verifierPubkeys: verifierPubkeys.map(hexToBin), threshold: num(th), beneficiaryAddress: addr(bene), deadline: num(dl), pledgeId: binToHex(pid) }, provider).address;
  } else {
    // v1: maxFee, pledgeId, deadline, beneficiaryLock, verifierPk, stakerPk
    const [, pid, dl, bene, ver, st] = args;
    terms = { version: 1, id: binToHex(pid), deadline: num(dl), beneficiaryAddress: addr(bene), stakerPubkey: binToHex(st), verifierPubkey: binToHex(ver), network: 'chipnet' };
    address = createPledgeContract({ stakerPubkey: st, verifierPubkey: ver, beneficiaryAddress: addr(bene), deadline: num(dl), pledgeId: binToHex(pid) }, provider).address;
  }
  const lockOut = lockTx.outputs[input.outpointIndex];
  const lockAddr = addr(lockOut.lockingBytecode);
  if (lockAddr !== address) throw new Error(`${run.lock}: rebuilt ${address} != lock ${lockAddr}`);
  out.push({ ...run, contractAddress: address, stakeSats: lockOut.valueSatoshis.toString(), terms });
  console.error('ok', run.label, address);
}
console.log(JSON.stringify(out, null, 2));

// Test-only stand-in for a WizardConnect wallet: takes the relay-safe sign request the app sends,
// fills placeholder signatures/pubkeys for the inputs listed in inputPaths, returns signed tx hex.
// Mirrors the WC2 convention CashScript's generateWcTransactionObject targets.
import { encodeTransaction, decodeTransaction, binToHex, hexToBin, secp256k1, type Output } from '@bitauth/libauth';
import { hash256 } from '@cashscript/utils';
// createSighashPreimage isn't re-exported from the package index
import { createSighashPreimage } from 'cashscript/dist/utils.js';
import { SighashType } from 'cashscript';
import { toUint8Array, toBigInt } from '@wizardconnect/core';
import type { WcSignRequest } from '@/lib/wc';

const HASHTYPE = SighashType.SIGHASH_ALL | SighashType.SIGHASH_UTXOS;

function replaceZeros(bytecode: Uint8Array, len: number, replacement: Uint8Array): Uint8Array {
  const out = Uint8Array.from(bytecode);
  for (let i = 0; i + len <= out.length; i++) {
    if (out[i - 1] !== len) continue; // must be a direct push of `len` bytes
    let zero = true;
    for (let j = 0; j < len; j++) if (out[i + j] !== 0) { zero = false; break; }
    if (zero) {
      out.set(replacement, i);
      return out;
    }
  }
  return out;
}

export function mockWalletSign(req: WcSignRequest, keys: Record<string, Uint8Array>): string {
  // Same wire handling as Paytaca's WizardConnect signRequest: JSON over the relay, tx as hex,
  // source-output fields hydrated with toUint8Array/toBigInt.
  const wire = JSON.parse(JSON.stringify(req.transaction)) as {
    transaction: unknown;
    sourceOutputs: Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  if (typeof wire.transaction !== 'string') throw new Error('Failed to decode transaction: transaction is not hex');
  const tx = decodeTransaction(hexToBin(wire.transaction));
  if (typeof tx === 'string') throw new Error('Failed to decode transaction: ' + tx);
  const wc = {
    sourceOutputs: wire.sourceOutputs.map(
      (so): Output & { contract?: { redeemScript: Uint8Array } } => ({
        lockingBytecode: toUint8Array(so.lockingBytecode),
        valueSatoshis: toBigInt(so.valueSatoshis),
        ...(so.token ? { token: { category: toUint8Array(so.token.category), amount: toBigInt(so.token.amount) } } : {}),
        ...(so.contract ? { contract: { redeemScript: toUint8Array(so.contract.redeemScript) } } : {}),
      }),
    ),
  };
  const sourceOutputs = wc.sourceOutputs.map((s) => ({ lockingBytecode: s.lockingBytecode, valueSatoshis: s.valueSatoshis, token: s.token }));
  for (const [inputIndex, path, index] of req.inputPaths) {
    const priv = keys[`${path}/${index}`];
    if (!priv) throw new Error(`wallet has no key ${path}/${index}`);
    const pub = secp256k1.derivePublicKeyCompressed(priv) as Uint8Array;
    const so = wc.sourceOutputs[inputIndex];
    const covered = so.contract ? so.contract.redeemScript : so.lockingBytecode;
    const preimage = createSighashPreimage(tx, sourceOutputs, inputIndex, covered, HASHTYPE);
    const sig = Uint8Array.from([...(secp256k1.signMessageHashSchnorr(priv, hash256(preimage)) as Uint8Array), 0x61]);
    if (so.contract) {
      let ub = replaceZeros(tx.inputs[inputIndex].unlockingBytecode, 65, sig);
      ub = replaceZeros(ub, 33, pub);
      tx.inputs[inputIndex].unlockingBytecode = ub;
    } else {
      tx.inputs[inputIndex].unlockingBytecode = Uint8Array.from([65, ...sig, 33, ...pub]);
    }
  }
  return binToHex(encodeTransaction(tx));
}

// WizardConnect / WC2 helpers: turn a CashScript TransactionBuilder into a relay-safe sign request,
// and pull signatures back out of signed transactions.
import type { TransactionBuilder } from 'cashscript';
import {
  binToHex,
  encodeTransaction,
  decodeTransaction,
  decodeAuthenticationInstructions,
  hexToBin,
  stringify,
  type AuthenticationInstructionPush,
} from '@bitauth/libauth';

/** [inputIndex, pathName, addressIndex] — which wallet key signs which input. */
export type InputPath = [number, string, number];

/** Where the staker's key lives in their wallet. v1 always uses receive/0. */
export const STAKER_PATH = { name: 'receive', index: 0 } as const;

/**
 * A 65-byte signature that is NOT the all-zero placeholder, so a wallet won't try to fill it.
 * Used when the staker signs a keep before the verifier: the slot is replaced later with the real
 * verifier signature (signatures don't commit to unlocking bytecode, so the staker's sig stays valid).
 */
export const DUMMY_SIGNATURE = (() => {
  const s = new Uint8Array(65).fill(1);
  s[64] = 0x61; // SIGHASH_ALL | SIGHASH_UTXOS | SIGHASH_FORKID
  return s;
})();

export interface WcSignRequest {
  transaction: {
    /** Unsigned transaction as hex. Wallets (Paytaca) run decodeTransaction(hexToBin(this)). */
    transaction: string;
    sourceOutputs: Record<string, unknown>[];
    broadcast?: boolean;
    userPrompt?: string;
  };
  inputPaths: InputPath[];
}

/**
 * Build the object passed to `manager.signTransaction(...)`.
 *
 * The inner `transaction` MUST be the unsigned tx as a hex string: Paytaca's WizardConnect handler
 * does `decodeTransaction(hexToBin(request.transaction.transaction))`, so sending CashScript's
 * libauth Transaction object there decodes zero bytes ("Error reading Uint32LE: requires 4 bytes").
 * Source outputs carry Uint8Array/bigint values; the relay is JSON, so they go in libauth's extended
 * format ("<Uint8Array: 0x..>", "<bigint: 1n>"), which wallets parse with toUint8Array/toBigInt.
 */
export function toWcSignRequest(
  builder: TransactionBuilder,
  inputPaths: InputPath[],
  opts: { broadcast: boolean; userPrompt: string },
): WcSignRequest {
  const wcObject = builder.generateWcTransactionObject({ broadcast: opts.broadcast, userPrompt: opts.userPrompt });
  const txHex = binToHex(encodeTransaction(wcObject.transaction));
  return {
    transaction: {
      transaction: txHex,
      sourceOutputs: JSON.parse(stringify(wcObject.sourceOutputs)) as Record<string, unknown>[],
      broadcast: opts.broadcast,
      userPrompt: opts.userPrompt,
    },
    inputPaths,
  };
}

/** Data pushes of one input's unlocking bytecode, in script order. */
export function unlockingPushes(txHex: string, inputIndex = 0): Uint8Array[] {
  const tx = decodeTransaction(hexToBin(txHex));
  if (typeof tx === 'string') throw new Error(`Bad transaction: ${tx}`);
  const input = tx.inputs[inputIndex];
  if (!input) throw new Error(`No input ${inputIndex}`);
  return decodeAuthenticationInstructions(input.unlockingBytecode).map(
    (i) => (i as AuthenticationInstructionPush).data ?? new Uint8Array(),
  );
}

/*
 * CashScript pushes function arguments in reverse order, then the function selector, then the
 * redeem script. For keep(stakerSig, verifierSig) the unlocking bytecode is:
 *   [verifierSig, stakerSig, selector, redeemScript]
 */
export function keepSignaturesFromTx(txHex: string, inputIndex = 0) {
  const [verifierSig, stakerSig] = unlockingPushes(txHex, inputIndex);
  if (verifierSig?.length !== 65 || stakerSig?.length !== 65) throw new Error('Not a keep spend');
  return { stakerSig, verifierSig };
}

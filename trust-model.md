# Vouch: trust model, keep vs break (1-pager)

**Scope:** v1 rules apply: BCH only, brand-new code, no AI judge, no bridge. Chipnet first, dust-only on mainnet.

## Contract parameters (fixed when the pledge is created)
`stakerPk`, `verifierPk`, `beneficiaryLock` (locking bytecode), `deadline` (absolute locktime), `pledgeId` (random 16 bytes), `maxFee` (e.g. 2,000 sats).
The parameters set the P2SH address, so every pledge gets its own address and none of these values can change later.

## Spend paths
| Path | Who authorizes | Where funds can go (enforced by covenant) | When |
|---|---|---|---|
| **keep** | staker sig **and** verifier `checkDataSig` over `"KEEP" ‖ pledgeId` | output at `activeInputIndex` = staker P2PKH | any time (see race below) |
| **break** | staker sig alone (admits it) **or** verifier datasig over `"BREAK" ‖ pledgeId` | output = `beneficiaryLock` | any time |
| **forfeit** | **no signature.** Anyone can broadcast it. | output = `beneficiaryLock` | `tx.time >= deadline` |

Every path checks that the output value is at least the input value minus `maxFee`. **This check is required.** Without it, anyone can broadcast forfeit, set a huge fee, and give the stake to a miner.
Each output is pinned to `this.activeInputIndex` (or each path requires `tx.inputs.length == 1`). That stops someone from bundling two pledges and paying out only one.

## Who can do what
- **Staker alone:** can break (send the stake to the beneficiary), but can never take the coins back. That's the whole product. If the staker loses their key, keep becomes impossible and the stake forfeits.
- **Verifier alone:** can force break, which is griefing. The verifier can't steal: every path pays either the staker or the beneficiary. The verifier is also a liveness dependency. If they never sign KEEP, the stake forfeits.
- **Beneficiary:** has no power before the deadline. After it, anyone (beneficiary, app, stranger) can push forfeit, so no one needs to be online.
- **Collusion:**
  - Verifier + beneficiary can lie "broken" and split the stake. Mitigation: the UI refuses verifier key = beneficiary key and warns when they share a wallet.
  - Staker + verifier can lie "kept". That's inherent: the beneficiary was promised nothing, so call it a bet, not a guarantee.
  - Staker = verifier is allowed but gets a "self-honour pledge" label.

## Edge cases to get right
1. **Keep vs forfeit race after the deadline.** UTXO script can't say "before T", so keep stays valid after the deadline. Once the deadline passes, whichever valid tx miners see first wins. Rule: the app broadcasts keep the moment the verifier signs, and the UI shows "verify before <deadline − 1h>". Don't try to fix this on-chain in v1.
2. **Replay.** Verifiers reuse one key across pledges, so each datasig must commit to `pledgeId` plus the outcome tag. Never sign a bare "KEEP".
3. **Locktime units.** Below 500,000,000 the value is a block height; at or above, it's MTP time (median of the last 11 blocks, which lags the wall clock by about an hour). Use height on chipnet for testable demos and timestamps on mainnet for UX, and show the real expected unlock time. The input's nSequence must not be final, which CashScript handles. Check it in a test anyway.
4. **Beneficiary is frozen at creation.** Validate the cashaddr and show a QR or name confirmation step. A typo or a lost beneficiary key burns the stake, which is irreversible on mainnet. Keep mainnet to dust.
5. **Dust and fees.** Minimum stake = 546 + `maxFee` + margin. Reject smaller stakes in the UI.
6. **Verifier signing UX (open question).** Check that WizardConnect (or the verifier's wallet) can produce a raw-message signature that `checkDataSig` accepts. Fallback: the verifier co-signs the keep tx with `checkSig` (wallet signs a tx with sourceOutputs). The last resort is a demo verifier key held by the app, labelled as centralised in the README.

## Tests that must pass before mainnet
Keep pays the staker. Break by staker. Break by verifier. Forfeit fails before the deadline and passes after it. Each of the following must fail: a high-fee forfeit, a wrong output address, a KEEP datasig replayed from another pledgeId, a two-pledge bundle, and keep with only one signature.

**Verdict:** the model is sound for v1. "Can't reclaim alone, can't be stolen, forfeit needs no one" holds as long as the fee bound, per-input output pinning and pledgeId in datasigs are all there. The real trust assumption is the human verifier, and the deck should say so plainly.

## v2: verifier quorum (contracts/VouchQuorum.cash)

Same four paths; the verifier becomes a group of N = 1..5 keys with a threshold M = 1..N.

- **keep** = staker sig + any M verifier sigs; **breakByVerifier** = any M verifier sigs; **breakByStaker** and **forfeit** unchanged. Every path keeps v1's per-input output pinning and `maxFee` bound, and adds `tx.outputs[i].tokenCategory == tx.inputs[i].tokenCategory`.
- **Slots:** five fixed pubkey slots, signature `s_i` only ever checked against `v_i`, so one key counts once. Unused slots are pinned NUMS keys nobody can sign for. Missing signatures are empty pushes; a non-empty invalid one fails the script (NULLFAIL), so clients verify every collected signature before broadcasting.
- **Who can do what:** fewer than M verifiers can only withhold (then it forfeits at the deadline). M verifiers can keep (with the staker) or break. No set of verifiers can pay anyone but the staker or the beneficiary: verifiers can grief, never steal.
- **Collusion:** M verifiers + the beneficiary can lie "broken"; the UI refuses any verifier whose P2PKH is the beneficiary. Staker + M verifiers can lie "kept".
- **Replay:** signatures commit to the pledge outpoint and its redeem script (which contains the pledgeId), so they don't carry over to another pledge, another lock, or the other spend path.
- **Duplicates:** refused off-chain (create form, link decoder, contract constructor helper, server); not re-checked on-chain, to keep the script under 520 bytes.
- **Old pledges:** stored pledges and links without `version: 2` load the v1 `Vouch` artifact exactly as before; its bytecode and a known chipnet address are pinned by tests.

## v1.1 / v2.1: verifier-only refund (contracts/Vouch11.cash, contracts/VouchQuorum21.cash)

New pledges drop the staker's signature from `keep`. Everything else is unchanged.

| Path | v1 / v2 (pledges locked before this) | v1.1 / v2.1 (new pledges) |
|---|---|---|
| keep | staker sig + verifier sig (v2: + any M) | verifier sig (v2.1: any M of N) |
| breakByStaker, breakByVerifier, forfeit | as above | identical |

Why it's safe:
- **The refund destination is fixed at lock time.** `keep` requires `tx.outputs[activeInputIndex].lockingBytecode == P2PKH(hash160(stakerPk))`; `stakerPk` is a constructor arg, so it's baked into the address before anything is locked. The verifier(s) can sign the refund, but it can only pay the staker. Same fee bound (`>= input - maxFee`) and, for v2.1, the same token-category guard.
- **No new theft path.** Every path still pays either the staker (keep) or the beneficiary (break, forfeit). The only new power is "the verifier(s) can refund the staker without the staker's consent", which costs the staker nothing.
- **Replay:** unchanged. A verifier signature is `SIGHASH_ALL | SIGHASH_UTXOS` over one outpoint and one output, so it can't move to another pledge or become a break (different output).
- **Keep vs forfeit race:** unchanged; keep has no deadline guard (as in v1), the app and the demo verifier stop approving at deadline minus ~1 hour.
- **Demo verifier griefing:** with no staker signature, a demo-verifier refund would otherwise be triggerable by anyone who knows the terms (the wall shows them), ending someone's pledge early (a "kept" they didn't earn). So for v1.1 / v2.1 the demo verifier requires the staker's listSecret proof (the pledge id commits to `sha256(listSecret)`), which only the creating browser holds. A friend verifier needs no such proof: their own judgement is the check.
- **Backward compatibility:** the version is part of the contract address, so it's stored with the pledge as `verifierRefund: true`. A pledge without it rebuilds the original artifact and keeps the original two-signature refund; `test/verifier-refund.test.ts` pins the original addresses, including the real chipnet lock a0a255e4…07ea.

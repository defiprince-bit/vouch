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

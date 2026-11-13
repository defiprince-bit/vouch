# CommitCash

**Stake BCH on a habit. Keep the streak, the covenant returns your coins. Break it, the stake pays someone else.**

A CashScript covenant on Bitcoin Cash + a Next.js app. Built for BCH BLAZE 2026 (Mainnet track). Chipnet by default; mainnet only with `NEXT_PUBLIC_BCH_NETWORK=mainnet`, dust amounts only.

## How it works in 30 seconds

Each pledge is its own contract address (`contracts/CommitCash.cash`), fixed at creation:
`stakerPk, verifierPk, beneficiaryLock, deadline, pledgeId (16 random bytes), maxFee`.

| Path | Who authorises | Where the coins can go (enforced on-chain) | When |
|---|---|---|---|
| `keep` | staker sig **and** verifier sig | staker's P2PKH only | any time |
| `breakByStaker` | staker sig (admits it) | beneficiary only | any time |
| `breakByVerifier` | verifier sig | beneficiary only | any time |
| `forfeit` | **nobody**: anyone can broadcast | beneficiary only | `tx.time >= deadline` |

Every path:
- pays to `tx.outputs[this.activeInputIndex]`, so two pledges can't be bundled into one transaction that pays out only once;
- requires `output value >= input value - maxFee`, so nobody (above all a signature-less `forfeit` broadcaster) can burn the stake into miner fees.

## Trust model (why it's sound)

- **Staker alone** can break (stake goes to the beneficiary) but can never take the coins back. That's the product.
- **Verifier alone** can force a break (griefing) but can't steal: every path pays either the staker or the beneficiary. The verifier is a liveness dependency: no keep signature before the deadline means the stake forfeits.
- **Beneficiary** has no power before the deadline. After it, anyone (beneficiary, app, stranger) can push `forfeit`, so nobody needs to stay online.
- **Collusion:** verifier + beneficiary can lie "broken" (the UI refuses verifier = beneficiary). Staker + verifier can lie "kept"; that's inherent, so it's a bet, not a guarantee. Staker = verifier is allowed and labelled a self-honour pledge.
- **Replay:** verifier approval is a transaction signature (`checkSig`, default `SIGHASH_ALL | SIGHASH_UTXOS`), which commits to the exact outpoint being spent. A verifier signature for pledge A can't be reused on pledge B (there's a test for this). We use `checkSig` rather than `checkDataSig` because WizardConnect only supports transaction signing (`sign_transaction_request`); it has no raw-message signing.
- **Keep vs forfeit race:** script can't say "before T", so keep stays valid after the deadline, and once it passes, whichever valid tx miners see first wins. The app tells the verifier to sign before deadline minus 1 hour.
- **Default verifier:** if the user doesn't name a friend, the CommitCash demo verifier key is used. That is centralised, and we say so.

Full one-pager: [`trust-model.md`](trust-model.md).

## Develop

```bash
npm install
npm test               # 20 MockNetworkProvider tests for every path + attack
npm run build
npm run dev
npm run compile:contract   # after editing contracts/CommitCash.cash
```

### Chipnet end-to-end

```bash
npm run keys                     # throwaway chipnet keys -> .env.local (gitignored)
npm run chipnet:status           # shows the staker address to fund
# fund it from a chipnet faucet, then:
npm run chipnet:run              # lock -> keep, lock -> forfeit (real chipnet txs)
CHIPNET_PROVIDER=rest npm run chipnet:run   # if Electrum ports are blocked (HTTPS via mainnet.cash, watch-only)
```

Recorded chipnet runs (13 Nov 2026):

| Step | txid |
|---|---|
| lock (keep pledge) | [c36f21ba…b115](https://chipnet.imaginary.cash/tx/c36f21baceb7017e56ac8482dd1a8e3f7bfa9978011adf4baf753eccafedb115) |
| keep → staker | [b088db2f…6dbe](https://chipnet.imaginary.cash/tx/b088db2f4695df54ea50049a7f188daba9c7c8fee07738157f4953556d306dbe) |
| lock (forfeit pledge) | [b8185ef5…84af](https://chipnet.imaginary.cash/tx/b8185ef5c0dd247001a116caaeee970d38b8dd20963625c19fcd4e119be184af) |
| forfeit → beneficiary (no signature, after deadline) | [771e768d…3068](https://chipnet.imaginary.cash/tx/771e768d99fe5d384635c1c4fdff9bac233767e21726f1992f05518efce13068) |
| lock (verifier-break pledge) | [b0711964…ee7d](https://chipnet.imaginary.cash/tx/b07119645843618e0fbdb450e752163e4dac079c9f5977a359f1952b34cdee7d) |
| breakByVerifier → beneficiary | [fc163b6d…8a6e](https://chipnet.imaginary.cash/tx/fc163b6d741c81c3bcef0fa86abad964cd2961f6ca128a7ccfe22271de7b8a6e) |

## Wallet connect

[WizardConnect](https://docs.riftenlabs.com/wizardconnect/) (`@wizardconnect/react`): the **Connect Wallet** button opens the QR dialog; the staker key is the wallet's first `receive` pubkey. Signing the lock / keep / break transactions through `manager.signTransaction(...)` is the next step (see the TODOs in `src/app/create/CreatePledgeForm.tsx` and `src/app/pledges/PledgeList.tsx`). `forfeit` needs no signature, so the app can settle it directly.

## License

MIT (to add). WizardConnect is LGPL-3.0-or-later (used unmodified as a dependency).

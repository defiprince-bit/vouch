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
- **Demo verifier = operated by this app.** If you don't name a friend, your verifier is the *CommitCash demo verifier*: a key held server-side by whoever runs this deployment (`COMMITCASH_VERIFIER_WIF`). It is centralised and confirm-based: it co-signs "kept" when you tick a confirm box and write a short note, before deadline minus ~1 hour. It does not check that you actually did the thing. If you want real accountability, name a friend.
- **Demo verifier "break"** is honour-based too (it signs breakByVerifier on request), so anyone who knows a demo pledge's terms could ask it to break that pledge. Coins still only go to the beneficiary you chose. For the hackathon demo that's the accepted trade-off; a friend verifier doesn't have it.

Full one-pager: [`trust-model.md`](trust-model.md).

## Develop

```bash
npm install
npm test               # 34 tests: 20 covenant paths/attacks + 14 wallet-flow tests (mock WizardConnect wallet)
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

### App end-to-end (chipnet, through the running app's API routes)

```bash
npm run build && npx next start -p 3311
npm run e2e:app -- http://localhost:3311 all    # keep1 | keep2 | settle | all
```

`scripts/e2e-app.mts` plays the wallet with the throwaway keys, builds the exact WizardConnect sign requests the app sends, and talks to `/api/chain/*`, `/api/verifier`, `/api/settle`. Recorded runs (13 Nov 2026):

| Flow | lock | spend |
|---|---|---|
| keep, demo verifier signs first, wallet completes + broadcasts | [5d53c4bb…adf4](https://chipnet.imaginary.cash/tx/5d53c4bbe5d04cc764c41092aff3500886eab294924f73a9c4282a3c3880adf4) | [ee61efe5…2dbb](https://chipnet.imaginary.cash/tx/ee61efe57b340187ad1659319fea07613c4bc78043ba95804855cff3ae3a2dbb) → staker |
| keep, staker pre-signs (verify link), verifier completes + broadcasts | [ee515238…351c](https://chipnet.imaginary.cash/tx/ee51523823edea99f21e65c543a27521725070ae76c942d1e2c3209edf31351c) | [1f3d5173…4919](https://chipnet.imaginary.cash/tx/1f3d51735f4fc08330d78dbde6031c82d5310181403439d81abd54a541594919) → staker |
| expired pledge auto-settled by `/api/settle` | [2a570cc0…d981](https://chipnet.imaginary.cash/tx/2a570cc0607556ca28606c8419b17516481e74fd68f2e0a054e0b3539194d981) | [4c7cb19a…5a5c](https://chipnet.imaginary.cash/tx/4c7cb19a983b0968aaa1206e134b804d723d2fa3dc180d26239b21d482995a5c) → beneficiary |

## Wallet connect and the flows

[WizardConnect](https://docs.riftenlabs.com/wizardconnect/) (`@wizardconnect/react`): **Connect Wallet** opens a QR dialog (with a copy-link option for desktop wallets). The staker key is the wallet's first `receive` pubkey. Every signature is a normal transaction signature via `sign_transaction_request` (`SIGHASH_ALL|UTXOS|FORKID`); WizardConnect has no message signing.

- **Lock:** the app builds the funding tx from your wallet's UTXOs (placeholder P2PKH unlockers); your wallet signs and broadcasts.
- **Keep, demo verifier:** you confirm + write a note → `/api/verifier` checks the pledge on-chain and returns its signature → your wallet signs the keep tx and broadcasts. Coins go back to your address.
- **Keep, friend verifier:** your wallet pre-signs the keep tx (not broadcast) → the app makes a **verify my pledge** link (`/verify#…`, everything in the URL fragment, never sent to our server) → your friend opens it, connects their wallet, and **approves by signing the refund in their wallet**, which broadcasts it. Your friend gets their verifier key to share from `/verifier-key`.
- **Break:** you sign breakByStaker (stake to the beneficiary); a friend verifier can also rule it broken from the verify link.
- **Settle:** after the deadline, `forfeit` needs no signature. The pledges page auto-broadcasts it for expired pledges it knows about (browser first, `/api/settle` as backup), and keeps a manual **Settle to beneficiary** button.
- **Verify by:** the UI asks for approval by deadline − 6 blocks (~1 hour), and the demo verifier refuses after that, to avoid the keep/forfeit race.

### Chain access

The browser uses Electrum over wss by default. If that fails to connect, it falls back to the app's HTTPS route `/api/chain/{height,utxos,tx,broadcast}`, which uses mainnet.cash's watch-only REST (no keys leave the browser). `NEXT_PUBLIC_BCH_PROVIDER=rest` forces HTTPS; `electrum` disables the fallback. A rejected broadcast is never retried on the other backend.

## Environment variables

See [`.env.example`](.env.example). For a deployment:

| Name | Where | What |
|---|---|---|
| `NEXT_PUBLIC_BCH_NETWORK` | public | `chipnet` (default) or `mainnet` |
| `NEXT_PUBLIC_BCH_PROVIDER` | public | `auto` (default), `electrum`, `rest` |
| `NEXT_PUBLIC_SLIDES_URL`, `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_EMBER_ADDRESS` | public | banner links |
| `COMMITCASH_VERIFIER_WIF` | **server-only** | the app-operated demo verifier key. Never `NEXT_PUBLIC_`. Unset = demo verifier off |

## License

MIT (to add). WizardConnect is LGPL-3.0-or-later (used unmodified as a dependency).

# Vouch

**Put your money where your mouth is.** Deliver, and you get your money back. Don’t, and your coins go to whoever you picked.

A CashScript covenant on Bitcoin Cash + a Next.js app. Built for BCH BLAZE 2026 (Mainnet track). Chipnet by default; mainnet only with `NEXT_PUBLIC_BCH_NETWORK=mainnet`, dust amounts only.

## How it works in 30 seconds

Each pledge is its own contract address (`contracts/Vouch.cash`), fixed at creation:
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
- **Demo verifier = operated by this app, honour system.** If you don't name a friend, your verifier is the *Vouch demo verifier*: a key held server-side by whoever runs this deployment (`COMMITCASH_VERIFIER_WIF`). It co-signs **keep** for whoever asks (after a confirm box and a short note, before deadline minus ~1 hour); it does not check that you did the thing. It's for trying the app. **For a real pledge, name a friend as verifier.**
- **The demo verifier never signs a break.** `/api/verifier` can't authenticate its caller, so if it signed `breakByVerifier`, anyone holding a pledge's terms (the beneficiary included) could force a demo pledge to break. It refuses `action: "break"` (HTTP 403, covered by a test). A demo pledge ends only by keep, by expiry (`forfeit`), or by the staker's own `breakByStaker`, which the staker signs alone in their wallet.
- **Wall listing needs the creating browser's secret, not a signature.** Anyone with a verify link has the pledge's terms and the staker's keep pre-signature, so neither can prove "I'm the staker" (and WizardConnect has no message signing to make a separate proof). Instead the pledge id commits to a nonce, the habit and `sha256(listSecret)`; the secret stays in the staker's browser storage. A link holder can't list an unlisted pledge, and can't front-run by registering their own secret first, because the contract already pins the secret's hash, so registration order doesn't matter. The committed habit can't be swapped at listing time either. Pledges made before this (random ids) can't be newly listed by anyone; the chipnet seed rows were inserted directly. Clearing site data or switching devices loses the ability to list (the pledge itself is unaffected).

Full one-pager: [`trust-model.md`](trust-model.md).

## Verifier quorum (M of N)

New pledges can name a **group** of 1–5 verifiers and how many must approve: 2 of 3, 3 of 5, 4 of 5, 1 of 5… (the demo verifier can be one of them on chipnet). These use a second contract, [`contracts/VouchQuorum.cash`](contracts/VouchQuorum.cash); single-verifier pledges keep using `Vouch.cash` unchanged, so every existing pledge and link still works (the stored pledge and the link carry `version: 2` for quorum pledges).

- **keep:** staker + any M verifier signatures → stake back to the staker. **breakByVerifier:** any M verifiers → beneficiary. `breakByStaker` and `forfeit` are unchanged.
- **One contract, five slots:** verifiers sit in fixed slots `v0..v4`, each matched to its own signature argument, and the contract counts `checkSig(s_i, v_i)` against the threshold. Unused slots hold pinned "nothing up my sleeve" keys (`02 || sha256("vouch/unused-verifier-slot/<i>/<n>")`), so nobody can sign for them. An absent signature is an empty push (counts 0); any non-empty invalid one fails the whole script (NULLFAIL). `checkMultiSig` wasn't used: wallets sign Schnorr, and the threshold has to be a constructor parameter. The compiled script is ≤ 520 bytes even with five slots and a P2SH32 beneficiary (tested), and a 5-of-5 keep tx is under 1 KB, inside the fixed 1,500-sat fee.
- **Tokens:** every v2 path also requires the payout to carry the pledge input's token category (none for app-made stakes), so no spend can strip CashTokens off a pledge UTXO.
- **No double counting:** a verifier's signature only verifies in their own slot. Duplicate keys are refused by the create form, by link decoding, by `createQuorumContract` and by the server; the contract itself doesn't re-check distinctness (10 pairwise checks would push it past 520 bytes), which only matters for a pledge someone builds outside the app, and the verify page refuses those.
- **Replay:** each signature is a tx signature (`SIGHASH_ALL|UTXOS|FORKID`) over the one deterministic spend (that pledge's outpoint, its redeem script with the pledgeId, one fixed output, fixed fee), so it can't be used on another pledge, another lock of the same pledge, or the other path (a keep signature isn't a break vote).
- **Signing without a backend (link relay):** the staker pre-signs the refund and gets **one link** for the whole group. Any verifier opens it, signs their slot in their wallet, and gets an updated link carrying their signature to pass to the next verifier (or back to the staker, who can paste it on the pledge page). Order doesn't matter; partial links merge slot by slot. Every signature in a link is checked against the sighash before it's shown or used, and whoever completes M of N broadcasts. All of it travels in the URL fragment.
- **Griefing, not theft:** as before, verifiers can only ever send the stake to the staker (keep) or the beneficiary (break). M colluding verifiers can force a break; fewer than M can only withhold, and then the pledge forfeits at the deadline.

```bash
npm run chipnet:quorum           # real chipnet 2-of-3 keep (sigs collected one at a time) + 2-of-3 verifier break
npx tsx scripts/e2e-quorum-app.mts http://localhost:3311   # 2-of-3 with the app's demo verifier as one of the three
```

Recorded quorum runs on chipnet (19 Nov 2026):

| Flow | lock | spend |
|---|---|---|
| 2-of-3 keep, staker pre-signs, verifier 3 then verifier 1 sign separately | [d33425c0…71de](https://chipnet.imaginary.cash/tx/d33425c071c52ba3ef38066d55bdf3f04ab9a9c6a4a9be9114fc201afdaf71de) | [9b716c9b…8448](https://chipnet.imaginary.cash/tx/9b716c9b685943f30fbf7cf387b8058428ad3514c4c179af0cf0849306b78448) → staker |
| 2-of-3 breakByVerifier (verifiers 2 + 3) | [3101159c…9e62](https://chipnet.imaginary.cash/tx/3101159c5785fa7f8a470323031d30496605ca85cfd08ebc8ba73cd3cf009e62) | [6076d727…87ea](https://chipnet.imaginary.cash/tx/6076d72769203fcb178ca50fcb1cbf3b30b35ef07f5795190e24fd40ad7887ea) → beneficiary |
| 2-of-3 keep through the app: `/api/verifier` (demo slot) + a wallet-signed slot via the link | [bff62eeb…27a0](https://chipnet.imaginary.cash/tx/bff62eeb89f5c839ce22bbb69bd5e8212563b131a3e4f335fb7eaa96463527a0) | [cc183853…d31e](https://chipnet.imaginary.cash/tx/cc183853d9c6f4965267b5ec222f6520c025c3ad0e8645aa86faf61a245ad31e) → staker |
| Same, re-run after the WizardConnect hex-payload fix (sign requests carry the tx as hex) | [3ae2d542…f7ed](https://chipnet.imaginary.cash/tx/3ae2d5424ddeeaa169c5287d24cb0d85c4233dda65e652fbc685390cf106f7ed) | [28db3837…f59a](https://chipnet.imaginary.cash/tx/28db38379d3e98bae7ee50b410dbee5f115f0b58d8e5c47d720449f0ee23f59a) → staker |

## Develop

```bash
npm install
npm test               # covenant paths/attacks (v1 + quorum), wallet flows with a mock WizardConnect wallet, network + rate-limit helpers
npm run build
npm run dev
npm run compile:contract   # after editing contracts/Vouch.cash or contracts/VouchQuorum.cash
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
- **Keep, demo verifier (honour system):** you confirm + write a note → `/api/verifier` checks the pledge on-chain and returns its signature → your wallet signs the keep tx and broadcasts. Coins go back to your address. The demo verifier approves any refund you ask for; for real stakes, pick a friend.
- **Keep, friend verifier:** your wallet pre-signs the keep tx (not broadcast) → the app makes a **verify my pledge** link (`/verify#pledge=…`, everything in the URL fragment, never sent to our server) → your friend opens it, connects their wallet, and **approves by signing the refund in their wallet**, which broadcasts it. Your friend gets their verifier key to share from `/verifier-key`.
- **Break:** staker only in the app: you sign breakByStaker yourself (stake to the beneficiary). The demo verifier never breaks. (The contract still has `breakByVerifier`, so a friend verifier could sign one with their own key, but the UI doesn't offer it.)
- **Settle:** after the deadline, `forfeit` needs no signature. The pledges page auto-broadcasts it for expired pledges it knows about (browser first, `/api/settle` as backup), and keeps a manual **Settle to beneficiary** button.
- **Verify by:** the UI asks for approval by deadline − 6 blocks (~1 hour), and the demo verifier refuses after that, to avoid the keep/forfeit race.

### Chain access

The browser uses Electrum over wss by default. If that fails to connect, it falls back to the app's HTTPS route `/api/chain/{height,utxos,tx,broadcast}`, which uses mainnet.cash's watch-only REST (no keys leave the browser). `NEXT_PUBLIC_BCH_PROVIDER=rest` forces HTTPS; `electrum` disables the fallback. A rejected broadcast is never retried on the other backend.

## Pages

`/` landing · `/create` new pledge · `/pledges` your pledges (this browser) · `/pledges/<id>` one pledge's status (countdown, Your move, Settle) · `/verify#pledge=…` a friend signs the refund (pledge data stays in the URL fragment, never sent to the server; a `?pledge=` link is accepted and moved into the fragment) · `/verifier-key` get a key to be someone's verifier · `/wall` listed pledges per network, with figures.

UI follows the design pack in `bchblaze/design/mocks`; `node scripts/sync-design-css.mjs <path/to/styles.css>` re-syncs its stylesheet into `src/app/design.css` (app tweaks live in `src/app/app.css`). Brand files are in `public/brand/`; swap the logo in `src/components/Logo.tsx`.

## The wall (`/wall`)

A pledge is **Listed on the wall** or **Unlisted** (field `visibility`: `public | unlisted`; chipnet defaults to listed, mainnet to unlisted). Unlisted pledges stay off the wall, but the coins, amount and payout are still visible on-chain to anyone with the address.

- **Who can list: only the browser that created the pledge.** At create time the browser makes a random 32-byte `listSecret` and a 16-byte nonce and keeps them **only** in its own pledge storage (localStorage); they never go into a verify link, a share URL, or anywhere but `POST /api/wall`. The pledge id, which is a contract constructor argument and so part of the contract address, commits to them: `pledgeId = sha256("vouch-wall-list:v1" || nonce || habit || sha256(listSecret))[0..16)`. To list, the browser sends `POST /api/wall {pledge terms, listSecret, listNonce, habit}`; the server rebuilds the contract (address and network must match), checks that sha256(listSecret), the nonce and the habit rebuild the pledge id, requires a lock on chain, and stores `sha256(listSecret)` (never the secret). A listed-at-create pledge is registered and listed in one call right after the lock; "List on the wall" on the pledge page works later from the same browser.
- **Registry.** Turso database `vouch-wall`, table `listings` (terms, network, habit, staker key, contract address, version, created time, `list_secret_hash` = sha256(listSecret), last derived state + `checked_at`). Only listed pledges are stored. `pledge_id` is the primary key and `contract_address` is unique.
- **Everything shown is derived from the chain**: active = the contract UTXO is unspent; kept = the spend paid the staker; paid = the spend paid the beneficiary (ruled broken, or forfeited after the deadline). Figures per network: vouches made, BCH locked (active only), kept and paid counts. Cards never show the beneficiary; the staker is a shortened address. Final states are stored and not re-read; active ones are re-read after 60 s. `GET /api/wall?network=` is edge-cached (`s-maxage=45, stale-while-revalidate=300`).
- **Spam guards.** Habit 1–140 characters (control/bidi characters removed; rendered escaped). At most 5 active listings per staker key. Listing attempts are rate-limited in Turso (`list_attempts`): 10 per hour per hashed IP, 8 per hour per staker key.
- **Pulling a listing** without a redeploy: in the Turso shell (`turso db shell vouch-wall`) run `UPDATE listings SET hidden = 1 WHERE pledge_id = '<pledge id hex>';` (set back to `0` to restore). Hidden rows are left out of the wall and the figures within a minute or so (the edge cache).
- **Seed.** The chipnet wall is seeded with the 10 README test pledges (tagged "test run"); their terms were rebuilt from their spend transactions by `scripts/recover-legacy.mts`. Without the Turso variables the app serves just these seeds and `POST /api/wall` answers 503.
- **Empty mainnet.** If nothing is listed on mainnet, the wall shows chipnet with a note.

## Environment variables

See [`.env.example`](.env.example). For a deployment:

| Name | Where | What |
|---|---|---|
| `NEXT_PUBLIC_BCH_NETWORK` | public | `chipnet` (default) or `mainnet` |
| `NEXT_PUBLIC_BCH_PROVIDER` | public | `auto` (default), `electrum`, `rest` |
| `NEXT_PUBLIC_SLIDES_URL`, `NEXT_PUBLIC_REPO_URL`, `NEXT_PUBLIC_EMBER_ADDRESS` | public | banner links |
| `DEMO_VERIFIER_MAINNET` | **server-only** | `1` lets the demo verifier sign mainnet pledges. Unset (default): it's chipnet-only, `/api/verifier` answers 403 for mainnet and the create form requires a friend or group there. |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | **server-only** | the wall registry (`libsql://vouch-wall-….turso.io` and a database token). Unset = the wall shows only the chipnet seeds and listing is off. Never `NEXT_PUBLIC_`. |
| `WALL_IP_SALT` | **server-only** | optional salt for the hashed IPs in `list_attempts`. |
| `COMMITCASH_VERIFIER_WIF` | **server-only** | the app-operated demo verifier key (co-signs keep only). Never `NEXT_PUBLIC_`. Unset = demo verifier off. *Legacy name from before the rename to Vouch; kept as is because it's already set on Vercel.* |

## Known limits

- **The verify page shows the stake from the link.** The amount on a `/verify` page comes from the link's `stakeSats`; what a verifier signs is bound to the real locked UTXO (its outpoint and value are in the sighash), so a wrong number can't move different coins, but the page doesn't re-read the amount from the chain before showing it.
- **Upstream error text leaks.** Errors from the chain backends (Electrum / mainnet.cash) are passed to the browser mostly as-is, so they can expose upstream hostnames or messages.
- **Rate limiting is per server instance.** `/api/*` has a simple in-memory per-IP limit (600/min for `/api/chain`, 30/min for the signing routes, in `src/proxy.ts`). On Vercel each instance counts separately, so it slows hammering rather than hard-capping it.
- **Quorum shape rules are enforced off-chain.** The contract counts valid signatures per slot; the create form, the `/verify` page and the server all refuse a quorum where M is outside 1..(number of real verifiers, padding slots excluded), a key appears twice, or the staker's own key sits in a verifier slot. A hand-built contract that breaks these rules isn't something the app will make, sign for, or show as valid. Checking them in the script would exceed the 520-byte limit.
- **The token rule compares the category only.** `VouchQuorum` requires each output's `tokenCategory` to equal its input's, but doesn't compare the token amount or NFT commitment. The app never creates token pledges (it locks plain BCH), and checking more would push the script past 520 bytes.
- **M verifiers can force a break.** The same M that approves a refund can instead sign `breakByVerifier` and send the stake to the beneficiary. With 1 of N, any single verifier can do it alone; the create and verify pages say so.
- **Deadlines are block heights.** The create form, links and the server refuse a deadline ≥ 500,000,000 (that would be a clock time) and the create form one within 6 blocks of now.
- **Pledges live in one browser.** The pledge list and collected quorum signatures are in localStorage; links are the only way they travel.

## License

MIT, see [`LICENSE`](LICENSE). Copyright (c) 2026 Douglas Godwin Michael. WizardConnect is LGPL-3.0-or-later (used unmodified as a dependency).

## Renamed from CommitCash

The project was called CommitCash until 13 Nov 2026. The contract is now `contracts/Vouch.cash` (`contract Vouch`); renaming it did not change the compiled bytecode (identical, checked against the pre-rename artifact), so pledges and contract addresses created before the rename still work, and the chipnet txids above are still valid. Two names stay on purpose: the env var `COMMITCASH_VERIFIER_WIF`, and the old browser storage key `commitcash-pledges`, which is still read so earlier pledges show up.

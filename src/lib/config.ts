// Public config. Chipnet by default; mainnet only when NEXT_PUBLIC_BCH_NETWORK=mainnet.
export const NETWORK = process.env.NEXT_PUBLIC_BCH_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';
export const IS_MAINNET = NETWORK === 'mainnet';
export const EXPLORER_TX = IS_MAINNET ? 'https://explorer.bitcoinunlimited.info/tx/' : 'https://chipnet.imaginary.cash/tx/';
export const EXPLORER_ADDR = IS_MAINNET ? 'https://explorer.bitcoinunlimited.info/address/' : 'https://chipnet.imaginary.cash/address/';

// Banner links (BCH BLAZE requirement). TODO before submission: fill these in.
export const SLIDES_URL = process.env.NEXT_PUBLIC_SLIDES_URL ?? '#slides-todo';
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? '#repo-todo';
export const EMBER_ADDRESS = process.env.NEXT_PUBLIC_EMBER_ADDRESS ?? 'bitcoincash:z…(EMBER2026 CashTokens address TODO)';

// Default verifier = CommitCash demo verifier key (centralised; see README). Users can paste a friend's pubkey instead.
export const DEFAULT_VERIFIER_PUBKEY = process.env.NEXT_PUBLIC_VERIFIER_PUBKEY ?? '';

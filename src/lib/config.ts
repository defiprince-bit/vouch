// Public config. Chipnet by default; mainnet only when NEXT_PUBLIC_BCH_NETWORK=mainnet.
export const NETWORK = process.env.NEXT_PUBLIC_BCH_NETWORK === 'mainnet' ? 'mainnet' : 'chipnet';
export const IS_MAINNET = NETWORK === 'mainnet';
export const EXPLORER_TX = IS_MAINNET ? 'https://explorer.bitcoinunlimited.info/tx/' : 'https://chipnet.imaginary.cash/tx/';
export const EXPLORER_ADDR = IS_MAINNET ? 'https://explorer.bitcoinunlimited.info/address/' : 'https://chipnet.imaginary.cash/address/';

// Banner links (BCH BLAZE requirement). TODO before submission: fill these in.
export const SLIDES_URL = process.env.NEXT_PUBLIC_SLIDES_URL ?? '#slides-todo';
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL ?? '#repo-todo';
export const EMBER_ADDRESS = process.env.NEXT_PUBLIC_EMBER_ADDRESS ?? 'bitcoincash:z…(EMBER2026 CashTokens address TODO)';

// The demo verifier's public key is served by GET /api/verifier (its private key is server-only).

// Public config. The deployment default network is chipnet unless NEXT_PUBLIC_BCH_NETWORK=mainnet;
// users can switch at runtime (see lib/network.ts + useNetwork), so use the hook for the active one.
import { defaultNetwork } from './network';

export const DEFAULT_NETWORK = defaultNetwork();

// Banner links (BCH BLAZE requirement). Empty or unset = the banner hides that item.
export const SLIDES_URL = process.env.NEXT_PUBLIC_SLIDES_URL || '';
export const REPO_URL = process.env.NEXT_PUBLIC_REPO_URL || '';
export const EMBER_ADDRESS = process.env.NEXT_PUBLIC_EMBER_ADDRESS || '';

// The demo verifier's public key is served by GET /api/verifier (its private key is server-only).

// Generate throwaway CHIPNET test keys into .env.local (gitignored). Never use these on mainnet.
import { existsSync, readFileSync, appendFileSync } from 'node:fs';
import { generatePrivateKey, encodePrivateKeyWif } from '@bitauth/libauth';

const file = '.env.local';
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';
const names = ['CHIPNET_STAKER_WIF', 'CHIPNET_VERIFIER_WIF', 'CHIPNET_BENEFICIARY_WIF'];
let added = 0;
for (const name of names) {
  if (current.includes(`${name}=`)) continue;
  appendFileSync(file, `${name}=${encodePrivateKeyWif(generatePrivateKey(), 'testnet')}\n`);
  added++;
}
// The app's demo verifier (server-only env var). Locally it reuses the chipnet verifier key so
// scripts and the running app agree; on Vercel set COMMITCASH_VERIFIER_WIF to a fresh WIF.
const now = readFileSync(file, 'utf8');
if (!now.includes('COMMITCASH_VERIFIER_WIF=')) {
  const v = now.match(/^CHIPNET_VERIFIER_WIF=(.+)$/m)?.[1];
  appendFileSync(file, `COMMITCASH_VERIFIER_WIF=${v}\n`);
  added++;
}
console.log(added ? `Added ${added} chipnet test key(s) to ${file}` : `${file} already has chipnet keys`);

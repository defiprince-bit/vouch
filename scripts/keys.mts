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
console.log(added ? `Added ${added} chipnet test key(s) to ${file}` : `${file} already has chipnet keys`);

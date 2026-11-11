/**
 * Generates the operator's server-side trading wallet.
 * Writes the secret ONLY to .secrets/trading-wallet.json (chmod 600, solana-keygen format)
 * and prints ONLY the public address. Refuses to overwrite an existing wallet.
 */
import { Keypair } from '@solana/web3.js';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.cwd(), '.secrets');
const file = path.join(dir, 'trading-wallet.json');
if (fs.existsSync(file) && !process.argv.includes('--force')) {
  const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
  console.log(`Wallet already exists. Public address: ${kp.publicKey.toBase58()}`);
  process.exit(0);
}
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
fs.chmodSync(dir, 0o700);
const kp = Keypair.generate();
fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
fs.chmodSync(file, 0o600);
console.log(`Generated operator trading wallet. Public address: ${kp.publicKey.toBase58()}`);
console.log('Secret saved to .secrets/trading-wallet.json (chmod 600). Back it up offline. Never commit it.');

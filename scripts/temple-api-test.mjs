#!/usr/bin/env node
/**
 * Smoke-test Temple REST with SDK 1.x auth:
 * - Primary: TEMPLE_API_EMAIL + TEMPLE_API_PASSWORD → /auth/login → Bearer token
 * - Fallback: TEMPLE_API_KEY (sent as Authorization: Bearer <key> by the SDK)
 *
 * Run: npm run test:temple-api   (from trading-server/)
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initialize, getTicker } from '@temple-digital-group/temple-canton-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
config({ path: resolve(root, '.env') });

const network = (process.env.NETWORK || 'testnet').trim();
const symbol = (process.env.TEMPLE_TEST_SYMBOL || 'Amulet/USDCx').trim();
const email = process.env.TEMPLE_API_EMAIL?.trim();
const password = process.env.TEMPLE_API_PASSWORD?.trim();
const apiKey = process.env.TEMPLE_API_KEY?.trim();

async function main() {
  if (email && password) {
    const loginRes = await initialize({
      NETWORK: network,
      API_EMAIL: email,
      API_PASSWORD: password,
    });
    if (loginRes && typeof loginRes === 'object' && loginRes.error) {
      console.error('Login failed:', JSON.stringify(loginRes, null, 2));
      process.exit(1);
    }
    console.log('Temple REST test (SDK 1.x): Bearer from email/password login');
  } else if (apiKey) {
    await initialize({ NETWORK: network, API_KEY: apiKey });
    console.log('Temple REST test (SDK 1.x): Bearer API_KEY');
  } else {
    console.error(
      'Set TEMPLE_API_EMAIL + TEMPLE_API_PASSWORD in .env (recommended).\n' +
        'Or TEMPLE_API_KEY if your environment accepts it.'
    );
    process.exit(1);
  }

  console.log('  NETWORK=', network);
  console.log('  getTicker(', symbol, ') ...\n');

  const data = await getTicker(symbol);
  if (data && typeof data === 'object' && data.error) {
    console.error('FAILED:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log('SUCCESS');
  console.log(JSON.stringify(data, null, 2).slice(0, 2500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

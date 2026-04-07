/**
 * Initialize Loop SDK and Temple Canton JS with WALLET_ADAPTER.
 * Temple Lightspeed: REST auth via TEMPLE_API_KEY only (no email/password).
 *
 * Required env: PRIVATE_KEY, PARTY_ID, LOOP_NETWORK, WALLET_URL, API_URL,
 * NETWORK, TEMPLE_API_KEY
 *
 * @see https://www.npmjs.com/package/@temple-digital-group/temple-canton-js/v/1.0.39
 */
import { config as loadDotenv } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loop } from '@fivenorth/loop-sdk/server';
import { initialize } from '@temple-digital-group/temple-canton-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: resolve(__dirname, '..', '.env'), override: true, quiet: true });

let initialized = false;
let partyId: string = '';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export async function ensureInitialized(): Promise<string> {
  if (initialized) return partyId;

  const privateKey = requireEnv('PRIVATE_KEY');
  const loopPartyId = requireEnv('PARTY_ID');
  const network = requireEnv('LOOP_NETWORK') as 'mainnet' | 'testnet' | 'local';
  const walletUrl = requireEnv('WALLET_URL');
  const apiUrl = requireEnv('API_URL');

  console.log(`[init] Using Loop API: ${apiUrl}, network: ${network}, party: ${loopPartyId.slice(0, 20)}...`);

  loop.init({
    privateKey,
    partyId: loopPartyId,
    network,
    walletUrl,
    apiUrl,
  });

  try {
    await loop.authenticate();
    console.log('[init] Loop authenticate OK');
  } catch (e: any) {
    console.error('[init] Loop authenticate failed:', e.message);
    throw e;
  }
  partyId = loop.getSigner().getPartyId();

  const templeNetwork = requireEnv('NETWORK');
  const apiKey = requireEnv('TEMPLE_API_KEY');

  await initialize({
    NETWORK: templeNetwork,
    WALLET_ADAPTER: loop as any,
    API_KEY: apiKey,
  });
  console.log('[init] Temple SDK initialized (REST: TEMPLE_API_KEY)');

  initialized = true;
  return partyId;
}

export function getPartyId(): string {
  if (!initialized) throw new Error('Not initialized; call ensureInitialized() first');
  return partyId;
}

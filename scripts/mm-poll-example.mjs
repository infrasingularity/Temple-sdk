#!/usr/bin/env node
/**
 * Minimal market-maker integration harness: polls your trading-server HTTP API
 * (same surface an MM bot would use). Does not place orders unless MM_PLACE_SAMPLE=1.
 *
 * Prereqs: npm run build && npm start (server on MM_BASE_URL)
 * Env: SERVER_API_KEY, optional MM_BASE_URL (default http://127.0.0.1:3001), MM_POLL_MS (default 5000)
 *
 * Example:
 *   MM_BASE_URL=http://127.0.0.1:3001 node scripts/mm-poll-example.mjs
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '..', '.env'), override: true });

const BASE = process.env.MM_BASE_URL || 'http://127.0.0.1:3001';
const KEY = process.env.SERVER_API_KEY?.trim();
const POLL_MS = Number(process.env.MM_POLL_MS) || 5000;
const SYMBOL = process.env.MM_SYMBOL || 'CC/USDCx';
const PLACE_SAMPLE = process.env.MM_PLACE_SAMPLE === '1' || process.env.MM_PLACE_SAMPLE === 'true';

if (!KEY) {
  console.error('Missing SERVER_API_KEY in .env');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${KEY}`,
  'Content-Type': 'application/json',
};

async function get(path) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: headers.Authorization } });
  const text = await res.text();
  try {
    return { status: res.status, data: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, data: text };
  }
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();
  try {
    return { status: res.status, data: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, data: text };
  }
}

async function tick() {
  const enc = encodeURIComponent(SYMBOL);
  const [ticker, book, orders] = await Promise.all([
    get(`/market/ticker?symbol=${enc}`),
    get(`/market/orderbook?symbol=${enc}&levels=5`),
    get(`/orders?limit=20`),
  ]);
  console.log(
    new Date().toISOString(),
    'ticker',
    ticker.status,
    'book',
    book.status,
    'orders',
    orders.status
  );
  if (ticker.data?.ticker && typeof ticker.data.ticker === 'object') {
    const t = ticker.data.ticker;
    console.log('  last?', t.last ?? t.lastPrice ?? JSON.stringify(t).slice(0, 120));
  }
  if (PLACE_SAMPLE && ticker.status === 200) {
    console.log('  MM_PLACE_SAMPLE: posting tiny limit (may fail on min size / balance)');
    const r = await post('/orders', {
      symbol: SYMBOL,
      side: 'Buy',
      quantity: '0.0001',
      pricePerUnit: '0.01',
      orderType: 'limit',
    });
    console.log('  sample POST /orders', r.status, r.data?.message || r.data?.error || 'ok');
  }
}

console.log('MM poll example →', BASE, 'symbol', SYMBOL, 'every', POLL_MS, 'ms');
console.log('Set MM_PLACE_SAMPLE=1 to attempt one buy per tick (use only on testnet / with care).\n');

await tick();
const id = setInterval(tick, POLL_MS);
process.on('SIGINT', () => {
  clearInterval(id);
  process.exit(0);
});

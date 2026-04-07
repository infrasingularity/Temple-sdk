#!/usr/bin/env node
/**
 * Subscribe to Temple WS trades:{SYMBOL} (and optionally orderbook) and log raw frames.
 * Usage (from trading-server/): TEMPLE_WS_LOG_MS=120000 node scripts/log-temple-ws-trades.mjs
 *
 * Needs .env: TEMPLE_WS_URL, TEMPLE_API_KEY
 * Optional: MM_SYMBOL (default CBTC/USDCx), TEMPLE_WS_LOG_MS (default 120000), TEMPLE_WS_CHANNELS=trades|both
 */
import WebSocket from 'ws';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

config({ path: resolve(root, '.env'), override: true });

const url = process.env.TEMPLE_WS_URL?.trim();
const key = process.env.TEMPLE_API_KEY?.trim();
const rawSym = process.env.MM_SYMBOL?.trim() || 'CBTC/USDCx';
const durationMs = Math.max(10000, Number(process.env.TEMPLE_WS_LOG_MS || 120000));
const channelsMode = (process.env.TEMPLE_WS_CHANNELS || 'trades').toLowerCase();

if (!url || !key) {
  console.error('Missing TEMPLE_WS_URL or TEMPLE_API_KEY in .env');
  process.exit(1);
}

let channels = [`trades:${rawSym}`];
if (channelsMode === 'both') {
  channels = [`orderbook:${rawSym}`, `trades:${rawSym}`];
}

console.log(
  JSON.stringify({
    note: 'Temple WS trade stream probe',
    durationMs,
    symbol: rawSym,
    channels,
    hint: 'If you see many trades with varied sizes/prices while idle, stream is likely public tape. If only updates around your fills, likely private.',
  })
);

const ws = new WebSocket(url, { headers: { 'X-API-Key': key } });

let msgCount = 0;

ws.on('open', () => {
  console.log('[ws] open, subscribing', channels);
  ws.send(JSON.stringify({ type: 'subscribe', channels }));
  // keepalive per arch
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 30000);
});

ws.on('message', (data) => {
  msgCount += 1;
  const line = typeof data === 'string' ? data : data.toString();
  let pretty;
  try {
    pretty = JSON.parse(line);
  } catch {
    pretty = line;
  }
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      n: msgCount,
      raw: pretty,
    })
  );
});

ws.on('error', (err) => {
  console.error('[ws] error', err.message);
});

ws.on('close', (code, reason) => {
  console.log('[ws] close', code, reason?.toString?.() || '', 'messages_seen=', msgCount);
});

const t = setTimeout(() => {
  console.log('[ws] duration done, closing');
  ws.close();
}, durationMs);

ws.on('close', () => clearTimeout(t));

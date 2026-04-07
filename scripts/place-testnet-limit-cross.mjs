#!/usr/bin/env node
/**
 * Places a small BUY limit at or above best ask to try to get an immediate fill (testnet).
 * Loads .env: NETWORK, TEMPLE_API_KEY, MM_SYMBOL (optional)
 *
 * Optional: TEST_ORDER_QTY (default 0.001), TEST_ORDER_PRICE (if set, skips book and uses this)
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

config({ path: resolve(root, '.env'), override: true });

const network = process.env.NETWORK?.trim().toLowerCase();
const key = process.env.TEMPLE_API_KEY?.trim();
const symbol = process.env.MM_SYMBOL?.trim() || 'CBTC/USDCx';
const qty = Number(process.env.TEST_ORDER_QTY || 0.001);

if (!network || !key) {
  console.error('Missing NETWORK or TEMPLE_API_KEY');
  process.exit(1);
}

const base =
  network === 'testnet'
    ? 'https://api-testnet.templedigitalgroup.com'
    : network === 'mainnet'
      ? 'https://api.templedigitalgroup.com'
      : null;

if (!base) {
  console.error('NETWORK must be testnet or mainnet');
  process.exit(1);
}

function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  let price = process.env.TEST_ORDER_PRICE ? num(process.env.TEST_ORDER_PRICE) : null;

  if (price == null) {
    const bookUrl = `${base}/api/v1/market/orderbook?symbol=${encodeURIComponent(symbol)}&levels=5`;
    const br = await fetch(bookUrl, {
      headers: { accept: 'application/json', 'X-API-Key': key },
    });
    const bookText = await br.text();
    let book;
    try {
      book = JSON.parse(bookText);
    } catch {
      console.error('Orderbook not JSON', br.status, bookText.slice(0, 200));
      process.exit(1);
    }
    const ob = book.orderbook ?? book.data?.orderbook ?? book;
    const askFromTop =
      ob.best_ask != null ? num(ob.best_ask) : ob.bestAsk != null ? num(ob.bestAsk) : null;
    const asks = ob.asks ?? book.asks;
    const firstAsk = Array.isArray(asks) && asks[0];
    const askPx = askFromTop ?? firstAsk?.price ?? firstAsk?.[0];
    const askN = num(askPx);
    if (askN == null) {
      console.error('Could not parse best ask from orderbook', book);
      process.exit(1);
    }
    // Slightly through the ask to improve match probability
    price = askN * 1.001;
    console.log(JSON.stringify({ step: 'orderbook', bestAsk: askN, limitPrice: price }));
  }

  const body = {
    Symbol: symbol,
    Side: 'buy',
    Type: 'limit',
    Quantity: qty,
    Price: price,
  };

  const url = `${base}/api/trading/orders`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': key,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  console.log(
    JSON.stringify({
      step: 'place',
      status: res.status,
      body: payload,
    })
  );
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

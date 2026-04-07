/**
 * Temple + Loop trading server.
 * Exposes HTTP API for Temple to use our Loop wallet (holdings, orders, merge, market).
 * Callers must send: Authorization: Bearer <SERVER_API_KEY>
 */
import { fileURLToPath } from 'url';
import express from 'express';
import { ensureInitialized } from './init.js';
import { requireApiKey } from './middleware/auth.js';
import { getHoldings } from './routes/holdings.js';
import {
  postOrder,
  getOrders,
  getPastOrders,
  deleteOrder,
  postCancelAllOrders,
} from './routes/orders.js';
import { mergeHoldings } from './routes/merge.js';
import { getTickerRoute, getOrderbookRoute } from './routes/market.js';
import { getInstruments } from './routes/instruments.js';

const app = express();
app.use(express.json());

// Health (no auth)
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'temple-loop-trading-server' });
});

// All API routes require API key
app.use(requireApiKey);

// Holdings
app.get('/holdings', getHoldings);
app.post('/holdings/merge', mergeHoldings);

// Orders
app.post('/orders', postOrder);
app.get('/orders', getOrders);
app.get('/orders/past', getPastOrders);
app.delete('/orders/:orderId', deleteOrder);
app.post('/orders/cancel-all', postCancelAllOrders);

// Market data
app.get('/market/ticker', getTickerRoute);
app.get('/market/orderbook', getOrderbookRoute);

// Instruments (catalog)
app.get('/instruments', getInstruments);

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: true, message: err.message });
});

export { app };

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

async function main() {
  try {
    const partyId = await ensureInitialized();
    const portStr = requireEnv('PORT');
    const PORT = Number(portStr);
    if (!Number.isFinite(PORT) || PORT <= 0) {
      throw new Error('PORT must be a positive number');
    }

    const { startBinanceBookTicker, stopBinanceBookTicker } = await import('./feeds/binance-book-ticker.js');
    startBinanceBookTicker(requireEnv('BINANCE_WS_URL'));

    const stop = () => {
      stopBinanceBookTicker();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    console.log('[trading-server] Loop + Temple SDK initialized');
    console.log('[trading-server] Party ID:', partyId);
    console.log('[trading-server] Temple NETWORK:', requireEnv('NETWORK'));
    app.listen(PORT, () => {
      console.log(`[trading-server] Listening on http://localhost:${PORT}`);
      console.log('[trading-server] Protected routes: GET/POST /holdings, /orders, /market/*, /instruments');
    });
  } catch (e) {
    console.error('Startup failed:', e);
    process.exit(1);
  }
}

const __filename = fileURLToPath(import.meta.url);
const isMain = process.argv[1] === __filename;
if (isMain) main();

import { Request, Response } from 'express';
import { getOrderBookSnapshot } from '../services/trading.js';
import { getBinanceBookTickerSnapshot } from '../feeds/binance-book-ticker.js';

const DEFAULT_TEMPLE_SYMBOL = 'CBTC/USDCx';

/**
 * GET /market/ticker
 * Fair reference price: Binance BTC/USDT bookTicker only (see docs/STRATEGY.md, TEMPLE_MM_ARCHITECTURE.md).
 * Optional ?templeSymbol= labels the Temple pair you quote against; it does not change the Binance stream.
 */
export async function getTickerRoute(req: Request, res: Response): Promise<void> {
  try {
    const templeSymbol =
      typeof req.query.templeSymbol === 'string' && req.query.templeSymbol.trim()
        ? req.query.templeSymbol.trim()
        : typeof req.query.symbol === 'string' && req.query.symbol.trim()
          ? req.query.symbol.trim()
          : DEFAULT_TEMPLE_SYMBOL;

    const snap = getBinanceBookTickerSnapshot();
    if (!snap) {
      res.status(503).json({
        error: true,
        message:
          'Binance reference unavailable (not connected or stale). Check BINANCE_WS_URL and feed health.',
        templeSymbol,
        source: 'binance',
      });
      return;
    }

    res.json({
      success: true,
      source: 'binance',
      templeSymbol,
      pair: 'BTCUSDT',
      best_bid: snap.bestBid,
      best_ask: snap.bestAsk,
      mid: snap.mid,
      receivedAt: new Date(snap.receivedAt).toISOString(),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

/**
 * GET /market/orderbook?symbol=CBTC/USDCx&levels=10
 * Temple venue book — basis / sanity check only, not fair-value truth.
 */
export async function getOrderbookRoute(req: Request, res: Response): Promise<void> {
  try {
    const symbol =
      typeof req.query.symbol === 'string' && req.query.symbol.trim()
        ? req.query.symbol.trim()
        : DEFAULT_TEMPLE_SYMBOL;
    const levels = req.query.levels ? Number(req.query.levels) : 10;
    const book = await getOrderBookSnapshot(symbol, levels);
    if (book && (book as any).error) {
      res.status(400).json(book);
      return;
    }
    res.json({
      success: true,
      source: 'temple',
      role: 'basis_check_only',
      symbol,
      orderbook: book,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: true, message });
  }
}

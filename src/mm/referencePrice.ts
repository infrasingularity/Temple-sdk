/**
 * Fair / mid price: Binance bookTicker only (price truth). Temple book is not used here.
 * @see docs/STRATEGY.md — "Data source: Binance WebSocket (always)"
 */
import { getBinanceBookTickerSnapshot } from '../feeds/binance-book-ticker.js';

export type BookMidResult =
  | { mid: number; source: 'binance' }
  | { mid: null; error: string };

/** Kept for tests / callers that pass a book-shaped object; MM fair path uses Binance only. */
export function midFromOrderBook(book: {
  best_bid?: string;
  best_ask?: string;
  bids?: { price: string }[];
  asks?: { price: string }[];
}): number | null {
  function num(x: string | undefined): number | null {
    if (x == null || x === '') return null;
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  const bb = num(book.best_bid) ?? (book.bids?.[0] ? num(book.bids[0].price) : null);
  const ba = num(book.best_ask) ?? (book.asks?.[0] ? num(book.asks[0].price) : null);
  if (bb != null && ba != null && ba > 0 && bb > 0) {
    return (bb + ba) / 2;
  }
  return null;
}

export async function getFairMid(_symbol: string, _orderBookLevels: number): Promise<BookMidResult> {
  const snap = getBinanceBookTickerSnapshot();
  if (!snap) {
    return {
      mid: null,
      error:
        'Binance reference unavailable (not connected or stale). MM requires BINANCE_WS_URL and a running Binance feed.',
    };
  }
  return { mid: snap.mid, source: 'binance' };
}

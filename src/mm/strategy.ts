/**
 * Pure quoting math for MM — no I/O.
 * Fair `mid` comes from Binance (referencePrice).
 *
 * Ladder (3 levels per side):
 * - Level n uses total bps from mid = sideHalfBps + (n - 1) × levelGapBps,
 *   where sideHalfBps is bidBps or askBps (halfSpreadBps ± inventory tilt).
 * - Bid n: mid * (1 - bps/10000); Ask n: mid * (1 + bps/10000).
 * Example: halfSpread 20, levelGap 30 → bid L1/L2/L3 at 20/50/80 bps below mid.
 *
 * Inventory tilt: tiltBps = invRatio * invSkewMaxBps * inventorySkewFactor (capped by invSkewMaxBps at |invRatio|≤1, factor≤1).
 * Arch INVENTORY_SKEW_FACTOR=0.7 is MM_INVENTORY_SKEW_FACTOR; MM_INV_SKEW_MAX_BPS is the bps ceiling at full inv when factor=1.
 */
import type { MmConfig } from './config.js';

export type DesiredOrder = {
  side: 'Buy' | 'Sell';
  price: number;
  quantity: number;
  level: 1 | 2 | 3;
};

function bpsToFrac(bps: number): number {
  return bps / 10000;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Inventory ratio in [-1, 1]: positive = long base, negative = short base (spot: mostly long/flat).
 */
export function computeDesiredOrders(
  mid: number,
  invRatio: number,
  cfg: MmConfig
): DesiredOrder[] {
  if (mid <= 0 || !Number.isFinite(mid)) return [];

  const baseHalf = cfg.halfSpreadBps;
  const f = clamp(cfg.inventorySkewFactor, 0, 1);
  const tiltBps = invRatio * cfg.invSkewMaxBps * f;
  const bidBps = Math.max(1, baseHalf + tiltBps);
  const askBps = Math.max(1, baseHalf - tiltBps);

  const q = cfg.orderSize;
  const out: DesiredOrder[] = [];
  for (const n of [1, 2, 3] as const) {
    const bidTotalBps = bidBps + (n - 1) * cfg.levelGapBps;
    out.push({
      side: 'Buy',
      price: mid * (1 - bpsToFrac(bidTotalBps)),
      quantity: q,
      level: n,
    });
  }
  for (const n of [1, 2, 3] as const) {
    const askTotalBps = askBps + (n - 1) * cfg.levelGapBps;
    out.push({
      side: 'Sell',
      price: mid * (1 + bpsToFrac(askTotalBps)),
      quantity: q,
      level: n,
    });
  }
  return out;
}

export { clamp };

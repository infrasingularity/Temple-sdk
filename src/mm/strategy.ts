/**
 * Pure quoting math for MM — no I/O.
 * Fair `mid` comes from Binance (referencePrice).
 *
 * Ladder (2 levels per side today — arch §8 shows 3; extend here later):
 * - L1 bid price: mid * (1 - bidBps/10000),  bidBps = halfSpreadBps + inventoryTiltBps
 * - L2 bid price: mid * (1 - (bidBps + levelGapBps)/10000)
 * So MM_LEVEL_GAP_BPS is **extra bps from mid** for level 2 vs level 1 on that side (not “total ladder width”).
 * Example: halfSpread 20, levelGap 30 → L1 bid 20 bps below mid, L2 bid 50 bps below mid (~30 bps between rungs).
 *
 * Inventory tilt: tiltBps = invRatio * invSkewMaxBps * inventorySkewFactor (capped by invSkewMaxBps at |invRatio|≤1, factor≤1).
 * Arch INVENTORY_SKEW_FACTOR=0.7 is MM_INVENTORY_SKEW_FACTOR; MM_INV_SKEW_MAX_BPS is the bps ceiling at full inv when factor=1.
 */
import type { MmConfig } from './config.js';

export type DesiredOrder = {
  side: 'Buy' | 'Sell';
  price: number;
  quantity: number;
  level: 1 | 2;
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

  const bid1 = mid * (1 - bpsToFrac(bidBps));
  const bid2 = mid * (1 - bpsToFrac(bidBps + cfg.levelGapBps));
  const ask1 = mid * (1 + bpsToFrac(askBps));
  const ask2 = mid * (1 + bpsToFrac(askBps + cfg.levelGapBps));

  const q = cfg.orderSize;
  return [
    { side: 'Buy', price: bid1, quantity: q, level: 1 },
    { side: 'Buy', price: bid2, quantity: q, level: 2 },
    { side: 'Sell', price: ask1, quantity: q, level: 1 },
    { side: 'Sell', price: ask2, quantity: q, level: 2 },
  ];
}

export { clamp };

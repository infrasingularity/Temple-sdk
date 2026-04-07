/**
 * Market-maker env (MM_*). Loaded after dotenv in init / mm-runner.
 *
 * Quoting is event-driven (Binance + Temple WS). Use MM_SAFETY_RECONCILE_MS for the
 * slow timer only — see docs/TEMPLE_MM_ARCHITECTURE.md §6.
 */
function envBool(key: string, defaultVal: boolean): boolean {
  const v = process.env[key]?.trim().toLowerCase();
  if (!v) return defaultVal;
  return v === '1' || v === 'true' || v === 'yes';
}

function envNum(key: string, defaultVal: number): number {
  const v = process.env[key]?.trim();
  if (!v || Number.isNaN(Number(v))) return defaultVal;
  return Number(v);
}

function envStr(key: string, defaultVal: string): string {
  return process.env[key]?.trim() || defaultVal;
}

/** Parse MM_SYMBOL "BASE/QUOTE" — base/quote are not separate env vars. */
function parseTradingSymbol(raw: string): { symbol: string; baseAsset: string; quoteAsset: string } {
  const s = raw.trim();
  const i = s.indexOf('/');
  if (i <= 0 || i === s.length - 1) {
    throw new Error('MM_SYMBOL must be BASE/QUOTE (e.g. CBTC/USDCx)');
  }
  const base = s.slice(0, i).trim();
  const quote = s.slice(i + 1).trim();
  if (!base || !quote) {
    throw new Error('MM_SYMBOL must be BASE/QUOTE (e.g. CBTC/USDCx)');
  }
  return { symbol: s, baseAsset: base, quoteAsset: quote };
}

/**
 * Safety reconciliation interval only — not the quoting loop.
 * MM_POLL_MS is accepted as legacy alias (docs used to name it that).
 */
function loadSafetyReconcileMs(): number {
  const primary = process.env.MM_SAFETY_RECONCILE_MS?.trim();
  const legacy = process.env.MM_POLL_MS?.trim();
  const v = primary || legacy;
  if (!v || Number.isNaN(Number(v))) return 5000;
  return Math.max(500, Number(v));
}

export type MmConfig = {
  symbol: string;
  /** Timer for safety / REST reconcile only — not primary quote trigger */
  safetyReconcileMs: number;
  dryRun: boolean;
  /**
   * Reserved for REST orderbook depth if needed; fair mid uses Binance WS only.
   * Ladder level count is defined in strategy.ts today (not this number).
   */
  orderBookLevels: number;
  /**
   * Half-spread from mid in bps per side. Phase 1 target ~40 bps total → 20 here.
   * @see docs/TEMPLE_MM_ARCHITECTURE.md — SPREAD_BPS=40
   */
  halfSpreadBps: number;
  /**
   * Extra bps from mid for L2 vs L1 on each side (added to that side’s bps for the second rung).
   * See strategy.ts — arch ladder ~30 bps between adjacent rungs → default 30.
   */
  levelGapBps: number;
  /**
   * Max inventory tilt (bps) at |invRatio|=1 when inventorySkewFactor=1.
   * Actual: invRatio * invSkewMaxBps * inventorySkewFactor.
   */
  invSkewMaxBps: number;
  /**
   * Arch INVENTORY_SKEW_FACTOR — scales tilt only; clamped [0,1]. Not a second independent skew.
   */
  inventorySkewFactor: number;
  /** Order size per level (base units) — Phase 1 uses ~0.003 CBTC */
  orderSize: number;
  /** Position cap in base units for skew scaling */
  maxPositionBase: number;
  /** Parsed from MM_SYMBOL — for balance lookup */
  baseAsset: string;
  quoteAsset: string;
  /**
   * When reconciling desired vs live orders, treat prices within this band as same
   * (avoids cancel/replace churn if venue rounds ticks).
   */
  priceMatchBps: number;
  activeOrderLimit: number;
  requoteThresholdBps: number;
  basisWarnBps: number;
  basisHaltBps: number;
  basisWidenMaxScale: number;
  basisHaltCancelAll: boolean;
};

export function loadMmConfig(): MmConfig {
  const { symbol, baseAsset, quoteAsset } = parseTradingSymbol(envStr('MM_SYMBOL', 'CBTC/USDCx'));

  return {
    symbol,
    safetyReconcileMs: loadSafetyReconcileMs(),
    dryRun: envBool('MM_DRY_RUN', true),
    orderBookLevels: Math.max(3, envNum('MM_ORDERBOOK_LEVELS', 5)),
    halfSpreadBps: envNum('MM_HALF_SPREAD_BPS', 20),
    levelGapBps: envNum('MM_LEVEL_GAP_BPS', 30),
    invSkewMaxBps: envNum('MM_INV_SKEW_MAX_BPS', 8),
    inventorySkewFactor: Math.min(1, Math.max(0, envNum('MM_INVENTORY_SKEW_FACTOR', 0.7))),
    orderSize: envNum('MM_ORDER_SIZE', 0.003),
    maxPositionBase: Math.max(1e-9, envNum('MM_MAX_POSITION_BASE', 0.05)),
    baseAsset,
    quoteAsset,
    priceMatchBps: envNum('MM_PRICE_MATCH_BPS', 2),
    activeOrderLimit: Math.max(10, envNum('MM_ACTIVE_ORDER_LIMIT', 50)),
    requoteThresholdBps: envNum('MM_REQUOTE_THRESHOLD_BPS', 8),
    basisWarnBps: envNum('MM_BASIS_WARN_BPS', 50),
    basisHaltBps: envNum('MM_BASIS_HALT_BPS', 100),
    basisWidenMaxScale: Math.max(1, envNum('MM_BASIS_WIDEN_MAX_SCALE', 2)),
    basisHaltCancelAll: envBool('MM_BASIS_HALT_CANCEL_ALL', false),
  };
}

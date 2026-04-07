/**
 * Market-maker loop (in-process; uses services/trading + init).
 */
import { getPartyId } from '../init.js';
import { onBinanceBookTicker } from '../feeds/binance-book-ticker.js';
import { onTempleTrade } from '../feeds/temple-ws.js';
import { loadMmConfig } from './config.js';
import { runOneMmTick } from './engine.js';

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

export async function startMarketMaker(): Promise<void> {
  const cfg = loadMmConfig();
  const partyId = getPartyId();

  if (running) {
    console.warn('[mm] already running');
    return;
  }
  running = true;

  console.log('[mm] config', {
    symbol: cfg.symbol,
    safetyReconcileMs: cfg.safetyReconcileMs,
    dryRun: cfg.dryRun,
    halfSpreadBps: cfg.halfSpreadBps,
    orderSize: cfg.orderSize,
    basisWarnBps: cfg.basisWarnBps,
    basisHaltBps: cfg.basisHaltBps,
    requoteThresholdBps: cfg.requoteThresholdBps,
  });

  let lastBinanceMid: number | null = null;
  let inFlight = false;
  let pending = false;

  const tick = async (reason: string) => {
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const r = await runOneMmTick(partyId, cfg);
      if (r.error) {
        console.warn(`[mm] tick(${reason})`, r.error);
        return;
      }
      const basis =
        r.basisBps != null && Number.isFinite(r.basisBps) ? ` basis=${r.basisBps.toFixed(1)}bps` : '';
      const safe = r.safetyState ? ` ${r.safetyState}` : '';
      const scale = r.spreadScale != null && r.spreadScale !== 1 ? ` scale=${r.spreadScale.toFixed(2)}` : '';
      console.log(
        `[mm] reason=${reason} mid=${r.mid.toFixed(6)} (${r.source})${basis}${safe}${scale} inv=${r.invRatio.toFixed(3)} dry=${r.dryRun} canceled=${r.canceled.length} placed=${r.placed}`
      );
    } catch (e) {
      console.error('[mm] tick error', e);
    } finally {
      inFlight = false;
      if (pending) {
        pending = false;
        void tick('coalesced');
      }
    }
  };

  const offBinance = onBinanceBookTicker((snap) => {
    if (lastBinanceMid == null) {
      lastBinanceMid = snap.mid;
      void tick('binance-init');
      return;
    }
    const moveBps = (Math.abs(snap.mid - lastBinanceMid) / Math.max(lastBinanceMid, 1e-12)) * 10000;
    if (moveBps >= cfg.requoteThresholdBps) {
      lastBinanceMid = snap.mid;
      void tick(`binance-move-${moveBps.toFixed(1)}bps`);
    }
  });

  const offTempleTrade = onTempleTrade(() => {
    void tick('temple-trade');
  });

  await tick('startup');
  timer = setInterval(() => void tick('safety-reconcile'), cfg.safetyReconcileMs);

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    offBinance();
    offTempleTrade();
    running = false;
    console.log('[mm] stopped');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

# STRATEGY.md — Temple Market Maker Bot

> Token: CBTC/USDCx | Exchange: Temple Digital | Program: Lightspeed Registered MM

---

## What This Strategy Is

**Market making.** You post resting limit orders on both sides of BTC's fair price 24/7.
You earn money in two ways on every fill:

```
1. Spread    — you buy at bid, sell at ask, capture the gap
2. Rebate    — Temple pays you +3.75 bps on every single fill
```

You never predict price direction. You never place market orders.
You are a toll booth — anyone who wants to trade CBTC pays you the spread for
the privilege of getting instant execution. Temple also pays you for keeping
the booth open.

---

## The 4 Mechanics

### 1. Fair Value (Where to Center Quotes)

```
fastEMA  = EMA(BTC_price, 8_bars)
slowEMA  = EMA(BTC_price, 34_bars)
mid      = (fastEMA + slowEMA) / 2

alphaRaw = (fastEMA - slowEMA) / ATR        ← how strong is the trend?
alpha    = clamp(alphaRaw, -1.5, 1.5)

fair     = mid + alpha × ATR × 0.15         ← lean quotes WITH momentum
```

The `alpha` lean is the key improvement over a plain midprice.
When BTC is trending up, `fair` shifts slightly above mid so your quotes
move with the market instead of being left behind as free money for arb bots.

**Data source: Binance WebSocket (always). Never Temple's own book.**
Temple's book is thin at launch — quoting off it is quoting off nothing.

---

### 2. Order Ladder (What to Post)

Every quote cycle the bot posts 3 limit orders per side:

```
ASK level 3:  fair × (1 + askBps + 2×gap)   ← furthest from mid
ASK level 2:  fair × (1 + askBps + gap)
ASK level 1:  fair × (1 + askBps)            ← tightest ask
─────────────────── fair ───────────────────
BID level 1:  fair × (1 − bidBps)            ← tightest bid
BID level 2:  fair × (1 − bidBps − gap)
BID level 3:  fair × (1 − bidBps − 2×gap)   ← furthest from mid
```

All orders are **limit orders** placed via `POST /v1/orders/create`.
Market orders are never used — limit orders are how you earn the rebate.

**Spread formula:**
```
baseHalfSpread = max(MIN_SPREAD_BPS, ATR_bps × ATR_MULT)

bidBps = baseHalfSpread + inventorySkew + trendPenalty_if_downtrend
askBps = baseHalfSpread − inventorySkew + trendPenalty_if_uptrend

floor: bidBps and askBps never go below 1.0 bps
```

**Trend widen penalty:**
```
trendUp   = fastEMA > slowEMA AND ADX > 22
trendDown = fastEMA < slowEMA AND ADX > 22

if trendDown → bidBps += TREND_WIDEN_BPS   (don't buy aggressively into a dump)
if trendUp   → askBps += TREND_WIDEN_BPS   (don't sell aggressively into a rip)
```

---

### 3. Inventory Skew (Risk Management)

The biggest risk in market making is getting stuck one-directional.
If 10 buyers in a row hit your asks, you are short CBTC and exposed to BTC rising.

The skew algorithm automatically adjusts to pull you back to neutral:

```
invRatio = clamp(position / MAX_POSITION, −1.0, +1.0)

bidBps += invRatio × MAX_SKEW_BPS
askBps −= invRatio × MAX_SKEW_BPS
```

In plain terms:
```
Too much CBTC (invRatio positive):
  bids widen  → you buy less aggressively
  asks tighten → you sell faster
  Result: inventory drains back toward zero

Too little CBTC (invRatio negative):
  bids tighten → you accumulate faster
  asks widen   → you sell less
  Result: inventory refills back toward zero
```

Hard inventory limits:
```
position > 60% of MAX_POSITION → soft: start widening exposed side
position > 90% of MAX_POSITION → hard: suppress exposed side entirely
5+ consecutive same-side fills  → suppress that side (toxic flow signal)
```

---

### 4. Safety Gates (Step Back When Risky)

Every quote cycle runs through these checks before any order is placed.

```
BASIS CHECK — Temple mid vs Binance BTC:
  < 50 bps divergence  → normal quoting
  50–100 bps           → widen spreads proportionally
  > 100 bps            → HALT — cancel all orders

VOLATILITY GATE — BTC price range over 10s window:
  < 50 bps move   → normal
  50–100 bps      → widen spreads
  > 100 bps       → HALT

LATENCY MONITOR — WebSocket round-trip average:
  < 500ms  → normal
  > 500ms  → HALT

QUOTE AGE:
  any quote older than 3000ms → force cancel + requote immediately

ADVERSE SELECTION — markout PnL rolling average:
  avg markout > −3 bps → normal
  avg markout < −3 bps → alert (informed traders are picking you off)
```

Any halt path cancels all orders immediately and independently.

---

## Optional Layer: Perp Signal Overlay

**OFF at launch. Enable in Phase 3 once base bot is stable.**

Polls Binance every 30 seconds for:
- Open Interest (OI)
- Funding Rate
- Long/Short Account Ratio (proxy for aggregate unrealized PnL)

These are the same signals from the PineScript OI/Funding/uPnL strategies
converted to TypeScript in `perp-signals.ts`.

```
BEARISH signal (OI spike + crowded longs + flat funding):
  → liquidation cascade likely incoming
  → spread × 1.5, size × 0.6, skew toward USDCx (−0.4)

BULLISH signal (funding spike + neutral uPnL + stable OI):
  → short squeeze likely incoming
  → spread × 0.8, size × 1.3, skew toward CBTC (+0.3)

NEUTRAL:
  → no adjustment, normal quoting
```

Controlled by `ENABLE_PERP_SIGNALS=false` in `.env`.

---

## Data Sources

| Source | Purpose | Transport |
|---|---|---|
| Binance BTC/USDT | Reference price — fair value anchor | WebSocket (always on) |
| Binance perp APIs | OI, funding, L/S ratio for signals | REST poll every 30s |
| Temple `orderbook:CBTC/USDCx` | Basis check vs Binance | WebSocket subscribe |
| Temple `trades:CBTC/USDCx` | Fill notifications → immediate requote | WebSocket subscribe |
| Temple REST | Create orders, cancel orders, check balance | REST (actions only) |

**Key rule:** Binance WS = price truth. Temple orderbook = sanity check only.

---

## Revenue Per Trade

```
One fill (single leg):
  Maker rebate = +3.75 bps × notional

One round trip (bid fill + ask fill):
  Spread capture = spread_bps × notional
  Rebate × 2     = 7.5 bps × notional
  Total          = spread + 7.5 bps

Example at launch settings:
  spread = 40 bps, size = 0.003 CBTC, BTC = $84,000
  notional       = $252
  spread capture = $252 × 0.0040 = $1.01
  rebate (×2)    = $252 × 0.00075 = $0.19
  per round trip = $1.20
```

---

## Configuration — Phase 1 (Launch)

```bash
# Temple
TEMPLE_API_KEY=your_key
TEMPLE_WS_URL=wss://ws-dev.templedigitalgroup.com/v1/stream

# Binance
BINANCE_WS_URL=wss://stream.binance.com:9443/ws/btcusdt@bookTicker

# Core strategy
SYMBOL=CBTC/USDCx
REFERENCE_SOURCE=EXTERNAL

# MM v2 params
MIN_SPREAD_BPS=40          # wide at launch
ATR_MULT=0.30              # ATR contribution to spread
LEVEL_GAP_BPS=3.0          # gap between L1/L2/L3
ALPHA_MULT=0.15            # momentum lean strength
ADX_TREND_THRESH=22        # trend detection threshold

# Sizing
ORDER_SIZE_BASE=0.003      # ~$252/level at $84K BTC
ORDER_LEVELS=3
MAX_POSITION=0.05          # ~$4,200 max CBTC exposure

# Inventory
MAX_SKEW_BPS=8.0
TREND_WIDEN_BPS=8.0

# Safety
BASIS_WARN_BPS=50
BASIS_HALT_BPS=100
VOLATILITY_HALT_BPS=100
MAX_QUOTE_AGE_MS=3000
MAX_LATENCY_MS=500
REQUOTE_THRESHOLD_BPS=8

# Perp signals
ENABLE_PERP_SIGNALS=false
```

---

## Scaling Plan

| Phase | Capital | Spread | Levels | Perp Signals | Monthly Target |
|---|---|---|---|---|---|
| 1 — validate (weeks 1–4) | $5K | 40 bps | 3 | OFF | Learn the venue |
| 2 — tighten (month 2–3) | $10K | 25 bps | 5 | OFF | $600–$1,200 |
| 3 — scale (month 3–6) | $25K | 15 bps | 5 | ON | $2,000–$3,000 |
| 4 — full (month 6+) | $50K+ | 10 bps | 7 | ON | $5,000+ |

---

## What the Bot Does NOT Do

- Does NOT predict price direction
- Does NOT place market orders (everything is a limit order)
- Does NOT hold overnight directional positions
- Does NOT use leverage
- Does NOT chase price moves

---

## The One Risk That Kills Profitability

**Adverse selection** — informed traders hitting your quotes the instant before
a price move. You sell right before BTC goes up. You buy right before BTC drops.

Your defenses in order of importance:
1. Binance WS feed — requote within 8 bps of a price move
2. Alpha lean — quotes already lean with momentum before the move
3. Volatility gate — halt during fast moves when you are most exposed
4. Quote age limit — never leave stale quotes older than 3 seconds
5. Markout PnL tracker — detects if adverse selection is happening

# Temple Market Maker Bot — Full Architecture & Knowledge Base

> Last updated: April 7, 2026
> Token: CBTC/USDCx
> Program: Temple Lightspeed — Registered Market Maker
> Language: TypeScript / Node.js

---

## 1. What Temple Is

Temple is a CLOB (Central Limit Order Book) exchange built on the Canton Network.
It settles trades atomically on-chain but matches orders off-chain (post-V2). Key facts:

- **Non-custodial** — you keep custody of assets, settlement is atomic on Canton
- **V2 "Lightspeed"** — off-chain matching engine, sub-10ms order matching
- **Price-time priority** CLOB, same model as NASDAQ/ARCA
- **REST base URL (testnet)**: `https://api-testnet.templedigitalgroup.com`
- **REST base URL (mainnet)**: `https://api.templedigitalgroup.com`
- **WebSocket (dev/testnet)**: `wss://ws-dev.templedigitalgroup.com/v1/stream`
- **WebSocket (mainnet)**: ask Temple for prod WS URL when V2 goes live

---

## 2. Market Maker Program Economics

| Item | Value |
|---|---|
| Maker fee | 0 bps (you pay nothing) |
| Maker rebate | +3.75 bps per executed fill |
| Source of rebate | Takers pay 15 bps — 25% routed to makers |
| CC rewards | 1,000,000 CC monthly pool |
| Pool split | 20% fixed top-10 by position, 80% pro-rata by volume |
| Fees live since | April 1, 2026 |

**Revenue per round trip:**
Spread captured + 3.75 bps rebate on each leg = spread + 7.5 bps per round trip

---

## 3. Data Sources — What Each One Does

Three sources, three completely different jobs. None replaces another.

```
Binance WS              Temple WS                          Temple REST
─────────────           ────────────────────────────────   ────────────
Always on               wss://ws-dev.templedigitalgroup     Actions only
                        .com/v1/stream
     |                        |                    |              |
     v                        v                    v              v
Reference price        orderbook:CBTC/USDCx   trades:CBTC/USDCx  create/cancel
mid, bid, ask          Temple book depth      fill notifications  orders
from real BTC          updates
```

### Binance WebSocket
- **Purpose**: Reference price — what BTC is actually worth globally
- **Gives you**: `best_bid`, `best_ask`, `mid` for BTC/USDT in real time
- **Used for**: Deciding WHERE to place CBTC quotes on Temple
- **Never replaced** by Temple data even after V2 with active book
- **File**: `binance-feed.ts`

### Temple WS — `orderbook:CBTC/USDCx` channel
- **Purpose**: Temple's own live book state
- **Gives you**: `bids[]`, `asks[]` depth updates
- **Used for**: Basis check — compare Temple mid vs Binance mid.
  Divergence > 50 bps → widen spreads. > 100 bps → halt all quoting
- **Message received**:
```json
{
  "type": "data",
  "channel": "orderbook:CBTC/USDCx",
  "data": { "bids": [...], "asks": [...] }
}
```

### Temple WS — `trades:CBTC/USDCx` channel
- **Purpose**: Trade/fill notifications
- **Used for**: Detect fills → immediately replace that level
- **Message received**:
```json
{
  "type": "data",
  "channel": "trades:CBTC/USDCx",
  "data": { "..." }
}
```
> **UNRESOLVED**: Does this channel deliver only YOUR fills or ALL public trades?
> If public trades — need to ask Temple for the private fills channel name.
> Exact `data` field names also need confirming (sample message from Temple).

### Temple REST API
- **Purpose**: Actions ONLY — never for streaming prices or state
- **Bot uses only these calls**:
  1. `POST /v1/orders/create` — place a limit order
  2. `POST /v1/orders/cancel` — cancel one order
  3. `POST /v1/orders/cancel-all` — emergency wipe
  4. `GET /v1/orders/active` — reconcile on startup
  5. `GET /v1/account/balances` — check CBTC and USDCx balance
  6. `GET /v1/account/trades` — verify rebates are crediting

---

## 4. WebSocket Protocol — Confirmed Correct Schema

> These are the REAL message formats from Temple's actual API docs (confirmed April 7).
> Earlier versions of this doc had wrong field names — all corrected below.

### Connection URL
```
wss://ws-dev.templedigitalgroup.com/v1/stream   ← testnet/dev
wss://[UNKNOWN — ask Temple]                     ← mainnet (get before going live)
```

### Authentication — two options (either works)

**Option A**: Pass header at connection time (cleanest, recommended)
```
X-API-Key: YOUR_API_KEY
```

**Option B**: Send auth message after connecting
```json
{ "type": "auth", "api_key": "your-api-key-here" }
```

JWT alternative:
```json
{ "type": "auth", "token": "eyJhbGciOiJSUzI1NiIs..." }
```

### Messages YOU send to server

```json
// Subscribe (auth must happen first)
{
  "type": "subscribe",
  "channels": ["orderbook:CBTC/USDCx", "trades:CBTC/USDCx"]
}

// Unsubscribe
{
  "type": "unsubscribe",
  "channels": ["orderbook:CBTC/USDCx"]
}

// Keepalive (send every 30s)
{ "type": "ping" }
```

### Messages SERVER sends to you

```json
// Channel data push
{
  "type": "data",
  "channel": "orderbook:CBTC/USDCx",
  "data": { "bids": [...], "asks": [...] }
}

// Error
{
  "type": "error",
  "code": "INVALID_CHANNEL",
  "message": "Unknown channel: foo"
}

// Auth expired — resend auth message
{
  "type": "auth_expired",
  "message": "Token expired, please re-authenticate"
}

// Pong (response to your ping)
{ "type": "pong" }
```

### What was wrong in our earlier code (corrected here)

| Old (WRONG) | New (CORRECT) |
|---|---|
| `{ "action": "auth", "key": "..." }` | `{ "type": "auth", "api_key": "..." }` |
| `{ "action": "subscribe", "channels": ["ticker","orders"] }` | `{ "type": "subscribe", "channels": ["orderbook:CBTC/USDCx","trades:CBTC/USDCx"] }` |
| `{ "action": "ping" }` | `{ "type": "ping" }` |
| `msg.channel === 'ticker'` | `msg.type === "data" && msg.channel === "orderbook:CBTC/USDCx"` |
| `msg.channel === 'orders'` | `msg.type === "data" && msg.channel === "trades:CBTC/USDCx"` |
| WS URL `wss://api.templedigitalgroup.com/ws` | `wss://ws-dev.templedigitalgroup.com/v1/stream` |

---

## 5. Complete REST API Reference

### Orders
| Endpoint | Method | Params | Returns |
|---|---|---|---|
| `GET /v1/orders/active` | GET | `symbol` (optional) | Array: `id`, `price`, `qty`, `filledQty` |
| `POST /v1/orders/cancel` | POST | `orderId` | Confirmation + remaining qty |
| `POST /v1/orders/cancel-all` | POST | `symbol` (optional) | Count cancelled |
| `GET /v1/orders/history` | GET | `symbol`, `status`, `limit` | FILLED/CANCELLED/EXPIRED list |
| `POST /v1/orders/create` | POST | `symbol`, `side`, `type`, `qty`, `price` | `orderId`, initial status |

### Exchange (Market Data)
| Endpoint | Returns |
|---|---|
| `GET /v1/exchange/tickers` | All symbols: high/low/vol/last price |
| `GET /v1/exchange/orderbook?symbol=CBTC/USDCx` | Full market depth |
| `GET /v1/exchange/trades/history` | Public trade history |

### Account
| Endpoint | Returns |
|---|---|
| `GET /v1/account/balances` | `available`, `locked`, `total` per asset |
| `GET /v1/account/trades` | Every trade you executed |
| `GET /v1/account/trades/buy` | Filtered side: BUY |
| `GET /v1/account/trades/sell` | Filtered side: SELL |
| `POST /v1/account/withdraw` | `withdrawalId`, status |

---

## 6. Bot File Structure

```
temple-mm-bot/
├── src/
│   ├── index.ts              — entry point, wires everything
│   ├── market-maker.ts       — core quote engine, inventory skew, ladder
│   ├── temple-client.ts      — REST API (create/cancel/balances)
│   ├── temple-ws-client.ts   — WebSocket (orderbook + trades channels)
│   ├── binance-feed.ts       — Binance WS BTC reference price
│   ├── reference-price.ts    — EXTERNAL vs TEMPLE_MID mode
│   ├── risk-manager.ts       — circuit breakers, loss limits, rate limits
│   ├── safety.ts             — basis check, latency, adverse selection
│   ├── perp-signals.ts       — OI/funding/long-short ratio overlay
│   └── types.ts              — shared TypeScript interfaces
├── .env
├── package.json
└── tsconfig.json
```

### Core loop trigger model

```
Binance WS move > REQUOTE_THRESHOLD_BPS  →  IMMEDIATE cancel + requote
Temple WS trades fill notification        →  IMMEDIATE level replacement
Timer every 5s                            →  safety reconciliation only
```

---

## 7. temple-ws-client.ts — Correct Implementation

```typescript
import WebSocket from 'ws';
import EventEmitter from 'events';

export class TempleWSClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private symbol: string;
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(
    private url: string,
    private apiKey: string
  ) {
    super();
    this.symbol = process.env.SYMBOL || 'CBTC/USDCx';
  }

  connect() {
    // Auth via header at connection time — cleanest, avoids race condition
    this.ws = new WebSocket(this.url, {
      headers: { 'X-API-Key': this.apiKey }
    });

    this.ws.on('open', () => {
      console.log('[TempleWS] connected');
      this.subscribe();
      this.startPing();
    });

    this.ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch (e) {
        console.error('[TempleWS] bad JSON:', raw.toString());
      }
    });

    this.ws.on('close', () => {
      console.log('[TempleWS] disconnected — reconnecting in 3s');
      this.stopPing();
      setTimeout(() => this.connect(), 3000);
    });

    this.ws.on('error', (err) => {
      console.error('[TempleWS] error:', err.message);
    });
  }

  private subscribe() {
    this.ws!.send(JSON.stringify({
      type: 'subscribe',
      channels: [
        `orderbook:${this.symbol}`,
        `trades:${this.symbol}`
      ]
    }));
  }

  private handleMessage(msg: any) {
    switch (msg.type) {

      case 'data':
        if (msg.channel === `orderbook:${this.symbol}`) {
          // Temple book update → basis check vs Binance
          this.emit('orderbook', msg.data);
        }
        if (msg.channel === `trades:${this.symbol}`) {
          // Fill or public trade → requote
          // TODO: confirm exact field names in msg.data with Temple sample
          this.emit('trade', msg.data);
        }
        break;

      case 'auth_expired':
        console.warn('[TempleWS] auth expired — re-authenticating');
        this.ws!.send(JSON.stringify({
          type: 'auth',
          api_key: this.apiKey
        }));
        this.subscribe(); // re-subscribe after re-auth
        break;

      case 'error':
        console.error(`[TempleWS] ${msg.code}: ${msg.message}`);
        break;

      case 'pong':
        // connection healthy, no action needed
        break;
    }
  }

  private startPing() {
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 30000);
  }

  private stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
  }
}
```

---

## 8. Trading Strategy

### Order ladder
```
ASK Level 3:  $84,500  × 0.003 CBTC
ASK Level 2:  $84,380  × 0.003 CBTC
ASK Level 1:  $84,250  × 0.003 CBTC
────────── Binance mid = $84,000 ──────────
BID Level 1:  $83,750  × 0.003 CBTC
BID Level 2:  $83,630  × 0.003 CBTC
BID Level 3:  $83,500  × 0.003 CBTC
```

### Inventory skew
Too much CBTC → tighten asks + widen bids (offload faster)
Too little CBTC → tighten bids + widen asks (accumulate faster)

### Perp signal overlay

| Signal | Trigger | Bot response |
|---|---|---|
| Bearish | OI spike + crowded longs + flat funding | Widen spread 50%, shrink size 40%, lean USDCx |
| Bullish | Funding spike + neutral uPnL + stable OI | Tighten spread 20%, increase size 30%, accumulate CBTC |
| Neutral | No trigger | Normal quoting |

Controlled by `ENABLE_PERP_SIGNALS` in `.env` — keep `false` until base bot is stable.

---

## 9. Safety Layers (safety.ts)

| Check | Threshold | Action |
|---|---|---|
| Basis deviation Temple vs Binance | > 50 bps | Widen spreads proportionally |
| Basis deviation Temple vs Binance | > 100 bps | Full halt, cancel all |
| BTC volatility | > 50 bps in 10s | Widen spreads |
| BTC volatility | > 100 bps in 10s | Full halt |
| Quote age | > 3000ms | Force cancel + requote |
| WS latency avg | > 500ms | Halt |
| Adverse selection (markout) | < -3 bps avg | Alert, consider widening |
| Consecutive same-side fills | > 5 in a row | Suppress that side |
| Inventory soft limit | > 60% of max | Widen one side |
| Inventory hard limit | > 90% of max | Suppress one side entirely |

---

## 10. Environment Config (.env)

```bash
# Temple REST
TEMPLE_API_KEY=your_key_here
TEMPLE_BASE_URL=https://api-testnet.templedigitalgroup.com

# Temple WebSocket
TEMPLE_WS_URL=wss://ws-dev.templedigitalgroup.com/v1/stream

# Binance
BINANCE_WS_URL=wss://stream.binance.com:9443/ws/btcusdt@bookTicker

# Strategy — Phase 1 conservative
SYMBOL=CBTC/USDCx
SPREAD_BPS=40
ORDER_LEVELS=3
ORDER_SIZE_BASE=0.003
MAX_POSITION_BASE=0.05
INVENTORY_SKEW_FACTOR=0.7
REFERENCE_SOURCE=EXTERNAL

# Safety
REQUOTE_THRESHOLD_BPS=8
MAX_QUOTE_AGE_MS=3000
BASIS_WARN_BPS=50
BASIS_HALT_BPS=100
VOLATILITY_HALT_BPS=100
MAX_LATENCY_MS=500

# Signals
ENABLE_PERP_SIGNALS=false
```

---

## 11. Still Unresolved — Ask Temple

| # | Question | Why it matters |
|---|---|---|
| 1 | **Mainnet WS URL?** | Dev URL is `ws-dev.` — prod URL unknown. Do not go live without this. |
| 2 | **Sample `trades:CBTC/USDCx` fill message?** | Need exact `data` field names to wire fill handler |
| 3 | **`trades` channel = YOUR fills or ALL public trades?** | If public — need the private fills channel name separately |
| 4 | **JWT token lifetime?** | Docs confirm re-auth on expiry, but how long does each token last? |
| 5 | **Testnet REST schema = mainnet?** | Safe to use for integration testing before V2? |
| 6 | **Order status values?** | All possible statuses: PENDING, OPEN, FILLED, PARTIAL, CANCELLED, EXPIRED? |

> **Most critical: question #3** — if `trades` is public trade feed only,
> you won't receive your own fill notifications and the bot can't requote on fills.

---

## 12. ROI Model

### $5,000 capital

| Scenario | Daily volume | Monthly spread + rebate | Monthly ROI |
|---|---|---|---|
| Conservative | $5,000 | ~$210 | 4.2% |
| Realistic | $15,000 | ~$620 | 12.4% |
| Optimistic | $30,000 | ~$1,250 | 25% |

### CC reward upside
- Pool: 1,000,000 CC/month ≈ $148,000 at $0.148
- Early MM with few competitors, $450K/month volume: 30,000–50,000 CC/month
- At current price: $4,400–$7,400/month from CC alone

### Scaling phases

| Phase | Capital | Spread | Levels | Monthly target |
|---|---|---|---|---|
| 1 (weeks 1–4) | $5K | 40 bps | 3 | Validate setup |
| 2 (month 2–3) | $10K | 25 bps | 5 | $600–$1,200 |
| 3 (month 3–6) | $25K | 15 bps | 5 | $2,000–$3,000 |
| 4 (month 6+) | $50K+ | 10 bps | 7 | $5,000+ |

---

## 13. Next Steps Checklist

### Right now — before V2 mainnet
- [ ] Ask Temple the 6 questions in Section 11 — especially #1 and #3
- [ ] Connect to `wss://ws-dev.templedigitalgroup.com/v1/stream` with testnet key
- [ ] Subscribe to `orderbook:CBTC/USDCx` and `trades:CBTC/USDCx`
- [ ] Log raw messages — confirm exact `data` field names
- [ ] Update `temple-ws-client.ts` with real field names from step above

### V2 launch day
- [ ] Get production API keys + mainnet WS URL from Temple
- [ ] Update `.env` with mainnet URLs
- [ ] Run **dry-run 24 hours** — log intended orders, don't submit
- [ ] Verify Binance feed healthy, WS connecting + authing

### Day 2
- [ ] Go live: 3 levels, 40 bps, 0.003 CBTC/level
- [ ] Monitor fills 48 hours
- [ ] Check `GET /v1/account/trades` — confirm rebates crediting

### Week 2
- [ ] Tighten to 25 bps + 5 levels if fill rate > 30%
- [ ] Enable perp signals
- [ ] Track markout PnL — adverse selection metric

---

## 14. Key Decisions Log

| Decision | Choice | Why |
|---|---|---|
| Reference price source | Binance WS always | Temple book empty/thin at launch |
| Temple data transport | WebSocket not REST poll | Sub-10ms matching needs event-driven |
| Strategy | Inventory-aware CLOB market making | Fits rebate + CC reward structure |
| Launch spread | 40 bps | Safety margin while learning venue |
| Launch size | 0.003 CBTC/level | ~$250 exposure per level |
| Perp signals | Disabled at launch | Enable after base bot is stable |
| Testnet | Integration + WS field name testing only | Behavior does not reflect real market |
| Hedging | None at Phase 1 | Add BTC perp short at Phase 4 ($50K+) |
| WS auth method | `X-API-Key` header at connect | Cleanest, avoids auth race condition |

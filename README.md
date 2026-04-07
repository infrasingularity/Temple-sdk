# Temple + Loop trading server

HTTP API for **your** Loop wallet + Temple V2 REST integration: holdings, merge, market data, and limit order actions via `/v1/orders/*`. Callers send `Authorization: Bearer <SERVER_API_KEY>`.

**Market data (see [docs/STRATEGY.md](docs/STRATEGY.md), [docs/TEMPLE_MM_ARCHITECTURE.md](docs/TEMPLE_MM_ARCHITECTURE.md)):**

- **`GET /market/ticker`** — Fair reference from **Binance** `btcusdt@bookTicker` only (`BINANCE_WS_URL`). Not Temple.
- **`GET /market/orderbook`** — **Temple** venue book for basis / sanity checks only, not fair-value truth.

Temple REST auth: **`TEMPLE_API_KEY` only** (no email/password path).

## Setup

1. Copy `.env.example` to `.env` and set **every** variable shown there (no implicit defaults in code for network URLs or keys):

   - **Loop:** `PRIVATE_KEY`, `PARTY_ID`, `LOOP_NETWORK`, `WALLET_URL`, `API_URL`
   - **Temple:** `NETWORK`, `TEMPLE_API_KEY`
     - `NETWORK=testnet` -> `https://api-testnet.templedigitalgroup.com/api/v1/...`
     - `NETWORK=mainnet` -> `https://api.templedigitalgroup.com/api/v1/...`
   - **Binance (reference price):** `BINANCE_WS_URL` — e.g. `wss://stream.binance.com:9443/ws/btcusdt@bookTicker`
   - **Server:** `SERVER_API_KEY`, `PORT`

2. Install and build:

```bash
npm install
npm run build
```

3. Start:

```bash
npm start
```

The process connects to Binance over WebSocket on startup so `/market/ticker` can serve live reference prices.

## Validate

```bash
npm run validate
```

## Test Temple REST

```bash
npm run test:temple-api
```

## Test routes

Requires a filled `.env` including `BINANCE_WS_URL` (Binance feed is started for the test process).

```bash
npm run test:routes
```

## Market-maker (in-process)

Uses **`getFairMid` from Binance** (same WS feed as the HTTP server). Run `npm run mm` only after **`BINANCE_WS_URL`** is set; the MM runner starts the Binance client before the loop.

```bash
npm run build
MM_DRY_RUN=true npm run mm
```

Dev: `npm run mm:dev`

Requires **`TEMPLE_WS_URL`** (same host family as docs: e.g. `wss://ws-dev.templedigitalgroup.com/v1/stream` on testnet). The MM connects to **Binance** (fair mid) and **Temple WS** (venue book mid) and applies **basis** widen/halt (`MM_BASIS_*` in `.env.example`).
Primary trigger is **event-driven** (Binance move >= `MM_REQUOTE_THRESHOLD_BPS` and Temple trade events). **`MM_SAFETY_RECONCILE_MS`** is only the slow safety / REST reconciliation timer (architecture §6). **`MM_POLL_MS` is still read as a legacy alias** for the same value if `MM_SAFETY_RECONCILE_MS` is unset.

## Routes

All routes except `/health` require: `Authorization: Bearer <SERVER_API_KEY>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness (no auth) |
| GET | `/holdings` | Balances |
| POST | `/holdings/merge` | Merge Amulet + USDCx UTXOs |
| POST | `/orders` | Create limit order (`POST /v1/orders/create`) |
| GET | `/orders` | Active orders |
| DELETE | `/orders/:orderId` | Cancel order |
| GET | `/market/ticker` | **Binance** BTC/USDT reference (`?symbol=` / `?templeSymbol=` labels Temple pair only) |
| GET | `/market/orderbook` | **Temple** book (basis check only) |
| GET | `/instruments` | Supported pairs + catalog |

## Example

```bash
curl http://localhost:$PORT/health
curl -H "Authorization: Bearer $SERVER_API_KEY" "http://localhost:$PORT/market/ticker"
```

See project root `INTEGRATION.md` for broader architecture.

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

# Temple SDK — README

This repository provides the Temple SDK service and supporting tooling for building trading and ledger-integrated applications. This README has been rewritten to highlight the primary technologies used in the project—especially Canton and DAML—and to give clear setup and development guidance.

## Highlights

- Core purpose: a Node/TypeScript HTTP API and background services that connect to Temple REST/WS and external market feeds (e.g. Binance) to expose holdings, market data, and order features.
- Primary smart-contract / ledger tech: DAML (for contract modeling) and Canton (as the multi-party ledger/runtime for private, secure DAML apps).
- The codebase is TypeScript (Node.js). Key runtime pieces also interact with WebSocket market feeds and external REST APIs.

## Tech stack

- DAML — The high-level language used to model financial contracts and workflows. DAML apps are compiled and deployed to ledgers.
- Canton — A multi-party ledger platform that can host DAML applications with privacy and multi-party execution guarantees. Canton provides the network and runtime for parties to run shared DAML contracts.
- Node.js + TypeScript — API, middlewares, and integration logic (the `src/` folder).
- WebSockets & REST — Live market feeds (Binance) and external venue integration (Temple APIs).

If you are new to DAML or Canton, the official docs are strongly recommended:

- DAML: https://docs.daml.com/
- Canton: https://www.digitalasset.com/canton (or the Canton repo/docs from your vendor)

## Quick start (developer)

Prerequisites

- Node.js (LTS, e.g. >=16 or a version your project requires)
- npm or yarn
- (If you work with DAML/Canton) DAML SDK and Canton tooling installed locally or accessible via CI/deployment environment

Install dependencies

```bash
# from repo root
npm install
```

Build and run

```bash
npm run build    # if present; otherwise `ts-node` or your preferred runner
npm start        # runs the service (if package.json defines start)
```

Note: If `package.json` uses other script names (e.g. `dev`, `mm`, `test:routes`), use those instead. Check `package.json` for exact scripts.

Environment

- Copy `.env.example` to `.env` and set the required environment variables for your environment. Typical values include API keys, network URLs, and feed endpoints (e.g. `BINANCE_WS_URL`, `TEMPLE_API_KEY`, `TEMPLE_WS_URL`, `SERVER_API_KEY`, `PORT`).

## DAML + Canton workflow (recommended)

This repository primarily contains the TypeScript service layer. If your project includes DAML contracts and you plan to use Canton for deployment, follow these steps as a high-level guide:

1. Model your agreements in DAML and keep DAML sources in a dedicated directory (e.g. `daml/` or `ledger/`).
2. Build DAML package(s):

  - daml build  # produces .dar files

3. Deploy to Canton (or your preferred ledger runtime):

  - Use your Canton tooling or operator scripts to create domains, participants, and to upload the DAML archive (.dar). The exact commands depend on your Canton installation and operator scripts.

4. Connect the Node service to Canton:

  - Use the Canton client libraries or a light-weight integration layer (for example an existing TypeScript/JS wrapper such as `temple-canton-js` if present) to submit commands and subscribe to events.
  - Configure connection parameters (host, port, TLS, credentials) in `.env`.

5. Run integration tests and system tests that exercise end-to-end behavior (smart contracts on Canton, plus the Node API and market feeds).

Important: DAML/Canton are large systems with specific operational requirements (certificates, parties, topology). Follow your organization's Canton/DAML runbook or the official docs for secure configuration and production setup.

## Project layout (top-level)

- `src/` — TypeScript source code
  - `index.ts` — entry point
  - `init.ts`, `mm-runner.ts` — initialization and market-maker runner
  - `feeds/` — market feed clients (e.g. `binance-book-ticker.ts`, `temple-ws.ts`)
  - `middleware/` — express middlewares (auth, etc.)
  - `routes/` — HTTP route handlers (holdings, instruments, market, merge, orders)
  - `services/` — integration services (trading logic, ledger adapters)
  - `types/` — project ambient/type declarations (e.g. `temple-canton-js.d.ts`)

Any DAML/Canton-specific code or configuration (if present) should be kept in a clearly named folder like `daml/` or `canton/`.

## Environment variables (examples)

- `PORT` — HTTP server port
- `SERVER_API_KEY` — API key for internal callers
- `TEMPLE_API_KEY` — Temple REST API key
- `TEMPLE_WS_URL` — Temple WebSocket URL for book/trade events
- `BINANCE_WS_URL` — Binance ws stream url for price reference
- `CANTON_*` — Canton connection details (host, port, TLS settings) — use names matching your deployment

Create a `.env.example` entry for any new variables and document them here when you add them.

## Development notes

- Keep DAML models and Node integration decoupled: DAML models describe the ledger's business logic; the Node service orchestrates off-ledger interactions, market feeds, and REST APIs.
- Tests: Add unit tests for service and route logic (Jest, Mocha, or your preferred runner). Add lightweight integration tests that mock external feeds and a separate suite for end-to-end testing against a Canton dev network.
- Security: Do not commit production keys. Use secret management for production deployments.

## Contributing

1. Fork the repo and create a feature branch.
2. Add tests for new behavior.
3. Open a PR describing the change.

If your change includes DAML contracts or Canton topology changes, include deployment instructions and any necessary operator steps.

## References

- DAML docs: https://docs.daml.com/
- Canton docs: vendor or org-provided Canton documentation

## License

See `LICENSE` in the repository root (or add one if missing).

---

If you'd like, I can also:

- add a small `daml/` README with commands to build `.dar` files and link to Canton deploy steps, or
- scaffold a `CONTRIBUTING.md` with a sample PR/test workflow.

Tell me which follow-up you'd like and I'll add it.

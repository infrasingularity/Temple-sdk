declare module '@temple-digital-group/temple-canton-js' {
  /** 1.x: async; REST via API_EMAIL/API_PASSWORD or API_KEY */
  export function initialize(cfg: Record<string, unknown>): Promise<unknown>;

  export function getUserBalances(party?: string | null, provider?: unknown): Promise<unknown[]>;

  export function createOrderProposal(
    orderArguments: {
      party: string;
      symbol: string;
      side: string;
      quantity: string;
      pricePerUnit: string;
      expiration: string;
      userId?: string;
      orderType?: string;
    },
    returnCommand?: boolean,
    provider?: unknown,
    amuletDisclosures?: unknown[]
  ): Promise<unknown>;

  export function getActiveOrders(options?: { symbol?: string; limit?: number }): Promise<unknown>;

  export function cancelOrder(orderId: string): Promise<unknown>;

  export function mergeAmuletHoldingsForParty(
    party: string,
    returnCommand?: boolean,
    provider?: unknown,
    maxUtxos?: number | null,
    amuletDisclosures?: unknown[]
  ): Promise<unknown>;

  export function mergeUtilityHoldingsForParty(
    party: string,
    utilityAsset: string,
    returnCommand?: boolean,
    provider?: unknown,
    maxUtxos?: number | null
  ): Promise<unknown>;

  export function getTicker(symbol?: string): Promise<unknown>;
  export function getOrderBook(symbol: string, options?: { levels?: number; precision?: number }): Promise<unknown>;
  export function getSupportedTradingPairs(): string[];
  export function getInstrumentCatalog(): Record<string, unknown>;
}

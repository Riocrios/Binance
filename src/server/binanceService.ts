import { generateSignalReport } from '../engine/signalEngine';
import type {
  ConnectionTelemetry,
  Kline,
  MarketMode,
  OrderBookSnapshot,
  ScannerFilters,
  SignalReport,
  SignalWeights,
  Ticker24h,
  Timeframe,
  WhaleEvent,
} from '../engine/types';

const STABLE_BASES = new Set([
  'USDC', 'BUSD', 'TUSD', 'USDP', 'FDUSD', 'DAI', 'USTC', 'USDD',
  'PAXG', 'AEUR', 'EUR', 'GBP', 'TRY', 'BRL', 'ARS', 'BIDR',
]);

export function isStablecoinSymbol(symbol: string): boolean {
  const up = symbol.toUpperCase();
  if (!up.endsWith('USDT')) return true;
  return STABLE_BASES.has(up.slice(0, -4));
}

export interface ScannerItem {
  ticker: Ticker24h;
  signal: SignalReport;
}

export interface SymbolDeepAnalysis {
  symbol: string;
  marketMode: MarketMode;
  timeframe: Timeframe;
  ticker: Ticker24h | null;
  klines: Kline[];
  orderBook: OrderBookSnapshot | null;
  signal: SignalReport;
}

export class BinanceLiveService {
  private marketMode: MarketMode = 'FUTURES';
  private activeSymbol = 'BTCUSDT';
  private apiKey = '';
  private apiKeyMasked: string | null = null;

  private telemetry: ConnectionTelemetry = {
    status: 'DISCONNECTED',
    marketMode: 'FUTURES',
    restPingMs: null,
    wsLatencyMs: null,
    wsConnected: false,
    lastDataUpdate: null,
    apiErrorsCount: 0,
    lastError: null,
    reconnectAttempts: 0,
    hasApiKey: false,
    apiKeyMasked: null,
  };

  private ws: WebSocket | null = null;
  private wsTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private rateLimitUntil = 0;

  private whaleEvents: WhaleEvent[] = [];
  private rollingTradeAvg = new Map<string, number>();
  private livePrices = new Map<string, number>();

  private scannerCache: { key: string; ts: number; items: ScannerItem[]; tickers: Ticker24h[] } | null = null;
  private symbolCache = new Map<string, { ts: number; data: SymbolDeepAnalysis }>();

  constructor(initialMode: MarketMode = 'FUTURES', initialSymbol = 'BTCUSDT') {
    this.marketMode = initialMode;
    this.activeSymbol = initialSymbol.toUpperCase();
    this.telemetry.marketMode = initialMode;
  }

  startWebSocket(): void {
    this.stopped = false;
    this.connectWs();
  }

  stop(): void {
    this.stopped = true;
    if (this.wsTimer) clearTimeout(this.wsTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  setMarketMode(mode: MarketMode): void {
    if (this.marketMode === mode) return;
    this.marketMode = mode;
    this.telemetry.marketMode = mode;
    this.scannerCache = null;
    this.symbolCache.clear();
    this.reconnectWs();
  }

  setActiveSymbol(symbol: string): void {
    const clean = symbol.trim().toUpperCase();
    if (!clean || clean === this.activeSymbol) return;
    this.activeSymbol = clean;
    this.reconnectWs();
  }

  setApiKey(apiKey: string, masked: string | null): void {
    this.apiKey = apiKey;
    this.apiKeyMasked = masked;
    this.telemetry.hasApiKey = Boolean(masked);
    this.telemetry.apiKeyMasked = masked;
  }

  getTelemetry(): ConnectionTelemetry {
    return {
      ...this.telemetry,
      hasApiKey: Boolean(this.apiKeyMasked),
      apiKeyMasked: this.apiKeyMasked,
    };
  }

  getLivePrices(): Record<string, number> {
    return Object.fromEntries(this.livePrices.entries());
  }

  getWhaleEvents(limit = 60): WhaleEvent[] {
    return this.whaleEvents.slice(0, limit);
  }

  private get restBase(): string {
    return this.marketMode === 'FUTURES'
      ? 'https://fapi.binance.com'
      : 'https://api.binance.com';
  }

  private reconnectWs(): void {
    if (this.wsTimer) clearTimeout(this.wsTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    if (!this.stopped) {
      this.connectWs();
    }
  }

  private connectWs(): void {
    if (this.stopped) return;
    const sym = this.activeSymbol.toLowerCase();
    const streams = [`${sym}@aggTrade`, `${sym}@miniTicker`];
    const url =
      this.marketMode === 'FUTURES'
        ? `wss://fstream.binance.com/stream?streams=${streams.join('/')}/!forceOrder@arr`
        : `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;

    try {
      const wsStart = performance.now();
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        this.telemetry.wsConnected = true;
        this.telemetry.reconnectAttempts = 0;
        this.telemetry.wsLatencyMs = Math.max(1, Math.round(performance.now() - wsStart));
        if (this.telemetry.status === 'DISCONNECTED' && this.telemetry.lastDataUpdate) {
          this.telemetry.status = 'CONNECTED';
        }
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          const stream: string = payload.stream || '';
          const data = payload.data || {};
          if (typeof data.E === 'number') {
            const diff = Date.now() - data.E;
            if (diff >= 0 && diff < 15000) {
              this.telemetry.wsLatencyMs = Math.max(1, Math.round(diff));
            }
          }
          if (stream.endsWith('@miniTicker') && data.s && data.c) {
            this.livePrices.set(String(data.s), Number(data.c));
          } else if (stream.endsWith('@aggTrade')) {
            this.handleWsAggTrade(this.activeSymbol, data);
          } else if (stream === '!forceOrder@arr') {
            this.handleWsLiquidation(data);
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onerror = () => {
        this.telemetry.wsConnected = false;
      };

      ws.onclose = () => {
        this.telemetry.wsConnected = false;
        if (!this.stopped) {
          this.telemetry.reconnectAttempts += 1;
          const delay = Math.min(12000, 1500 * this.telemetry.reconnectAttempts);
          this.wsTimer = setTimeout(() => this.connectWs(), delay);
        }
      };
    } catch (err) {
      this.telemetry.wsConnected = false;
      this.telemetry.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  private pushWhaleEvent(ev: WhaleEvent): void {
    this.whaleEvents.unshift(ev);
    if (this.whaleEvents.length > 120) {
      this.whaleEvents.length = 120;
    }
  }

  private handleWsAggTrade(symbol: string, d: Record<string, unknown>): void {
    const price = Number(d.p || 0);
    const qty = Number(d.q || 0);
    if (price <= 0 || qty <= 0) return;
    const notional = price * qty;
    const side: 'BUY' | 'SELL' = d.m ? 'SELL' : 'BUY';
    const prevAvg = this.rollingTradeAvg.get(symbol) ?? notional;
    const nextAvg = prevAvg * 0.96 + notional * 0.04;
    this.rollingTradeAvg.set(symbol, nextAvg);
    const dev = notional / Math.max(1, prevAvg);

    const minUsd = symbol === 'BTCUSDT' || symbol === 'ETHUSDT' ? 65_000 : 20_000;
    if (notional < minUsd && dev < 6) return;

    this.pushWhaleEvent({
      id: `${symbol}-${d.a || Date.now()}`,
      symbol,
      timestamp: Number(d.T || d.E || Date.now()),
      eventType: side === 'BUY' ? 'LARGE_BUY' : 'LARGE_SELL',
      side,
      price,
      quantity: qty,
      notionalUsd: Number(notional.toFixed(2)),
      deviationMultiple: Number(dev.toFixed(2)),
      marketImpact: notional >= minUsd * 3.5 ? 'HIGH' : notional >= minUsd * 1.6 ? 'MEDIUM' : 'LOW',
      note: `Large aggressive ${side.toLowerCase()} execution (${dev.toFixed(1)}x rolling average).`,
    });
  }

  private handleWsLiquidation(payload: Record<string, unknown>): void {
    const o = (payload.o || {}) as Record<string, unknown>;
    const symbol = String(o.s || '');
    const price = Number(o.ap || o.p || 0);
    const qty = Number(o.q || 0);
    if (!symbol || price <= 0 || qty <= 0) return;
    const notional = price * qty;
    if (notional < 10_000) return;
    const side: 'BUY' | 'SELL' = o.S === 'BUY' ? 'BUY' : 'SELL';
    const isLongLiq = side === 'SELL';

    this.pushWhaleEvent({
      id: `LIQ-${symbol}-${payload.E || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      symbol,
      timestamp: Number(payload.E || Date.now()),
      eventType: isLongLiq ? 'LONG_LIQUIDATION' : 'SHORT_LIQUIDATION',
      side,
      price,
      quantity: qty,
      notionalUsd: Number(notional.toFixed(2)),
      deviationMultiple: 10.0,
      marketImpact: notional >= 100_000 ? 'HIGH' : 'MEDIUM',
      note: `Forced ${isLongLiq ? 'LONG' : 'SHORT'} liquidation on USD-M Futures.`,
    });
  }

  private async fetchJson<T>(endpoint: string): Promise<T> {
    const now = Date.now();
    if (now < this.rateLimitUntil) {
      throw new Error(`Binance rate limit cooldown (${Math.ceil((this.rateLimitUntil - now) / 1000)}s)`);
    }
    const headers: Record<string, string> = { 'User-Agent': 'BinanceSmartTraderAI/1.0' };
    if (this.apiKey) headers['X-MBX-APIKEY'] = this.apiKey;

    const t0 = performance.now();
    try {
      const res = await fetch(`${this.restBase}${endpoint}`, {
        headers,
        signal: AbortSignal.timeout(8000),
      });
      const ping = Math.round(performance.now() - t0);

      if (res.status === 418 || res.status === 429) {
        const retry = Number(res.headers.get('Retry-After') || '15');
        this.rateLimitUntil = Date.now() + Math.max(5, retry) * 1000;
        throw new Error(`Binance rate limited (${res.status}), retry in ${retry}s`);
      }
      if (!res.ok) {
        throw new Error(`Binance HTTP ${res.status} on ${endpoint}`);
      }

      const json = (await res.json()) as T;
      this.telemetry.restPingMs = ping;
      this.telemetry.lastDataUpdate = Date.now();
      this.telemetry.status = 'CONNECTED';
      this.telemetry.lastError = null;
      return json;
    } catch (err) {
      this.telemetry.apiErrorsCount += 1;
      this.telemetry.lastError = err instanceof Error ? err.message : String(err);
      this.telemetry.status = 'DISCONNECTED';
      throw err;
    }
  }

  async fetchTickers24h(excludeStablecoins = true): Promise<Ticker24h[]> {
    const tickerPath =
      this.marketMode === 'FUTURES' ? '/fapi/v1/ticker/24hr' : '/api/v3/ticker/24hr';
    const rawTickers = await this.fetchJson<Record<string, string>[]>(tickerPath);

    const bookMap = new Map<string, { bid: number; ask: number }>();
    const premMap = new Map<string, { mark: number; funding: number }>();

    if (this.marketMode === 'FUTURES') {
      const [books, prems] = await Promise.allSettled([
        this.fetchJson<Record<string, string>[]>('/fapi/v1/ticker/bookTicker'),
        this.fetchJson<Record<string, string>[]>('/fapi/v1/premiumIndex'),
      ]);
      if (books.status === 'fulfilled') {
        for (const b of books.value) {
          bookMap.set(b.symbol, {
            bid: Number(b.bidPrice || 0),
            ask: Number(b.askPrice || 0),
          });
        }
      }
      if (prems.status === 'fulfilled') {
        for (const p of prems.value) {
          premMap.set(p.symbol, {
            mark: Number(p.markPrice || 0),
            funding: Number(p.lastFundingRate || 0),
          });
        }
      }
    }

    const out: Ticker24h[] = [];
    for (const item of rawTickers) {
      const symbol = String(item.symbol || '');
      if (!symbol.endsWith('USDT')) continue;
      if (excludeStablecoins && isStablecoinSymbol(symbol)) continue;

      const lastPrice = Number(item.lastPrice || 0);
      const quoteVolume = Number(item.quoteVolume || 0);
      const highPrice = Number(item.highPrice || 0);
      const lowPrice = Number(item.lowPrice || 0);
      const priceChangePercent = Number(item.priceChangePercent || 0);
      if (lastPrice <= 0 || quoteVolume <= 0) continue;

      this.livePrices.set(symbol, lastPrice);
      const bk = bookMap.get(symbol);
      const bidPrice = bk?.bid || Number(item.bidPrice || lastPrice);
      const askPrice = bk?.ask || Number(item.askPrice || lastPrice);
      const spreadPct =
        bidPrice > 0 && askPrice >= bidPrice
          ? ((askPrice - bidPrice) / lastPrice) * 100
          : 0;
      const volatilityPct =
        highPrice > lowPrice ? ((highPrice - lowPrice) / lastPrice) * 100 : 0;
      const prem = premMap.get(symbol);

      out.push({
        symbol,
        lastPrice,
        priceChangePercent,
        quoteVolume,
        highPrice,
        lowPrice,
        bidPrice,
        askPrice,
        spreadPct: Number(spreadPct.toFixed(4)),
        volatilityPct: Number(volatilityPct.toFixed(2)),
        markPrice: prem?.mark ?? lastPrice,
        fundingRate: prem?.funding ?? 0,
      });
    }
    return out;
  }

  async fetchKlines(symbol: string, interval: Timeframe, limit = 200): Promise<Kline[]> {
    const endpoint =
      this.marketMode === 'FUTURES'
        ? `/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
        : `/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const raw = await this.fetchJson<(string | number)[][]>(endpoint);
    return raw.map((r) => ({
      openTime: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
      closeTime: Number(r[6]),
      quoteVolume: Number(r[7]),
      trades: Number(r[8]),
      takerBuyBaseVolume: Number(r[9]),
      takerBuyQuoteVolume: Number(r[10]),
    }));
  }

  async fetchOrderBook(symbol: string, limit = 20): Promise<OrderBookSnapshot> {
    const endpoint =
      this.marketMode === 'FUTURES'
        ? `/fapi/v1/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`
        : `/api/v3/depth?symbol=${symbol.toUpperCase()}&limit=${limit}`;
    const raw = await this.fetchJson<{ bids: [string, string][]; asks: [string, string][] }>(
      endpoint,
    );
    const bids = raw.bids || [];
    const asks = raw.asks || [];
    if (bids.length === 0 || asks.length === 0) {
      throw new Error(`Empty order book for ${symbol}`);
    }
    const bestBid = Number(bids[0][0]);
    const bestAsk = Number(asks[0][0]);
    const mid = (bestBid + bestAsk) / 2;
    const spreadPct = mid > 0 ? ((bestAsk - bestBid) / mid) * 100 : 0;
    const bidDepthUsd = bids.reduce((acc, [p, q]) => acc + Number(p) * Number(q), 0);
    const askDepthUsd = asks.reduce((acc, [p, q]) => acc + Number(p) * Number(q), 0);
    const total = bidDepthUsd + askDepthUsd;
    return {
      bestBid,
      bestAsk,
      spreadPct: Number(spreadPct.toFixed(4)),
      bidDepthUsd: Number(bidDepthUsd.toFixed(2)),
      askDepthUsd: Number(askDepthUsd.toFixed(2)),
      imbalanceRatio: total > 0 ? Number(((bidDepthUsd - askDepthUsd) / total).toFixed(4)) : 0,
      updatedAt: Date.now(),
    };
  }

  async fetchRecentAggTrades(symbol: string, limit = 60): Promise<void> {
    const endpoint =
      this.marketMode === 'FUTURES'
        ? `/fapi/v1/aggTrades?symbol=${symbol.toUpperCase()}&limit=${limit}`
        : `/api/v3/aggTrades?symbol=${symbol.toUpperCase()}&limit=${limit}`;
    const trades = await this.fetchJson<Record<string, unknown>[]>(endpoint);
    if (trades.length === 0) return;
    const notionals = trades.map((t) => Number(t.p || 0) * Number(t.q || 0)).filter((n) => n > 0);
    const avg = notionals.reduce((a, b) => a + b, 0) / Math.max(1, notionals.length);
    this.rollingTradeAvg.set(symbol, avg);

    const threshold = Math.max(avg * 4.5, symbol === 'BTCUSDT' || symbol === 'ETHUSDT' ? 45_000 : 18_000);
    for (const t of trades) {
      const price = Number(t.p || 0);
      const qty = Number(t.q || 0);
      const notional = price * qty;
      if (notional >= threshold) {
        const id = `${symbol}-${t.a}`;
        if (this.whaleEvents.some((e) => e.id === id)) continue;
        const side: 'BUY' | 'SELL' = t.m ? 'SELL' : 'BUY';
        const dev = notional / Math.max(1, avg);
        this.pushWhaleEvent({
          id,
          symbol,
          timestamp: Number(t.T || Date.now()),
          eventType: side === 'BUY' ? 'LARGE_BUY' : 'LARGE_SELL',
          side,
          price,
          quantity: qty,
          notionalUsd: Number(notional.toFixed(2)),
          deviationMultiple: Number(dev.toFixed(2)),
          marketImpact: dev >= 8 ? 'HIGH' : 'MEDIUM',
          note: `Aggressive ${side} execution (${dev.toFixed(1)}x sample average).`,
        });
      }
    }
  }

  async scanMarket(params: {
    weights: SignalWeights;
    filters: ScannerFilters;
    minRiskReward: number;
    maxPairs?: number;
  }): Promise<{
    items: ScannerItem[];
    btcTicker: Ticker24h | null;
    ethTicker: Ticker24h | null;
    totalQualifiedPairs: number;
  }> {
    const cacheKey = `${this.marketMode}:${params.filters.aggressiveness}:${params.filters.minVolume24hUsd}:${params.filters.excludeStablecoins}:${JSON.stringify(params.weights)}`;
    if (this.scannerCache && this.scannerCache.key === cacheKey && Date.now() - this.scannerCache.ts < 7000) {
      const btc = this.scannerCache.tickers.find((t) => t.symbol === 'BTCUSDT') ?? null;
      const eth = this.scannerCache.tickers.find((t) => t.symbol === 'ETHUSDT') ?? null;
      return {
        items: this.scannerCache.items,
        btcTicker: btc,
        ethTicker: eth,
        totalQualifiedPairs: this.scannerCache.items.length,
      };
    }

    const tickers = await this.fetchTickers24h(params.filters.excludeStablecoins);
    const qualified = tickers
      .filter(
        (t) =>
          t.quoteVolume >= params.filters.minVolume24hUsd &&
          t.spreadPct <= params.filters.maxSpreadPct &&
          t.volatilityPct >= params.filters.minVolatilityPct,
      )
      .sort((a, b) => b.quoteVolume - a.quoteVolume);

    // Ensure BTCUSDT & ETHUSDT are always included if available
    const topSet = qualified.slice(0, params.maxPairs ?? 18);
    for (const mustSym of ['BTCUSDT', 'ETHUSDT']) {
      if (!topSet.some((t) => t.symbol === mustSym)) {
        const found = tickers.find((t) => t.symbol === mustSym);
        if (found) topSet.unshift(found);
      }
    }

    const results: ScannerItem[] = [];
    // Bounded concurrency of 6 requests at a time
    for (let i = 0; i < topSet.length; i += 6) {
      const batch = topSet.slice(i, i + 6);
      const settled = await Promise.allSettled(
        batch.map(async (ticker) => {
          const [k15, k1h, k4h, k5] = await Promise.all([
            this.fetchKlines(ticker.symbol, '15m', 150),
            this.fetchKlines(ticker.symbol, '1h', 120),
            this.fetchKlines(ticker.symbol, '4h', 90),
            this.fetchKlines(ticker.symbol, '5m', 120),
          ]);
          const signal = generateSignalReport({
            symbol: ticker.symbol,
            marketMode: this.marketMode,
            primaryKlines: k15,
            timeframeKlines: { '5m': k5, '15m': k15, '1h': k1h, '4h': k4h },
            orderBook: {
              bestBid: ticker.bidPrice,
              bestAsk: ticker.askPrice,
              spreadPct: ticker.spreadPct,
              bidDepthUsd: 0,
              askDepthUsd: 0,
              imbalanceRatio: 0,
              updatedAt: Date.now(),
            },
            livePrice: ticker.lastPrice,
            lastUpdatedAt: Date.now(),
            weights: params.weights,
            aggressiveness: params.filters.aggressiveness,
            minRiskReward: params.minRiskReward,
            maxSpreadPct: params.filters.maxSpreadPct,
          });
          return { ticker, signal };
        }),
      );
      for (const s of settled) {
        if (s.status === 'fulfilled') results.push(s.value);
      }
    }

    this.scannerCache = {
      key: cacheKey,
      ts: Date.now(),
      items: results,
      tickers,
    };

    const btcTicker = tickers.find((t) => t.symbol === 'BTCUSDT') ?? null;
    const ethTicker = tickers.find((t) => t.symbol === 'ETHUSDT') ?? null;
    return {
      items: results,
      btcTicker,
      ethTicker,
      totalQualifiedPairs: qualified.length,
    };
  }

  async analyzeSymbol(params: {
    symbol: string;
    timeframe: Timeframe;
    weights: SignalWeights;
    filters: ScannerFilters;
    minRiskReward: number;
  }): Promise<SymbolDeepAnalysis> {
    const sym = params.symbol.toUpperCase();
    this.setActiveSymbol(sym);
    const cacheKey = `${this.marketMode}:${sym}:${params.timeframe}:${params.filters.aggressiveness}`;
    const cached = this.symbolCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < 3500) {
      return cached.data;
    }

    const tfsNeeded: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
    const [kMain, ob, tickers] = await Promise.all([
      this.fetchKlines(sym, params.timeframe, 220),
      this.fetchOrderBook(sym, 20).catch(() => null),
      this.fetchTickers24h(false).catch(() => []),
      this.fetchRecentAggTrades(sym, 60).catch(() => undefined),
    ]);

    const otherTfs = tfsNeeded.filter((t) => t !== params.timeframe);
    const tfResults = await Promise.allSettled(
      otherTfs.map(async (tf) => ({ tf, data: await this.fetchKlines(sym, tf, 120) })),
    );
    const tfMap: Partial<Record<Timeframe, Kline[]>> = { [params.timeframe]: kMain };
    for (const r of tfResults) {
      if (r.status === 'fulfilled') {
        tfMap[r.value.tf] = r.value.data;
      }
    }

    const ticker = tickers.find((t) => t.symbol === sym) ?? null;
    const livePrice = ticker?.lastPrice ?? kMain[kMain.length - 1]?.close ?? 0;

    const signal = generateSignalReport({
      symbol: sym,
      marketMode: this.marketMode,
      primaryKlines: tfMap['15m'] ?? kMain,
      timeframeKlines: tfMap,
      orderBook: ob,
      livePrice,
      lastUpdatedAt: Date.now(),
      weights: params.weights,
      aggressiveness: params.filters.aggressiveness,
      minRiskReward: params.minRiskReward,
      maxSpreadPct: params.filters.maxSpreadPct,
    });

    const data: SymbolDeepAnalysis = {
      symbol: sym,
      marketMode: this.marketMode,
      timeframe: params.timeframe,
      ticker,
      klines: kMain,
      orderBook: ob,
      signal,
    };
    this.symbolCache.set(cacheKey, { ts: Date.now(), data });
    return data;
  }
}

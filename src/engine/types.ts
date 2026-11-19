export type MarketMode = 'FUTURES' | 'SPOT';

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d';

export type SignalDirection = 'LONG' | 'SHORT' | 'WAIT';

export type EntryState =
  | 'SCANNING'
  | 'WATCHLIST'
  | 'WAITING CONFIRMATION'
  | 'ENTRY READY'
  | 'SIGNAL ACTIVE'
  | 'POSITION TRACKING'
  | 'EXIT WARNING'
  | 'CLOSED'
  | 'INVALIDATED';

export type MomentumStrength = 'WEAK' | 'MODERATE' | 'STRONG' | 'EXTREME';

export type StrategyAggressiveness = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE';

export interface Kline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  trades: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface OrderBookSnapshot {
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalanceRatio: number; // -1 (ask heavy) to +1 (bid heavy)
  updatedAt: number;
}

export interface Ticker24h {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
  bidPrice: number;
  askPrice: number;
  spreadPct: number;
  markPrice?: number;
  fundingRate?: number;
  openInterestUsd?: number;
  volatilityPct: number;
}

export interface SignalWeights {
  trend: number;
  momentum: number;
  volume: number;
  structure: number;
  orderFlow: number;
  volatility: number;
}

export interface ScannerFilters {
  minVolume24hUsd: number;
  maxSpreadPct: number;
  minVolatilityPct: number;
  excludeStablecoins: boolean;
  aggressiveness: StrategyAggressiveness;
}

export interface FactorScoreBreakdown {
  trendLong: number;
  trendShort: number;
  momentumLong: number;
  momentumShort: number;
  volumeLong: number;
  volumeShort: number;
  structureLong: number;
  structureShort: number;
  orderFlowLong: number;
  orderFlowShort: number;
  volatilityLong: number;
  volatilityShort: number;
}

export interface TimeframeBias {
  timeframe: Timeframe;
  direction: SignalDirection;
  emaAlignment: 'BULLISH' | 'BEARISH' | 'MIXED';
  rsi: number;
  macdHist: number;
  adxLikeStrength: number;
}

export interface MomentumReport {
  strength: MomentumStrength;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  stochRsiK: number;
  stochRsiD: number;
  roc10: number;
  rsiDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  macdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  exhaustionWarning: string | null;
}

export interface VolumeReport {
  currentVolume: number;
  avgVolume20: number;
  avgVolume50: number;
  rvol20: number;
  rvol50: number;
  isSpike: boolean;
  buySellRatio: number;
  volumeDelta: number;
  obvTrend: 'RISING' | 'FALLING' | 'FLAT';
  regime: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL';
}

export interface MarketStructureReport {
  swingHighs: number[];
  swingLows: number[];
  pattern: 'HH/HL' | 'LH/LL' | 'RANGING';
  bos: 'BULLISH' | 'BEARISH' | 'NONE';
  choch: 'BULLISH' | 'BEARISH' | 'NONE';
  support: number;
  resistance: number;
  breakout: 'BULLISH' | 'BEARISH' | 'FALSE_BULLISH' | 'FALSE_BEARISH' | 'NONE';
}

export interface ExitPlan {
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  breakEvenTrigger: number;
  trailingStopDistance: number;
  partialCloseRules: string[];
  fullExitRules: string[];
  invalidationCondition: string;
}

export interface SignalReport {
  symbol: string;
  marketMode: MarketMode;
  timestamp: number;
  price: number;
  direction: SignalDirection;
  longScore: number;
  shortScore: number;
  activeScore: number;
  entryState: EntryState;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: number;
  reasons: string[];
  warnings: string[];
  invalidation: string;
  breakdown: FactorScoreBreakdown;
  timeframeBiases: TimeframeBias[];
  momentum: MomentumReport;
  volume: VolumeReport;
  structure: MarketStructureReport;
  exitPlan: ExitPlan;
  lateEntryBlocked: boolean;
  dataStale: boolean;
}

export interface RiskConfig {
  virtualBalance: number;
  riskPerTradePct: number;
  maxDailyLossPct: number;
  maxOpenPositions: number;
  minRiskReward: number;
  maxSpreadPct: number;
  maxSlippagePct: number;
  leverage: number;
  takerFeePct: number;
  fundingRatePctPer8h: number;
}

export interface RiskEvaluation {
  approved: boolean;
  rejectionReasons: string[];
  riskAmountUsd: number;
  stopDistance: number;
  stopDistancePct: number;
  positionSizeQty: number;
  notionalValueUsd: number;
  requiredMarginUsd: number;
  estimatedEntryFeeUsd: number;
  estimatedExitFeeUsd: number;
  estimatedSlippageUsd: number;
  estimatedFundingUsd: number;
  totalExecutionCostUsd: number;
  grossProfitTp1Usd: number;
  netProfitTp1Usd: number;
  grossProfitTp2Usd: number;
  netProfitTp2Usd: number;
  netMaxLossUsd: number;
  netMaxLossPctBalance: number;
  netProfitTp2PctBalance: number;
  effectiveRiskReward: number;
}

export interface WhaleEvent {
  id: string;
  symbol: string;
  timestamp: number;
  eventType: 'LARGE_BUY' | 'LARGE_SELL' | 'LONG_LIQUIDATION' | 'SHORT_LIQUIDATION' | 'VOLUME_BURST';
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  notionalUsd: number;
  deviationMultiple: number;
  marketImpact: 'HIGH' | 'MEDIUM' | 'LOW';
  note: string;
}

export interface JournalEntry {
  id: number;
  createdAt: number;
  symbol: string;
  marketMode: MarketMode;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  score: number;
  riskReward: number;
  positionSizeQty: number;
  notionalUsd: number;
  feesUsd: number;
  slippageUsd: number;
  status: 'OPEN' | 'TP1_HIT' | 'TP2_HIT' | 'SL_HIT' | 'MANUAL_CLOSED' | 'INVALIDATED';
  exitPrice: number | null;
  closedAt: number | null;
  holdDurationMs: number | null;
  closeReason: string | null;
  realizedPnlUsd: number | null;
  realizedR: number | null;
  notes: string;
}

export interface JournalStats {
  totalSignals: number;
  openSignals: number;
  winningSignals: number;
  losingSignals: number;
  winRatePct: number;
  averageR: number;
  netPnlUsd: number;
  maxDrawdownPct: number;
  profitFactor: number;
  longWinRatePct: number;
  longNetPnlUsd: number;
  shortWinRatePct: number;
  shortNetPnlUsd: number;
}

export interface BacktestParams {
  symbol: string;
  timeframe: Timeframe;
  marketMode: MarketMode;
  limit: number;
  initialBalance: number;
  riskPerTradePct: number;
  commissionPct: number;
  slippagePct: number;
  minScore: number;
  minRiskReward: number;
  aggressiveness: StrategyAggressiveness;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  direction: 'LONG' | 'SHORT';
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  takeProfit: number;
  score: number;
  rMultiple: number;
  pnlUsd: number;
  feesAndSlippageUsd: number;
  exitReason: string;
  segment: 'IN_SAMPLE' | 'OUT_OF_SAMPLE';
}

export interface BacktestSegmentMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRatePct: number;
  netPnlUsd: number;
  profitFactor: number;
  maxDrawdownPct: number;
  averageR: number;
}

export interface BacktestResult {
  symbol: string;
  timeframe: Timeframe;
  marketMode: MarketMode;
  candlesAnalyzed: number;
  inSample: BacktestSegmentMetrics;
  outOfSample: BacktestSegmentMetrics;
  overall: BacktestSegmentMetrics;
  equityCurve: { time: number; equity: number; segment: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' }[];
  trades: BacktestTrade[];
  params: BacktestParams;
}

export interface ConnectionTelemetry {
  status: 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED';
  marketMode: MarketMode;
  restPingMs: number | null;
  wsLatencyMs: number | null;
  wsConnected: boolean;
  lastDataUpdate: number | null;
  apiErrorsCount: number;
  lastError: string | null;
  reconnectAttempts: number;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
}

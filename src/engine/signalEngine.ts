import {
  atr,
  bollingerBands,
  detectDivergence,
  detectMarketStructure,
  ema,
  macd,
  obv,
  relativeVolume,
  roc,
  rsi,
  stochRsi,
  volumeDeltaMetrics,
} from './indicators';
import type {
  EntryState,
  FactorScoreBreakdown,
  Kline,
  MarketMode,
  MomentumReport,
  MomentumStrength,
  OrderBookSnapshot,
  SignalDirection,
  SignalReport,
  SignalWeights,
  StrategyAggressiveness,
  Timeframe,
  TimeframeBias,
  VolumeReport,
} from './types';

export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  trend: 25,
  momentum: 20,
  volume: 20,
  structure: 15,
  orderFlow: 10,
  volatility: 10,
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function analyzeTimeframeBias(timeframe: Timeframe, klines: Kline[]): TimeframeBias {
  const closed = klines.length > 2 ? klines.slice(0, -1) : klines;
  const closes = closed.map((k) => k.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsiArr = rsi(closes, 14);
  const macdRes = macd(closes);

  const idx = closes.length - 1;
  const e9 = ema9[idx] ?? closes[idx] ?? 0;
  const e21 = ema21[idx] ?? closes[idx] ?? 0;
  const e50 = ema50[idx] ?? closes[idx] ?? 0;
  const r = rsiArr[idx] ?? 50;
  const h = macdRes.histogram[idx] ?? 0;

  let emaAlignment: 'BULLISH' | 'BEARISH' | 'MIXED' = 'MIXED';
  if (e9 > e21 && e21 > e50) emaAlignment = 'BULLISH';
  else if (e9 < e21 && e21 < e50) emaAlignment = 'BEARISH';

  let direction: SignalDirection = 'WAIT';
  if (emaAlignment === 'BULLISH' && r > 50 && h >= 0) direction = 'LONG';
  else if (emaAlignment === 'BEARISH' && r < 50 && h <= 0) direction = 'SHORT';
  else if (e9 > e21 && r > 54 && h > 0) direction = 'LONG';
  else if (e9 < e21 && r < 46 && h < 0) direction = 'SHORT';

  const spread = e21 > 0 ? Math.abs((e9 - e50) / e21) * 100 : 0;
  const strength = clamp(spread * 25 + Math.abs(r - 50) * 1.2, 0, 100);

  return {
    timeframe,
    direction,
    emaAlignment,
    rsi: r,
    macdHist: h,
    adxLikeStrength: strength,
  };
}

export interface AnalyzeSignalInput {
  symbol: string;
  marketMode: MarketMode;
  primaryKlines: Kline[]; // Typically 5m or 15m
  timeframeKlines: Partial<Record<Timeframe, Kline[]>>;
  orderBook: OrderBookSnapshot | null;
  livePrice: number;
  lastUpdatedAt: number;
  now?: number;
  weights?: SignalWeights;
  aggressiveness?: StrategyAggressiveness;
  minRiskReward?: number;
  maxSpreadPct?: number;
  maxStaleMs?: number;
}

export function generateSignalReport(input: AnalyzeSignalInput): SignalReport {
  const now = input.now ?? Date.now();
  const weights = input.weights ?? DEFAULT_SIGNAL_WEIGHTS;
  const aggressiveness = input.aggressiveness ?? 'BALANCED';
  const minRiskReward = input.minRiskReward ?? 1.8;
  const maxSpreadPct = input.maxSpreadPct ?? 0.15;
  const maxStaleMs = input.maxStaleMs ?? 45_000;

  // Strictly analyze closed candles for signal confirmation (§10)
  const closed =
    input.primaryKlines.length > 30
      ? input.primaryKlines.slice(0, -1)
      : input.primaryKlines;

  const dataStale =
    closed.length < 60 || now - input.lastUpdatedAt > maxStaleMs || input.livePrice <= 0;

  const closes = closed.map((k) => k.close);
  const idx = closes.length - 1;
  const lastClosed = closed[idx];
  const refPrice = input.livePrice > 0 ? input.livePrice : lastClosed?.close ?? 0;

  const ema9Arr = ema(closes, 9);
  const ema21Arr = ema(closes, 21);
  const ema50Arr = ema(closes, 50);
  const ema200Arr = ema(closes, 200);
  const rsiArr = rsi(closes, 14);
  const macdRes = macd(closes);
  const sRsi = stochRsi(closes);
  const rocArr = roc(closes, 10);
  const atrArr = atr(closed, 14);
  const bb = bollingerBands(closes, 20, 2);
  const obvArr = obv(closed);
  const rvol = relativeVolume(closed);
  const vDelta = volumeDeltaMetrics(closed, 20);
  const structure = detectMarketStructure(closed, 3);

  const e9 = ema9Arr[idx] ?? refPrice;
  const e21 = ema21Arr[idx] ?? refPrice;
  const e50 = ema50Arr[idx] ?? refPrice;
  const e200 = ema200Arr[idx] ?? e50;
  const currentRsi = rsiArr[idx] ?? 50;
  const prevRsi = rsiArr[idx - 1] ?? currentRsi;
  const macdVal = macdRes.macdLine[idx] ?? 0;
  const macdSig = macdRes.signalLine[idx] ?? 0;
  const macdHist = macdRes.histogram[idx] ?? 0;
  const prevMacdHist = macdRes.histogram[idx - 1] ?? macdHist;
  const currentRoc = rocArr[idx] ?? 0;
  const currentAtr = atrArr[idx] ?? refPrice * 0.01;
  const bbUpper = bb.upper[idx] ?? refPrice * 1.02;
  const bbLower = bb.lower[idx] ?? refPrice * 0.98;
  const bbWidth = bb.bandwidthPct[idx] ?? 2;
  const prevBbWidth = bb.bandwidthPct[Math.max(0, idx - 5)] ?? bbWidth;

  const rsiDiv = detectDivergence(closes, rsiArr, 18);
  const macdDiv = detectDivergence(closes, macdRes.histogram, 18);

  // Multi-timeframe biases
  const tfOrder: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  const timeframeBiases: TimeframeBias[] = tfOrder
    .filter((tf) => (input.timeframeKlines[tf]?.length ?? 0) >= 35)
    .map((tf) => analyzeTimeframeBias(tf, input.timeframeKlines[tf]!));

  const bias4h = timeframeBiases.find((b) => b.timeframe === '4h');
  const bias1h = timeframeBiases.find((b) => b.timeframe === '1h');
  const bias15m = timeframeBiases.find((b) => b.timeframe === '15m');
  const bias5m = timeframeBiases.find((b) => b.timeframe === '5m');

  // 1. TREND FACTOR (0..100 each direction)
  let trendLong = 0;
  let trendShort = 0;
  if (e9 > e21) trendLong += 25;
  else if (e9 < e21) trendShort += 25;
  if (e21 > e50) trendLong += 25;
  else if (e21 < e50) trendShort += 25;
  if (refPrice > e200) trendLong += 20;
  else if (refPrice < e200) trendShort += 20;

  if (bias4h?.direction === 'LONG') trendLong += 15;
  else if (bias4h?.direction === 'SHORT') trendShort += 15;
  if (bias1h?.direction === 'LONG') trendLong += 15;
  else if (bias1h?.direction === 'SHORT') trendShort += 15;

  // 2. MOMENTUM FACTOR (0..100 each direction)
  let momentumLong = 0;
  let momentumShort = 0;
  if (currentRsi >= 52 && currentRsi <= 72) momentumLong += 30;
  else if (currentRsi > 72) momentumLong += 12; // near overbought
  if (currentRsi <= 48 && currentRsi >= 28) momentumShort += 30;
  else if (currentRsi < 28) momentumShort += 12; // near oversold

  if (currentRsi > prevRsi && currentRsi > 48) momentumLong += 10;
  if (currentRsi < prevRsi && currentRsi < 52) momentumShort += 10;

  if (macdVal > macdSig && macdHist > 0) momentumLong += 25;
  else if (macdVal < macdSig && macdHist < 0) momentumShort += 25;
  if (macdHist > prevMacdHist && macdHist > 0) momentumLong += 10;
  if (macdHist < prevMacdHist && macdHist < 0) momentumShort += 10;

  if (sRsi.k > sRsi.d && sRsi.k < 80) momentumLong += 15;
  if (sRsi.k < sRsi.d && sRsi.k > 20) momentumShort += 15;
  if (currentRoc > 0.25) momentumLong += 10;
  if (currentRoc < -0.25) momentumShort += 10;

  if (rsiDiv === 'BULLISH' || macdDiv === 'BULLISH') momentumLong = clamp(momentumLong + 15, 0, 100);
  if (rsiDiv === 'BEARISH' || macdDiv === 'BEARISH') momentumShort = clamp(momentumShort + 15, 0, 100);

  // 3. VOLUME FACTOR (0..100)
  let volumeLong = 0;
  let volumeShort = 0;
  const obvDelta =
    obvArr.length >= 10
      ? obvArr[obvArr.length - 1] - obvArr[obvArr.length - 10]
      : 0;
  const obvTrend: 'RISING' | 'FALLING' | 'FLAT' =
    obvDelta > 0 ? 'RISING' : obvDelta < 0 ? 'FALLING' : 'FLAT';

  if (rvol.rvol20 >= 1.2) {
    if (vDelta.buySellRatio >= 1.1) volumeLong += 35;
    if (vDelta.buySellRatio <= 0.9) volumeShort += 35;
  }
  if (rvol.isSpike) {
    if (lastClosed && lastClosed.close > lastClosed.open) volumeLong += 25;
    if (lastClosed && lastClosed.close < lastClosed.open) volumeShort += 25;
  }
  if (vDelta.cumulativeDelta > 0) volumeLong += 20;
  else if (vDelta.cumulativeDelta < 0) volumeShort += 20;
  if (obvTrend === 'RISING') volumeLong += 20;
  else if (obvTrend === 'FALLING') volumeShort += 20;

  // 4. MARKET STRUCTURE FACTOR (0..100)
  let structureLong = 20;
  let structureShort = 20;
  if (structure.pattern === 'HH/HL') {
    structureLong += 40;
    structureShort -= 10;
  } else if (structure.pattern === 'LH/LL') {
    structureShort += 40;
    structureLong -= 10;
  }
  if (structure.bos === 'BULLISH' || structure.choch === 'BULLISH') structureLong += 25;
  if (structure.bos === 'BEARISH' || structure.choch === 'BEARISH') structureShort += 25;
  if (structure.breakout === 'BULLISH') structureLong += 15;
  if (structure.breakout === 'BEARISH') structureShort += 15;
  if (structure.breakout === 'FALSE_BULLISH') structureShort += 20;
  if (structure.breakout === 'FALSE_BEARISH') structureLong += 20;

  // 5. ORDER FLOW FACTOR (0..100)
  let orderFlowLong = 35;
  let orderFlowShort = 35;
  if (input.orderBook) {
    const imb = input.orderBook.imbalanceRatio;
    if (imb > 0.12) orderFlowLong += clamp(imb * 90, 0, 45);
    else if (imb < -0.12) orderFlowShort += clamp(Math.abs(imb) * 90, 0, 45);
  }
  if (vDelta.buySellRatio > 1.25) orderFlowLong += 20;
  if (vDelta.buySellRatio < 0.8) orderFlowShort += 20;

  // 6. VOLATILITY FACTOR (0..100)
  let volatilityLong = 45;
  let volatilityShort = 45;
  const expanding = bbWidth > prevBbWidth * 1.08;
  const atrPct = refPrice > 0 ? (currentAtr / refPrice) * 100 : 0;
  if (atrPct >= 0.25 && atrPct <= 4.5) {
    volatilityLong += 25;
    volatilityShort += 25;
  }
  if (expanding && refPrice > bb.middle[idx]!) volatilityLong += 25;
  if (expanding && refPrice < bb.middle[idx]!) volatilityShort += 25;
  if (refPrice > bbUpper) volatilityLong -= 15; // stretched above upper band
  if (refPrice < bbLower) volatilityShort -= 15; // stretched below lower band

  const breakdown: FactorScoreBreakdown = {
    trendLong: clamp(Math.round(trendLong), 0, 100),
    trendShort: clamp(Math.round(trendShort), 0, 100),
    momentumLong: clamp(Math.round(momentumLong), 0, 100),
    momentumShort: clamp(Math.round(momentumShort), 0, 100),
    volumeLong: clamp(Math.round(volumeLong), 0, 100),
    volumeShort: clamp(Math.round(volumeShort), 0, 100),
    structureLong: clamp(Math.round(structureLong), 0, 100),
    structureShort: clamp(Math.round(structureShort), 0, 100),
    orderFlowLong: clamp(Math.round(orderFlowLong), 0, 100),
    orderFlowShort: clamp(Math.round(orderFlowShort), 0, 100),
    volatilityLong: clamp(Math.round(volatilityLong), 0, 100),
    volatilityShort: clamp(Math.round(volatilityShort), 0, 100),
  };

  const wSum =
    weights.trend +
    weights.momentum +
    weights.volume +
    weights.structure +
    weights.orderFlow +
    weights.volatility || 100;

  const longScore = Math.round(
    (breakdown.trendLong * weights.trend +
      breakdown.momentumLong * weights.momentum +
      breakdown.volumeLong * weights.volume +
      breakdown.structureLong * weights.structure +
      breakdown.orderFlowLong * weights.orderFlow +
      breakdown.volatilityLong * weights.volatility) /
      wSum,
  );

  const shortScore = Math.round(
    (breakdown.trendShort * weights.trend +
      breakdown.momentumShort * weights.momentum +
      breakdown.volumeShort * weights.volume +
      breakdown.structureShort * weights.structure +
      breakdown.orderFlowShort * weights.orderFlow +
      breakdown.volatilityShort * weights.volatility) /
      wSum,
  );

  const thresholdMap: Record<StrategyAggressiveness, { minScore: number; minGap: number }> = {
    CONSERVATIVE: { minScore: 72, minGap: 18 },
    BALANCED: { minScore: 65, minGap: 14 },
    AGGRESSIVE: { minScore: 58, minGap: 10 },
  };
  const { minScore, minGap } = thresholdMap[aggressiveness];

  let direction: SignalDirection = 'WAIT';
  const warnings: string[] = [];

  if (dataStale) {
    warnings.push('Market data stale or insufficient closed candles; new signals blocked.');
  } else {
    if (longScore >= minScore && longScore - shortScore >= minGap) {
      direction = 'LONG';
    } else if (shortScore >= minScore && shortScore - longScore >= minGap) {
      direction = 'SHORT';
    }
  }

  // Higher timeframe veto (§7): never enter purely on low TF contradicting 4h + 1h
  if (direction === 'LONG' && bias4h?.direction === 'SHORT' && bias1h?.direction === 'SHORT') {
    if (aggressiveness !== 'AGGRESSIVE') {
      direction = 'WAIT';
      warnings.push('Higher timeframes (4h & 1h) remain bearish; LONG vetoed.');
    } else {
      warnings.push('Counter-trend vs 4h/1h bearish structure (aggressive mode).');
    }
  }
  if (direction === 'SHORT' && bias4h?.direction === 'LONG' && bias1h?.direction === 'LONG') {
    if (aggressiveness !== 'AGGRESSIVE') {
      direction = 'WAIT';
      warnings.push('Higher timeframes (4h & 1h) remain bullish; SHORT vetoed.');
    } else {
      warnings.push('Counter-trend vs 4h/1h bullish structure (aggressive mode).');
    }
  }

  // Spread check
  if (input.orderBook && input.orderBook.spreadPct > maxSpreadPct) {
    warnings.push(
      `Spread ${input.orderBook.spreadPct.toFixed(3)}% exceeds max ${maxSpreadPct.toFixed(3)}%.`,
    );
    direction = 'WAIT';
  }

  // Late entry protection (§11)
  let lateEntryBlocked = false;
  const distFromEma21 = Math.abs(refPrice - e21);
  if (direction !== 'WAIT' && currentAtr > 0 && distFromEma21 > currentAtr * 2.4) {
    lateEntryBlocked = true;
    warnings.push('Price extended > 2.4x ATR from EMA 21; late entry avoided.');
    direction = 'WAIT';
  }

  // Compute Entry, Stop Loss, Take Profit levels
  const entry = refPrice;
  const slMult = aggressiveness === 'CONSERVATIVE' ? 1.6 : 1.4;
  const rawSlDist = Math.max(currentAtr * slMult, refPrice * 0.0035);

  let stopLoss = direction === 'SHORT' ? entry + rawSlDist : entry - rawSlDist;
  if (direction === 'LONG' && structure.support > 0 && structure.support < entry) {
    const structSl = structure.support - currentAtr * 0.35;
    if (entry - structSl <= rawSlDist * 1.6 && entry - structSl >= currentAtr * 0.8) {
      stopLoss = structSl;
    }
  } else if (direction === 'SHORT' && structure.resistance > entry) {
    const structSl = structure.resistance + currentAtr * 0.35;
    if (structSl - entry <= rawSlDist * 1.6 && structSl - entry >= currentAtr * 0.8) {
      stopLoss = structSl;
    }
  }

  const finalRiskDist = Math.max(Math.abs(entry - stopLoss), refPrice * 0.002);
  const tp1 =
    direction === 'SHORT' ? entry - finalRiskDist * 1.2 : entry + finalRiskDist * 1.2;
  const tp2 =
    direction === 'SHORT' ? entry - finalRiskDist * 2.2 : entry + finalRiskDist * 2.2;
  const tp3 =
    direction === 'SHORT' ? entry - finalRiskDist * 3.2 : entry + finalRiskDist * 3.2;

  const riskReward = Number((Math.abs(tp2 - entry) / finalRiskDist).toFixed(2));
  if (direction !== 'WAIT' && riskReward < minRiskReward) {
    warnings.push(`Calculated R:R ${riskReward} is below minimum ${minRiskReward}.`);
    direction = 'WAIT';
  }

  // Smart Entry State Machine (§11)
  const activeScore = direction === 'LONG' ? longScore : direction === 'SHORT' ? shortScore : Math.max(longScore, shortScore);
  let entryState: EntryState = 'SCANNING';
  if (dataStale) {
    entryState = 'INVALIDATED';
  } else if (direction !== 'WAIT') {
    const tfAligned =
      (direction === 'LONG' && bias15m?.direction === 'LONG' && bias5m?.direction === 'LONG') ||
      (direction === 'SHORT' && bias15m?.direction === 'SHORT' && bias5m?.direction === 'SHORT');
    entryState = activeScore >= 76 && tfAligned ? 'SIGNAL ACTIVE' : 'ENTRY READY';
  } else if (activeScore >= minScore - 6) {
    entryState = 'WAITING CONFIRMATION';
  } else if (activeScore >= 52) {
    entryState = 'WATCHLIST';
  }

  // Momentum report (§9)
  const absRoc = Math.abs(currentRoc);
  let strength: MomentumStrength = 'WEAK';
  if (absRoc >= 2.2 || rvol.rvol20 >= 2.3) strength = 'EXTREME';
  else if (absRoc >= 1.1 || Math.abs(currentRsi - 50) >= 16) strength = 'STRONG';
  else if (absRoc >= 0.45 || Math.abs(currentRsi - 50) >= 8) strength = 'MODERATE';

  let exhaustionWarning: string | null = null;
  if (currentRsi > 76 || (rsiDiv === 'BEARISH' && currentRsi > 62)) {
    exhaustionWarning = 'Bullish momentum exhaustion risk (high RSI / bearish divergence).';
  } else if (currentRsi < 24 || (rsiDiv === 'BULLISH' && currentRsi < 38)) {
    exhaustionWarning = 'Bearish momentum exhaustion risk (oversold RSI / bullish divergence).';
  }

  const momentumReport: MomentumReport = {
    strength,
    rsi14: Number(currentRsi.toFixed(2)),
    macd: Number(macdVal.toFixed(6)),
    macdSignal: Number(macdSig.toFixed(6)),
    macdHistogram: Number(macdHist.toFixed(6)),
    stochRsiK: Number(sRsi.k.toFixed(1)),
    stochRsiD: Number(sRsi.d.toFixed(1)),
    roc10: Number(currentRoc.toFixed(2)),
    rsiDivergence: rsiDiv,
    macdDivergence: macdDiv,
    exhaustionWarning,
  };

  // Volume report (§10)
  const regime: 'ACCUMULATION' | 'DISTRIBUTION' | 'NEUTRAL' =
    vDelta.buySellRatio > 1.12 && obvTrend === 'RISING'
      ? 'ACCUMULATION'
      : vDelta.buySellRatio < 0.88 && obvTrend === 'FALLING'
      ? 'DISTRIBUTION'
      : 'NEUTRAL';

  const volumeReport: VolumeReport = {
    currentVolume: rvol.currentVolume,
    avgVolume20: rvol.avgVolume20,
    avgVolume50: rvol.avgVolume50,
    rvol20: Number(rvol.rvol20.toFixed(2)),
    rvol50: Number(rvol.rvol50.toFixed(2)),
    isSpike: rvol.isSpike,
    buySellRatio: Number(vDelta.buySellRatio.toFixed(2)),
    volumeDelta: Number(vDelta.cumulativeDelta.toFixed(2)),
    obvTrend,
    regime,
  };

  // Explanations (§6)
  const reasons: string[] = [];
  if (direction === 'LONG') {
    if (e9 > e21) reasons.push('EMA 9 is above EMA 21, confirming short-term bullish trend.');
    if (e21 > e50) reasons.push('EMA 21 holds above EMA 50 with constructive trend alignment.');
    if (currentRsi > 50) reasons.push(`RSI(14) at ${currentRsi.toFixed(1)} supports upward momentum.`);
    if (macdHist > 0) reasons.push('MACD histogram is positive and above signal line.');
    if (rvol.rvol20 >= 1.15) reasons.push(`Relative volume ${rvol.rvol20.toFixed(2)}x exceeds 20-bar average.`);
    if (vDelta.buySellRatio > 1.05) reasons.push(`Buyers dominate taker volume (${vDelta.buySellRatio.toFixed(2)}x buy/sell ratio).`);
    if (structure.bos === 'BULLISH' || structure.pattern === 'HH/HL') reasons.push('Market structure shows higher highs / higher lows or bullish BoS.');
  } else if (direction === 'SHORT') {
    if (e9 < e21) reasons.push('EMA 9 is below EMA 21, confirming short-term bearish trend.');
    if (e21 < e50) reasons.push('EMA 21 remains below EMA 50 with downward pressure.');
    if (currentRsi < 50) reasons.push(`RSI(14) at ${currentRsi.toFixed(1)} confirms bearish momentum.`);
    if (macdHist < 0) reasons.push('MACD histogram is negative below zero line.');
    if (rvol.rvol20 >= 1.15) reasons.push(`Relative volume ${rvol.rvol20.toFixed(2)}x confirms sell-side expansion.`);
    if (vDelta.buySellRatio < 0.95) reasons.push(`Sellers dominate aggressive market flow (${vDelta.buySellRatio.toFixed(2)}x ratio).`);
    if (structure.bos === 'BEARISH' || structure.pattern === 'LH/LL') reasons.push('Market structure prints lower highs / lower lows or bearish BoS.');
  } else {
    reasons.push('Multi-factor confluence below threshold; system recommends WAIT.');
    if (Math.abs(longScore - shortScore) < minGap) {
      reasons.push(`Conflicting directional scores (LONG ${longScore} vs SHORT ${shortScore}).`);
    }
    if (warnings.length > 0) {
      reasons.push(warnings[0]);
    }
  }

  const invalidation =
    direction === 'SHORT'
      ? `Candle close above resistance/SL level ${stopLoss.toPrecision(6)} invalidates bearish thesis.`
      : `Candle close below support/SL level ${stopLoss.toPrecision(6)} invalidates bullish thesis.`;

  const breakEvenTrigger =
    direction === 'SHORT' ? entry - finalRiskDist * 1.0 : entry + finalRiskDist * 1.0;

  return {
    symbol: input.symbol,
    marketMode: input.marketMode,
    timestamp: now,
    price: refPrice,
    direction,
    longScore,
    shortScore,
    activeScore,
    entryState,
    entry,
    stopLoss,
    takeProfit1: tp1,
    takeProfit2: tp2,
    takeProfit3: tp3,
    riskReward,
    reasons,
    warnings,
    invalidation,
    breakdown,
    timeframeBiases,
    momentum: momentumReport,
    volume: volumeReport,
    structure,
    exitPlan: {
      stopLoss,
      takeProfit1: tp1,
      takeProfit2: tp2,
      takeProfit3: tp3,
      breakEvenTrigger,
      trailingStopDistance: currentAtr * 1.2,
      partialCloseRules: [
        `Close 40% at TP1 (${tp1.toPrecision(6)}) and move Stop Loss to Break Even (${entry.toPrecision(6)}).`,
        `Close 40% at TP2 (${tp2.toPrecision(6)}) and activate 1.2x ATR trailing stop.`,
      ],
      fullExitRules: [
        `Full exit at TP3 (${tp3.toPrecision(6)}) or upon opposite BoS / MACD momentum exhaustion.`,
        `Hard Stop Loss at ${stopLoss.toPrecision(6)} — never widen SL beyond initial risk.`,
      ],
      invalidationCondition: invalidation,
    },
    lateEntryBlocked,
    dataStale,
  };
}

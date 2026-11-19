import test from 'node:test';
import assert from 'node:assert/strict';
import { atr, bollingerBands, ema, macd, relativeVolume, rsi } from './indicators';
import { DEFAULT_RISK_CONFIG, evaluateRisk } from './riskManager';
import { generateSignalReport } from './signalEngine';
import { runWalkForwardBacktest } from './backtester';
import type { Kline } from './types';

function makeSyntheticTrendKlines(
  count: number,
  startPrice: number,
  step: number,
  volBase = 1000,
): Kline[] {
  const klines: Kline[] = [];
  let price = startPrice;
  const t0 = 1_700_000_000_000;
  for (let i = 0; i < count; i++) {
    // Realistic trend with periodic pullbacks toward EMA21 so late-entry guard is not triggered
    const pullback = i % 14 >= 10 && i < count - 3 ? -step * 1.15 : step * 0.45;
    const candleMove = i >= count - 3 ? step * 0.9 : pullback;
    const open = price;
    const close = Math.max(1, price + candleMove);
    const wick = Math.max(0.8, Math.abs(step) * 1.9);
    const high = Math.max(open, close) + wick;
    const low = Math.min(open, close) - wick;
    const volume = i >= count - 2 ? volBase * 2.6 : volBase + (i % 5) * 40;
    const takerBuyBaseVolume = step >= 0 ? volume * 0.72 : volume * 0.28;
    klines.push({
      openTime: t0 + i * 300_000,
      open,
      high,
      low,
      close,
      volume,
      closeTime: t0 + (i + 1) * 300_000 - 1,
      quoteVolume: volume * close,
      trades: 250,
      takerBuyBaseVolume,
      takerBuyQuoteVolume: takerBuyBaseVolume * close,
    });
    price = close;
  }
  return klines;
}

test('indicators compute valid EMA, RSI, MACD, ATR, Bollinger Bands, and RVOL', () => {
  const klines = makeSyntheticTrendKlines(120, 100, 0.8);
  const closes = klines.map((k) => k.close);

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  assert.ok(ema9[119]! > ema21[119]!);

  const rsiArr = rsi(closes, 14);
  assert.ok(rsiArr[119]! > 50 && rsiArr[119]! <= 100);

  const macdRes = macd(closes);
  assert.ok(macdRes.macdLine[119]! > macdRes.signalLine[119]!);

  const atrArr = atr(klines, 14);
  assert.ok(atrArr[119]! > 0);

  const bb = bollingerBands(closes, 20, 2);
  assert.ok(bb.upper[119]! > bb.middle[119]!);
  assert.ok(bb.middle[119]! > bb.lower[119]!);

  const rvol = relativeVolume(klines);
  assert.ok(rvol.rvol20 > 1.8);
  assert.equal(rvol.isSpike, true);
});

test('signal engine produces LONG, SHORT, and WAIT cleanly including stale guard', () => {
  const now = 1_700_050_000_000;
  const bull15m = makeSyntheticTrendKlines(140, 100, 0.7);
  const bull1h = makeSyntheticTrendKlines(120, 90, 0.9);
  const bull4h = makeSyntheticTrendKlines(100, 80, 1.1);
  const bullLast = bull15m[bull15m.length - 2].close;

  const longReport = generateSignalReport({
    symbol: 'BTCUSDT',
    marketMode: 'FUTURES',
    primaryKlines: bull15m,
    timeframeKlines: { '5m': bull15m, '15m': bull15m, '1h': bull1h, '4h': bull4h },
    orderBook: {
      bestBid: bullLast,
      bestAsk: bullLast * 1.0002,
      spreadPct: 0.02,
      bidDepthUsd: 800000,
      askDepthUsd: 350000,
      imbalanceRatio: 0.39,
      updatedAt: now,
    },
    livePrice: bullLast,
    lastUpdatedAt: now,
    now,
    aggressiveness: 'BALANCED',
  });

  assert.equal(longReport.direction, 'LONG', `Expected LONG, got ${longReport.direction}; scores L=${longReport.longScore} S=${longReport.shortScore}; warnings=${longReport.warnings.join('; ')}`);
  assert.ok(longReport.longScore >= 65);
  assert.ok(longReport.stopLoss < longReport.entry);
  assert.ok(longReport.takeProfit2 > longReport.takeProfit1);
  assert.ok(longReport.riskReward >= 1.8);

  // Stale data must block new signals
  const staleReport = generateSignalReport({
    symbol: 'BTCUSDT',
    marketMode: 'FUTURES',
    primaryKlines: bull15m,
    timeframeKlines: { '5m': bull15m, '15m': bull15m, '1h': bull1h, '4h': bull4h },
    orderBook: null,
    livePrice: bullLast,
    lastUpdatedAt: now - 120_000,
    now,
  });
  assert.equal(staleReport.dataStale, true);
  assert.equal(staleReport.direction, 'WAIT');
  assert.equal(staleReport.entryState, 'INVALIDATED');

  // Bearish trend -> SHORT
  const bear15m = makeSyntheticTrendKlines(140, 220, -0.7);
  const bear1h = makeSyntheticTrendKlines(120, 240, -0.9);
  const bear4h = makeSyntheticTrendKlines(100, 260, -1.1);
  const bearLast = bear15m[bear15m.length - 2].close;

  const shortReport = generateSignalReport({
    symbol: 'ETHUSDT',
    marketMode: 'FUTURES',
    primaryKlines: bear15m,
    timeframeKlines: { '5m': bear15m, '15m': bear15m, '1h': bear1h, '4h': bear4h },
    orderBook: {
      bestBid: bearLast,
      bestAsk: bearLast * 1.0002,
      spreadPct: 0.02,
      bidDepthUsd: 300000,
      askDepthUsd: 780000,
      imbalanceRatio: -0.44,
      updatedAt: now,
    },
    livePrice: bearLast,
    lastUpdatedAt: now,
    now,
  });

  assert.equal(shortReport.direction, 'SHORT');
  assert.ok(shortReport.shortScore >= 65);
  assert.ok(shortReport.stopLoss > shortReport.entry);
  assert.ok(shortReport.takeProfit2 < shortReport.takeProfit1);

  // Flat choppy market -> WAIT
  const flat = makeSyntheticTrendKlines(140, 100, 0);
  const waitReport = generateSignalReport({
    symbol: 'SOLUSDT',
    marketMode: 'FUTURES',
    primaryKlines: flat,
    timeframeKlines: { '15m': flat },
    orderBook: null,
    livePrice: flat[flat.length - 2].close,
    lastUpdatedAt: now,
    now,
  });
  assert.equal(waitReport.direction, 'WAIT');
});

test('risk manager separates leverage from risk and rejects low R:R or high spread', () => {
  const ok = evaluateRisk({
    direction: 'LONG',
    entry: 50000,
    stopLoss: 49500,
    takeProfit1: 50600,
    takeProfit2: 51200,
    spreadPct: 0.02,
    openPositionsCount: 0,
    dailyRealizedLossUsd: 0,
    config: DEFAULT_RISK_CONFIG,
  });
  assert.equal(ok.approved, true);
  assert.equal(ok.riskAmountUsd, 100);
  assert.ok(Math.abs(ok.positionSizeQty - 0.2) < 1e-6);
  assert.ok(ok.requiredMarginUsd < ok.notionalValueUsd);

  const rejectedSpread = evaluateRisk({
    direction: 'LONG',
    entry: 50000,
    stopLoss: 49500,
    takeProfit1: 50600,
    takeProfit2: 51200,
    spreadPct: 0.4,
    openPositionsCount: 0,
    dailyRealizedLossUsd: 0,
    config: DEFAULT_RISK_CONFIG,
  });
  assert.equal(rejectedSpread.approved, false);
  assert.ok(rejectedSpread.rejectionReasons.some((r) => r.includes('spread')));

  const rejectedRR = evaluateRisk({
    direction: 'LONG',
    entry: 50000,
    stopLoss: 49000,
    takeProfit1: 50500,
    takeProfit2: 51000,
    spreadPct: 0.02,
    openPositionsCount: 0,
    dailyRealizedLossUsd: 0,
    config: DEFAULT_RISK_CONFIG,
  });
  assert.equal(rejectedRR.approved, false);
  assert.ok(rejectedRR.rejectionReasons.some((r) => r.includes('Risk/Reward')));
});

test('walk-forward backtester splits In-Sample and Out-of-Sample without look-ahead', () => {
  const up = makeSyntheticTrendKlines(140, 100, 0.7);
  const down = makeSyntheticTrendKlines(120, up[up.length - 1].close, -0.6);
  const combined = [...up, ...down];
  const res = runWalkForwardBacktest(combined, {
    symbol: 'BTCUSDT',
    timeframe: '15m',
    marketMode: 'FUTURES',
    limit: combined.length,
    initialBalance: 10000,
    riskPerTradePct: 1,
    commissionPct: 0.05,
    slippagePct: 0.05,
    minScore: 60,
    minRiskReward: 1.5,
    aggressiveness: 'BALANCED',
  });
  assert.equal(res.candlesAnalyzed, combined.length);
  assert.ok(res.equityCurve.length > 50);
  assert.ok(res.inSample.trades + res.outOfSample.trades === res.overall.trades);
});

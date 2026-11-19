import { generateSignalReport } from './signalEngine';
import type {
  BacktestParams,
  BacktestResult,
  BacktestSegmentMetrics,
  BacktestTrade,
  Kline,
} from './types';

function computeSegmentMetrics(
  trades: BacktestTrade[],
  startingEquity: number,
): BacktestSegmentMetrics {
  if (trades.length === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      winRatePct: 0,
      netPnlUsd: 0,
      profitFactor: 0,
      maxDrawdownPct: 0,
      averageR: 0,
    };
  }

  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let rSum = 0;
  let equity = startingEquity;
  let peak = startingEquity;
  let maxDd = 0;

  for (const t of trades) {
    if (t.pnlUsd > 0) {
      wins++;
      grossWin += t.pnlUsd;
    } else {
      losses++;
      grossLoss += Math.abs(t.pnlUsd);
    }
    rSum += t.rMultiple;
    equity += t.pnlUsd;
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;
    if (dd > maxDd) maxDd = dd;
  }

  const netPnlUsd = equity - startingEquity;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  return {
    trades: trades.length,
    wins,
    losses,
    winRatePct: Number(((wins / trades.length) * 100).toFixed(2)),
    netPnlUsd: Number(netPnlUsd.toFixed(2)),
    profitFactor: Number(profitFactor.toFixed(2)),
    maxDrawdownPct: Number(maxDd.toFixed(2)),
    averageR: Number((rSum / trades.length).toFixed(2)),
  };
}

/**
 * Strictly causal walk-forward backtester with zero look-ahead bias (§16):
 * At bar `i`, only candles[0..i] are visible to the signal engine.
 * Trades execute at bar `i+1` open price with configured slippage and commissions.
 */
export function runWalkForwardBacktest(
  klines: Kline[],
  params: BacktestParams,
): BacktestResult {
  const warmup = 70;
  const splitIndex = Math.floor(warmup + (klines.length - warmup) * 0.6);

  let equity = params.initialBalance;
  const equityCurve: { time: number; equity: number; segment: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' }[] = [];
  const trades: BacktestTrade[] = [];

  interface OpenPos {
    direction: 'LONG' | 'SHORT';
    entryTime: number;
    entryPrice: number;
    stopLoss: number;
    takeProfit: number;
    qty: number;
    score: number;
    entryFee: number;
    segment: 'IN_SAMPLE' | 'OUT_OF_SAMPLE';
  }

  let activePos: OpenPos | null = null;
  const slipFrac = params.slippagePct / 100;
  const feeFrac = params.commissionPct / 100;

  for (let i = warmup; i < klines.length - 1; i++) {
    const bar = klines[i];
    const nextBar = klines[i + 1];
    const segment: 'IN_SAMPLE' | 'OUT_OF_SAMPLE' = i < splitIndex ? 'IN_SAMPLE' : 'OUT_OF_SAMPLE';

    // Check active position exit on bar `i` using OHLC strictly
    if (activePos) {
      let exitPrice: number | null = null;
      let exitReason: string | null = null;

      if (activePos.direction === 'LONG') {
        if (bar.low <= activePos.stopLoss) {
          exitPrice = activePos.stopLoss * (1 - slipFrac);
          exitReason = 'Stop Loss Hit';
        } else if (bar.high >= activePos.takeProfit) {
          exitPrice = activePos.takeProfit * (1 - slipFrac);
          exitReason = 'Take Profit 2 Hit';
        }
      } else {
        if (bar.high >= activePos.stopLoss) {
          exitPrice = activePos.stopLoss * (1 + slipFrac);
          exitReason = 'Stop Loss Hit';
        } else if (bar.low <= activePos.takeProfit) {
          exitPrice = activePos.takeProfit * (1 + slipFrac);
          exitReason = 'Take Profit 2 Hit';
        }
      }

      if (exitPrice !== null && exitReason !== null) {
        const rawPnl =
          activePos.direction === 'LONG'
            ? (exitPrice - activePos.entryPrice) * activePos.qty
            : (activePos.entryPrice - exitPrice) * activePos.qty;
        const exitFee = exitPrice * activePos.qty * feeFrac;
        const netPnl = rawPnl - activePos.entryFee - exitFee;
        const riskUsd = Math.abs(activePos.entryPrice - activePos.stopLoss) * activePos.qty;
        const rMultiple = riskUsd > 0 ? netPnl / riskUsd : 0;

        equity += netPnl;
        trades.push({
          entryTime: activePos.entryTime,
          exitTime: bar.closeTime,
          direction: activePos.direction,
          entryPrice: Number(activePos.entryPrice.toPrecision(6)),
          exitPrice: Number(exitPrice.toPrecision(6)),
          stopLoss: Number(activePos.stopLoss.toPrecision(6)),
          takeProfit: Number(activePos.takeProfit.toPrecision(6)),
          score: activePos.score,
          rMultiple: Number(rMultiple.toFixed(2)),
          pnlUsd: Number(netPnl.toFixed(2)),
          feesAndSlippageUsd: Number((activePos.entryFee + exitFee).toFixed(2)),
          exitReason,
          segment: activePos.segment,
        });
        activePos = null;
      }
    }

    // Evaluate signal strictly using past bars up to `i` (never peeking at i+1)
    if (!activePos && equity > 10) {
      const windowSlice = klines.slice(Math.max(0, i - 220), i + 1);
      // Append dummy unclosed bar at end because generateSignalReport slices off last unclosed bar
      const causalHistory = [...windowSlice, bar];
      const report = generateSignalReport({
        symbol: params.symbol,
        marketMode: params.marketMode,
        primaryKlines: causalHistory,
        timeframeKlines: { [params.timeframe]: causalHistory },
        orderBook: null,
        livePrice: bar.close,
        lastUpdatedAt: bar.closeTime,
        now: bar.closeTime,
        aggressiveness: params.aggressiveness,
        minRiskReward: params.minRiskReward,
      });

      if (
        report.direction !== 'WAIT' &&
        report.activeScore >= params.minScore &&
        report.riskReward >= params.minRiskReward
      ) {
        // Enter on NEXT bar open with slippage (no look-ahead)
        const fillPrice =
          report.direction === 'LONG'
            ? nextBar.open * (1 + slipFrac)
            : nextBar.open * (1 - slipFrac);

        const slDist = Math.abs(report.entry - report.stopLoss);
        const tpDist = Math.abs(report.takeProfit2 - report.entry);
        const stopLoss =
          report.direction === 'LONG' ? fillPrice - slDist : fillPrice + slDist;
        const takeProfit =
          report.direction === 'LONG' ? fillPrice + tpDist : fillPrice - tpDist;

        const riskUsd = (equity * params.riskPerTradePct) / 100;
        const qty = slDist > 0 ? riskUsd / slDist : 0;
        if (qty > 0) {
          activePos = {
            direction: report.direction,
            entryTime: nextBar.openTime,
            entryPrice: fillPrice,
            stopLoss,
            takeProfit,
            qty,
            score: report.activeScore,
            entryFee: fillPrice * qty * feeFrac,
            segment,
          };
        }
      }
    }

    equityCurve.push({
      time: bar.closeTime,
      equity: Number(equity.toFixed(2)),
      segment,
    });
  }

  const inSampleTrades = trades.filter((t) => t.segment === 'IN_SAMPLE');
  const outOfSampleTrades = trades.filter((t) => t.segment === 'OUT_OF_SAMPLE');

  const inSampleMetrics = computeSegmentMetrics(inSampleTrades, params.initialBalance);
  const oosStartEquity = params.initialBalance + inSampleMetrics.netPnlUsd;

  return {
    symbol: params.symbol,
    timeframe: params.timeframe,
    marketMode: params.marketMode,
    candlesAnalyzed: klines.length,
    inSample: inSampleMetrics,
    outOfSample: computeSegmentMetrics(outOfSampleTrades, oosStartEquity),
    overall: computeSegmentMetrics(trades, params.initialBalance),
    equityCurve,
    trades,
    params,
  };
}

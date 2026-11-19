import type { Kline, MarketStructureReport } from './types';

export function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }
  return result;
}

export function ema(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return result;
  let initialSum = 0;
  for (let i = 0; i < period; i++) {
    initialSum += values[i];
  }
  let prevEma = initialSum / period;
  result[period - 1] = prevEma;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prevEma = values[i] * k + prevEma * (1 - k);
    result[i] = prevEma;
  }
  return result;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return result;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum += Math.abs(diff);
  }

  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) {
      result[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      result[i] = 100 - 100 / (1 + rs);
    }
  }
  return result;
}

export function macd(
  closes: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const fastEma = ema(closes, fastPeriod);
  const slowEma = ema(closes, slowPeriod);
  const macdLine: (number | null)[] = closes.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f !== null && s !== null ? f - s : null;
  });

  const validStart = macdLine.findIndex((v) => v !== null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  if (validStart !== -1) {
    const validMacdValues = macdLine.slice(validStart) as number[];
    const sig = ema(validMacdValues, signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      const idx = validStart + i;
      signalLine[idx] = sig[i];
      if (sig[i] !== null && macdLine[idx] !== null) {
        histogram[idx] = (macdLine[idx] as number) - (sig[i] as number);
      }
    }
  }

  return { macdLine, signalLine, histogram };
}

export function stochRsi(
  closes: number[],
  rsiPeriod = 14,
  stochPeriod = 14,
  kSmooth = 3,
  dSmooth = 3,
): { k: number; d: number } {
  const rsiSeries = rsi(closes, rsiPeriod);
  const validRsi = rsiSeries.filter((v): v is number => v !== null);
  if (validRsi.length < stochPeriod + kSmooth + dSmooth) {
    return { k: 50, d: 50 };
  }

  const rawStoch: number[] = [];
  for (let i = stochPeriod - 1; i < validRsi.length; i++) {
    const slice = validRsi.slice(i - stochPeriod + 1, i + 1);
    const minR = Math.min(...slice);
    const maxR = Math.max(...slice);
    const denom = maxR - minR;
    rawStoch.push(denom === 0 ? 50 : ((validRsi[i] - minR) / denom) * 100);
  }

  const kSeries = sma(rawStoch, kSmooth).filter((v): v is number => v !== null);
  const dSeries = sma(kSeries, dSmooth).filter((v): v is number => v !== null);

  return {
    k: kSeries[kSeries.length - 1] ?? 50,
    d: dSeries[dSeries.length - 1] ?? 50,
  };
}

export function roc(closes: number[], period = 10): (number | null)[] {
  const res: (number | null)[] = new Array(closes.length).fill(null);
  for (let i = period; i < closes.length; i++) {
    const prev = closes[i - period];
    res[i] = prev !== 0 ? ((closes[i] - prev) / prev) * 100 : 0;
  }
  return res;
}

export function atr(candles: Kline[], period = 14): (number | null)[] {
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return result;

  const tr: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const h = candles[i].high;
    const l = candles[i].low;
    tr.push(Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose)));
  }

  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += tr[i];
  }
  let prevAtr = sum / period;
  result[period] = prevAtr;

  for (let i = period + 1; i < candles.length; i++) {
    prevAtr = (prevAtr * (period - 1) + tr[i]) / period;
    result[i] = prevAtr;
  }
  return result;
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2,
): {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  bandwidthPct: (number | null)[];
} {
  const middle = sma(closes, period);
  const upper: (number | null)[] = new Array(closes.length).fill(null);
  const lower: (number | null)[] = new Array(closes.length).fill(null);
  const bandwidthPct: (number | null)[] = new Array(closes.length).fill(null);

  for (let i = period - 1; i < closes.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = closes[j] - mean;
      sqSum += diff * diff;
    }
    const std = Math.sqrt(sqSum / period);
    const u = mean + stdDevMult * std;
    const l = mean - stdDevMult * std;
    upper[i] = u;
    lower[i] = l;
    bandwidthPct[i] = mean !== 0 ? ((u - l) / mean) * 100 : 0;
  }

  return { upper, middle, lower, bandwidthPct };
}

export function obv(candles: Kline[]): number[] {
  if (candles.length === 0) return [];
  const res: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    const prev = res[i - 1];
    if (candles[i].close > candles[i - 1].close) {
      res.push(prev + candles[i].volume);
    } else if (candles[i].close < candles[i - 1].close) {
      res.push(prev - candles[i].volume);
    } else {
      res.push(prev);
    }
  }
  return res;
}

export function relativeVolume(candles: Kline[]): {
  currentVolume: number;
  avgVolume20: number;
  avgVolume50: number;
  rvol20: number;
  rvol50: number;
  isSpike: boolean;
} {
  if (candles.length < 2) {
    return {
      currentVolume: 0,
      avgVolume20: 0,
      avgVolume50: 0,
      rvol20: 1,
      rvol50: 1,
      isSpike: false,
    };
  }
  const latest = candles[candles.length - 1];
  const history = candles.slice(0, -1);
  const slice20 = history.slice(-20);
  const slice50 = history.slice(-50);
  const avg20 =
    slice20.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, slice20.length);
  const avg50 =
    slice50.reduce((acc, c) => acc + c.volume, 0) / Math.max(1, slice50.length);

  const rvol20 = avg20 > 0 ? latest.volume / avg20 : 1;
  const rvol50 = avg50 > 0 ? latest.volume / avg50 : 1;

  return {
    currentVolume: latest.volume,
    avgVolume20: avg20,
    avgVolume50: avg50,
    rvol20,
    rvol50,
    isSpike: rvol20 >= 1.85 || rvol50 >= 2.0,
  };
}

export function volumeDeltaMetrics(candles: Kline[], lookback = 20): {
  lastDelta: number;
  cumulativeDelta: number;
  buySellRatio: number;
} {
  const slice = candles.slice(-lookback);
  let buyVol = 0;
  let sellVol = 0;
  let lastDelta = 0;

  for (const c of slice) {
    const takerBuy = c.takerBuyBaseVolume > 0
      ? Math.min(c.volume, c.takerBuyBaseVolume)
      : c.close >= c.open
      ? c.volume * 0.58
      : c.volume * 0.42;
    const takerSell = Math.max(0, c.volume - takerBuy);
    buyVol += takerBuy;
    sellVol += takerSell;
    lastDelta = takerBuy - takerSell;
  }

  return {
    lastDelta,
    cumulativeDelta: buyVol - sellVol,
    buySellRatio: sellVol > 0 ? buyVol / sellVol : buyVol > 0 ? 2 : 1,
  };
}

export function detectDivergence(
  closes: number[],
  indicatorSeries: (number | null)[],
  lookback = 18,
): 'BULLISH' | 'BEARISH' | 'NONE' {
  if (closes.length < lookback + 5) return 'NONE';
  const start = closes.length - lookback;
  const recentCloses = closes.slice(start);
  const recentInd = indicatorSeries.slice(start);
  if (recentInd.some((v) => v === null)) return 'NONE';
  const ind = recentInd as number[];

  const mid = Math.floor(lookback / 2);
  const priceLow1 = Math.min(...recentCloses.slice(0, mid));
  const priceLow2 = Math.min(...recentCloses.slice(mid));
  const indLow1 = Math.min(...ind.slice(0, mid));
  const indLow2 = Math.min(...ind.slice(mid));

  if (priceLow2 < priceLow1 * 0.997 && indLow2 > indLow1 * 1.03) {
    return 'BULLISH';
  }

  const priceHigh1 = Math.max(...recentCloses.slice(0, mid));
  const priceHigh2 = Math.max(...recentCloses.slice(mid));
  const indHigh1 = Math.max(...ind.slice(0, mid));
  const indHigh2 = Math.max(...ind.slice(mid));

  if (priceHigh2 > priceHigh1 * 1.003 && indHigh2 < indHigh1 * 0.97) {
    return 'BEARISH';
  }

  return 'NONE';
}

export function detectMarketStructure(candles: Kline[], pivotWindow = 3): MarketStructureReport {
  if (candles.length < pivotWindow * 2 + 5) {
    const lastClose = candles[candles.length - 1]?.close ?? 0;
    return {
      swingHighs: [],
      swingLows: [],
      pattern: 'RANGING',
      bos: 'NONE',
      choch: 'NONE',
      support: lastClose * 0.98,
      resistance: lastClose * 1.02,
      breakout: 'NONE',
    };
  }

  const swingHighs: number[] = [];
  const swingLows: number[] = [];

  for (let i = pivotWindow; i < candles.length - pivotWindow; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - pivotWindow; j <= i + pivotWindow; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) swingHighs.push(candles[i].high);
    if (isLow) swingLows.push(candles[i].low);
  }

  const recentHighs = swingHighs.slice(-3);
  const recentLows = swingLows.slice(-3);

  let pattern: 'HH/HL' | 'LH/LL' | 'RANGING' = 'RANGING';
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const hh = recentHighs[recentHighs.length - 1] > recentHighs[recentHighs.length - 2];
    const hl = recentLows[recentLows.length - 1] > recentLows[recentLows.length - 2];
    const lh = recentHighs[recentHighs.length - 1] < recentHighs[recentHighs.length - 2];
    const ll = recentLows[recentLows.length - 1] < recentLows[recentLows.length - 2];
    if (hh && hl) pattern = 'HH/HL';
    else if (lh && ll) pattern = 'LH/LL';
  }

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recentWindow = candles.slice(-25, -1);
  const support = recentLows.length > 0
    ? recentLows[recentLows.length - 1]
    : Math.min(...recentWindow.map((c) => c.low));
  const resistance = recentHighs.length > 0
    ? recentHighs[recentHighs.length - 1]
    : Math.max(...recentWindow.map((c) => c.high));

  let bos: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  let choch: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  let breakout: 'BULLISH' | 'BEARISH' | 'FALSE_BULLISH' | 'FALSE_BEARISH' | 'NONE' = 'NONE';

  if (last.close > resistance) {
    bos = 'BULLISH';
    breakout = 'BULLISH';
    if (pattern === 'LH/LL') choch = 'BULLISH';
  } else if (last.close < support) {
    bos = 'BEARISH';
    breakout = 'BEARISH';
    if (pattern === 'HH/HL') choch = 'BEARISH';
  } else if (last.high > resistance && last.close < resistance && prev.close <= resistance) {
    breakout = 'FALSE_BULLISH';
  } else if (last.low < support && last.close > support && prev.close >= support) {
    breakout = 'FALSE_BEARISH';
  }

  return {
    swingHighs: recentHighs,
    swingLows: recentLows,
    pattern,
    bos,
    choch,
    support,
    resistance,
    breakout,
  };
}

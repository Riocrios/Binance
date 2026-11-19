import React from 'react';
import type { Kline, OrderBookSnapshot, SignalReport, Timeframe, WhaleEvent } from '../engine/types';
import { CandlestickChart } from './CandlestickChart';
import { formatPrice, formatTime, formatUsd } from './formatters';

export const WhaleTrackerTab: React.FC<{
  events: WhaleEvent[];
  fundingRate?: number;
  markPrice?: number;
  onRefresh: () => void;
}> = ({ events, fundingRate, markPrice, onRefresh }) => {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111622] p-4">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Large Market Trades & Liquidation Monitor</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Detects anomalous aggressive market executions and USD-M Futures forced liquidations. Events are never attributed to specific wallets or individuals.
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-slate-300">
          {markPrice ? <span>Mark: ${formatPrice(markPrice)}</span> : null}
          {typeof fundingRate === 'number' ? (
            <span>Funding: {(fundingRate * 100).toFixed(4)}%</span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-sans font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
          >
            Refresh Stream
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111622] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-[#0D121C]">
                <th className="py-2.5 px-3 font-medium">TIME</th>
                <th className="py-2.5 px-3 font-medium">SYMBOL</th>
                <th className="py-2.5 px-3 font-medium">TYPE</th>
                <th className="py-2.5 px-3 font-medium">SIDE</th>
                <th className="py-2.5 px-3 font-medium text-right">SIZE (USD)</th>
                <th className="py-2.5 px-3 font-medium text-right">PRICE</th>
                <th className="py-2.5 px-3 font-medium text-right">DEVIATION</th>
                <th className="py-2.5 px-3 font-medium">MARKET IMPACT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {events.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                    Monitoring live Binance aggTrade and liquidation streams for large executions...
                  </td>
                </tr>
              ) : (
                events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 text-slate-400">{formatTime(ev.timestamp)}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-100">{ev.symbol}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-300">{ev.eventType.replace('_', ' ')}</td>
                    <td
                      className={`py-2.5 px-3 font-semibold ${
                        ev.side === 'BUY' ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {ev.side}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-100">{formatUsd(ev.notionalUsd)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{formatPrice(ev.price)}</td>
                    <td className="py-2.5 px-3 text-right text-sky-400">{ev.deviationMultiple.toFixed(1)}x</td>
                    <td className="py-2.5 px-3 font-sans text-slate-300">
                      <span className="font-semibold text-slate-100">{ev.marketImpact}</span> · {ev.note}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export const MomentumTab: React.FC<{ signal: SignalReport | null }> = ({ signal }) => {
  if (!signal) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-8 text-center text-sm text-slate-400">
        Waiting for active symbol momentum metrics...
      </div>
    );
  }
  const m = signal.momentum;
  const strengthCol =
    m.strength === 'EXTREME'
      ? 'text-amber-400'
      : m.strength === 'STRONG'
      ? 'text-emerald-400'
      : m.strength === 'MODERATE'
      ? 'text-sky-400'
      : 'text-slate-400';

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Momentum Engine · {signal.symbol}</h2>
          <p className="text-xs text-slate-400">Measures price acceleration, oscillator divergence, and exhaustion risk on closed candles.</p>
        </div>
        <div className={`text-lg font-bold font-mono ${strengthCol}`}>STRENGTH: {m.strength}</div>
      </div>

      {m.exhaustionWarning && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 px-4 py-3 text-xs text-amber-200">
          Exhaustion Warning: {m.exhaustionWarning}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono tabular-nums">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">RSI (14)</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">{m.rsi14.toFixed(2)}</div>
          <div className="mt-1 text-xs text-slate-400 font-sans">Divergence: {m.rsiDivergence}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">MACD Histogram</div>
          <div className={`mt-1 text-2xl font-semibold ${m.macdHistogram >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {m.macdHistogram >= 0 ? '+' : ''}
            {m.macdHistogram.toFixed(5)}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-sans">
            MACD {m.macd.toFixed(4)} / Sig {m.macdSignal.toFixed(4)} · Div: {m.macdDivergence}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">StochRSI & Rate of Change (10)</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {m.stochRsiK.toFixed(1)} / {m.stochRsiD.toFixed(1)}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-sans">
            ROC(10): {m.roc10 >= 0 ? '+' : ''}
            {m.roc10.toFixed(2)}%
          </div>
        </div>
      </div>
    </div>
  );
};

export const VolumeAnalysisTab: React.FC<{
  signal: SignalReport | null;
  orderBook: OrderBookSnapshot | null;
}> = ({ signal, orderBook }) => {
  if (!signal) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-8 text-center text-sm text-slate-400">
        Waiting for closed-candle volume data...
      </div>
    );
  }
  const v = signal.volume;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">Volume Analyzer · {signal.symbol}</h2>
          <p className="text-xs text-slate-400">Evaluated strictly on closed candles (unclosed active bars are excluded from final confirmation).</p>
        </div>
        <div
          className={`text-sm font-bold font-mono ${
            v.regime === 'ACCUMULATION'
              ? 'text-emerald-400'
              : v.regime === 'DISTRIBUTION'
              ? 'text-rose-400'
              : 'text-sky-400'
          }`}
        >
          REGIME: {v.regime}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono tabular-nums">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">Relative Volume (20 / 50)</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {v.rvol20.toFixed(2)}x / {v.rvol50.toFixed(2)}x
          </div>
          <div className="mt-1 text-xs text-slate-400 font-sans">
            Volume Spike: {v.isSpike ? 'DETECTED' : 'Normal'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">Buy / Sell Taker Pressure</div>
          <div className={`mt-1 text-2xl font-semibold ${v.buySellRatio >= 1 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {v.buySellRatio.toFixed(2)}x
          </div>
          <div className="mt-1 text-xs text-slate-400 font-sans">
            20-bar Delta: {v.volumeDelta >= 0 ? '+' : ''}
            {v.volumeDelta.toLocaleString()} · OBV {v.obvTrend}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400 font-sans">Live Order Book Imbalance</div>
          <div className="mt-1 text-2xl font-semibold text-slate-100">
            {orderBook ? `${(orderBook.imbalanceRatio * 100).toFixed(1)}%` : '--'}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-sans">
            {orderBook
              ? `Bids ${formatUsd(orderBook.bidDepthUsd)} · Asks ${formatUsd(orderBook.askDepthUsd)}`
              : 'Depth awaiting refresh'}
          </div>
        </div>
      </div>
    </div>
  );
};

export const LiveChartsTab: React.FC<{
  symbol: string;
  timeframe: Timeframe;
  klines: Kline[];
  signal: SignalReport | null;
  onTimeframeChange: (tf: Timeframe) => void;
}> = ({ symbol, timeframe, klines, signal, onTimeframeChange }) => {
  const timeframes: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111622] p-3.5">
        <div className="text-sm font-semibold text-slate-100">
          {symbol} · Live Candlesticks, EMA 9/21/50, Volume, RSI & MACD
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-[#0B0E14] p-1 border border-slate-800">
          {timeframes.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onTimeframeChange(tf)}
              className={`px-2.5 py-1 text-xs font-mono rounded-md transition-colors whitespace-nowrap ${
                timeframe === tf ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <CandlestickChart
        symbol={symbol}
        klines={klines}
        entry={signal?.entry}
        stopLoss={signal?.stopLoss}
        takeProfit1={signal?.takeProfit1}
        takeProfit2={signal?.takeProfit2}
        direction={signal?.direction}
        height={500}
      />
    </div>
  );
};

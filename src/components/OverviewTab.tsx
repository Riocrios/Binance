import React from 'react';
import type { ConnectionTelemetry, Kline, SignalReport, Ticker24h } from '../engine/types';
import { CandlestickChart } from './CandlestickChart';
import { formatPrice, formatTime } from './formatters';

interface ScannerRowItem {
  ticker: Ticker24h;
  signal: SignalReport;
}

interface OverviewTabProps {
  telemetry: ConnectionTelemetry;
  btcTicker: Ticker24h | null;
  ethTicker: Ticker24h | null;
  items: ScannerRowItem[];
  totalQualifiedPairs: number;
  activeSymbol: string;
  activeKlines: Kline[];
  activeSignal: SignalReport | null;
  loading: boolean;
  error: string | null;
  onSelectSymbol: (symbol: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  telemetry,
  btcTicker,
  ethTicker,
  items,
  totalQualifiedPairs,
  activeSymbol,
  activeKlines,
  activeSignal,
  loading,
  error,
  onSelectSymbol,
}) => {
  const longOpps = items.filter((i) => i.signal.direction === 'LONG');
  const shortOpps = items.filter((i) => i.signal.direction === 'SHORT');
  const activeSignals = items.filter(
    (i) => i.signal.entryState === 'SIGNAL ACTIVE' || i.signal.entryState === 'ENTRY READY',
  );

  const isInitialConnecting = loading && !btcTicker && !error;

  const marketRegime =
    error || (!loading && telemetry.status === 'DISCONNECTED')
      ? 'DISCONNECTED'
      : isInitialConnecting
      ? 'CONNECTING...'
      : longOpps.length > shortOpps.length
      ? 'BULLISH BIAS'
      : shortOpps.length > longOpps.length
      ? 'BEARISH BIAS'
      : 'WAIT / SELECTIVE';

  const sortedRows = [...items].sort((a, b) => {
    const aAct = a.signal.direction === 'WAIT' ? 1 : 0;
    const bAct = b.signal.direction === 'WAIT' ? 1 : 0;
    if (aAct !== bAct) return aAct - bAct;
    return b.signal.activeScore - a.signal.activeScore;
  });

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
        >
          Binance Connection Error: {error} — System status is DISCONNECTED and new signal generation is paused.
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400">BTC / USDT ({telemetry.marketMode})</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            {btcTicker ? `$${formatPrice(btcTicker.lastPrice)}` : isInitialConnecting ? 'Connecting...' : 'DISCONNECTED'}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              (btcTicker?.priceChangePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {btcTicker ? `24h ${btcTicker.priceChangePercent >= 0 ? '+' : ''}${btcTicker.priceChangePercent.toFixed(2)}%` : isInitialConnecting ? 'Fetching live ticker' : 'No live feed'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400">ETH / USDT ({telemetry.marketMode})</div>
          <div className="mt-1 text-2xl font-semibold font-mono tabular-nums text-slate-100">
            {ethTicker ? `$${formatPrice(ethTicker.lastPrice)}` : isInitialConnecting ? 'Connecting...' : 'DISCONNECTED'}
          </div>
          <div
            className={`mt-1 text-xs font-mono tabular-nums ${
              (ethTicker?.priceChangePercent ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {ethTicker ? `24h ${ethTicker.priceChangePercent >= 0 ? '+' : ''}${ethTicker.priceChangePercent.toFixed(2)}%` : isInitialConnecting ? 'Fetching live ticker' : 'No live feed'}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400">Market Regime · Pairs Scanned</div>
          <div className="mt-1 text-xl font-semibold text-slate-100">{marketRegime}</div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            {items.length} analyzed · {totalQualifiedPairs} qualified · {longOpps.length + shortOpps.length} setups
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
          <div className="text-xs text-slate-400">Opportunities & Network</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-100">
            {longOpps.length} LONG · {shortOpps.length} SHORT
          </div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            Active: {activeSignals.length} · Ping {telemetry.restPingMs ?? '--'}ms · WS {telemetry.wsLatencyMs ?? '--'}ms · {formatTime(telemetry.lastDataUpdate)}
          </div>
        </div>
      </div>

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <div className="xl:col-span-7 rounded-lg border border-slate-800 bg-[#111622] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-slate-100">Live Signal Matrix</h2>
            <span className="text-xs text-slate-400 font-mono tabular-nums">
              {loading ? 'Scanning Binance...' : `${sortedRows.length} pairs`}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 bg-[#0D121C]">
                  <th className="py-2 px-2 font-medium">SYMBOL</th>
                  <th className="py-2 px-2 font-medium">DIR</th>
                  <th className="py-2 px-2 font-medium text-right">ENTRY</th>
                  <th className="py-2 px-2 font-medium text-right">STOP LOSS</th>
                  <th className="py-2 px-2 font-medium text-right">TP2</th>
                  <th className="py-2 px-2 font-medium text-right">SCORE</th>
                  <th className="py-2 px-2 font-medium text-right">R/R</th>
                  <th className="py-2 px-2 font-medium">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                {sortedRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-sans text-xs">
                      {loading ? 'Loading live Binance market quotes...' : 'No pairs match active filters.'}
                    </td>
                  </tr>
                ) : (
                  sortedRows.map(({ ticker, signal }) => (
                    <tr
                      key={ticker.symbol}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        ticker.symbol === activeSymbol ? 'bg-sky-950/25' : ''
                      }`}
                    >
                      <td className="py-2 px-2 font-semibold text-slate-100 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(ticker.symbol)}
                          className="text-left hover:text-sky-400 focus-visible:outline-none focus-visible:underline"
                        >
                          {ticker.symbol}
                        </button>
                      </td>
                      <td
                        className={`py-2 px-2 font-semibold whitespace-nowrap ${
                          signal.direction === 'LONG'
                            ? 'text-emerald-400'
                            : signal.direction === 'SHORT'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                        }`}
                      >
                        {signal.direction}
                      </td>
                      <td className="py-2 px-2 text-right text-slate-200 whitespace-nowrap">{formatPrice(signal.entry)}</td>
                      <td className="py-2 px-2 text-right text-rose-300 whitespace-nowrap">{formatPrice(signal.stopLoss)}</td>
                      <td className="py-2 px-2 text-right text-emerald-300 whitespace-nowrap">{formatPrice(signal.takeProfit2)}</td>
                      <td className="py-2 px-2 text-right text-slate-100 whitespace-nowrap">{signal.activeScore}/100</td>
                      <td className="py-2 px-2 text-right text-slate-300 whitespace-nowrap">1:{signal.riskReward.toFixed(1)}</td>
                      <td className="py-2 px-2 text-slate-300 font-sans whitespace-nowrap">{signal.entryState}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <CandlestickChart
            symbol={activeSymbol}
            klines={activeKlines}
            entry={activeSignal?.entry}
            stopLoss={activeSignal?.stopLoss}
            takeProfit1={activeSignal?.takeProfit1}
            takeProfit2={activeSignal?.takeProfit2}
            direction={activeSignal?.direction}
            height={420}
          />
        </div>
      </div>
    </div>
  );
};

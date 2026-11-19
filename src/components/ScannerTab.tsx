import React, { useMemo, useState } from 'react';
import type { SignalReport, Ticker24h } from '../engine/types';
import { formatPrice, formatUsd } from './formatters';

interface ScannerTabProps {
  items: { ticker: Ticker24h; signal: SignalReport }[];
  activeSymbol: string;
  loading: boolean;
  onSelectSymbol: (symbol: string) => void;
  onRefresh: () => void;
}

type SortKey = 'LONG' | 'SHORT' | 'SCORE' | 'VOLUME' | 'VOLATILITY';

export const ScannerTab: React.FC<ScannerTabProps> = ({
  items,
  activeSymbol,
  loading,
  onSelectSymbol,
  onRefresh,
}) => {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('SCORE');
  const [directionFilter, setDirectionFilter] = useState<'ALL' | 'LONG' | 'SHORT' | 'WAIT'>('ALL');
  const [copyStatus, setCopyStatus] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    const list = items.filter((item) => {
      if (q && !item.ticker.symbol.includes(q)) return false;
      if (directionFilter !== 'ALL' && item.signal.direction !== directionFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      switch (sortBy) {
        case 'LONG':
          return b.signal.longScore - a.signal.longScore;
        case 'SHORT':
          return b.signal.shortScore - a.signal.shortScore;
        case 'VOLUME':
          return b.ticker.quoteVolume - a.ticker.quoteVolume;
        case 'VOLATILITY':
          return b.ticker.volatilityPct - a.ticker.volatilityPct;
        default:
          return b.signal.activeScore - a.signal.activeScore;
      }
    });
    return list;
  }, [items, query, sortBy, directionFilter]);

  const handlePasteSymbol = async () => {
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) setQuery(txt.trim().toUpperCase());
    } catch {
      // ignore if clipboard permission unavailable
    }
  };

  const handleCopyTable = async () => {
    const header = 'SYMBOL\tPRICE\tCHANGE%\tVOLUME\tSPREAD%\tMOMENTUM\tSIGNAL\tSCORE';
    const lines = filtered.map(
      ({ ticker, signal }) =>
        `${ticker.symbol}\t${formatPrice(ticker.lastPrice)}\t${ticker.priceChangePercent.toFixed(2)}%\t${formatUsd(ticker.quoteVolume)}\t${ticker.spreadPct.toFixed(3)}%\t${signal.momentum.strength}\t${signal.direction}\tL:${signal.longScore}/S:${signal.shortScore}`,
    );
    try {
      await navigator.clipboard.writeText([header, ...lines].join('\n'));
      setCopyStatus('Copied table to clipboard');
      setTimeout(() => setCopyStatus(''), 2000);
    } catch {
      setCopyStatus('Clipboard write denied');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111622] p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="scanner-search" className="sr-only">
            Search trading pair
          </label>
          <input
            id="scanner-search"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search symbol (e.g. BTCUSDT, ETH, SOL)..."
            className="w-64 rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handlePasteSymbol}
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
          >
            Paste Symbol
          </button>
          <div className="flex items-center gap-1 rounded-lg bg-[#0B0E14] p-1 border border-slate-800">
            {(['ALL', 'LONG', 'SHORT', 'WAIT'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setDirectionFilter(dir)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                  directionFilter === dir
                    ? 'bg-slate-800 text-sky-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="scanner-sort" className="text-xs text-slate-400">
            Sort:
          </label>
          <select
            id="scanner-sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-slate-700 bg-[#0B0E14] px-2.5 py-1.5 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            <option value="SCORE">Signal Quality</option>
            <option value="LONG">Best LONG</option>
            <option value="SHORT">Best SHORT</option>
            <option value="VOLUME">24h Volume</option>
            <option value="VOLATILITY">24h Volatility</option>
          </select>
          <button
            type="button"
            onClick={handleCopyTable}
            className="rounded-lg border border-slate-700 bg-slate-800/70 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
          >
            Copy Table
          </button>
          <button
            type="button"
            onClick={onRefresh}
            className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap"
          >
            {loading ? 'Scanning...' : 'Scan Now'}
          </button>
        </div>
      </div>

      {copyStatus && <div className="text-xs text-sky-400">{copyStatus}</div>}

      <div className="rounded-lg border border-slate-800 bg-[#111622] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-[#0D121C]">
                <th className="py-2.5 px-3 font-medium">SYMBOL</th>
                <th className="py-2.5 px-3 font-medium text-right">PRICE</th>
                <th className="py-2.5 px-3 font-medium text-right">CHANGE (24H)</th>
                <th className="py-2.5 px-3 font-medium text-right">VOLUME (24H)</th>
                <th className="py-2.5 px-3 font-medium text-right">SPREAD</th>
                <th className="py-2.5 px-3 font-medium">MOMENTUM</th>
                <th className="py-2.5 px-3 font-medium">SIGNAL</th>
                <th className="py-2.5 px-3 font-medium text-right">SCORE (L / S)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400 font-sans">
                    No trading pairs match your current scanner filter.
                  </td>
                </tr>
              ) : (
                filtered.map(({ ticker, signal }) => (
                  <tr
                    key={ticker.symbol}
                    className={`hover:bg-slate-800/40 transition-colors ${
                      ticker.symbol === activeSymbol ? 'bg-sky-950/25' : ''
                    }`}
                  >
                    <td className="py-2.5 px-3 font-semibold text-slate-100">
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(ticker.symbol)}
                        className="hover:text-sky-400 focus-visible:outline-none focus-visible:underline"
                      >
                        {ticker.symbol}
                      </button>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{formatPrice(ticker.lastPrice)}</td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        ticker.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {ticker.priceChangePercent >= 0 ? '+' : ''}
                      {ticker.priceChangePercent.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{formatUsd(ticker.quoteVolume)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">{ticker.spreadPct.toFixed(3)}%</td>
                    <td className="py-2.5 px-3 text-slate-300 font-sans">{signal.momentum.strength}</td>
                    <td
                      className={`py-2.5 px-3 font-semibold ${
                        signal.direction === 'LONG'
                          ? 'text-emerald-400'
                          : signal.direction === 'SHORT'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      {signal.direction}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">
                      {signal.longScore} / {signal.shortScore}
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

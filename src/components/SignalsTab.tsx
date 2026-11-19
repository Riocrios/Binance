import React, { useState } from 'react';
import type { SignalReport } from '../engine/types';
import { formatPrice } from './formatters';

interface SignalsTabProps {
  signal: SignalReport | null;
  spreadPct: number;
  loading: boolean;
  onLogToJournal: (signal: SignalReport, spreadPct: number) => Promise<void>;
}

export const SignalsTab: React.FC<SignalsTabProps> = ({
  signal,
  spreadPct,
  loading,
  onLogToJournal,
}) => {
  const [feedback, setFeedback] = useState<string | null>(null);

  if (loading && !signal) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-8 text-center text-sm text-slate-400">
        Running multi-timeframe analysis on Binance data...
      </div>
    );
  }

  if (!signal) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-8 text-center text-sm text-slate-400">
        Select a symbol from the Market Scanner to inspect its multi-factor signal report.
      </div>
    );
  }

  const dirColor =
    signal.direction === 'LONG'
      ? 'text-emerald-400'
      : signal.direction === 'SHORT'
      ? 'text-rose-400'
      : 'text-amber-300';

  const copyLevels = async () => {
    const txt = `${signal.symbol} ${signal.direction} | ENTRY: ${formatPrice(signal.entry)} | SL: ${formatPrice(signal.stopLoss)} | TP1: ${formatPrice(signal.takeProfit1)} | TP2: ${formatPrice(signal.takeProfit2)}`;
    await navigator.clipboard.writeText(txt);
    setFeedback('Entry / SL / TP copied to clipboard.');
    setTimeout(() => setFeedback(null), 2200);
  };

  const copyFullSignal = async () => {
    const txt = [
      `${signal.symbol} (${signal.marketMode})`,
      `DIRECTION: ${signal.direction}`,
      `ENTRY: ${formatPrice(signal.entry)}`,
      `STOP LOSS: ${formatPrice(signal.stopLoss)}`,
      `TAKE PROFIT 1: ${formatPrice(signal.takeProfit1)}`,
      `TAKE PROFIT 2: ${formatPrice(signal.takeProfit2)}`,
      `LONG SCORE: ${signal.longScore}/100 | SHORT SCORE: ${signal.shortScore}/100`,
      `RISK/REWARD: 1:${signal.riskReward}`,
      `REASONS:`,
      ...signal.reasons.map((r) => `- ${r}`),
      `INVALIDATION: ${signal.invalidation}`,
    ].join('\n');
    await navigator.clipboard.writeText(txt);
    setFeedback('Full signal report copied to clipboard.');
    setTimeout(() => setFeedback(null), 2200);
  };

  const handleSaveJournal = async () => {
    try {
      await onLogToJournal(signal, spreadPct);
      setFeedback('Virtual signal logged to Trade Journal.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Rejected by Risk Manager');
    }
    setTimeout(() => setFeedback(null), 3500);
  };

  const factors = [
    { name: 'Trend (25%)', l: signal.breakdown.trendLong, s: signal.breakdown.trendShort },
    { name: 'Momentum (20%)', l: signal.breakdown.momentumLong, s: signal.breakdown.momentumShort },
    { name: 'Volume (20%)', l: signal.breakdown.volumeLong, s: signal.breakdown.volumeShort },
    { name: 'Market Structure (15%)', l: signal.breakdown.structureLong, s: signal.breakdown.structureShort },
    { name: 'Order Flow (10%)', l: signal.breakdown.orderFlowLong, s: signal.breakdown.orderFlowShort },
    { name: 'Volatility (10%)', l: signal.breakdown.volatilityLong, s: signal.breakdown.volatilityShort },
  ];

  return (
    <div className="space-y-5">
      {/* Header & Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-[#111622] p-4">
        <div>
          <div className="text-xs text-slate-400">
            {signal.symbol} · {signal.marketMode} · State: {signal.entryState}
          </div>
          <div className={`mt-1 text-2xl font-bold font-mono tabular-nums ${dirColor}`}>
            DIRECTION: {signal.direction}
          </div>
          <div className="mt-1 text-xs text-slate-400 font-mono tabular-nums">
            LONG Score {signal.longScore}/100 · SHORT Score {signal.shortScore}/100 · R/R 1:{signal.riskReward}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={copyLevels}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
          >
            Copy Entry / SL / TP
          </button>
          <button
            type="button"
            onClick={copyFullSignal}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 whitespace-nowrap"
          >
            Copy Full Signal
          </button>
          <button
            type="button"
            disabled={signal.direction === 'WAIT'}
            onClick={handleSaveJournal}
            className="rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            Record Virtual Signal
          </button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-sky-500/40 bg-sky-950/30 px-4 py-2 text-xs text-sky-200">
          {feedback}
        </div>
      )}

      {/* Price Levels Strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono tabular-nums">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3">
          <div className="text-xs text-slate-400 font-sans">Entry Level</div>
          <div className="mt-1 text-base font-semibold text-sky-400">{formatPrice(signal.entry)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3">
          <div className="text-xs text-slate-400 font-sans">Stop Loss</div>
          <div className="mt-1 text-base font-semibold text-rose-400">{formatPrice(signal.stopLoss)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3">
          <div className="text-xs text-slate-400 font-sans">Take Profit 1 (40%)</div>
          <div className="mt-1 text-base font-semibold text-emerald-300">{formatPrice(signal.takeProfit1)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3">
          <div className="text-xs text-slate-400 font-sans">Take Profit 2 (40%)</div>
          <div className="mt-1 text-base font-semibold text-emerald-400">{formatPrice(signal.takeProfit2)}</div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3">
          <div className="text-xs text-slate-400 font-sans">Take Profit 3 (20%)</div>
          <div className="mt-1 text-base font-semibold text-emerald-500">{formatPrice(signal.takeProfit3)}</div>
        </div>
      </div>

      {/* Explanation + Breakdown + Multi-Timeframe */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-4 space-y-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">Decision Rationale & Smart Exit Plan</h3>
            <p className="mt-1 text-xs text-slate-400">
              Note: Score (0–100) measures multi-factor technical confluence, not a mathematical probability of profit.
            </p>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-semibold text-slate-300">REASONS</div>
            <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
              {signal.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          {signal.warnings.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold text-amber-400">GUARDRAIL WARNINGS</div>
              <ul className="space-y-1 text-xs text-amber-200 list-disc pl-4">
                {signal.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-1.5 border-t border-slate-800 pt-3">
            <div className="text-xs font-semibold text-rose-400">INVALIDATION</div>
            <p className="text-xs text-slate-300">{signal.invalidation}</p>
          </div>

          <div className="space-y-1.5 border-t border-slate-800 pt-3">
            <div className="text-xs font-semibold text-sky-400">SMART EXIT RULES</div>
            <ul className="space-y-1 text-xs text-slate-300 list-disc pl-4">
              {signal.exitPlan.partialCloseRules.map((r, i) => (
                <li key={`p-${i}`}>{r}</li>
              ))}
              {signal.exitPlan.fullExitRules.map((r, i) => (
                <li key={`f-${i}`}>{r}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
            <h3 className="text-sm font-semibold text-slate-100 mb-3">6-Factor Score Breakdown</h3>
            <table className="w-full text-xs border-collapse font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-left font-sans font-medium">Factor</th>
                  <th className="py-2 text-right font-medium text-emerald-400">LONG</th>
                  <th className="py-2 text-right font-medium text-rose-400">SHORT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {factors.map((f) => (
                  <tr key={f.name}>
                    <td className="py-2 text-slate-200 font-sans">{f.name}</td>
                    <td className="py-2 text-right text-emerald-400">{f.l}</td>
                    <td className="py-2 text-right text-rose-400">{f.s}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
            <h3 className="text-sm font-semibold text-slate-100 mb-3">Multi-Timeframe Alignment (1m – 1d)</h3>
            <table className="w-full text-xs border-collapse font-mono tabular-nums">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2 text-left font-sans font-medium">TF</th>
                  <th className="py-2 text-left font-sans font-medium">BIAS</th>
                  <th className="py-2 text-left font-sans font-medium">EMA ALIGN</th>
                  <th className="py-2 text-right font-medium">RSI 14</th>
                  <th className="py-2 text-right font-medium">MACD HIST</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {signal.timeframeBiases.map((b) => (
                  <tr key={b.timeframe}>
                    <td className="py-2 font-semibold text-slate-100">{b.timeframe}</td>
                    <td
                      className={`py-2 font-semibold ${
                        b.direction === 'LONG'
                          ? 'text-emerald-400'
                          : b.direction === 'SHORT'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {b.direction}
                    </td>
                    <td className="py-2 text-slate-300 font-sans">{b.emaAlignment}</td>
                    <td className="py-2 text-right text-slate-200">{b.rsi.toFixed(1)}</td>
                    <td className="py-2 text-right text-slate-300">{b.macdHist.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

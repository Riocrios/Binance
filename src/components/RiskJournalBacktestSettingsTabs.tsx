import React, { useMemo, useState } from 'react';
import { evaluateRisk } from '../engine/riskManager';
import type {
  BacktestResult,
  JournalEntry,
  JournalStats,
  MarketMode,
  RiskConfig,
  ScannerFilters,
  SignalReport,
  SignalWeights,
  Timeframe,
} from '../engine/types';
import { formatDateTime, formatPrice } from './formatters';

export const RiskManagerTab: React.FC<{
  riskConfig: RiskConfig;
  signal: SignalReport | null;
  spreadPct: number;
  openPositionsCount: number;
  onSaveRisk: (cfg: RiskConfig) => Promise<void>;
}> = ({ riskConfig, signal, spreadPct, openPositionsCount, onSaveRisk }) => {
  const [draft, setDraft] = useState<RiskConfig>(riskConfig);
  const [savedMsg, setSavedMsg] = useState('');

  const evalResult = useMemo(() => {
    const dir = signal?.direction ?? 'LONG';
    const entry = signal?.entry ?? 60000;
    const sl = signal?.stopLoss ?? 59200;
    const tp1 = signal?.takeProfit1 ?? 60960;
    const tp2 = signal?.takeProfit2 ?? 61760;
    return evaluateRisk({
      direction: dir,
      entry,
      stopLoss: sl,
      takeProfit1: tp1,
      takeProfit2: tp2,
      spreadPct,
      openPositionsCount,
      dailyRealizedLossUsd: 0,
      config: draft,
    });
  }, [draft, signal, spreadPct, openPositionsCount]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveRisk(draft);
    setSavedMsg('Risk configuration saved to SQLite.');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <form onSubmit={handleSave} className="rounded-lg border border-slate-800 bg-[#111622] p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-100">Risk Manager Configuration</h2>
        <div className="grid grid-cols-2 gap-3 text-xs">
          {[
            { label: 'Virtual Balance (USDT)', key: 'virtualBalance', step: '100' },
            { label: 'Risk per Trade (%)', key: 'riskPerTradePct', step: '0.1' },
            { label: 'Max Daily Loss (%)', key: 'maxDailyLossPct', step: '0.5' },
            { label: 'Max Open Positions', key: 'maxOpenPositions', step: '1' },
            { label: 'Minimum Risk/Reward', key: 'minRiskReward', step: '0.1' },
            { label: 'Max Spread (%)', key: 'maxSpreadPct', step: '0.01' },
            { label: 'Max Slippage (%)', key: 'maxSlippagePct', step: '0.01' },
            { label: 'Leverage Scenario (x)', key: 'leverage', step: '1' },
          ].map((f) => (
            <div key={f.key}>
              <label htmlFor={`risk-${f.key}`} className="block text-slate-400 mb-1">
                {f.label}
              </label>
              <input
                id={`risk-${f.key}`}
                type="number"
                step={f.step}
                value={draft[f.key as keyof RiskConfig]}
                onChange={(e) =>
                  setDraft({ ...draft, [f.key]: Number(e.target.value) })
                }
                className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100 focus:border-sky-500 focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-sky-400">{savedMsg}</span>
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap"
          >
            Save Risk Config
          </button>
        </div>
      </form>

      <div className="rounded-lg border border-slate-800 bg-[#111622] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-100">
            Position Sizing & Cost Simulation ({signal?.symbol ?? 'Reference'})
          </h2>
          <span
            className={`text-xs font-bold font-mono ${
              evalResult.approved ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {evalResult.approved ? 'APPROVED' : 'REJECTED'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs font-mono tabular-nums">
          <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
            <div className="text-slate-400 font-sans">Position Size</div>
            <div className="mt-1 text-base font-semibold text-slate-100">
              {evalResult.positionSizeQty.toFixed(5)} units
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
            <div className="text-slate-400 font-sans">Notional / Margin ({draft.leverage}x)</div>
            <div className="mt-1 text-base font-semibold text-slate-100">
              ${evalResult.notionalValueUsd.toLocaleString()} / ${evalResult.requiredMarginUsd.toLocaleString()}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
            <div className="text-slate-400 font-sans">Net Profit (TP2)</div>
            <div className="mt-1 text-base font-semibold text-emerald-400">
              +${evalResult.netProfitTp2Usd.toFixed(2)} (+{evalResult.netProfitTp2PctBalance.toFixed(2)}%)
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-[#0B0E14] p-3">
            <div className="text-slate-400 font-sans">Net Max Loss (SL)</div>
            <div className="mt-1 text-base font-semibold text-rose-400">
              -${evalResult.netMaxLossUsd.toFixed(2)} (-{evalResult.netMaxLossPctBalance.toFixed(2)}%)
            </div>
          </div>
        </div>

        <div className="text-xs text-slate-300 font-mono tabular-nums space-y-1 border-t border-slate-800 pt-3">
          <div>
            Entry + Exit Fees: ${(evalResult.estimatedEntryFeeUsd + evalResult.estimatedExitFeeUsd).toFixed(2)} · Slippage: ${evalResult.estimatedSlippageUsd.toFixed(2)} · Est. Funding: ${evalResult.estimatedFundingUsd.toFixed(2)}
          </div>
          <div>
            Stop Distance: {evalResult.stopDistancePct.toFixed(3)}% · Net Effective Risk/Reward: 1:{evalResult.effectiveRiskReward.toFixed(2)}
          </div>
        </div>

        {evalResult.rejectionReasons.length > 0 && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-3 text-xs text-rose-200 space-y-1">
            {evalResult.rejectionReasons.map((r, i) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export const TradeJournalTab: React.FC<{
  entries: JournalEntry[];
  stats: JournalStats;
  onCloseEntry: (id: number) => Promise<void>;
  onDeleteEntry: (id: number) => Promise<void>;
}> = ({ entries, stats, onCloseEntry, onDeleteEntry }) => {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 font-mono tabular-nums">
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3.5">
          <div className="text-xs text-slate-400 font-sans">Total / Open Signals</div>
          <div className="mt-1 text-xl font-semibold text-slate-100">
            {stats.totalSignals} / {stats.openSignals}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3.5">
          <div className="text-xs text-slate-400 font-sans">Win Rate (W / L)</div>
          <div className="mt-1 text-xl font-semibold text-slate-100">
            {stats.winRatePct.toFixed(1)}% ({stats.winningSignals}/{stats.losingSignals})
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3.5">
          <div className="text-xs text-slate-400 font-sans">Net Simulated PnL</div>
          <div className={`mt-1 text-xl font-semibold ${stats.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            ${stats.netPnlUsd >= 0 ? '+' : ''}
            {stats.netPnlUsd.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3.5">
          <div className="text-xs text-slate-400 font-sans">Avg R / Max DD / PF</div>
          <div className="mt-1 text-sm font-semibold text-slate-100">
            {stats.averageR.toFixed(2)}R · {stats.maxDrawdownPct.toFixed(1)}% · PF {stats.profitFactor.toFixed(2)}
          </div>
        </div>
        <div className="rounded-lg border border-slate-800 bg-[#111622] p-3.5">
          <div className="text-xs text-slate-400 font-sans">LONG vs SHORT</div>
          <div className="mt-1 text-xs font-semibold text-slate-200">
            L: {stats.longWinRatePct.toFixed(0)}% (${stats.longNetPnlUsd.toFixed(0)}) · S: {stats.shortWinRatePct.toFixed(0)}% (${stats.shortNetPnlUsd.toFixed(0)})
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111622] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 bg-[#0D121C]">
                <th className="py-2.5 px-3 font-medium">TIME</th>
                <th className="py-2.5 px-3 font-medium">SYMBOL</th>
                <th className="py-2.5 px-3 font-medium">DIR</th>
                <th className="py-2.5 px-3 font-medium text-right">ENTRY</th>
                <th className="py-2.5 px-3 font-medium text-right">SL</th>
                <th className="py-2.5 px-3 font-medium text-right">TP2</th>
                <th className="py-2.5 px-3 font-medium text-right">SCORE / R:R</th>
                <th className="py-2.5 px-3 font-medium">STATUS</th>
                <th className="py-2.5 px-3 font-medium text-right">NET PNL / R</th>
                <th className="py-2.5 px-3 font-medium text-right">ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-slate-400 font-sans">
                    No virtual signals recorded yet. Open AI Signals and click Record Virtual Signal to begin tracking simulated outcomes.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 text-slate-400">{formatDateTime(e.createdAt)}</td>
                    <td className="py-2.5 px-3 font-semibold text-slate-100">{e.symbol}</td>
                    <td className={`py-2.5 px-3 font-semibold ${e.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {e.direction}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-200">{formatPrice(e.entryPrice)}</td>
                    <td className="py-2.5 px-3 text-right text-rose-300">{formatPrice(e.stopLoss)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-300">{formatPrice(e.takeProfit2)}</td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {e.score} · 1:{e.riskReward.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-200">{e.status}</td>
                    <td
                      className={`py-2.5 px-3 text-right ${
                        e.realizedPnlUsd === null
                          ? 'text-slate-400'
                          : e.realizedPnlUsd >= 0
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {e.realizedPnlUsd === null
                        ? 'OPEN'
                        : `$${e.realizedPnlUsd >= 0 ? '+' : ''}${e.realizedPnlUsd.toFixed(2)} (${e.realizedR?.toFixed(2)}R)`}
                    </td>
                    <td className="py-2.5 px-3 text-right font-sans space-x-2">
                      {e.status === 'OPEN' && (
                        <button
                          type="button"
                          onClick={() => onCloseEntry(e.id)}
                          className="text-sky-400 hover:underline"
                        >
                          Close
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteEntry(e.id)}
                        className="text-rose-400 hover:underline"
                      >
                        Delete
                      </button>
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

export const BacktestingTab: React.FC<{
  defaultSymbol: string;
  result: BacktestResult | null;
  running: boolean;
  onRunBacktest: (params: {
    symbol: string;
    timeframe: Timeframe;
    limit: number;
    commissionPct: number;
    slippagePct: number;
  }) => Promise<void>;
}> = ({ defaultSymbol, result, running, onRunBacktest }) => {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [limit, setLimit] = useState(350);
  const [commissionPct, setCommissionPct] = useState(0.05);
  const [slippagePct, setSlippagePct] = useState(0.05);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onRunBacktest({ symbol, timeframe, limit, commissionPct, slippagePct });
  };

  const equityPath = useMemo(() => {
    if (!result || result.equityCurve.length < 2) return '';
    const pts = result.equityCurve;
    const minY = Math.min(...pts.map((p) => p.equity));
    const maxY = Math.max(...pts.map((p) => p.equity));
    const span = maxY - minY || 1;
    const w = 860;
    const h = 150;
    return pts
      .map((p, i) => {
        const x = (i / (pts.length - 1)) * w;
        const y = h - 10 - ((p.equity - minY) / span) * (h - 20);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [result]);

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-[#111622] p-4 text-xs"
      >
        <div>
          <label htmlFor="bt-sym" className="block text-slate-400 mb-1">
            Symbol
          </label>
          <input
            id="bt-sym"
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="w-32 rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="bt-tf" className="block text-slate-400 mb-1">
            Timeframe
          </label>
          <select
            id="bt-tf"
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as Timeframe)}
            className="rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
          >
            <option value="5m">5m</option>
            <option value="15m">15m</option>
            <option value="1h">1h</option>
            <option value="4h">4h</option>
          </select>
        </div>
        <div>
          <label htmlFor="bt-bars" className="block text-slate-400 mb-1">
            Historical Candles
          </label>
          <input
            id="bt-bars"
            type="number"
            min={150}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-28 rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="bt-fee" className="block text-slate-400 mb-1">
            Commission %
          </label>
          <input
            id="bt-fee"
            type="number"
            step="0.01"
            value={commissionPct}
            onChange={(e) => setCommissionPct(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
          />
        </div>
        <div>
          <label htmlFor="bt-slip" className="block text-slate-400 mb-1">
            Slippage %
          </label>
          <input
            id="bt-slip"
            type="number"
            step="0.01"
            value={slippagePct}
            onChange={(e) => setSlippagePct(Number(e.target.value))}
            className="w-24 rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
          />
        </div>
        <button
          type="submit"
          disabled={running}
          className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50 whitespace-nowrap"
        >
          {running ? 'Running Backtest...' : 'Run Walk-Forward Backtest'}
        </button>
      </form>

      {result && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 font-mono tabular-nums">
            <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
              <div className="text-xs text-slate-400 font-sans">Overall ({result.candlesAnalyzed} bars)</div>
              <div className={`mt-1 text-xl font-semibold ${result.overall.netPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                ${result.overall.netPnlUsd >= 0 ? '+' : ''}
                {result.overall.netPnlUsd.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-sans">
                {result.overall.trades} trades · WR {result.overall.winRatePct}% · Max DD {result.overall.maxDrawdownPct}%
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
              <div className="text-xs text-slate-400 font-sans">In-Sample (First 60%)</div>
              <div className="mt-1 text-xl font-semibold text-slate-100">
                ${result.inSample.netPnlUsd >= 0 ? '+' : ''}
                {result.inSample.netPnlUsd.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-sans">
                {result.inSample.trades} trades · WR {result.inSample.winRatePct}% · PF {result.inSample.profitFactor}
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
              <div className="text-xs text-slate-400 font-sans">Out-of-Sample Validation (Last 40%)</div>
              <div className="mt-1 text-xl font-semibold text-sky-400">
                ${result.outOfSample.netPnlUsd >= 0 ? '+' : ''}
                {result.outOfSample.netPnlUsd.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-sans">
                {result.outOfSample.trades} trades · WR {result.outOfSample.winRatePct}% · PF {result.outOfSample.profitFactor}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#111622] p-4">
            <div className="mb-2 text-xs font-semibold text-slate-300">
              Equity Curve (Strictly Causal · Zero Look-Ahead Bias)
            </div>
            <svg viewBox="0 0 860 150" className="w-full h-36 bg-[#0B0E14] rounded border border-slate-800/80">
              <path d={equityPath} fill="none" stroke="#38BDF8" strokeWidth="2" />
            </svg>
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#111622] overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-800 text-xs font-semibold text-slate-200">
              Simulated Walk-Forward Trades ({result.trades.length})
            </div>
            <div className="overflow-x-auto max-h-72 overflow-y-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-[#0D121C]">
                    <th className="py-2 px-3 font-medium">SEGMENT</th>
                    <th className="py-2 px-3 font-medium">DIR</th>
                    <th className="py-2 px-3 font-medium text-right">ENTRY</th>
                    <th className="py-2 px-3 font-medium text-right">EXIT</th>
                    <th className="py-2 px-3 font-medium text-right">NET PNL</th>
                    <th className="py-2 px-3 font-medium text-right">R</th>
                    <th className="py-2 px-3 font-medium">REASON</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                  {result.trades.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-400 font-sans">
                        No trades triggered during this window under current score and R:R filters.
                      </td>
                    </tr>
                  ) : (
                    result.trades.map((t, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-sans text-slate-300">{t.segment}</td>
                        <td className={`py-2 px-3 font-semibold ${t.direction === 'LONG' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {t.direction}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-200">{formatPrice(t.entryPrice)}</td>
                        <td className="py-2 px-3 text-right text-slate-200">{formatPrice(t.exitPrice)}</td>
                        <td className={`py-2 px-3 text-right ${t.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ${t.pnlUsd >= 0 ? '+' : ''}
                          {t.pnlUsd.toFixed(2)}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-300">{t.rMultiple.toFixed(2)}R</td>
                        <td className="py-2 px-3 font-sans text-slate-300">{t.exitReason}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export const SettingsTab: React.FC<{
  marketMode: MarketMode;
  weights: SignalWeights;
  filters: ScannerFilters;
  apiKeyMasked: string | null;
  onSaveSettings: (payload: {
    marketMode: MarketMode;
    weights: SignalWeights;
    filters: ScannerFilters;
    apiKey?: string;
  }) => Promise<void>;
}> = ({ marketMode, weights, filters, apiKeyMasked, onSaveSettings }) => {
  const [mode, setMode] = useState<MarketMode>(marketMode);
  const [w, setW] = useState<SignalWeights>(weights);
  const [f, setF] = useState<ScannerFilters>(filters);
  const [apiKey, setApiKey] = useState('');
  const [msg, setMsg] = useState('');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSaveSettings({ marketMode: mode, weights: w, filters: f, apiKey: apiKey || undefined });
    setApiKey('');
    setMsg('Settings saved and applied.');
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div className="rounded-lg border border-slate-800 bg-[#111622] p-5 space-y-4 text-xs">
        <h2 className="text-sm font-semibold text-slate-100">Market, Scanner & Configurable Weights</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="set-mode" className="block text-slate-400 mb-1">
              Default Market
            </label>
            <select
              id="set-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as MarketMode)}
              className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-slate-100"
            >
              <option value="FUTURES">USDT-M FUTURES</option>
              <option value="SPOT">SPOT</option>
            </select>
          </div>
          <div>
            <label htmlFor="set-aggr" className="block text-slate-400 mb-1">
              Strategy Aggressiveness
            </label>
            <select
              id="set-aggr"
              value={f.aggressiveness}
              onChange={(e) =>
                setF({ ...f, aggressiveness: e.target.value as ScannerFilters['aggressiveness'] })
              }
              className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 text-slate-100"
            >
              <option value="CONSERVATIVE">CONSERVATIVE</option>
              <option value="BALANCED">BALANCED</option>
              <option value="AGGRESSIVE">AGGRESSIVE</option>
            </select>
          </div>
          <div>
            <label htmlFor="set-vol" className="block text-slate-400 mb-1">
              Min 24h Volume (USD)
            </label>
            <input
              id="set-vol"
              type="number"
              value={f.minVolume24hUsd}
              onChange={(e) => setF({ ...f, minVolume24hUsd: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
            />
          </div>
          <div>
            <label htmlFor="set-vola" className="block text-slate-400 mb-1">
              Min 24h Volatility (%)
            </label>
            <input
              id="set-vola"
              type="number"
              step="0.1"
              value={f.minVolatilityPct}
              onChange={(e) => setF({ ...f, minVolatilityPct: Number(e.target.value) })}
              className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-slate-300">
          <input
            type="checkbox"
            checked={f.excludeStablecoins}
            onChange={(e) => setF({ ...f, excludeStablecoins: e.target.checked })}
          />
          Exclude stablecoins by default
        </label>

        <div className="grid grid-cols-3 gap-3 pt-2 border-t border-slate-800">
          {(
            [
              ['trend', 'Trend %'],
              ['momentum', 'Momentum %'],
              ['volume', 'Volume %'],
              ['structure', 'Structure %'],
              ['orderFlow', 'Order Flow %'],
              ['volatility', 'Volatility %'],
            ] as const
          ).map(([k, lbl]) => (
            <div key={k}>
              <label htmlFor={`w-${k}`} className="block text-slate-400 mb-1">
                {lbl}
              </label>
              <input
                id={`w-${k}`}
                type="number"
                value={w[k]}
                onChange={(e) => setW({ ...w, [k]: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-1.5 font-mono text-slate-100"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-[#111622] p-5 space-y-4 text-xs">
        <h2 className="text-sm font-semibold text-slate-100">Binance API Key (Optional · Read-Only)</h2>
        <p className="text-slate-400 leading-relaxed">
          All public market feeds work out-of-the-box without an API key. If you add a key, only Read-Only permissions are needed — never enable Withdraw, Transfer, or Trading in v1. Keys are stored securely and never logged.
        </p>
        <div className="text-slate-300 font-mono">
          Status: {apiKeyMasked ? `Configured (${apiKeyMasked})` : 'Public Market Streams (No Key)'}
        </div>
        <div>
          <label htmlFor="set-apikey" className="block text-slate-400 mb-1">
            New Binance API Key
          </label>
          <input
            id="set-apikey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Optional Read-Only API Key"
            className="w-full rounded-lg border border-slate-700 bg-[#0B0E14] px-3 py-2 font-mono text-slate-100"
          />
        </div>
        <div className="flex items-center justify-between pt-2">
          <span className="text-sky-400">{msg}</span>
          <button
            type="submit"
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-500 whitespace-nowrap"
          >
            Save Settings
          </button>
        </div>
      </div>
    </form>
  );
};

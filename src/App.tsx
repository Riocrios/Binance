import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  CandlestickChart as CandleIcon,
  Download,
  Flame,
  Gauge,
  LayoutDashboard,
  Radar,
  Settings,
  ShieldCheck,
  Waves,
} from 'lucide-react';
import { OverviewTab } from './components/OverviewTab';
import { ScannerTab } from './components/ScannerTab';
import { SignalsTab } from './components/SignalsTab';
import {
  LiveChartsTab,
  MomentumTab,
  VolumeAnalysisTab,
  WhaleTrackerTab,
} from './components/WhaleMomentumVolumeTabs';
import {
  BacktestingTab,
  RiskManagerTab,
  SettingsTab,
  TradeJournalTab,
} from './components/RiskJournalBacktestSettingsTabs';
import { formatTime } from './components/formatters';
import { DEFAULT_RISK_CONFIG } from './engine/riskManager';
import { DEFAULT_SIGNAL_WEIGHTS } from './engine/signalEngine';
import type {
  BacktestResult,
  ConnectionTelemetry,
  JournalEntry,
  JournalStats,
  Kline,
  MarketMode,
  OrderBookSnapshot,
  RiskConfig,
  ScannerFilters,
  SignalReport,
  SignalWeights,
  Ticker24h,
  Timeframe,
  WhaleEvent,
} from './engine/types';

type TabId =
  | 'OVERVIEW'
  | 'MARKET SCANNER'
  | 'AI SIGNALS'
  | 'WHALE TRACKER'
  | 'MOMENTUM'
  | 'VOLUME ANALYSIS'
  | 'LIVE CHARTS'
  | 'RISK MANAGER'
  | 'TRADE JOURNAL'
  | 'BACKTESTING'
  | 'SETTINGS';

const NAV_ITEMS: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'OVERVIEW', label: 'Overview', icon: LayoutDashboard },
  { id: 'MARKET SCANNER', label: 'Market Scanner', icon: Radar },
  { id: 'AI SIGNALS', label: 'AI Signals', icon: Activity },
  { id: 'WHALE TRACKER', label: 'Whale Tracker', icon: Waves },
  { id: 'MOMENTUM', label: 'Momentum', icon: Flame },
  { id: 'VOLUME ANALYSIS', label: 'Volume Analysis', icon: BarChart3 },
  { id: 'LIVE CHARTS', label: 'Live Charts', icon: CandleIcon },
  { id: 'RISK MANAGER', label: 'Risk Manager', icon: ShieldCheck },
  { id: 'TRADE JOURNAL', label: 'Trade Journal', icon: BookOpen },
  { id: 'BACKTESTING', label: 'Backtesting', icon: Gauge },
  { id: 'SETTINGS', label: 'Settings', icon: Settings },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('OVERVIEW');
  const [activeSymbol, setActiveSymbol] = useState('BTCUSDT');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');

  const [telemetry, setTelemetry] = useState<ConnectionTelemetry>({
    status: 'DISCONNECTED',
    marketMode: 'FUTURES',
    restPingMs: null,
    wsLatencyMs: null,
    wsConnected: false,
    lastDataUpdate: null,
    apiErrorsCount: 0,
    lastError: null,
    reconnectAttempts: 0,
    hasApiKey: false,
    apiKeyMasked: null,
  });

  const [weights, setWeights] = useState<SignalWeights>(DEFAULT_SIGNAL_WEIGHTS);
  const [filters, setFilters] = useState<ScannerFilters>({
    minVolume24hUsd: 25_000_000,
    maxSpreadPct: 0.15,
    minVolatilityPct: 0.6,
    excludeStablecoins: true,
    aggressiveness: 'BALANCED',
  });
  const [riskConfig, setRiskConfig] = useState<RiskConfig>(DEFAULT_RISK_CONFIG);

  const [scannerItems, setScannerItems] = useState<{ ticker: Ticker24h; signal: SignalReport }[]>([]);
  const [btcTicker, setBtcTicker] = useState<Ticker24h | null>(null);
  const [ethTicker, setEthTicker] = useState<Ticker24h | null>(null);
  const [totalQualifiedPairs, setTotalQualifiedPairs] = useState(0);
  const [scannerLoading, setScannerLoading] = useState(true);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const [symbolKlines, setSymbolKlines] = useState<Kline[]>([]);
  const [symbolSignal, setSymbolSignal] = useState<SignalReport | null>(null);
  const [symbolOrderBook, setSymbolOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [symbolTicker, setSymbolTicker] = useState<Ticker24h | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(true);

  const [whales, setWhales] = useState<WhaleEvent[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [journalStats, setJournalStats] = useState<JournalStats>({
    totalSignals: 0,
    openSignals: 0,
    winningSignals: 0,
    losingSignals: 0,
    winRatePct: 0,
    averageR: 0,
    netPnlUsd: 0,
    maxDrawdownPct: 0,
    profitFactor: 0,
    longWinRatePct: 0,
    longNetPnlUsd: 0,
    shortWinRatePct: 0,
    shortNetPnlUsd: 0,
  });
  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [backtestRunning, setBacktestRunning] = useState(false);

  const fetchScanner = useCallback(async () => {
    setScannerLoading(true);
    try {
      const res = await fetch('/api/scanner');
      const data = await res.json();
      if (data.telemetry) setTelemetry(data.telemetry);
      if (!res.ok || !data.connected) {
        setScannerError(data.error || 'Binance REST unavailable');
      } else {
        setScannerError(null);
        setScannerItems(data.items || []);
        setBtcTicker(data.btcTicker || null);
        setEthTicker(data.ethTicker || null);
        setTotalQualifiedPairs(data.totalQualifiedPairs || 0);
      }
    } catch (err) {
      setScannerError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setScannerLoading(false);
    }
  }, []);

  const fetchSymbolAnalysis = useCallback(async (sym: string, tf: Timeframe) => {
    setSymbolLoading(true);
    try {
      const res = await fetch(`/api/symbol/${encodeURIComponent(sym)}?tf=${tf}`);
      const data = await res.json();
      if (data.telemetry) setTelemetry(data.telemetry);
      if (res.ok && data.connected) {
        setSymbolKlines(data.klines || []);
        setSymbolSignal(data.signal || null);
        setSymbolOrderBook(data.orderBook || null);
        setSymbolTicker(data.ticker || null);
      }
    } catch {
      // handled via telemetry
    } finally {
      setSymbolLoading(false);
    }
  }, []);

  const fetchWhales = useCallback(async () => {
    try {
      const res = await fetch('/api/whales');
      const data = await res.json();
      if (data.events) setWhales(data.events);
      if (data.telemetry) setTelemetry(data.telemetry);
    } catch {
      // ignore
    }
  }, []);

  const fetchJournal = useCallback(async () => {
    try {
      const res = await fetch('/api/journal');
      const data = await res.json();
      if (data.entries) setJournalEntries(data.entries);
      if (data.stats) setJournalStats(data.stats);
    } catch {
      // ignore
    }
  }, []);

  const fetchInitialSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.telemetry) setTelemetry(data.telemetry);
      if (data.settings) {
        setWeights(data.settings.weights);
        setFilters(data.settings.filters);
        setRiskConfig(data.settings.risk);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    fetchInitialSettings();
    fetchScanner();
    fetchSymbolAnalysis(activeSymbol, timeframe);
    fetchWhales();
    fetchJournal();

    const scanInt = setInterval(fetchScanner, 12000);
    const symInt = setInterval(() => fetchSymbolAnalysis(activeSymbol, timeframe), 10000);
    const whaleInt = setInterval(fetchWhales, 5000);
    return () => {
      clearInterval(scanInt);
      clearInterval(symInt);
      clearInterval(whaleInt);
    };
  }, [activeSymbol, timeframe, fetchInitialSettings, fetchScanner, fetchSymbolAnalysis, fetchWhales, fetchJournal]);

  const handleMarketModeChange = async (mode: MarketMode) => {
    const res = await fetch('/api/market-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ marketMode: mode }),
    });
    const data = await res.json();
    if (data.telemetry) setTelemetry(data.telemetry);
    await Promise.all([fetchScanner(), fetchSymbolAnalysis(activeSymbol, timeframe)]);
  };

  const handleSelectSymbol = (sym: string) => {
    setActiveSymbol(sym);
    fetchSymbolAnalysis(sym, timeframe);
    setActiveTab('AI SIGNALS');
  };

  const handleLogToJournal = async (sig: SignalReport, spreadPct: number) => {
    const res = await fetch('/api/journal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: sig.symbol,
        marketMode: sig.marketMode,
        direction: sig.direction,
        entryPrice: sig.entry,
        stopLoss: sig.stopLoss,
        takeProfit1: sig.takeProfit1,
        takeProfit2: sig.takeProfit2,
        score: sig.activeScore,
        riskReward: sig.riskReward,
        spreadPct,
        notes: sig.reasons.slice(0, 2).join('; '),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Rejected by Risk Manager');
    }
    setJournalEntries(data.entries);
    setJournalStats(data.stats);
  };

  const handleCloseJournal = async (id: number) => {
    const res = await fetch(`/api/journal/${id}/close`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await res.json();
    if (data.entries) setJournalEntries(data.entries);
    if (data.stats) setJournalStats(data.stats);
  };

  const handleDeleteJournal = async (id: number) => {
    const res = await fetch(`/api/journal/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.entries) setJournalEntries(data.entries);
    if (data.stats) setJournalStats(data.stats);
  };

  const handleSaveRisk = async (cfg: RiskConfig) => {
    setRiskConfig(cfg);
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ risk: cfg }),
    });
  };

  const handleSaveSettings = async (payload: {
    marketMode: MarketMode;
    weights: SignalWeights;
    filters: ScannerFilters;
    apiKey?: string;
  }) => {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.settings) {
      setWeights(data.settings.weights);
      setFilters(data.settings.filters);
      setRiskConfig(data.settings.risk);
    }
    if (data.telemetry) setTelemetry(data.telemetry);
    await Promise.all([fetchScanner(), fetchSymbolAnalysis(activeSymbol, timeframe)]);
  };

  const handleRunBacktest = async (params: {
    symbol: string;
    timeframe: Timeframe;
    limit: number;
    commissionPct: number;
    slippagePct: number;
  }) => {
    setBacktestRunning(true);
    try {
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (res.ok) setBacktestResult(data);
    } finally {
      setBacktestRunning(false);
    }
  };

  const openPositionsCount = journalEntries.filter((e) => e.status === 'OPEN').length;

  return (
    <div className="min-h-screen bg-[#0B0E14] text-slate-100 flex flex-col">
      {/* 3-Zone Top Bar Contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-[#0F141E]">
        <a
          href="/"
          className="text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          Binance Smart Trader AI
        </a>

        <nav className="hidden md:flex items-center gap-6 text-xs font-medium text-slate-400">
          {(['OVERVIEW', 'MARKET SCANNER', 'AI SIGNALS', 'TRADE JOURNAL', 'BACKTESTING'] as TabId[]).map(
            (id) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === id
                    ? 'text-sky-400 font-semibold'
                    : 'hover:text-slate-100'
                }`}
              >
                {NAV_ITEMS.find((n) => n.id === id)?.label}
              </button>
            ),
          )}
        </nav>

        <div className="shrink-0">
          <a
            href="/api/download-windows-zip"
            download="BINANCE_SMART_TRADER_AI.zip"
            className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-sky-500 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            Download Windows App
          </a>
        </div>
      </header>

      {/* Main Workspace */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Left Sidebar */}
        <aside className="w-full md:w-60 shrink-0 border-b md:border-b-0 md:border-r border-slate-800 bg-[#0F141E] p-3.5 flex flex-col gap-4">
          {/* Market Switcher */}
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-slate-400 px-1">Market Feed</div>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#0B0E14] p-1 border border-slate-800">
              {(['FUTURES', 'SPOT'] as MarketMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleMarketModeChange(m)}
                  className={`py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap ${
                    telemetry.marketMode === m
                      ? 'bg-slate-800 text-sky-400'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {m === 'FUTURES' ? 'USDT-M' : 'SPOT'}
                </button>
              ))}
            </div>
          </div>

          {/* 11 Navigation Tabs */}
          <nav aria-label="Primary sections" className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
            {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'bg-slate-800/90 text-sky-400 font-semibold border border-slate-700/70'
                      : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-100 border border-transparent'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Real Connection Health Block */}
          <div className="mt-auto rounded-lg border border-slate-800 bg-[#0B0E14] p-3 text-xs space-y-1 font-mono tabular-nums">
            <div className="flex items-center justify-between">
              <span className="text-slate-400 font-sans">Binance Link</span>
              <span
                className={
                  telemetry.status === 'CONNECTED'
                    ? 'text-emerald-400 font-semibold'
                    : 'text-rose-400 font-semibold'
                }
              >
                {telemetry.status}
              </span>
            </div>
            <div className="text-slate-400">
              REST {telemetry.restPingMs ?? '--'}ms · WS {telemetry.wsLatencyMs ?? '--'}ms
            </div>
            <div className="text-slate-400 whitespace-nowrap">
              Updated {formatTime(telemetry.lastDataUpdate)} · Err {telemetry.apiErrorsCount}
            </div>
            <div className="text-[11px] text-slate-500 font-sans pt-1 border-t border-slate-800/80">
              Analysis Only (v1) · No Live Orders
            </div>
          </div>
        </aside>

        {/* Active View Viewport */}
        <main className="flex-1 p-5 overflow-y-auto">
          {activeTab === 'OVERVIEW' && (
            <OverviewTab
              telemetry={telemetry}
              btcTicker={btcTicker}
              ethTicker={ethTicker}
              items={scannerItems}
              totalQualifiedPairs={totalQualifiedPairs}
              activeSymbol={activeSymbol}
              activeKlines={symbolKlines}
              activeSignal={symbolSignal}
              loading={scannerLoading}
              error={scannerError}
              onSelectSymbol={handleSelectSymbol}
            />
          )}

          {activeTab === 'MARKET SCANNER' && (
            <ScannerTab
              items={scannerItems}
              activeSymbol={activeSymbol}
              loading={scannerLoading}
              onSelectSymbol={handleSelectSymbol}
              onRefresh={fetchScanner}
            />
          )}

          {activeTab === 'AI SIGNALS' && (
            <SignalsTab
              signal={symbolSignal}
              spreadPct={symbolOrderBook?.spreadPct ?? symbolTicker?.spreadPct ?? 0.02}
              loading={symbolLoading}
              onLogToJournal={handleLogToJournal}
            />
          )}

          {activeTab === 'WHALE TRACKER' && (
            <WhaleTrackerTab
              events={whales}
              fundingRate={symbolTicker?.fundingRate}
              markPrice={symbolTicker?.markPrice}
              onRefresh={fetchWhales}
            />
          )}

          {activeTab === 'MOMENTUM' && <MomentumTab signal={symbolSignal} />}

          {activeTab === 'VOLUME ANALYSIS' && (
            <VolumeAnalysisTab signal={symbolSignal} orderBook={symbolOrderBook} />
          )}

          {activeTab === 'LIVE CHARTS' && (
            <LiveChartsTab
              symbol={activeSymbol}
              timeframe={timeframe}
              klines={symbolKlines}
              signal={symbolSignal}
              onTimeframeChange={(tf) => setTimeframe(tf)}
            />
          )}

          {activeTab === 'RISK MANAGER' && (
            <RiskManagerTab
              riskConfig={riskConfig}
              signal={symbolSignal}
              spreadPct={symbolOrderBook?.spreadPct ?? 0.02}
              openPositionsCount={openPositionsCount}
              onSaveRisk={handleSaveRisk}
            />
          )}

          {activeTab === 'TRADE JOURNAL' && (
            <TradeJournalTab
              entries={journalEntries}
              stats={journalStats}
              onCloseEntry={handleCloseJournal}
              onDeleteEntry={handleDeleteJournal}
            />
          )}

          {activeTab === 'BACKTESTING' && (
            <BacktestingTab
              defaultSymbol={activeSymbol}
              result={backtestResult}
              running={backtestRunning}
              onRunBacktest={handleRunBacktest}
            />
          )}

          {activeTab === 'SETTINGS' && (
            <SettingsTab
              marketMode={telemetry.marketMode}
              weights={weights}
              filters={filters}
              apiKeyMasked={telemetry.apiKeyMasked}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </main>
      </div>
    </div>
  );
}

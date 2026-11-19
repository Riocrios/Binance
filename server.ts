import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { runWalkForwardBacktest } from './src/engine/backtester';
import { evaluateRisk } from './src/engine/riskManager';
import type { MarketMode, Timeframe } from './src/engine/types';
import { BinanceLiveService } from './src/server/binanceService';
import { JournalDatabase } from './src/server/journalDb';

async function bootstrap() {
  const app = express();
  app.use(express.json());

  const journalDb = new JournalDatabase();
  const initialSettings = journalDb.getSettings();
  const binance = new BinanceLiveService(
    initialSettings.marketMode,
    initialSettings.defaultSymbol,
  );
  binance.setApiKey(journalDb.getApiKey(), initialSettings.apiKeyMasked);
  binance.startWebSocket();

  app.get('/api/status', (_req, res) => {
    res.json({
      telemetry: binance.getTelemetry(),
      settings: journalDb.getSettings(),
    });
  });

  app.post('/api/market-mode', (req, res) => {
    const mode = req.body?.marketMode === 'SPOT' ? 'SPOT' : 'FUTURES';
    const settings = journalDb.getSettings();
    const updated = journalDb.saveSettings({ ...settings, marketMode: mode });
    binance.setMarketMode(mode);
    res.json({ telemetry: binance.getTelemetry(), settings: updated });
  });

  app.get('/api/scanner', async (_req, res) => {
    try {
      const settings = journalDb.getSettings();
      const scan = await binance.scanMarket({
        weights: settings.weights,
        filters: settings.filters,
        minRiskReward: settings.risk.minRiskReward,
        maxPairs: 18,
      });
      journalDb.evaluateOpenEntries(binance.getLivePrices());
      res.json({
        connected: true,
        telemetry: binance.getTelemetry(),
        ...scan,
      });
    } catch (err) {
      res.status(503).json({
        connected: false,
        error: err instanceof Error ? err.message : 'Binance unreachable',
        telemetry: binance.getTelemetry(),
        items: [],
        btcTicker: null,
        ethTicker: null,
        totalQualifiedPairs: 0,
      });
    }
  });

  app.get('/api/symbol/:symbol', async (req, res) => {
    try {
      const symbol = String(req.params.symbol || 'BTCUSDT').toUpperCase();
      const tf = (String(req.query.tf || '15m') as Timeframe);
      const settings = journalDb.getSettings();
      const data = await binance.analyzeSymbol({
        symbol,
        timeframe: tf,
        weights: settings.weights,
        filters: settings.filters,
        minRiskReward: settings.risk.minRiskReward,
      });
      res.json({
        connected: true,
        telemetry: binance.getTelemetry(),
        ...data,
      });
    } catch (err) {
      res.status(503).json({
        connected: false,
        error: err instanceof Error ? err.message : 'Failed to load symbol data',
        telemetry: binance.getTelemetry(),
      });
    }
  });

  app.get('/api/whales', (_req, res) => {
    res.json({
      events: binance.getWhaleEvents(80),
      telemetry: binance.getTelemetry(),
    });
  });

  app.get('/api/journal', (_req, res) => {
    const settings = journalDb.getSettings();
    journalDb.evaluateOpenEntries(binance.getLivePrices());
    res.json({
      entries: journalDb.listEntries(200),
      stats: journalDb.computeStats(settings.risk.virtualBalance),
    });
  });

  app.post('/api/journal', (req, res) => {
    const body = req.body || {};
    const settings = journalDb.getSettings();
    const openCount = journalDb.listEntries(200).filter((e) => e.status === 'OPEN').length;
    const evaluation = evaluateRisk({
      direction: body.direction,
      entry: Number(body.entryPrice),
      stopLoss: Number(body.stopLoss),
      takeProfit1: Number(body.takeProfit1),
      takeProfit2: Number(body.takeProfit2),
      spreadPct: Number(body.spreadPct ?? 0.02),
      openPositionsCount: openCount,
      dailyRealizedLossUsd: 0,
      config: settings.risk,
    });

    if (!evaluation.approved) {
      res.status(400).json({
        error: evaluation.rejectionReasons.join(' '),
        rejectionReasons: evaluation.rejectionReasons,
      });
      return;
    }

    const id = journalDb.addEntry({
      symbol: String(body.symbol || 'BTCUSDT').toUpperCase(),
      marketMode: (body.marketMode as MarketMode) || settings.marketMode,
      direction: body.direction,
      entryPrice: Number(body.entryPrice),
      stopLoss: Number(body.stopLoss),
      takeProfit1: Number(body.takeProfit1),
      takeProfit2: Number(body.takeProfit2),
      score: Number(body.score || 0),
      riskReward: Number(body.riskReward || evaluation.effectiveRiskReward),
      positionSizeQty: evaluation.positionSizeQty,
      notionalUsd: evaluation.notionalValueUsd,
      feesUsd: evaluation.estimatedEntryFeeUsd + evaluation.estimatedExitFeeUsd,
      slippageUsd: evaluation.estimatedSlippageUsd,
      notes: String(body.notes || ''),
    });

    res.json({
      id,
      entries: journalDb.listEntries(200),
      stats: journalDb.computeStats(settings.risk.virtualBalance),
    });
  });

  app.post('/api/journal/:id/close', (req, res) => {
    const id = Number(req.params.id);
    const entries = journalDb.listEntries(200);
    const target = entries.find((e) => e.id === id);
    if (!target) {
      res.status(404).json({ error: 'Journal entry not found' });
      return;
    }
    const prices = binance.getLivePrices();
    const exitPrice = Number(req.body?.exitPrice || prices[target.symbol] || target.entryPrice);
    journalDb.closeEntry(id, exitPrice, 'MANUAL_CLOSED', 'Closed manually from Trade Journal');
    const settings = journalDb.getSettings();
    res.json({
      entries: journalDb.listEntries(200),
      stats: journalDb.computeStats(settings.risk.virtualBalance),
    });
  });

  app.delete('/api/journal/:id', (req, res) => {
    const id = Number(req.params.id);
    journalDb.deleteEntry(id);
    const settings = journalDb.getSettings();
    res.json({
      entries: journalDb.listEntries(200),
      stats: journalDb.computeStats(settings.risk.virtualBalance),
    });
  });

  app.post('/api/backtest', async (req, res) => {
    try {
      const settings = journalDb.getSettings();
      const symbol = String(req.body?.symbol || 'BTCUSDT').toUpperCase();
      const timeframe = (req.body?.timeframe || '15m') as Timeframe;
      const limit = Math.min(1000, Math.max(150, Number(req.body?.limit || 350)));
      const commissionPct = Number(req.body?.commissionPct ?? settings.risk.takerFeePct);
      const slippagePct = Number(req.body?.slippagePct ?? settings.risk.maxSlippagePct);
      const minScore = Number(req.body?.minScore ?? 65);

      const klines = await binance.fetchKlines(symbol, timeframe, limit);
      const result = runWalkForwardBacktest(klines, {
        symbol,
        timeframe,
        marketMode: settings.marketMode,
        limit,
        initialBalance: settings.risk.virtualBalance,
        riskPerTradePct: settings.risk.riskPerTradePct,
        commissionPct,
        slippagePct,
        minScore,
        minRiskReward: settings.risk.minRiskReward,
        aggressiveness: settings.filters.aggressiveness,
      });
      res.json(result);
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Backtest failed to fetch Binance history',
      });
    }
  });

  app.get('/api/settings', (_req, res) => {
    res.json(journalDb.getSettings());
  });

  app.post('/api/settings', (req, res) => {
    const current = journalDb.getSettings();
    const body = req.body || {};
    const newApiKey = typeof body.apiKey === 'string' ? body.apiKey : undefined;
    const nextSettings = journalDb.saveSettings(
      {
        marketMode: body.marketMode === 'SPOT' ? 'SPOT' : body.marketMode === 'FUTURES' ? 'FUTURES' : current.marketMode,
        defaultSymbol: String(body.defaultSymbol || current.defaultSymbol).toUpperCase(),
        weights: { ...current.weights, ...(body.weights || {}) },
        filters: { ...current.filters, ...(body.filters || {}) },
        risk: { ...current.risk, ...(body.risk || {}) },
        apiKeyMasked: current.apiKeyMasked,
      },
      newApiKey,
    );

    if (nextSettings.marketMode !== binance.getTelemetry().marketMode) {
      binance.setMarketMode(nextSettings.marketMode);
    }
    if (newApiKey) {
      binance.setApiKey(journalDb.getApiKey(), nextSettings.apiKeyMasked);
    }
    res.json({ settings: nextSettings, telemetry: binance.getTelemetry() });
  });

  app.get('/api/download-windows-zip', (_req, res) => {
    const zipPath = path.resolve(process.cwd(), 'public', 'BINANCE_SMART_TRADER_AI.zip');
    if (!fs.existsSync(zipPath)) {
      res.status(404).json({ error: 'Windows package ZIP not found.' });
      return;
    }
    res.download(zipPath, 'BINANCE_SMART_TRADER_AI.zip');
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Binance Smart Trader AI Server listening on http://0.0.0.0:${port}`);
  });
}

bootstrap();

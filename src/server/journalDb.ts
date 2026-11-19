import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULT_RISK_CONFIG } from '../engine/riskManager';
import { DEFAULT_SIGNAL_WEIGHTS } from '../engine/signalEngine';
import type {
  JournalEntry,
  JournalStats,
  MarketMode,
  RiskConfig,
  ScannerFilters,
  SignalWeights,
} from '../engine/types';

export interface PersistedSettings {
  marketMode: MarketMode;
  defaultSymbol: string;
  weights: SignalWeights;
  filters: ScannerFilters;
  risk: RiskConfig;
  apiKeyMasked: string | null;
}

const DEFAULT_SETTINGS: PersistedSettings = {
  marketMode: 'FUTURES',
  defaultSymbol: 'BTCUSDT',
  weights: { ...DEFAULT_SIGNAL_WEIGHTS },
  filters: {
    minVolume24hUsd: 25_000_000,
    maxSpreadPct: 0.15,
    minVolatilityPct: 0.6,
    excludeStablecoins: true,
    aggressiveness: 'BALANCED',
  },
  risk: { ...DEFAULT_RISK_CONFIG },
  apiKeyMasked: null,
};

export class JournalDatabase {
  private db: DatabaseSync;
  private apiKeyVault = '';

  constructor(dbPath = path.resolve(process.cwd(), 'data', 'web_terminal.db')) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS trade_journal (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        market_mode TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('LONG', 'SHORT')),
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        take_profit_1 REAL NOT NULL,
        take_profit_2 REAL NOT NULL,
        score INTEGER NOT NULL,
        risk_reward REAL NOT NULL,
        position_size_qty REAL NOT NULL,
        notional_usd REAL NOT NULL,
        fees_usd REAL NOT NULL,
        slippage_usd REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        exit_price REAL,
        closed_at INTEGER,
        hold_duration_ms INTEGER,
        close_reason TEXT,
        realized_pnl_usd REAL,
        realized_r REAL,
        notes TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL
      );
    `);
  }

  getSettings(): PersistedSettings {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('main_settings') as { value_json: string } | undefined;
    if (!row) {
      this.saveSettings(DEFAULT_SETTINGS);
      return structuredClone(DEFAULT_SETTINGS);
    }
    try {
      const parsed = JSON.parse(row.value_json);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        weights: { ...DEFAULT_SETTINGS.weights, ...(parsed.weights || {}) },
        filters: { ...DEFAULT_SETTINGS.filters, ...(parsed.filters || {}) },
        risk: { ...DEFAULT_SETTINGS.risk, ...(parsed.risk || {}) },
      };
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  saveSettings(settings: PersistedSettings, newApiKey?: string): PersistedSettings {
    const current = this.getSettingsRaw();
    let masked = current?.apiKeyMasked ?? settings.apiKeyMasked ?? null;
    if (typeof newApiKey === 'string' && newApiKey.trim().length > 0) {
      const cleaned = newApiKey.trim();
      this.apiKeyVault = cleaned;
      masked =
        cleaned.length <= 8
          ? '****'
          : `${cleaned.slice(0, 4)}...${cleaned.slice(-4)}`;
    }
    const merged: PersistedSettings = {
      ...settings,
      apiKeyMasked: masked,
    };
    this.db
      .prepare(
        'INSERT INTO app_settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
      )
      .run('main_settings', JSON.stringify(merged));
    return merged;
  }

  private getSettingsRaw(): PersistedSettings | null {
    const row = this.db
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get('main_settings') as { value_json: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value_json);
    } catch {
      return null;
    }
  }

  getApiKey(): string {
    return this.apiKeyVault;
  }

  listEntries(limit = 200): JournalEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM trade_journal ORDER BY created_at DESC LIMIT ?')
      .all(limit) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: Number(r.id),
      createdAt: Number(r.created_at),
      symbol: String(r.symbol),
      marketMode: String(r.market_mode) as MarketMode,
      direction: String(r.direction) as 'LONG' | 'SHORT',
      entryPrice: Number(r.entry_price),
      stopLoss: Number(r.stop_loss),
      takeProfit1: Number(r.take_profit_1),
      takeProfit2: Number(r.take_profit_2),
      score: Number(r.score),
      riskReward: Number(r.risk_reward),
      positionSizeQty: Number(r.position_size_qty),
      notionalUsd: Number(r.notional_usd),
      feesUsd: Number(r.fees_usd),
      slippageUsd: Number(r.slippage_usd),
      status: String(r.status) as JournalEntry['status'],
      exitPrice: r.exit_price !== null ? Number(r.exit_price) : null,
      closedAt: r.closed_at !== null ? Number(r.closed_at) : null,
      holdDurationMs: r.hold_duration_ms !== null ? Number(r.hold_duration_ms) : null,
      closeReason: r.close_reason !== null ? String(r.close_reason) : null,
      realizedPnlUsd: r.realized_pnl_usd !== null ? Number(r.realized_pnl_usd) : null,
      realizedR: r.realized_r !== null ? Number(r.realized_r) : null,
      notes: String(r.notes || ''),
    }));
  }

  addEntry(input: {
    symbol: string;
    marketMode: MarketMode;
    direction: 'LONG' | 'SHORT';
    entryPrice: number;
    stopLoss: number;
    takeProfit1: number;
    takeProfit2: number;
    score: number;
    riskReward: number;
    positionSizeQty: number;
    notionalUsd: number;
    feesUsd: number;
    slippageUsd: number;
    notes?: string;
  }): number {
    const now = Date.now();
    const res = this.db
      .prepare(
        `INSERT INTO trade_journal (
          created_at, symbol, market_mode, direction, entry_price, stop_loss,
          take_profit_1, take_profit_2, score, risk_reward, position_size_qty,
          notional_usd, fees_usd, slippage_usd, status, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?)`,
      )
      .run(
        now,
        input.symbol,
        input.marketMode,
        input.direction,
        input.entryPrice,
        input.stopLoss,
        input.takeProfit1,
        input.takeProfit2,
        input.score,
        input.riskReward,
        input.positionSizeQty,
        input.notionalUsd,
        input.feesUsd,
        input.slippageUsd,
        input.notes ?? '',
      );
    return Number(res.lastInsertRowid);
  }

  closeEntry(
    id: number,
    exitPrice: number,
    status: JournalEntry['status'],
    closeReason: string,
  ): void {
    const row = this.db
      .prepare('SELECT * FROM trade_journal WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row || row.status !== 'OPEN') return;

    const now = Date.now();
    const direction = String(row.direction);
    const entryPrice = Number(row.entry_price);
    const stopLoss = Number(row.stop_loss);
    const qty = Number(row.position_size_qty);
    const fees = Number(row.fees_usd);
    const slip = Number(row.slippage_usd);
    const createdAt = Number(row.created_at);

    const rawPnl =
      direction === 'LONG'
        ? (exitPrice - entryPrice) * qty
        : (entryPrice - exitPrice) * qty;
    const netPnl = rawPnl - fees - slip;
    const riskUsd = Math.abs(entryPrice - stopLoss) * qty;
    const realizedR = riskUsd > 0 ? netPnl / riskUsd : 0;

    this.db
      .prepare(
        `UPDATE trade_journal
         SET status = ?, exit_price = ?, closed_at = ?, hold_duration_ms = ?,
             close_reason = ?, realized_pnl_usd = ?, realized_r = ?
         WHERE id = ?`,
      )
      .run(
        status,
        exitPrice,
        now,
        Math.max(0, now - createdAt),
        closeReason,
        Number(netPnl.toFixed(2)),
        Number(realizedR.toFixed(2)),
        id,
      );
  }

  evaluateOpenEntries(latestPrices: Record<string, number>): void {
    const opens = this.listEntries(200).filter((e) => e.status === 'OPEN');
    for (const e of opens) {
      const px = latestPrices[e.symbol];
      if (!px || px <= 0) continue;
      if (e.direction === 'LONG') {
        if (px <= e.stopLoss) {
          this.closeEntry(e.id, e.stopLoss, 'SL_HIT', 'Stop Loss hit by live market price');
        } else if (px >= e.takeProfit2) {
          this.closeEntry(e.id, e.takeProfit2, 'TP2_HIT', 'Take Profit 2 target reached');
        }
      } else {
        if (px >= e.stopLoss) {
          this.closeEntry(e.id, e.stopLoss, 'SL_HIT', 'Stop Loss hit by live market price');
        } else if (px <= e.takeProfit2) {
          this.closeEntry(e.id, e.takeProfit2, 'TP2_HIT', 'Take Profit 2 target reached');
        }
      }
    }
  }

  deleteEntry(id: number): void {
    this.db.prepare('DELETE FROM trade_journal WHERE id = ?').run(id);
  }

  computeStats(startingBalance = 10000): JournalStats {
    const all = this.listEntries(1000);
    const closed = all.filter((e) => e.status !== 'OPEN' && e.realizedPnlUsd !== null);
    const openCount = all.filter((e) => e.status === 'OPEN').length;

    if (closed.length === 0) {
      return {
        totalSignals: all.length,
        openSignals: openCount,
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
      };
    }

    const wins = closed.filter((e) => (e.realizedPnlUsd ?? 0) > 0);
    const losses = closed.filter((e) => (e.realizedPnlUsd ?? 0) <= 0);
    const grossWin = wins.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0));
    const netPnl = closed.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0);
    const avgR = closed.reduce((s, e) => s + (e.realizedR ?? 0), 0) / closed.length;

    let eq = startingBalance;
    let peak = startingBalance;
    let maxDd = 0;
    for (const e of [...closed].reverse()) {
      eq += e.realizedPnlUsd ?? 0;
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((peak - eq) / peak) * 100 : 0;
      if (dd > maxDd) maxDd = dd;
    }

    const longs = closed.filter((e) => e.direction === 'LONG');
    const shorts = closed.filter((e) => e.direction === 'SHORT');

    return {
      totalSignals: all.length,
      openSignals: openCount,
      winningSignals: wins.length,
      losingSignals: losses.length,
      winRatePct: Number(((wins.length / closed.length) * 100).toFixed(2)),
      averageR: Number(avgR.toFixed(2)),
      netPnlUsd: Number(netPnl.toFixed(2)),
      maxDrawdownPct: Number(maxDd.toFixed(2)),
      profitFactor:
        grossLoss > 0
          ? Number((grossWin / grossLoss).toFixed(2))
          : grossWin > 0
          ? 99
          : 0,
      longWinRatePct: longs.length
        ? Number(((longs.filter((e) => (e.realizedPnlUsd ?? 0) > 0).length / longs.length) * 100).toFixed(2))
        : 0,
      longNetPnlUsd: Number(longs.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0).toFixed(2)),
      shortWinRatePct: shorts.length
        ? Number(((shorts.filter((e) => (e.realizedPnlUsd ?? 0) > 0).length / shorts.length) * 100).toFixed(2))
        : 0,
      shortNetPnlUsd: Number(shorts.reduce((s, e) => s + (e.realizedPnlUsd ?? 0), 0).toFixed(2)),
    };
  }
}

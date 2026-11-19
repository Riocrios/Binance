import type { RiskConfig, RiskEvaluation } from './types';

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  virtualBalance: 10000,
  riskPerTradePct: 1.0,
  maxDailyLossPct: 4.0,
  maxOpenPositions: 4,
  minRiskReward: 1.8,
  maxSpreadPct: 0.15,
  maxSlippagePct: 0.08,
  leverage: 5,
  takerFeePct: 0.05,
  fundingRatePctPer8h: 0.01,
};

export function evaluateRisk(params: {
  direction: 'LONG' | 'SHORT' | 'WAIT';
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  spreadPct: number;
  openPositionsCount: number;
  dailyRealizedLossUsd: number;
  config: RiskConfig;
}): RiskEvaluation {
  const {
    direction,
    entry,
    stopLoss,
    takeProfit1,
    takeProfit2,
    spreadPct,
    openPositionsCount,
    dailyRealizedLossUsd,
    config,
  } = params;

  const rejectionReasons: string[] = [];

  if (direction === 'WAIT') {
    rejectionReasons.push('Signal direction is WAIT; no entry setup ready.');
  }

  const stopDistance = Math.abs(entry - stopLoss);
  const stopDistancePct = entry > 0 ? (stopDistance / entry) * 100 : 0;

  if (entry <= 0 || stopDistance <= 0) {
    rejectionReasons.push('Invalid entry or stop loss distance.');
  }

  if (direction === 'LONG' && stopLoss >= entry) {
    rejectionReasons.push('LONG stop loss must be strictly below entry price.');
  }
  if (direction === 'SHORT' && stopLoss <= entry) {
    rejectionReasons.push('SHORT stop loss must be strictly above entry price.');
  }

  const riskAmountUsd = (config.virtualBalance * config.riskPerTradePct) / 100;
  const positionSizeQty = stopDistance > 0 ? riskAmountUsd / stopDistance : 0;
  const notionalValueUsd = positionSizeQty * entry;
  const requiredMarginUsd = config.leverage > 0 ? notionalValueUsd / config.leverage : notionalValueUsd;

  const estimatedEntryFeeUsd = (notionalValueUsd * config.takerFeePct) / 100;
  const estimatedExitFeeUsd = (notionalValueUsd * config.takerFeePct) / 100;
  const estimatedSlippageUsd = (notionalValueUsd * config.maxSlippagePct) / 100;
  const estimatedFundingUsd = (notionalValueUsd * Math.abs(config.fundingRatePctPer8h)) / 100;
  const totalExecutionCostUsd =
    estimatedEntryFeeUsd + estimatedExitFeeUsd + estimatedSlippageUsd + estimatedFundingUsd;

  const tp1Dist = Math.abs(takeProfit1 - entry);
  const tp2Dist = Math.abs(takeProfit2 - entry);

  const grossProfitTp1Usd = positionSizeQty * tp1Dist;
  const netProfitTp1Usd = grossProfitTp1Usd - totalExecutionCostUsd;
  const grossProfitTp2Usd = positionSizeQty * tp2Dist;
  const netProfitTp2Usd = grossProfitTp2Usd - totalExecutionCostUsd;

  const netMaxLossUsd = riskAmountUsd + totalExecutionCostUsd;
  const netMaxLossPctBalance = config.virtualBalance > 0 ? (netMaxLossUsd / config.virtualBalance) * 100 : 0;
  const netProfitTp2PctBalance = config.virtualBalance > 0 ? (netProfitTp2Usd / config.virtualBalance) * 100 : 0;

  const effectiveRiskReward =
    netMaxLossUsd > 0 ? Math.max(0, netProfitTp2Usd / netMaxLossUsd) : 0;

  if (effectiveRiskReward < config.minRiskReward) {
    rejectionReasons.push(
      `Net Risk/Reward (${effectiveRiskReward.toFixed(2)}) is below minimum ${config.minRiskReward.toFixed(2)}.`,
    );
  }

  if (spreadPct > config.maxSpreadPct) {
    rejectionReasons.push(
      `Current spread (${spreadPct.toFixed(3)}%) exceeds max ${config.maxSpreadPct.toFixed(3)}%.`,
    );
  }

  if (openPositionsCount >= config.maxOpenPositions) {
    rejectionReasons.push(
      `Open positions (${openPositionsCount}) reached max limit (${config.maxOpenPositions}).`,
    );
  }

  const maxDailyLossUsd = (config.virtualBalance * config.maxDailyLossPct) / 100;
  if (Math.abs(Math.min(0, dailyRealizedLossUsd)) >= maxDailyLossUsd) {
    rejectionReasons.push(
      `Daily loss limit ($${maxDailyLossUsd.toFixed(2)}) reached or exceeded.`,
    );
  }

  if (requiredMarginUsd > config.virtualBalance * 0.95) {
    rejectionReasons.push(
      `Required margin ($${requiredMarginUsd.toFixed(2)}) exceeds 95% of virtual balance.`,
    );
  }

  return {
    approved: rejectionReasons.length === 0,
    rejectionReasons,
    riskAmountUsd,
    stopDistance,
    stopDistancePct,
    positionSizeQty,
    notionalValueUsd,
    requiredMarginUsd,
    estimatedEntryFeeUsd,
    estimatedExitFeeUsd,
    estimatedSlippageUsd,
    estimatedFundingUsd,
    totalExecutionCostUsd,
    grossProfitTp1Usd,
    netProfitTp1Usd,
    grossProfitTp2Usd,
    netProfitTp2Usd,
    netMaxLossUsd,
    netMaxLossPctBalance,
    netProfitTp2PctBalance,
    effectiveRiskReward,
  };
}

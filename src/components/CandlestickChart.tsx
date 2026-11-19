import React, { useMemo, useState } from 'react';
import { ema, macd, rsi } from '../engine/indicators';
import type { Kline, SignalDirection } from '../engine/types';
import { formatPrice } from './formatters';

interface CandlestickChartProps {
  symbol: string;
  klines: Kline[];
  entry?: number;
  stopLoss?: number;
  takeProfit1?: number;
  takeProfit2?: number;
  direction?: SignalDirection;
  height?: number;
}

export const CandlestickChart: React.FC<CandlestickChartProps> = ({
  symbol,
  klines,
  entry,
  stopLoss,
  takeProfit1,
  takeProfit2,
  direction = 'WAIT',
  height = 460,
}) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const view = useMemo(() => klines.slice(-90), [klines]);

  const computed = useMemo(() => {
    if (view.length < 5) return null;
    const closes = view.map((k) => k.close);
    const ema9 = ema(closes, 9);
    const ema21 = ema(closes, 21);
    const ema50 = ema(closes, 50);
    const rsiArr = rsi(closes, 14);
    const macdRes = macd(closes);

    let minP = Math.min(...view.map((k) => k.low));
    let maxP = Math.max(...view.map((k) => k.high));
    if (direction !== 'WAIT' && entry && stopLoss && takeProfit2) {
      minP = Math.min(minP, stopLoss, takeProfit2, entry);
      maxP = Math.max(maxP, stopLoss, takeProfit2, entry);
    }
    const pad = (maxP - minP) * 0.06 || 1;
    minP -= pad;
    maxP += pad;

    const maxVol = Math.max(...view.map((k) => k.volume), 1);
    const maxMacd = Math.max(
      ...macdRes.histogram.map((v) => (v !== null ? Math.abs(v) : 0)),
      1e-6,
    );

    return {
      ema9,
      ema21,
      ema50,
      rsiArr,
      macdHist: macdRes.histogram,
      minP,
      maxP,
      maxVol,
      maxMacd,
    };
  }, [view, direction, entry, stopLoss, takeProfit2]);

  if (!computed || view.length < 5) {
    return (
      <div
        data-testid="candlestick-chart-empty"
        className="flex items-center justify-center rounded-lg border border-slate-800 bg-[#0F141E] text-sm text-slate-400"
        style={{ height }}
      >
        Waiting for live Binance candlestick stream for {symbol}...
      </div>
    );
  }

  const width = 920;
  const padLeft = 14;
  const padRight = 76;
  const plotW = width - padLeft - padRight;
  const priceTop = 16;
  const priceH = 240;
  const volTop = 272;
  const volH = 62;
  const oscTop = 352;
  const oscH = 84;

  const xFor = (i: number) => padLeft + ((i + 0.5) / view.length) * plotW;
  const candleW = Math.max(3, (plotW / view.length) * 0.62);
  const yPrice = (p: number) =>
    priceTop + ((computed.maxP - p) / (computed.maxP - computed.minP)) * priceH;
  const yVol = (v: number) => volTop + volH - (v / computed.maxVol) * volH;
  const yRsi = (r: number) => oscTop + ((100 - r) / 100) * oscH;

  const buildPath = (series: (number | null)[]) => {
    let d = '';
    for (let i = 0; i < series.length; i++) {
      const v = series[i];
      if (v === null) continue;
      const cmd = d === '' ? 'M' : 'L';
      d += `${cmd}${xFor(i).toFixed(1)},${yPrice(v).toFixed(1)} `;
    }
    return d;
  };

  const buildRsiPath = () => {
    let d = '';
    for (let i = 0; i < computed.rsiArr.length; i++) {
      const v = computed.rsiArr[i];
      if (v === null) continue;
      const cmd = d === '' ? 'M' : 'L';
      d += `${cmd}${xFor(i).toFixed(1)},${yRsi(v).toFixed(1)} `;
    }
    return d;
  };

  const hovered = hoverIdx !== null ? view[hoverIdx] : view[view.length - 1];
  const hoveredRsi = hoverIdx !== null ? computed.rsiArr[hoverIdx] : computed.rsiArr[view.length - 1];

  const priceLevels = [0, 0.25, 0.5, 0.75, 1].map(
    (f) => computed.minP + (computed.maxP - computed.minP) * f,
  );

  return (
    <div className="rounded-lg border border-slate-800 bg-[#0F141E] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 font-mono tabular-nums">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-slate-100">{symbol}</span>
          <span>O {formatPrice(hovered.open)}</span>
          <span>H {formatPrice(hovered.high)}</span>
          <span>L {formatPrice(hovered.low)}</span>
          <span className={hovered.close >= hovered.open ? 'text-emerald-400' : 'text-rose-400'}>
            C {formatPrice(hovered.close)}
          </span>
          <span>Vol {hovered.volume.toFixed(1)}</span>
          {hoveredRsi !== null && <span>RSI {hoveredRsi.toFixed(1)}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sky-400">EMA 9</span>
          <span className="text-amber-400">EMA 21</span>
          <span className="text-violet-400">EMA 50</span>
        </div>
      </div>

      <svg
        data-testid="candlestick-chart-svg"
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto select-none"
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / rect.width) * width - padLeft;
          const idx = Math.floor((relX / plotW) * view.length);
          if (idx >= 0 && idx < view.length) setHoverIdx(idx);
        }}
      >
        {/* Horizontal grid & right axis */}
        {priceLevels.map((lvl, idx) => {
          const y = yPrice(lvl);
          return (
            <g key={idx}>
              <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#1E293B" strokeDasharray="2 3" />
              <text x={width - padRight + 6} y={y + 4} fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">
                {formatPrice(lvl)}
              </text>
            </g>
          );
        })}

        {/* Candlesticks */}
        {view.map((k, i) => {
          const x = xFor(i);
          const bull = k.close >= k.open;
          const col = bull ? '#22C55E' : '#EF4444';
          const yTop = yPrice(Math.max(k.open, k.close));
          const yBot = yPrice(Math.min(k.open, k.close));
          const bodyH = Math.max(1.5, yBot - yTop);
          return (
            <g key={k.openTime}>
              <line x1={x} y1={yPrice(k.high)} x2={x} y2={yPrice(k.low)} stroke={col} strokeWidth="1.2" />
              <rect x={x - candleW / 2} y={yTop} width={candleW} height={bodyH} fill={col} rx="0.5" />
            </g>
          );
        })}

        {/* EMA overlays */}
        <path d={buildPath(computed.ema50)} fill="none" stroke="#A855F7" strokeWidth="1.3" />
        <path d={buildPath(computed.ema21)} fill="none" stroke="#F59E0B" strokeWidth="1.4" />
        <path d={buildPath(computed.ema9)} fill="none" stroke="#38BDF8" strokeWidth="1.4" />

        {/* Signal Lines */}
        {direction !== 'WAIT' && entry && stopLoss && takeProfit1 && takeProfit2 && (
          <g>
            {[
              { val: entry, label: `ENTRY ${formatPrice(entry)}`, color: '#38BDF8' },
              { val: stopLoss, label: `SL ${formatPrice(stopLoss)}`, color: '#EF4444' },
              { val: takeProfit1, label: `TP1 ${formatPrice(takeProfit1)}`, color: '#4ADE80' },
              { val: takeProfit2, label: `TP2 ${formatPrice(takeProfit2)}`, color: '#10B981' },
            ].map((line) => {
              const y = yPrice(line.val);
              return (
                <g key={line.label}>
                  <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke={line.color} strokeWidth="1.2" strokeDasharray="5 4" />
                  <text x={padLeft + 4} y={y - 3} fill={line.color} fontSize="10" fontFamily="JetBrains Mono">
                    {line.label}
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Volume Pane */}
        <line x1={padLeft} y1={volTop} x2={width - padRight} y2={volTop} stroke="#1E293B" />
        <text x={width - padRight + 6} y={volTop + 12} fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">
          VOL
        </text>
        {view.map((k, i) => {
          const x = xFor(i);
          const y = yVol(k.volume);
          const bull = k.close >= k.open;
          return (
            <rect
              key={`v-${k.openTime}`}
              x={x - candleW / 2}
              y={y}
              width={candleW}
              height={Math.max(1, volTop + volH - y)}
              fill={bull ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)'}
            />
          );
        })}

        {/* RSI + MACD Pane */}
        <line x1={padLeft} y1={oscTop} x2={width - padRight} y2={oscTop} stroke="#1E293B" />
        <line x1={padLeft} y1={yRsi(70)} x2={width - padRight} y2={yRsi(70)} stroke="#334155" strokeDasharray="2 3" />
        <line x1={padLeft} y1={yRsi(30)} x2={width - padRight} y2={yRsi(30)} stroke="#334155" strokeDasharray="2 3" />
        <text x={width - padRight + 6} y={yRsi(70) + 3} fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">
          RSI 70
        </text>
        <text x={width - padRight + 6} y={yRsi(30) + 3} fill="#64748B" fontSize="10" fontFamily="JetBrains Mono">
          RSI 30
        </text>

        {/* MACD Histogram centered at oscTop + oscH / 2 */}
        {computed.macdHist.map((mh, i) => {
          if (mh === null) return null;
          const midY = oscTop + oscH / 2;
          const barH = (Math.abs(mh) / computed.maxMacd) * (oscH * 0.42);
          const y = mh >= 0 ? midY - barH : midY;
          return (
            <rect
              key={`m-${i}`}
              x={xFor(i) - candleW / 2}
              y={y}
              width={candleW}
              height={Math.max(1, barH)}
              fill={mh >= 0 ? 'rgba(56,189,248,0.35)' : 'rgba(244,63,94,0.35)'}
            />
          );
        })}
        <path d={buildRsiPath()} fill="none" stroke="#38BDF8" strokeWidth="1.5" />

        {/* Crosshair */}
        {hoverIdx !== null && (
          <line
            x1={xFor(hoverIdx)}
            y1={priceTop}
            x2={xFor(hoverIdx)}
            y2={oscTop + oscH}
            stroke="rgba(148,163,184,0.4)"
            strokeDasharray="3 3"
          />
        )}
      </svg>
    </div>
  );
};

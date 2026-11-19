export function formatPrice(val: number): string {
  if (!Number.isFinite(val) || val <= 0) return '0.00';
  if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (val >= 1) return val.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return val.toFixed(6);
}

export function formatUsd(val: number): string {
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

export function formatTime(ms: number | null): string {
  if (!ms) return '--:--:--';
  return new Date(ms).toLocaleTimeString('en-GB', { hour12: false });
}

export function formatDateTime(ms: number | null): string {
  if (!ms) return '--';
  const d = new Date(ms);
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour12: false })}`;
}

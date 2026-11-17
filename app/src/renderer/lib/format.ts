// Display formatting for usage & cost.

/** Sub-cent amounts keep 4 decimals so a $0.0006 turn doesn't read "$0.00". */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

export function formatMinutes(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  return `${(seconds / 60).toFixed(seconds < 600 ? 1 : 0)} min`
}

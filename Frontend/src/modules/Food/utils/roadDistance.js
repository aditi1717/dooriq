export function formatDistanceLabel(km) {
  if (km == null || !Number.isFinite(Number(km))) return "--";
  const value = Number(km);
  if (value >= 1) return `${value.toFixed(1)} KM`;
  return `${Math.round(value * 1000)} M`;
}

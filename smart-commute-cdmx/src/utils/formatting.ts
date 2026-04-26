const numberFormatter = new Intl.NumberFormat('es-MX');

export const normalizeSearchText = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();

export const formatCompact = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return numberFormatter.format(value);
};

export const formatPct = (value: number) => `${value.toFixed(1)}%`;

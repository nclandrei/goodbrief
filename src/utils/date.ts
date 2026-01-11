export function formatDateShort(date: Date): string {
  return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString('ro-RO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function getTodayString(): string {
  const d = new Date();
  return formatDate(d);
}

export function getYesterdayString(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatDisplayDate(dateStr: string): string {
  const [yyyy, mm, dd] = dateStr.split('-');
  return `${yyyy}-${mm}-${dd}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function formatKoreanDate(dateStr: string): string {
  const today = getTodayString();
  const yesterday = getYesterdayString();
  if (dateStr === today) return `오늘 (${dateStr})`;
  if (dateStr === yesterday) return `어제 (${dateStr})`;
  return dateStr;
}

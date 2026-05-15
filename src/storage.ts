import type { DoughRecord, YesterdayBaseline } from './types';
import { getTodayString } from './dateUtils';

export const TODAY_RECORDS_KEY = 'dough-water-temp-today-records';
export const YESTERDAY_BASELINE_KEY = 'dough-water-temp-yesterday-baseline';

// ── 오늘 기록 ──────────────────────────────────────────────────────────────

export function loadTodayRecords(): DoughRecord[] {
  try {
    const raw = localStorage.getItem(TODAY_RECORDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as DoughRecord[];
  } catch {
    return [];
  }
}

export function saveTodayRecords(records: DoughRecord[]): void {
  localStorage.setItem(TODAY_RECORDS_KEY, JSON.stringify(records));
}

/** 오늘 날짜가 아닌 기록을 제거한다. */
export function cleanupTodayRecords(records: DoughRecord[]): DoughRecord[] {
  const today = getTodayString();
  return records.filter((r) => r.date === today);
}

/** 불러온 뒤 오늘 날짜 아닌 기록을 자동 삭제한다. */
export function loadAndCleanTodayRecords(): DoughRecord[] {
  const records = loadTodayRecords();
  const cleaned = cleanupTodayRecords(records);
  if (cleaned.length !== records.length) {
    saveTodayRecords(cleaned);
  }
  return cleaned;
}

export function clearTodayRecords(): void {
  localStorage.removeItem(TODAY_RECORDS_KEY);
}

// ── 어제 기준값 ────────────────────────────────────────────────────────────

export function loadYesterdayBaseline(): YesterdayBaseline | null {
  try {
    const raw = localStorage.getItem(YESTERDAY_BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as YesterdayBaseline;
  } catch {
    return null;
  }
}

export function saveYesterdayBaseline(baseline: YesterdayBaseline): void {
  localStorage.setItem(YESTERDAY_BASELINE_KEY, JSON.stringify(baseline));
}

export function clearYesterdayBaseline(): void {
  localStorage.removeItem(YESTERDAY_BASELINE_KEY);
}

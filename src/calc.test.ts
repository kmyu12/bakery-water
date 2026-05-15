import {
  roundToOneDecimal,
  getFinalDoughTemp,
  calculatePredictedWaterTemp,
  getPreviousRecord,
} from './calc';
import type { DoughRecord } from './types';

function assert(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? '✅' : '❌'} ${label}`);
  if (!pass) {
    console.log(`   expected: ${JSON.stringify(expected)}`);
    console.log(`   actual:   ${JSON.stringify(actual)}`);
  }
}

// ── roundToOneDecimal ──────────────────────────────────────────────────────
assert('roundToOneDecimal(13.85) → 13.9', roundToOneDecimal(13.85), 13.9);
assert('roundToOneDecimal(13.84) → 13.8', roundToOneDecimal(13.84), 13.8);
assert('roundToOneDecimal(13.80) → 13.8', roundToOneDecimal(13.8), 13.8);

// ── getFinalDoughTemp ──────────────────────────────────────────────────────
const base: DoughRecord = {
  id: 'x', date: '2026-05-14', batchNo: 18,
  roomTemp: null, flourTemp: 23.3,
  predictedWaterTemp: null, confirmedWaterTemp: 14.0,
  doughTemp1: 26.8, doughTemp2: null,
  note: '', createdAt: '2026-05-14T08:00:00.000Z', updatedAt: '2026-05-14T08:00:00.000Z',
};

assert('getFinalDoughTemp - doughTemp2 없으면 doughTemp1 반환', getFinalDoughTemp(base), 26.8);

const withDoughTemp2: DoughRecord = { ...base, doughTemp2: 27.1 };
assert('getFinalDoughTemp - doughTemp2 있으면 doughTemp2 반환', getFinalDoughTemp(withDoughTemp2), 27.1);

const noTemps: DoughRecord = { ...base, doughTemp1: null, doughTemp2: null };
assert('getFinalDoughTemp - 둘 다 null이면 null 반환', getFinalDoughTemp(noTemps), null);

// ── calculatePredictedWaterTemp (메인 검증: 13.8) ───────────────────────
assert(
  'calculatePredictedWaterTemp → 13.8 (핵심 케이스)',
  calculatePredictedWaterTemp({
    previousFlourTemp: 23.3,
    previousConfirmedWaterTemp: 14.0,
    previousDoughTemp: 26.8,
    currentFlourTemp: 23.7,
  }),
  13.8
);

assert(
  'calculatePredictedWaterTemp - null 포함 시 null 반환',
  calculatePredictedWaterTemp({
    previousFlourTemp: 23.3,
    previousConfirmedWaterTemp: null,
    previousDoughTemp: 26.8,
    currentFlourTemp: 23.7,
  }),
  null
);

// ── getPreviousRecord ──────────────────────────────────────────────────────
const prev: DoughRecord = { ...base, id: 'prev', createdAt: '2026-05-14T07:00:00.000Z' };
const curr: DoughRecord = {
  ...base, id: 'curr', date: '2026-05-15', batchNo: 1,
  flourTemp: 23.7, createdAt: '2026-05-15T08:00:00.000Z',
};

assert('getPreviousRecord - 직전 기록 반환', getPreviousRecord([prev, curr], 'curr')?.id, 'prev');
assert('getPreviousRecord - 첫 기록이면 null 반환', getPreviousRecord([prev, curr], 'prev'), null);
assert('getPreviousRecord - 존재하지 않는 id면 null 반환', getPreviousRecord([prev, curr], 'none'), null);

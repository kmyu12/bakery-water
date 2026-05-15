import {
  getBaselineForRecord,
  calculatePredictedWaterTemp,
  getFinalDoughTempFromBaseline,
  validateDoughTemps,
} from './calc';
import type { DoughRecord, YesterdayBaseline } from './types';

function assert(label: string, actual: unknown, expected: unknown) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${pass ? '✅' : '❌'} ${label}`);
  if (!pass) {
    console.log(`   expected: ${JSON.stringify(expected)}`);
    console.log(`   actual:   ${JSON.stringify(actual)}`);
  }
}

// ── 테스트 데이터 ──────────────────────────────────────────────────────────

const baseline: YesterdayBaseline = {
  batchNo: 18,
  flourTemp: 23.3,
  confirmedWaterTemp: 14.0,
  doughTemp1: 26.8,
  doughTemp2: null,
  note: '테스트 기준값',
  updatedAt: '2026-05-15T08:00:00Z',
};

const today1: DoughRecord = {
  id: 'today-1',
  date: '2026-05-15',
  batchNo: 1,
  roomTemp: null,
  flourTemp: 23.7,
  predictedWaterTemp: null,
  confirmedWaterTemp: 13.8,
  doughTemp1: 26.9,
  doughTemp2: 27.1,
  note: '',
  createdAt: '2026-05-15T08:00:00Z',
  updatedAt: '2026-05-15T08:00:00Z',
};

const today2: DoughRecord = {
  id: 'today-2',
  date: '2026-05-15',
  batchNo: 2,
  roomTemp: null,
  flourTemp: 23.5,
  predictedWaterTemp: null,
  confirmedWaterTemp: null,
  doughTemp1: null,
  doughTemp2: null,
  note: '',
  createdAt: '2026-05-15T09:00:00Z',
  updatedAt: '2026-05-15T09:00:00Z',
};

// ── getBaselineForRecord ───────────────────────────────────────────────────

const bv1 = getBaselineForRecord(today1, [today1, today2], baseline);
assert('오늘 1회차 기준값 소스 = 어제 18회차', bv1?.sourceName, '어제 18회차');
assert('오늘 1회차 기준 밀가루 온도', bv1?.flourTemp, 23.3);
assert('오늘 1회차 기준 물 온도 확정', bv1?.confirmedWaterTemp, 14.0);
assert('오늘 1회차 기준 반죽 온도 1차', bv1?.doughTemp1, 26.8);

const bv2 = getBaselineForRecord(today2, [today1, today2], baseline);
assert('오늘 2회차 기준값 소스 = 오늘 1회차', bv2?.sourceName, '오늘 1회차');
assert('오늘 2회차 기준 밀가루 온도', bv2?.flourTemp, 23.7);
assert('오늘 2회차 기준 물 온도 확정', bv2?.confirmedWaterTemp, 13.8);
assert('오늘 2회차 기준 doughTemp2 = 27.1 (2차 우선)', bv2?.doughTemp2, 27.1);

// ── 핵심 계산: 오늘 1회차 예측값 = 13.8 ───────────────────────────────────

const prevDough1 = bv1?.doughTemp2 ?? bv1?.doughTemp1 ?? null;
const predicted1 = calculatePredictedWaterTemp({
  previousFlourTemp: bv1?.flourTemp ?? null,
  previousConfirmedWaterTemp: bv1?.confirmedWaterTemp ?? null,
  previousDoughTemp: prevDough1,
  currentFlourTemp: today1.flourTemp,
});
assert('오늘 1회차 예측값 = 13.8', predicted1, 13.8);

// ── 오늘 2회차 계산 (기준 반죽 온도는 today1의 2차 = 27.1) ────────────────

const prevDough2 = bv2?.doughTemp2 ?? bv2?.doughTemp1 ?? null;
assert('오늘 2회차 기준 최종 반죽 온도 = 27.1 (2차)', prevDough2, 27.1);

// ── getFinalDoughTempFromBaseline ──────────────────────────────────────────

assert('baseline doughTemp2=null → 1차 반환', getFinalDoughTempFromBaseline(baseline), 26.8);
const b2 = { ...baseline, doughTemp2: 27.1 };
assert('baseline doughTemp2=27.1 → 2차 반환', getFinalDoughTempFromBaseline(b2), 27.1);

// ── validateDoughTemps ────────────────────────────────────────────────────

assert('2차 > 1차 → null', validateDoughTemps(26.8, 27.1), null);
assert('2차 = 1차 → null', validateDoughTemps(26.8, 26.8), null);
assert('2차 < 1차 → 오류 문구', validateDoughTemps(26.8, 26.5), '반죽 온도 2차는 1차보다 낮을 수 없습니다.');
assert('1차 null, 2차 있음 → null', validateDoughTemps(null, 27.1), null);

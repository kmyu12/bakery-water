import type { DoughRecord, PredictedWaterTempParams, YesterdayBaseline } from './types';

export const TARGET_DOUGH_TEMP = 27.0;

/**
 * 숫자를 소수점 첫째 자리까지 반올림한다.
 */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * 반죽 온도 최종값을 반환한다.
 * - doughTemp2가 있으면 doughTemp2 반환
 * - doughTemp2가 없고 doughTemp1이 있으면 doughTemp1 반환
 * - 둘 다 없으면 null 반환
 */
export function getFinalDoughTemp(record: DoughRecord): number | null {
  if (record.doughTemp2 !== null && record.doughTemp2 !== undefined) {
    return record.doughTemp2;
  }
  if (record.doughTemp1 !== null && record.doughTemp1 !== undefined) {
    return record.doughTemp1;
  }
  return null;
}

/**
 * 물 온도 예측값을 계산한다.
 *
 * 수식:
 * predictedWaterTemp =
 *   previousConfirmedWaterTemp
 *   + (TARGET_DOUGH_TEMP - previousDoughTemp)
 *   + (previousFlourTemp - currentFlourTemp)
 *
 * - 필요한 값 중 하나라도 null이면 null 반환
 * - 유한하지 않은 값이 들어오면 null 반환
 * - 결과는 소수점 첫째 자리까지 반올림
 */
export function calculatePredictedWaterTemp(
  params: PredictedWaterTempParams
): number | null {
  const { previousFlourTemp, previousConfirmedWaterTemp, previousDoughTemp, currentFlourTemp } =
    params;

  if (
    previousFlourTemp === null ||
    previousConfirmedWaterTemp === null ||
    previousDoughTemp === null ||
    currentFlourTemp === null
  ) {
    return null;
  }

  if (
    !isFinite(previousFlourTemp) ||
    !isFinite(previousConfirmedWaterTemp) ||
    !isFinite(previousDoughTemp) ||
    !isFinite(currentFlourTemp)
  ) {
    return null;
  }

  const result =
    previousConfirmedWaterTemp +
    (TARGET_DOUGH_TEMP - previousDoughTemp) +
    (previousFlourTemp - currentFlourTemp);

  return roundToOneDecimal(result);
}

/**
 * 현재 record 바로 이전 기록을 반환한다.
 * createdAt 기준 오름차순 정렬 후 currentRecordId 직전 항목을 반환한다.
 * 이전 기록이 없으면 null 반환.
 */
export function getPreviousRecord(
  records: DoughRecord[],
  currentRecordId: string
): DoughRecord | null {
  const sorted = [...records].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const currentIndex = sorted.findIndex((r) => r.id === currentRecordId);

  if (currentIndex <= 0) {
    return null;
  }

  return sorted[currentIndex - 1];
}

// ── 신규: 기준값 공통 인터페이스 ─────────────────────────────────────────

/**
 * 계산에 필요한 기준값을 표현하는 공통 인터페이스.
 * YesterdayBaseline 또는 이전 DoughRecord에서 추출된다.
 */
export interface BaselineValues {
  flourTemp: number | null;
  confirmedWaterTemp: number | null;
  doughTemp1: number | null;
  doughTemp2: number | null;
  /** UI 표시용 레이블 (예: "어제 18회차", "오늘 2회차") */
  sourceName: string;
}

/**
 * YesterdayBaseline의 최종 반죽 온도를 반환한다.
 * doughTemp2 우선, 없으면 doughTemp1, 둘 다 없으면 null.
 */
export function getFinalDoughTempFromBaseline(baseline: YesterdayBaseline): number | null {
  if (baseline.doughTemp2 !== null) return baseline.doughTemp2;
  if (baseline.doughTemp1 !== null) return baseline.doughTemp1;
  return null;
}

/**
 * 반죽 온도 1차/2차 유효성 검사.
 * doughTemp2가 doughTemp1보다 낮으면 오류 문구를 반환한다.
 * 정상이면 null 반환.
 */
export function validateDoughTemps(
  doughTemp1: number | null,
  doughTemp2: number | null
): string | null {
  if (doughTemp1 !== null && doughTemp2 !== null && doughTemp2 < doughTemp1) {
    return '반죽 온도 2차는 1차보다 낮을 수 없습니다.';
  }
  return null;
}

/**
 * 현재 record가 계산할 때 사용하는 기준값을 반환한다.
 *
 * - 오늘 첫 번째 record (idx === 0) → yesterdayBaseline 사용
 * - 오늘 두 번째 이상 record → 바로 직전 오늘 record 사용
 * - record를 todayRecords에서 찾을 수 없으면 null 반환
 */
export function getBaselineForRecord(
  record: DoughRecord,
  todayRecords: DoughRecord[],
  yesterdayBaseline: YesterdayBaseline | null
): BaselineValues | null {
  const sorted = [...todayRecords].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const idx = sorted.findIndex((r) => r.id === record.id);
  if (idx < 0) return null;

  if (idx === 0) {
    if (!yesterdayBaseline) return null;
    return {
      flourTemp: yesterdayBaseline.flourTemp,
      confirmedWaterTemp: yesterdayBaseline.confirmedWaterTemp,
      doughTemp1: yesterdayBaseline.doughTemp1,
      doughTemp2: yesterdayBaseline.doughTemp2,
      sourceName: yesterdayBaseline.batchNo
        ? `어제 ${yesterdayBaseline.batchNo}회차`
        : '어제 마지막 회차',
    };
  }

  const prev = sorted[idx - 1];
  return {
    flourTemp: prev.flourTemp,
    confirmedWaterTemp: prev.confirmedWaterTemp,
    doughTemp1: prev.doughTemp1,
    doughTemp2: prev.doughTemp2,
    sourceName: `오늘 ${prev.batchNo}회차`,
  };
}

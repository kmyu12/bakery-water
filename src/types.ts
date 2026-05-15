export interface DoughRecord {
  id: string;
  date: string;
  batchNo: number;
  roomTemp: number | null;
  flourTemp: number | null;
  predictedWaterTemp: number | null;
  confirmedWaterTemp: number | null;
  doughTemp1: number | null;
  doughTemp2: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface PredictedWaterTempParams {
  previousFlourTemp: number | null;
  previousConfirmedWaterTemp: number | null;
  previousDoughTemp: number | null;
  currentFlourTemp: number | null;
}

/** 어제 마지막 회차 기준값 (오늘 1회차 계산에 사용) */
export interface YesterdayBaseline {
  batchNo: number | null;
  flourTemp: number | null;
  confirmedWaterTemp: number | null;
  doughTemp1: number | null;
  doughTemp2: number | null;
  note: string;
  updatedAt: string;
}

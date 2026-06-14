import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import type { DoughRecord, YesterdayBaseline } from './types';
import {
  calculatePredictedWaterTemp,
  getBaselineForRecord,
  validateDoughTemps,
  roundToOneDecimal,
  TARGET_DOUGH_TEMP,
} from './calc';
import {
  loadAndCleanTodayRecords,
  saveTodayRecords,
  clearTodayRecords,
  loadYesterdayBaseline,
  saveYesterdayBaseline,
  clearYesterdayBaseline,
} from './storage';
import { getTodayString, isoNow } from './dateUtils';
import { isSupabaseEnabled } from './supabaseClient';
import {
  cleanupOldTodayRecords,
  fetchTodayRecords,
  fetchYesterdayBaseline,
  createTodayRecord,
  updateTodayRecord,
  deleteTodayRecord,
  deleteTodayRecordsByDate,
  upsertYesterdayBaseline,
  deleteYesterdayBaseline,
  SupabaseNotConfiguredError,
  WORKSPACE_ID,
} from './db';
import './App.css';

// ── 유틸 ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function parseTemp(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const n = parseFloat(trimmed);
  if (isNaN(n) || !isFinite(n)) return null;
  return roundToOneDecimal(n);
}

function formatTemp(value: number | null): string {
  if (value === null) return '';
  return value.toFixed(1);
}

function sortByCreatedAt<T extends { createdAt: string }>(arr: T[]): T[] {
  return [...arr].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

/** 두 DoughRecord를 비교해서 DB에 저장 가능한 변경 필드만 추출한다. */
function computeRecordPatch(
  prev: DoughRecord,
  next: DoughRecord
): Partial<Pick<DoughRecord, 'flourTemp' | 'confirmedWaterTemp' | 'doughTemp1' | 'doughTemp2' | 'note'>> {
  const patch: Partial<Pick<DoughRecord, 'flourTemp' | 'confirmedWaterTemp' | 'doughTemp1' | 'doughTemp2' | 'note'>> = {};
  if (prev.flourTemp           !== next.flourTemp)           patch.flourTemp           = next.flourTemp;
  if (prev.confirmedWaterTemp  !== next.confirmedWaterTemp)  patch.confirmedWaterTemp  = next.confirmedWaterTemp;
  if (prev.doughTemp1          !== next.doughTemp1)          patch.doughTemp1          = next.doughTemp1;
  if (prev.doughTemp2          !== next.doughTemp2)          patch.doughTemp2          = next.doughTemp2;
  if (prev.note                !== next.note)                patch.note                = next.note;
  return patch;
}

// ── 예측 결과 타입 ─────────────────────────────────────────────────────────

type PredictedStatus =
  | 'ok'
  | 'no-flour'
  | 'no-prev'
  | 'no-prev-water'
  | 'no-prev-flour'
  | 'no-prev-dough'
  | 'calc-error';

type PredictedResult =
  | { value: number; status: 'ok' }
  | { value: null; status: Exclude<PredictedStatus, 'ok'> };

const PREDICTED_LABELS: Record<Exclude<PredictedStatus, 'ok'>, string> = {
  'no-flour':      '밀가루 온도 입력 필요',
  'no-prev':       '어제 기준값 필요',
  'no-prev-water': '기준 물 온도 없음',
  'no-prev-flour': '기준 밀가루 온도 없음',
  'no-prev-dough': '기준 반죽 온도 없음',
  'calc-error':    '예측 불가',
};

function getPredictedResult(
  record: DoughRecord,
  todayRecords: DoughRecord[],
  yesterdayBaseline: YesterdayBaseline | null
): PredictedResult {
  if (record.flourTemp === null) return { value: null, status: 'no-flour' };

  const baseline = getBaselineForRecord(record, todayRecords, yesterdayBaseline);
  if (!baseline) return { value: null, status: 'no-prev' };

  if (baseline.confirmedWaterTemp === null) return { value: null, status: 'no-prev-water' };
  if (baseline.flourTemp === null)          return { value: null, status: 'no-prev-flour' };

  const prevDoughTemp = baseline.doughTemp1;
  if (prevDoughTemp === null) return { value: null, status: 'no-prev-dough' };

  const val = calculatePredictedWaterTemp({
    previousFlourTemp: baseline.flourTemp,
    previousConfirmedWaterTemp: baseline.confirmedWaterTemp,
    previousDoughTemp: prevDoughTemp,
    currentFlourTemp: record.flourTemp,
  });

  if (val === null) return { value: null, status: 'calc-error' };
  return { value: val, status: 'ok' };
}

// ── 행 상태 배지 ───────────────────────────────────────────────────────────

type RowStatusKey = 'input' | 'nobase' | 'predicted' | 'water-done' | 'done';

function getRowStatus(record: DoughRecord, predictedVal: number | null): { key: RowStatusKey; label: string } {
  if (record.flourTemp === null)                                return { key: 'input',      label: '입력 중' };
  if (predictedVal === null)                                    return { key: 'nobase',     label: '기준값 부족' };
  if (record.confirmedWaterTemp === null)                       return { key: 'predicted',  label: '예측 완료' };
  if (record.doughTemp1 === null && record.doughTemp2 === null) return { key: 'water-done', label: '물 온도 확정' };
  return { key: 'done', label: '반죽 완료' };
}

// ── Toast ─────────────────────────────────────────────────────────────────

const Toast = memo(function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 4000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="toast" role="status" aria-live="polite">
      <span>{message}</span>
      <button className="toast-close" onClick={onClose} aria-label="닫기">✕</button>
    </div>
  );
});

// ── TempInput ─────────────────────────────────────────────────────────────

interface TempInputProps {
  value: number | null;
  onChange: (v: number | null) => void;
  ariaLabel?: string;
}

const TempInput = memo(function TempInput({ value, onChange, ariaLabel }: TempInputProps) {
  const [raw, setRaw] = useState(formatTemp(value));

  useEffect(() => { setRaw(formatTemp(value)); }, [value]);

  function handleBlur() {
    const trimmed = raw.trim();
    if (trimmed === '') { onChange(null); return; }
    const parsed = parseTemp(trimmed);
    if (parsed === null) {
      alert('올바른 온도를 입력하세요. (예: 23.5)');
      setRaw(formatTemp(value));
      return;
    }
    if (parsed < 0) {
      alert('음수 온도는 입력할 수 없습니다.');
      setRaw(formatTemp(value));
      return;
    }
    if (parsed > 60) {
      const ok = confirm(`${parsed.toFixed(1)}°C는 정상 범위(0~60°C)를 벗어납니다. 그대로 저장할까요?`);
      if (!ok) { setRaw(formatTemp(value)); return; }
    }
    const formatted = parsed.toFixed(1);
    if (formatted !== trimmed) setRaw(formatted);
    onChange(parsed);
  }

  return (
    <div className="temp-input-wrap">
      <input
        className="temp-input"
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        max="60"
        value={raw}
        placeholder=""
        aria-label={ariaLabel}
        onChange={(e) => setRaw(e.target.value)}
        onBlur={handleBlur}
      />
      <span className="unit" aria-hidden="true">°C</span>
    </div>
  );
});

// ── YesterdayBaselineTable ─────────────────────────────────────────────────

interface YesterdayBaselineTableProps {
  baseline: YesterdayBaseline | null;
  onUpdate: (b: YesterdayBaseline) => void;
  onClear: () => void;
}

const YesterdayBaselineTable = memo(function YesterdayBaselineTable({
  baseline, onUpdate, onClear,
}: YesterdayBaselineTableProps) {
  const empty: YesterdayBaseline = {
    batchNo: null, flourTemp: null, confirmedWaterTemp: null,
    doughTemp1: null, doughTemp2: null, note: '', updatedAt: isoNow(),
  };
  const b = baseline ?? empty;

  function upd(fields: Partial<YesterdayBaseline>) {
    onUpdate({ ...b, ...fields, updatedAt: isoNow() });
  }

  function handleDoughTemp2Change(v: number | null) {
    const err = validateDoughTemps(b.doughTemp1, v);
    if (err) { alert(err); return; }
    upd({ doughTemp2: v });
  }

  const isComplete = b.flourTemp !== null && b.confirmedWaterTemp !== null && b.doughTemp1 !== null;

  return (
    <div className="date-group">
      <div className="date-group-label baseline-label-row">
        어제 마지막 회차 기준값
        {isComplete && <span className="baseline-ok-badge">입력 완료</span>}
      </div>
      <div className="table-wrap">
        <table className="record-table">
          <thead>
            <tr>
              <th className="th-sticky">회차</th>
              <th>밀가루 온도</th>
              <th className="th-confirmed">물 온도 (확정)</th>
              <th>반죽 온도 1차</th>
              <th>반죽 온도 2차</th>
              <th>비고</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr className="row-baseline">
              <td className="td-batch td-sticky">
                <div className="batch-cell">
                  <input
                    className="batch-no-input"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={b.batchNo ?? ''}
                    placeholder="—"
                    aria-label="어제 마지막 회차 번호"
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      upd({ batchNo: isNaN(v) ? null : v });
                    }}
                  />
                  <span className="status-badge badge-nobase">기준값</span>
                </div>
              </td>
              <td className="td-temp">
                <TempInput value={b.flourTemp} onChange={(v) => upd({ flourTemp: v })} ariaLabel="어제 밀가루 온도" />
              </td>
              <td className="td-confirmed">
                <div className="confirmed-cell">
                  <div className="confirmed-display">
                    {b.confirmedWaterTemp !== null
                      ? <span className="confirmed-value">{b.confirmedWaterTemp.toFixed(1)} °C</span>
                      : <span className="unconfirmed-label">미입력</span>}
                  </div>
                  <TempInput value={b.confirmedWaterTemp} onChange={(v) => upd({ confirmedWaterTemp: v })} ariaLabel="어제 물 온도 확정" />
                </div>
              </td>
              <td className="td-temp">
                <TempInput value={b.doughTemp1} onChange={(v) => upd({ doughTemp1: v })} ariaLabel="어제 반죽 온도 1차" />
              </td>
              <td className="td-temp">
                <TempInput value={b.doughTemp2} onChange={handleDoughTemp2Change} ariaLabel="어제 반죽 온도 2차" />
              </td>
              <td className="td-note">
                <input
                  className="note-input"
                  type="text"
                  value={b.note}
                  placeholder="메모"
                  aria-label="어제 기준값 비고"
                  onChange={(e) => upd({ note: e.target.value })}
                />
              </td>
              <td className="td-del">
                <button
                  className="btn btn-delete"
                  onClick={() => { if (confirm('어제 마지막 회차 기준값을 삭제할까요?')) onClear(); }}
                  aria-label="어제 기준값 초기화"
                >
                  ✕
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ── NextBatchReferenceCard ─────────────────────────────────────────────────

const NextBatchReferenceCard = memo(function NextBatchReferenceCard({
  todayRecords,
  yesterdayBaseline,
}: {
  todayRecords: DoughRecord[];
  yesterdayBaseline: YesterdayBaseline | null;
}) {
  const lastToday = useMemo(() => {
    const sorted = sortByCreatedAt(todayRecords);
    return sorted[sorted.length - 1] ?? null;
  }, [todayRecords]);

  const ref = useMemo(() => {
    if (lastToday) {
      return {
        srcName: `오늘 ${lastToday.batchNo}회차`,
        flourTemp: lastToday.flourTemp,
        confirmedWaterTemp: lastToday.confirmedWaterTemp,
        finalDough: lastToday.doughTemp1,
      };
    }
    if (yesterdayBaseline) {
      const b = yesterdayBaseline;
      return {
        srcName: b.batchNo ? `어제 ${b.batchNo}회차` : '어제 마지막 회차',
        flourTemp: b.flourTemp,
        confirmedWaterTemp: b.confirmedWaterTemp,
        finalDough: b.doughTemp1,
      };
    }
    return null;
  }, [lastToday, yesterdayBaseline]);

  if (!ref) {
    return (
      <div className="reference-box reference-empty">
        <p className="ref-empty-text">어제 마지막 회차 기준값을 입력하면 오늘 1회차 계산이 시작됩니다.</p>
      </div>
    );
  }

  const missing: string[] = [];
  if (ref.flourTemp === null)          missing.push('밀가루 온도');
  if (ref.confirmedWaterTemp === null) missing.push('물 온도 확정값');
  if (ref.finalDough === null)         missing.push('반죽 온도');

  return (
    <div className={`reference-box ${missing.length > 0 ? 'reference-warn' : 'reference-ok'}`}>
      <div className="ref-header">
        <span className="ref-title">다음 회차 계산 기준</span>
        <span className="ref-sub">{ref.srcName}</span>
      </div>
      <div className="ref-grid">
        <span className="ref-label">밀가루 온도</span>
        <span className="ref-value">
          {ref.flourTemp !== null ? `${ref.flourTemp.toFixed(1)} °C` : <span className="ref-missing">없음</span>}
        </span>
        <span className="ref-label">물 온도 확정</span>
        <span className="ref-value">
          {ref.confirmedWaterTemp !== null ? `${ref.confirmedWaterTemp.toFixed(1)} °C` : <span className="ref-missing">없음</span>}
        </span>
        <span className="ref-label">반죽 온도 1차</span>
        <span className="ref-value">
          {ref.finalDough !== null
            ? `${ref.finalDough.toFixed(1)} °C`
            : <span className="ref-missing">없음</span>}
        </span>
      </div>
      {missing.length > 0 && (
        <div className="ref-missing-alert">
          기준값 부족: {missing.join(', ')}이(가) 없습니다.
        </div>
      )}
    </div>
  );
});

// ── ConfirmedWaterCell ─────────────────────────────────────────────────────

interface ConfirmedWaterCellProps {
  record: DoughRecord;
  predictedVal: number | null;
  onUpdate: (id: string, value: number | null) => void;
}

const ConfirmedWaterCell = memo(function ConfirmedWaterCell({
  record, predictedVal, onUpdate,
}: ConfirmedWaterCellProps) {
  const [editing, setEditing] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function handleConfirm() {
    if (predictedVal === null) return;
    if (
      record.confirmedWaterTemp !== null &&
      !confirm('이미 확정된 물 온도가 있습니다. 예측값으로 덮어쓸까요?')
    ) return;
    onUpdate(record.id, predictedVal);
  }

  function handleStartEdit() {
    setInputVal(formatTemp(record.confirmedWaterTemp));
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  }

  function handleSave() {
    const trimmed = inputVal.trim();
    if (trimmed === '') { onUpdate(record.id, null); setEditing(false); return; }
    const parsed = parseTemp(trimmed);
    if (parsed === null) { alert('올바른 온도를 입력하세요. (예: 14.0)'); return; }
    if (parsed < 0) { alert('음수 온도는 입력할 수 없습니다.'); return; }
    onUpdate(record.id, parsed);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="confirmed-edit">
        <div className="temp-input-wrap">
          <input
            ref={inputRef}
            className="temp-input"
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder=""
            value={inputVal}
            aria-label="물 온도 직접 입력"
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setEditing(false); }}
          />
          <span className="unit">°C</span>
        </div>
        <div className="btn-row">
          <button className="btn btn-save" onClick={handleSave}>저장</button>
          <button className="btn btn-cancel" onClick={() => setEditing(false)}>취소</button>
        </div>
      </div>
    );
  }

  return (
    <div className="confirmed-cell">
      <div className="confirmed-display">
        {record.confirmedWaterTemp !== null
          ? <span className="confirmed-value">{record.confirmedWaterTemp.toFixed(1)} °C</span>
          : <span className="unconfirmed-label">미확정</span>}
      </div>
      <div className="btn-row">
        <button
          className="btn btn-confirm"
          onClick={handleConfirm}
          disabled={predictedVal === null}
          title={predictedVal === null ? '예측값이 없습니다' : `${predictedVal.toFixed(1)}°C로 확정`}
          aria-label="예측값으로 확정"
        >
          확정
        </button>
        <button
          className="btn btn-input"
          onClick={handleStartEdit}
          aria-label="물 온도 직접 입력"
        >
          입력
        </button>
      </div>
    </div>
  );
});

// ── RecordRow ──────────────────────────────────────────────────────────────

interface RecordRowProps {
  record: DoughRecord;
  todayRecords: DoughRecord[];
  yesterdayBaseline: YesterdayBaseline | null;
  onUpdate: (updated: DoughRecord) => void;
  onDelete: (id: string) => void;
}

const RecordRow = memo(function RecordRow({
  record, todayRecords, yesterdayBaseline, onUpdate, onDelete,
}: RecordRowProps) {
  const result = getPredictedResult(record, todayRecords, yesterdayBaseline);
  const predictedVal = result.status === 'ok' ? result.value : null;
  const rowStatus = getRowStatus(record, predictedVal);

  const field = useCallback(
    <K extends keyof DoughRecord>(key: K, val: DoughRecord[K]) => {
      onUpdate({ ...record, [key]: val, updatedAt: isoNow() });
    },
    [record, onUpdate]
  );

  const handleDoughTemp2Change = useCallback((v: number | null) => {
    const err = validateDoughTemps(record.doughTemp1, v);
    if (err) { alert(err); return; }
    onUpdate({ ...record, doughTemp2: v, updatedAt: isoNow() });
  }, [record, onUpdate]);

  const handleFlourTempChange   = useCallback((v: number | null) => field('flourTemp', v), [field]);
  const handleDoughTemp1Change  = useCallback((v: number | null) => field('doughTemp1', v), [field]);
  const handleConfirmedUpdate   = useCallback((id: string, v: number | null) => {
    onUpdate({ ...record, id, confirmedWaterTemp: v, updatedAt: isoNow() });
  }, [record, onUpdate]);

  return (
    <tr className="row-today">
      <td className="td-batch td-sticky">
        <div className="batch-cell">
          <span className="batch-no">{record.batchNo}회차</span>
          <span className={`status-badge badge-${rowStatus.key}`}>{rowStatus.label}</span>
        </div>
      </td>

      <td className="td-temp">
        <TempInput value={record.flourTemp} onChange={handleFlourTempChange} ariaLabel="밀가루 온도" />
      </td>

      <td className="td-predicted">
        {result.status === 'ok'
          ? <span className="predicted-value">{result.value.toFixed(1)} °C</span>
          : <span className="predicted-status">{PREDICTED_LABELS[result.status]}</span>}
      </td>

      <td className="td-confirmed">
        <ConfirmedWaterCell
          record={record}
          predictedVal={predictedVal}
          onUpdate={handleConfirmedUpdate}
        />
      </td>

      <td className="td-temp">
        <TempInput value={record.doughTemp1} onChange={handleDoughTemp1Change} ariaLabel="반죽 온도 1차" />
      </td>

      <td className="td-temp">
        <TempInput value={record.doughTemp2} onChange={handleDoughTemp2Change} ariaLabel="반죽 온도 2차" />
      </td>

      <td className="td-note">
        <input
          className="note-input"
          type="text"
          value={record.note}
          placeholder="메모"
          aria-label="비고"
          onChange={(e) => field('note', e.target.value)}
        />
      </td>

      <td className="td-del">
        <button
          className="btn btn-delete"
          onClick={() => { if (confirm('이 회차 기록을 삭제할까요?')) onDelete(record.id); }}
          aria-label={`${record.batchNo}회차 삭제`}
        >
          ✕
        </button>
      </td>
    </tr>
  );
});

// ── 테이블 헤더 ────────────────────────────────────────────────────────────

const TableHeader = memo(function TableHeader() {
  return (
    <thead>
      <tr>
        <th className="th-sticky">회차</th>
        <th>밀가루 온도</th>
        <th className="th-predicted">물 온도 (예측)</th>
        <th className="th-confirmed">물 온도 (확정)</th>
        <th>반죽 온도 1차</th>
        <th>반죽 온도 2차</th>
        <th>비고</th>
        <th></th>
      </tr>
    </thead>
  );
});

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const [todayRecords, setTodayRecords] = useState<DoughRecord[]>([]);
  const [yesterdayBaseline, setYesterdayBaseline] = useState<YesterdayBaseline | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [storageMode, setStorageMode] = useState<'supabase' | 'local' | null>(null);

  useEffect(() => {
    if (!isSupabaseEnabled) {
      setTodayRecords(loadAndCleanTodayRecords());
      setYesterdayBaseline(loadYesterdayBaseline());
      setStorageMode('local');
      return;
    }

    setIsLoading(true);
    const todayStr = getTodayString();

    (async () => {
      try {
        await cleanupOldTodayRecords(WORKSPACE_ID);
        const [records, baseline] = await Promise.all([
          fetchTodayRecords(WORKSPACE_ID, todayStr),
          fetchYesterdayBaseline(WORKSPACE_ID),
        ]);
        setTodayRecords(records);
        setYesterdayBaseline(baseline);
        setStorageMode('supabase');
      } catch (e) {
        if (e instanceof SupabaseNotConfiguredError) {
          setTodayRecords(loadAndCleanTodayRecords());
          setYesterdayBaseline(loadYesterdayBaseline());
          setStorageMode('local');
        } else {
          const msg = e instanceof Error ? e.message : 'DB 오류가 발생했습니다.';
          setDbError(msg);
          setTodayRecords(loadAndCleanTodayRecords());
          setYesterdayBaseline(loadYesterdayBaseline());
          setStorageMode('local');
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const showToast = useCallback((msg: string) => setToast(msg), []);

  /** Supabase에서 오늘 기록을 다시 불러와 state에 반영한다. */
  const reloadTodayFromDb = useCallback(async () => {
    try {
      const records = await fetchTodayRecords(WORKSPACE_ID, getTodayString());
      setTodayRecords(records);
    } catch (e) {
      console.error('today_records 재로딩 실패:', e);
      setDbError(e instanceof Error ? e.message : '오늘 기록 재로딩 실패');
    }
  }, []);

  /** Supabase에서 어제 기준값을 다시 불러와 state에 반영한다. */
  const reloadBaselineFromDb = useCallback(async () => {
    try {
      const baseline = await fetchYesterdayBaseline(WORKSPACE_ID);
      setYesterdayBaseline(baseline);
    } catch (e) {
      console.error('yesterday_baseline 재로딩 실패:', e);
      setDbError(e instanceof Error ? e.message : '어제 기준값 재로딩 실패');
    }
  }, []);

  const persistRecords = useCallback((updated: DoughRecord[]) => {
    setTodayRecords(updated);
    saveTodayRecords(updated);
  }, []);

  /**
   * 어제 기준값 저장.
   * · Supabase 모드: 즉시 state 반영(optimistic) → 비동기 upsert → 실패 시 DB 재로딩
   * · Local 모드: state + localStorage 동기 저장
   */
  const persistBaseline = useCallback((b: YesterdayBaseline) => {
    setYesterdayBaseline(b);
    if (storageMode === 'supabase') {
      upsertYesterdayBaseline(b, WORKSPACE_ID).catch((e) => {
        console.error('어제 기준값 저장 실패:', e);
        setDbError(e instanceof Error ? e.message : '어제 기준값 저장 실패');
        reloadBaselineFromDb();
      });
    } else {
      saveYesterdayBaseline(b);
    }
  }, [storageMode, reloadBaselineFromDb]);

  /**
   * 새 회차 추가.
   * · Supabase 모드: createTodayRecord → DB 반환 UUID로 재로딩
   * · Local 모드: persistRecords (state + localStorage)
   */
  const addBatch = useCallback(() => {
    const today = getTodayString();
    const now = isoNow();
    const newRecord: DoughRecord = {
      id: generateId(),
      date: today,
      batchNo: todayRecords.length + 1,
      roomTemp: null,
      flourTemp: null,
      predictedWaterTemp: null,
      confirmedWaterTemp: null,
      doughTemp1: null,
      doughTemp2: null,
      note: '',
      createdAt: now,
      updatedAt: now,
    };

    if (storageMode === 'supabase') {
      setIsSaving(true);
      createTodayRecord(newRecord, WORKSPACE_ID)
        .then(() => reloadTodayFromDb())
        .catch((e) => {
          console.error('새 회차 추가 실패:', e);
          setDbError(e instanceof Error ? e.message : '새 회차 추가 실패');
        })
        .finally(() => setIsSaving(false));
    } else {
      persistRecords([...todayRecords, newRecord]);
    }
  }, [todayRecords, persistRecords, storageMode, reloadTodayFromDb]);

  /**
   * 회차 필드 수정.
   * · Supabase 모드: 즉시 state 반영(optimistic) → 변경된 필드만 updateTodayRecord → 실패 시 재로딩
   * · Local 모드: persistRecords
   */
  const updateRecord = useCallback((updated: DoughRecord) => {
    const newRecords = todayRecords.map((r) => (r.id === updated.id ? updated : r));

    if (storageMode === 'supabase') {
      setTodayRecords(newRecords);
      const old = todayRecords.find((r) => r.id === updated.id);
      if (old) {
        const patch = computeRecordPatch(old, updated);
        if (Object.keys(patch).length > 0) {
          updateTodayRecord(updated.id, patch).catch((e) => {
            console.error('회차 수정 실패:', e);
            setDbError(e instanceof Error ? e.message : '회차 수정 실패');
            reloadTodayFromDb();
          });
        }
      }
    } else {
      persistRecords(newRecords);
    }
  }, [todayRecords, persistRecords, storageMode, reloadTodayFromDb]);

  /**
   * 회차 삭제.
   * · Supabase 모드: deleteTodayRecord → 재로딩
   * · Local 모드: persistRecords
   */
  const deleteRecord = useCallback((id: string) => {
    if (storageMode === 'supabase') {
      setIsSaving(true);
      deleteTodayRecord(id)
        .then(() => reloadTodayFromDb())
        .catch((e) => {
          console.error('회차 삭제 실패:', e);
          setDbError(e instanceof Error ? e.message : '회차 삭제 실패');
        })
        .finally(() => setIsSaving(false));
    } else {
      persistRecords(todayRecords.filter((r) => r.id !== id));
    }
  }, [todayRecords, persistRecords, storageMode, reloadTodayFromDb]);

  /**
   * 오늘 기록 전체 초기화.
   * · Supabase 모드: deleteTodayRecordsByDate → state 빈 배열
   * · Local 모드: clearTodayRecords + state 초기화
   */
  const handleClearToday = useCallback(() => {
    if (confirm('오늘 기록을 모두 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) {
      if (storageMode === 'supabase') {
        setIsSaving(true);
        deleteTodayRecordsByDate(WORKSPACE_ID, getTodayString())
          .then(() => {
            setTodayRecords([]);
            showToast('오늘 기록이 초기화되었습니다.');
          })
          .catch((e) => {
            console.error('오늘 기록 초기화 실패:', e);
            setDbError(e instanceof Error ? e.message : '오늘 기록 초기화 실패');
          })
          .finally(() => setIsSaving(false));
      } else {
        clearTodayRecords();
        setTodayRecords([]);
        showToast('오늘 기록이 초기화되었습니다.');
      }
    }
  }, [storageMode, showToast]);

  /**
   * 어제 기준값 초기화.
   * · Supabase 모드: deleteYesterdayBaseline → state null
   * · Local 모드: clearYesterdayBaseline + state null
   */
  const handleClearBaseline = useCallback(() => {
    if (confirm('어제 마지막 회차 기준값을 삭제할까요?')) {
      if (storageMode === 'supabase') {
        setIsSaving(true);
        deleteYesterdayBaseline(WORKSPACE_ID)
          .then(() => {
            setYesterdayBaseline(null);
            showToast('어제 기준값이 초기화되었습니다.');
          })
          .catch((e) => {
            console.error('어제 기준값 초기화 실패:', e);
            setDbError(e instanceof Error ? e.message : '어제 기준값 초기화 실패');
          })
          .finally(() => setIsSaving(false));
      } else {
        clearYesterdayBaseline();
        setYesterdayBaseline(null);
        showToast('어제 기준값이 초기화되었습니다.');
      }
    }
  }, [storageMode, showToast]);

  const handleExportCSV = useCallback(() => {
    const headers = ['회차', '날짜', '현재온도', '밀가루온도', '물온도(예측)', '물온도(확정)', '반죽온도1차', '반죽온도2차', '비고'];
    const sorted = sortByCreatedAt(todayRecords);
    const rows = sorted.map((r) => {
      const res = getPredictedResult(r, todayRecords, yesterdayBaseline);
      const pv = res.status === 'ok' ? res.value.toFixed(1) : '';
      return [
        r.batchNo, r.date,
        r.roomTemp ?? '', r.flourTemp ?? '',
        pv, r.confirmedWaterTemp ?? '',
        r.doughTemp1 ?? '', r.doughTemp2 ?? '',
        r.note,
      ].join(',');
    });
    const csv = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dough-water-temp-today-records-${getTodayString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [todayRecords, yesterdayBaseline]);

  const handleLoadTestData = useCallback(() => {
    const today = getTodayString();
    const now = isoNow();
    const baseline: YesterdayBaseline = {
      batchNo: 18, flourTemp: 23.3, confirmedWaterTemp: 14.0,
      doughTemp1: 26.8, doughTemp2: null,
      note: '테스트 기준값', updatedAt: now,
    };
    const todayRecord: DoughRecord = {
      id: generateId(), date: today, batchNo: 1,
      roomTemp: null, flourTemp: 23.7, predictedWaterTemp: null,
      confirmedWaterTemp: null, doughTemp1: null, doughTemp2: null,
      note: '테스트 현재 회차', createdAt: now, updatedAt: now,
    };

    if (storageMode === 'supabase') {
      setIsSaving(true);
      Promise.all([
        upsertYesterdayBaseline(baseline, WORKSPACE_ID),
        createTodayRecord(todayRecord, WORKSPACE_ID),
      ])
        .then(() => Promise.all([reloadTodayFromDb(), reloadBaselineFromDb()]))
        .then(() => showToast('테스트 데이터가 입력되었습니다. 오늘 1회차 예측값이 13.8°C인지 확인하세요.'))
        .catch((e) => {
          console.error('테스트 데이터 입력 실패:', e);
          setDbError(e instanceof Error ? e.message : '테스트 데이터 입력 실패');
        })
        .finally(() => setIsSaving(false));
    } else {
      persistBaseline(baseline);
      persistRecords([todayRecord]);
      showToast('테스트 데이터가 입력되었습니다. 오늘 1회차 예측값이 13.8°C인지 확인하세요.');
    }
  }, [storageMode, persistBaseline, persistRecords, showToast, reloadTodayFromDb, reloadBaselineFromDb]);

  const sortedRecords = useMemo(() => sortByCreatedAt(todayRecords), [todayRecords]);
  const today = getTodayString();

  return (
    <div className="app">

      {/* ── 헤더 ── */}
      <header className="app-header">
        <h1 className="app-title">반죽 물온도 계산기</h1>
        <div className="header-meta">
          <span className="meta-chip">📅 {today}</span>
          <span className="meta-chip highlight">목표 반죽 온도 {TARGET_DOUGH_TEMP.toFixed(1)}°C 고정</span>
          {storageMode === 'supabase' && (
            <span className="meta-chip chip-supabase">☁ 공유 DB 사용 중</span>
          )}
          {storageMode === 'local' && (
            <span className="meta-chip chip-local">📱 이 기기 저장 사용 중</span>
          )}
        </div>
        <p className="app-desc">
          1회차는 어제 기준값, 2회차부터는 직전 회차 기준으로 계산합니다.
        </p>
      </header>

      {/* ── 로딩 / 저장 중 / DB 에러 표시 ── */}
      {isLoading && (
        <div className="db-status-bar db-loading" role="status">불러오는 중…</div>
      )}
      {!isLoading && isSaving && (
        <div className="db-status-bar db-saving" role="status">저장 중…</div>
      )}
      {!isLoading && !isSaving && dbError && (
        <div className="db-status-bar db-error" role="alert">
          <span>DB 오류: {dbError}</span>
          <button className="db-error-close" onClick={() => setDbError(null)} aria-label="에러 닫기">✕</button>
        </div>
      )}

      {/* ── 어제 기준값 테이블 ── */}
      <section className="section table-section">
        <YesterdayBaselineTable
          baseline={yesterdayBaseline}
          onUpdate={persistBaseline}
          onClear={handleClearBaseline}
        />
      </section>

      {/* ── 다음 회차 계산 기준 카드 ── */}
      <section className="section">
        <NextBatchReferenceCard
          todayRecords={todayRecords}
          yesterdayBaseline={yesterdayBaseline}
        />
      </section>

      {/* ── 오늘 기록 테이블 ── */}
      <section className="section table-section">
        <div className="date-group">
          <div className="date-group-label today-label-row">오늘 기록 ({today})</div>

          {sortedRecords.length === 0 ? (
            <div className="empty-state">
              <p className="empty-title">아직 오늘 기록이 없습니다.</p>
              <p className="empty-desc">어제 마지막 회차 기준값을 입력한 뒤 오늘 1회차를 추가하세요.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="record-table">
                <TableHeader />
                <tbody>
                  {sortedRecords.map((r) => (
                    <RecordRow
                      key={r.id}
                      record={r}
                      todayRecords={todayRecords}
                      yesterdayBaseline={yesterdayBaseline}
                      onUpdate={updateRecord}
                      onDelete={deleteRecord}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* ── 버튼 그리드 (맨 아래) ── */}
      <section className="section bottom-btn-section">
        <div className="btn-grid">
          <button
            className="btn btn-primary btn-full"
            onClick={addBatch}
            disabled={isSaving || isLoading}
            aria-label="새 회차 추가"
          >
            {isSaving ? '저장 중…' : '＋ 새 회차 추가'}
          </button>
          <button className="btn btn-test" onClick={handleLoadTestData} disabled={isSaving || isLoading}>테스트 데이터</button>
          <button className="btn btn-secondary" onClick={handleExportCSV} disabled={isLoading}>CSV 내보내기</button>
          <button className="btn btn-danger" onClick={handleClearToday} disabled={isSaving || isLoading}>오늘 기록 초기화</button>
        </div>
      </section>

      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}

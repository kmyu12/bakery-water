/**
 * src/db.ts
 * Supabase DB 접근 함수 모음.
 *
 * - App.tsx가 직접 Supabase 쿼리를 갖지 않도록 분리한다.
 * - 모든 함수는 app 내부 타입(camelCase) ↔ DB row(snake_case) 변환을 처리한다.
 * - Supabase가 미설정 상태이면 SupabaseNotConfiguredError를 throw한다.
 *   호출부(App.tsx)에서 catch 후 localStorage fallback으로 처리한다.
 */

import { supabase } from './supabaseClient';
import type { DoughRecord, YesterdayBaseline } from './types';

// ── 상수 ──────────────────────────────────────────────────────────────────

export const WORKSPACE_ID = 'default';

// ── 에러 타입 ──────────────────────────────────────────────────────────────

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super('Supabase가 설정되지 않았습니다. .env 파일에 VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 입력하세요.');
    this.name = 'SupabaseNotConfiguredError';
  }
}

function requireSupabase() {
  if (!supabase) throw new SupabaseNotConfiguredError();
  return supabase;
}

// ── DB Row 타입 (snake_case) ───────────────────────────────────────────────

interface TodayRecordRow {
  id: string;
  workspace_id: string;
  work_date: string;
  batch_no: number;
  flour_temp: number | null;
  confirmed_water_temp: number | null;
  dough_temp1: number | null;
  dough_temp2: number | null;
  note: string;
  created_at: string;
  updated_at: string;
}

interface YesterdayBaselineRow {
  id: string;
  workspace_id: string;
  batch_no: number | null;
  flour_temp: number | null;
  confirmed_water_temp: number | null;
  dough_temp1: number | null;
  dough_temp2: number | null;
  note: string;
  updated_at: string;
}

// ── 변환 함수: DB row → App 타입 ──────────────────────────────────────────

function rowToRecord(row: TodayRecordRow): DoughRecord {
  return {
    id:                   row.id,
    date:                 row.work_date,
    batchNo:              row.batch_no,
    roomTemp:             null,               // DB에 없는 필드, null로 유지
    flourTemp:            row.flour_temp,
    predictedWaterTemp:   null,               // DB 미저장, 화면에서 재계산
    confirmedWaterTemp:   row.confirmed_water_temp,
    doughTemp1:           row.dough_temp1,
    doughTemp2:           row.dough_temp2,
    note:                 row.note,
    createdAt:            row.created_at,
    updatedAt:            row.updated_at,
  };
}

function rowToBaseline(row: YesterdayBaselineRow): YesterdayBaseline {
  return {
    batchNo:            row.batch_no,
    flourTemp:          row.flour_temp,
    confirmedWaterTemp: row.confirmed_water_temp,
    doughTemp1:         row.dough_temp1,
    doughTemp2:         row.dough_temp2,
    note:               row.note,
    updatedAt:          row.updated_at,
  };
}

// ── 변환 함수: App 타입 → DB insert payload ───────────────────────────────

/**
 * DoughRecord → DB insert payload.
 * id는 Supabase가 생성하도록 제외한다.
 * predictedWaterTemp·roomTemp는 DB 컬럼이 없으므로 제외한다.
 */
function recordToInsertPayload(
  record: DoughRecord,
  workspaceId: string
): Omit<TodayRecordRow, 'id' | 'updated_at'> {
  return {
    workspace_id:         workspaceId,
    work_date:            record.date,
    batch_no:             record.batchNo,
    flour_temp:           record.flourTemp,
    confirmed_water_temp: record.confirmedWaterTemp,
    dough_temp1:          record.doughTemp1,
    dough_temp2:          record.doughTemp2,
    note:                 record.note,
    created_at:           record.createdAt,
  };
}

/**
 * DoughRecord의 수정 가능한 필드 부분 → DB update payload (snake_case).
 * created_at·workspace_id·work_date·batch_no는 업데이트하지 않는다.
 * App.tsx에서 import해서 사용할 수 있도록 export한다.
 */
export type RecordPatch = Partial<Pick<DoughRecord,
  'flourTemp' | 'confirmedWaterTemp' | 'doughTemp1' | 'doughTemp2' | 'note'
>>;

function patchToDbPayload(patch: RecordPatch): Partial<TodayRecordRow> {
  const result: Partial<TodayRecordRow> = {};
  if (patch.flourTemp           !== undefined) result.flour_temp           = patch.flourTemp;
  if (patch.confirmedWaterTemp  !== undefined) result.confirmed_water_temp = patch.confirmedWaterTemp;
  if (patch.doughTemp1          !== undefined) result.dough_temp1          = patch.doughTemp1;
  if (patch.doughTemp2          !== undefined) result.dough_temp2          = patch.doughTemp2;
  if (patch.note                !== undefined) result.note                 = patch.note;
  return result;
}

// ════════════════════════════════════════════════════════════════
// today_records 함수
// ════════════════════════════════════════════════════════════════

/**
 * 특정 날짜의 오늘 회차 기록 전체를 조회한다.
 * 반환 배열은 created_at 오름차순(회차 순서) 정렬이다.
 */
export async function fetchTodayRecords(
  workspaceId = WORKSPACE_ID,
  workDate: string
): Promise<DoughRecord[]> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('today_records')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('work_date', workDate)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`fetchTodayRecords 실패: ${error.message}`);
  return (data as TodayRecordRow[]).map(rowToRecord);
}

/**
 * 새 회차 기록을 DB에 삽입한다.
 * id는 Supabase가 생성한 UUID를 반환값으로 받아 사용한다.
 * App 상태에서는 반환된 record.id로 이후 update/delete를 수행해야 한다.
 */
export async function createTodayRecord(
  record: DoughRecord,
  workspaceId = WORKSPACE_ID
): Promise<DoughRecord> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('today_records')
    .insert(recordToInsertPayload(record, workspaceId))
    .select()
    .single();

  if (error) throw new Error(`createTodayRecord 실패: ${error.message}`);
  return rowToRecord(data as TodayRecordRow);
}

/**
 * 회차 기록의 필드를 부분 수정한다.
 * id는 Supabase가 반환한 UUID를 사용해야 한다.
 * updated_at은 DB 트리거가 자동 갱신하므로 전달하지 않는다.
 */
export async function updateTodayRecord(
  id: string,
  patch: RecordPatch
): Promise<void> {
  const sb = requireSupabase();

  const { error } = await sb
    .from('today_records')
    .update(patchToDbPayload(patch))
    .eq('id', id);

  if (error) throw new Error(`updateTodayRecord 실패: ${error.message}`);
}

/**
 * 특정 회차 기록 1건을 삭제한다.
 */
export async function deleteTodayRecord(id: string): Promise<void> {
  const sb = requireSupabase();

  const { error } = await sb
    .from('today_records')
    .delete()
    .eq('id', id);

  if (error) throw new Error(`deleteTodayRecord 실패: ${error.message}`);
}

/**
 * 특정 날짜의 오늘 기록 전체를 삭제한다.
 * "오늘 기록 초기화" 버튼에 사용한다.
 */
export async function deleteTodayRecordsByDate(
  workspaceId = WORKSPACE_ID,
  workDate: string
): Promise<void> {
  const sb = requireSupabase();

  const { error } = await sb
    .from('today_records')
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('work_date', workDate);

  if (error) throw new Error(`deleteTodayRecordsByDate 실패: ${error.message}`);
}

// ════════════════════════════════════════════════════════════════
// yesterday_baseline 함수
// ════════════════════════════════════════════════════════════════

/**
 * 어제 기준값을 조회한다.
 * 행이 없으면 null을 반환한다.
 */
export async function fetchYesterdayBaseline(
  workspaceId = WORKSPACE_ID
): Promise<YesterdayBaseline | null> {
  const sb = requireSupabase();

  const { data, error } = await sb
    .from('yesterday_baseline')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (error) throw new Error(`fetchYesterdayBaseline 실패: ${error.message}`);
  if (!data) return null;
  return rowToBaseline(data as YesterdayBaselineRow);
}

/**
 * 어제 기준값을 저장(없으면 insert, 있으면 update)한다.
 * workspace_id unique 제약을 이용해 upsert한다.
 */
export async function upsertYesterdayBaseline(
  baseline: YesterdayBaseline,
  workspaceId = WORKSPACE_ID
): Promise<void> {
  const sb = requireSupabase();

  const payload = {
    workspace_id:         workspaceId,
    batch_no:             baseline.batchNo,
    flour_temp:           baseline.flourTemp,
    confirmed_water_temp: baseline.confirmedWaterTemp,
    dough_temp1:          baseline.doughTemp1,
    dough_temp2:          baseline.doughTemp2,
    note:                 baseline.note,
    // updated_at는 DB 트리거가 자동 갱신
  };

  const { error } = await sb
    .from('yesterday_baseline')
    .upsert(payload, { onConflict: 'workspace_id' });

  if (error) throw new Error(`upsertYesterdayBaseline 실패: ${error.message}`);
}

/**
 * 어제 기준값을 삭제한다.
 * "어제 기준값 초기화" 버튼에 사용한다.
 */
export async function deleteYesterdayBaseline(
  workspaceId = WORKSPACE_ID
): Promise<void> {
  const sb = requireSupabase();

  const { error } = await sb
    .from('yesterday_baseline')
    .delete()
    .eq('workspace_id', workspaceId);

  if (error) throw new Error(`deleteYesterdayBaseline 실패: ${error.message}`);
}

// ════════════════════════════════════════════════════════════════
// cleanup 함수
// ════════════════════════════════════════════════════════════════

/**
 * 한국 기준 오늘 날짜보다 이전인 today_records를 삭제한다.
 * 앱 시작 시 호출해서 DB 용량을 최소로 유지한다.
 *
 * 호출 순서 (App.tsx 연결 시):
 *   1. cleanupOldTodayRecords('default')   ← 오래된 행 정리
 *   2. fetchTodayRecords('default', 오늘날짜) ← 오늘 데이터 로드
 *
 * Supabase DB 함수 cleanup_old_today_records(target_workspace_id)를
 * RPC로 호출한다. 삭제 기준은 DB 서버 측에서 KST 기준으로 계산한다.
 */
export async function cleanupOldTodayRecords(
  workspaceId = WORKSPACE_ID
): Promise<void> {
  const sb = requireSupabase();

  const { error } = await sb.rpc('cleanup_old_today_records', {
    target_workspace_id: workspaceId,
  });

  if (error) throw new Error(`cleanupOldTodayRecords 실패: ${error.message}`);
}

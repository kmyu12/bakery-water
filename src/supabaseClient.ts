/**
 * Supabase 클라이언트 초기화
 *
 * 이 앱은 로그인 없이 같은 링크를 공유하는 공개 작업판입니다.
 * anon role에 select/insert/update/delete 권한을 부여한 상태로 운영합니다.
 * 링크를 아는 누구나 데이터를 읽고 수정할 수 있습니다.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl  = import.meta.env.VITE_SUPABASE_URL  as string | undefined;
const supabaseKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const isConfigured = Boolean(supabaseUrl && supabaseKey);

/**
 * Supabase 클라이언트 인스턴스.
 * 환경변수가 설정되지 않은 경우 null.
 * DB 기능 사용 전에 반드시 null 체크를 해야 합니다.
 */
export const supabase: SupabaseClient | null = isConfigured
  ? createClient(supabaseUrl!, supabaseKey!)
  : null;

/**
 * Supabase가 정상적으로 초기화되었는지 확인합니다.
 * false이면 DB 연결 없이 localStorage 전용으로 동작합니다.
 */
export const isSupabaseEnabled = isConfigured;

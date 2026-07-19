-- 기존 accounts 테이블에 아이디별 입력·출력 토큰 누적 필드를 추가합니다.
alter table public.accounts
  add column if not exists total_input_tokens bigint not null default 0,
  add column if not exists total_output_tokens bigint not null default 0,
  add column if not exists total_tokens bigint not null default 0;

alter table public.accounts
  drop constraint if exists accounts_total_input_tokens_check,
  drop constraint if exists accounts_total_output_tokens_check,
  drop constraint if exists accounts_total_tokens_check;

alter table public.accounts
  add constraint accounts_total_input_tokens_check check (total_input_tokens >= 0),
  add constraint accounts_total_output_tokens_check check (total_output_tokens >= 0),
  add constraint accounts_total_tokens_check check (total_tokens >= 0);

notify pgrst, 'reload schema';

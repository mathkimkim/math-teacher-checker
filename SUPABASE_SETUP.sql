create extension if not exists pgcrypto;

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  login_id text unique not null,
  password_hash text not null,
  limit_count integer not null default 0 check (limit_count >= 0),
  used_count integer not null default 0 check (used_count >= 0),
  total_input_tokens bigint not null default 0 check (total_input_tokens >= 0),
  total_output_tokens bigint not null default 0 check (total_output_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);


-- 기존에 accounts 테이블을 만든 사용자도 입력·출력·전체 토큰 누적 필드를 추가할 수 있도록 합니다.
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

create table if not exists public.account_sessions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  token_hash text unique not null,
  is_admin boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;
alter table public.account_sessions enable row level security;

-- 브라우저에서는 두 테이블에 직접 접근하지 않습니다.
-- 모든 접근은 Netlify Functions의 service_role 키를 통해서만 수행합니다.
revoke all on public.accounts from anon, authenticated;
revoke all on public.account_sessions from anon, authenticated;

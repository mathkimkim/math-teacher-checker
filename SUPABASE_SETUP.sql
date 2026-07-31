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

-- 학생 접속코드·제출 사진·상세분석
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  student_name text not null,
  access_code_hash text unique not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists students_account_idx on public.students(account_id, student_name);

create table if not exists public.student_sessions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  token_hash text unique not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.student_submissions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  record_id text not null,
  image_path text not null,
  file_name text not null,
  analysis_result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '3 days'),
  unique(account_id, record_id)
);
create index if not exists student_submissions_lookup on public.student_submissions(account_id, student_id, created_at desc);

insert into storage.buckets (id, name, public)
values ('student-submissions', 'student-submissions', false)
on conflict (id) do update set public=false;

alter table public.students enable row level security;
alter table public.student_sessions enable row level security;
alter table public.student_submissions enable row level security;
revoke all on public.students from anon, authenticated;
revoke all on public.student_sessions from anon, authenticated;
revoke all on public.student_submissions from anon, authenticated;
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

-- 학생 이름으로 저장되는 분석 기록. 화면에서 판정을 수정하면 같은 record_id가 갱신됩니다.
create table if not exists public.student_analysis_records (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  record_id text not null,
  student_name text not null,
  student_name_key text not null,
  total_count integer not null default 0,
  correct_count integer not null default 0,
  incorrect_count integer not null default 0,
  review_count integer not null default 0,
  calculation_errors integer not null default 0,
  concept_errors integer not null default 0,
  analyzed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, record_id)
);

create index if not exists student_analysis_weekly_lookup
  on public.student_analysis_records (account_id, student_name_key, analyzed_at desc);

alter table public.student_analysis_records enable row level security;
revoke all on public.student_analysis_records from anon, authenticated;
alter table public.student_analysis_records drop column if exists logic_errors;
notify pgrst, 'reload schema';

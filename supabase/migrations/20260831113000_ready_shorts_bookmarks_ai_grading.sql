-- Shorts review state and persisted-before-inference AI grading requests.

create table if not exists public.ready_question_bookmarks (
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  question_id uuid not null references public.ready_questions(id) on delete restrict,
  source text not null default 'manual' check (source in ('manual', 'wrong_answer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (student_id, exam_id, question_id)
);

create index if not exists ready_question_bookmarks_review_idx
  on public.ready_question_bookmarks(student_id, exam_id, updated_at desc);

create table if not exists public.ready_ai_grading_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  question_id uuid not null references public.ready_questions(id) on delete restrict,
  response jsonb not null,
  rubric_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed')),
  result jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ready_ai_grading_requests_student_idx
  on public.ready_ai_grading_requests(student_id, created_at desc);

alter table public.ready_question_bookmarks enable row level security;
alter table public.ready_ai_grading_requests enable row level security;
revoke all on public.ready_question_bookmarks, public.ready_ai_grading_requests from anon, authenticated;
grant all on public.ready_question_bookmarks, public.ready_ai_grading_requests to service_role;

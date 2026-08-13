-- OC-PLANTAR-01 DM3: persist heel cup width on corrections.
-- Additive, non-null default 0 — existing rows and selects unaffected.

alter table public.corrections
  add column if not exists "heelCupWidthMm" double precision
  not null default 0;

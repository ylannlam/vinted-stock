-- Compte délié de YlaVint : l'extension l'ignore et ses données YlaVint sont effacées.
alter table public.publication_accounts add column if not exists ylavint_unlinked_at timestamptz;

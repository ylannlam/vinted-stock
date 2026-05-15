-- ============================================================
-- STOCK VINTED — Setup Supabase
-- Coller ce SQL dans Supabase > SQL Editor > Run
-- ============================================================

-- 1. Table principale
CREATE TABLE IF NOT EXISTS public.items (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  category     TEXT        NOT NULL,
  size         TEXT        NOT NULL CHECK (size IN ('XS','S','M','L','XL','XXL')),
  photo_url    TEXT        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'en_stock' CHECK (status IN ('en_stock','vendu')),
  bordereau_url TEXT
);

-- 2. Row Level Security (accès réservé aux utilisateurs connectés)
ALTER TABLE public.items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users — full access"
  ON public.items
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Buckets de stockage
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('photos',     'photos',     true, 10485760,  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif']),
  ('bordereaux', 'bordereaux', true, 20971520,  ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- 4. Policies storage — photos
CREATE POLICY "Authenticated upload photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'photos');

CREATE POLICY "Public read photos"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'photos');

CREATE POLICY "Authenticated delete photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'photos');

-- 5. Policies storage — bordereaux
CREATE POLICY "Authenticated upload bordereaux"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'bordereaux');

CREATE POLICY "Public read bordereaux"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'bordereaux');

CREATE POLICY "Authenticated delete bordereaux"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'bordereaux');

-- ============================================================
-- MIGRATION v2 — Nouveaux statuts + colonne sent_at
-- Exécuter dans Supabase > SQL Editor si la table existe déjà
-- ============================================================

-- Mettre à jour le CHECK pour accepter les 3 statuts
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE public.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('en_stock', 'vendu', 'envoye'));

-- Ajouter la colonne date d'envoi
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;

-- ============================================================
-- MIGRATION v3 — Colonne lien Shein
-- ============================================================
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS shein_url TEXT;

-- ============================================================
-- MIGRATION v5 — Statut "à recevoir" + photo optionnelle
-- ============================================================
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_status_check;
ALTER TABLE public.items ADD CONSTRAINT items_status_check
  CHECK (status IN ('en_stock', 'vendu', 'envoye', 'a_recevoir'));

ALTER TABLE public.items ALTER COLUMN photo_url DROP NOT NULL;

-- ============================================================
-- MIGRATION v6 — Marqueur "à récupérer" sur articles vendus
-- ============================================================
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS reception_needed BOOLEAN DEFAULT false;

-- ============================================================
-- MIGRATION v7 — Date de vente
-- ============================================================
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS sold_at TIMESTAMPTZ;

-- ============================================================
-- MIGRATION v8 — Table comptes Vinted (admin)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vinted_accounts (
  id                UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  pseudo            TEXT        NOT NULL,
  email             TEXT,
  password          TEXT,
  methode_connexion TEXT        CHECK (methode_connexion IN ('google', 'apple', 'email')),
  telephone         TEXT,
  telephone_type    TEXT        CHECK (telephone_type IN ('onoff', 'autre')),
  telephone_email   TEXT,
  statut            TEXT        DEFAULT 'actif' CHECK (statut IN ('actif', 'banni_temp', 'banni_def', 'suspendu')),
  notes             TEXT,
  deban_at          TIMESTAMPTZ,
  ads_power_num     TEXT
);

ALTER TABLE public.vinted_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Authenticated users can manage accounts"
  ON public.vinted_accounts FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- Colonnes ajoutées progressivement (idempotentes)
ALTER TABLE public.vinted_accounts ADD COLUMN IF NOT EXISTS deban_at     TIMESTAMPTZ;
ALTER TABLE public.vinted_accounts ADD COLUMN IF NOT EXISTS ads_power_num TEXT;

-- ============================================================
-- MIGRATION v4 — Renommage catégorie Vert-Noir-Bleu
-- Les anciens articles "Vert-Noir-Bleu" passent dans le nouveau
-- groupe. Reassigner manuellement ceux qui sont purement "Vert".
-- ============================================================
UPDATE public.items
SET category = 'Vert foncé / Bleu foncé / Noir'
WHERE category = 'Vert-Noir-Bleu';

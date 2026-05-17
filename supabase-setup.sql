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

-- ============================================================
-- MIGRATION v9 — Système multi-utilisateurs avec rôles
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  pseudo TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('employe', 'stock', 'admin')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lien_shein TEXT NOT NULL,
  categorie TEXT NOT NULL,
  taille TEXT,
  statut TEXT NOT NULL DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'image_faite', 'importe_dotb')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE work_items ENABLE ROW LEVEL SECURITY;

-- profiles RLS
DROP POLICY IF EXISTS "profiles_read_authenticated" ON profiles;
CREATE POLICY "profiles_read_authenticated" ON profiles
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "profiles_admin_write" ON profiles;
CREATE POLICY "profiles_admin_write" ON profiles
  FOR ALL USING (get_my_role() = 'admin');

-- work_items RLS
DROP POLICY IF EXISTS "work_items_own_or_admin" ON work_items;
CREATE POLICY "work_items_own_or_admin" ON work_items
  FOR ALL USING (auth.uid() = employe_id OR get_my_role() = 'admin');

-- Update items table to require stock/admin role
DROP POLICY IF EXISTS "Authenticated users can do everything" ON items;
DROP POLICY IF EXISTS "Allow all for authenticated" ON items;
DROP POLICY IF EXISTS "Authenticated users — full access" ON items;
CREATE POLICY "items_stock_admin" ON items
  FOR ALL USING (get_my_role() IN ('stock', 'admin'));

-- Update vinted_accounts to require admin role
DROP POLICY IF EXISTS "Authenticated users can do everything" ON vinted_accounts;
DROP POLICY IF EXISTS "Allow all for authenticated" ON vinted_accounts;
DROP POLICY IF EXISTS "Authenticated users can manage accounts" ON vinted_accounts;
CREATE POLICY "vinted_accounts_admin" ON vinted_accounts
  FOR ALL USING (get_my_role() = 'admin');

-- Bootstrap: insert admin profile for existing auth user
-- Run this separately with your user ID:
-- INSERT INTO profiles (id, pseudo, email, role)
-- SELECT id, 'Admin', email, 'admin' FROM auth.users LIMIT 1
-- ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- MIGRATION v10 — Améliorations espace employé
-- ============================================================

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS admin_status TEXT DEFAULT 'en_attente' CHECK (admin_status IN ('en_attente', 'valide', 'refuse'));
ALTER TABLE profiles    ADD COLUMN IF NOT EXISTS note_admin TEXT;

-- ============================================================
-- MIGRATION v11 — Fonds, tâches, images articles
-- ============================================================

CREATE TABLE IF NOT EXISTS fonds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom TEXT NOT NULL,
  image_url TEXT NOT NULL,
  compte_vinted_pseudo TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE fonds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fonds_read_authenticated" ON fonds;
CREATE POLICY "fonds_read_authenticated" ON fonds
  FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "fonds_admin_write" ON fonds;
CREATE POLICY "fonds_admin_write" ON fonds
  FOR ALL USING (get_my_role() = 'admin');

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employe_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  lien_shein TEXT NOT NULL,
  fond_id UUID REFERENCES fonds(id) ON DELETE SET NULL,
  message TEXT,
  statut TEXT NOT NULL DEFAULT 'assignee' CHECK (statut IN ('assignee', 'en_cours', 'termine')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tasks_own_or_admin" ON tasks;
CREATE POLICY "tasks_own_or_admin" ON tasks
  FOR ALL USING (auth.uid() = employe_id OR get_my_role() = 'admin');

ALTER TABLE work_items ADD COLUMN IF NOT EXISTS fond_id UUID REFERENCES fonds(id) ON DELETE SET NULL;
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS prix_shein NUMERIC(10,2);
ALTER TABLE work_items ADD COLUMN IF NOT EXISTS images_urls TEXT[] DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public) VALUES ('fonds', 'fonds', true) ON CONFLICT DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('work_images', 'work_images', true) ON CONFLICT DO NOTHING;

DROP POLICY IF EXISTS "fonds_upload_admin" ON storage.objects;
CREATE POLICY "fonds_upload_admin" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'fonds' AND get_my_role() = 'admin');
DROP POLICY IF EXISTS "fonds_read_public" ON storage.objects;
CREATE POLICY "fonds_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'fonds');
DROP POLICY IF EXISTS "fonds_delete_admin" ON storage.objects;
CREATE POLICY "fonds_delete_admin" ON storage.objects
  FOR DELETE USING (bucket_id = 'fonds' AND get_my_role() = 'admin');

DROP POLICY IF EXISTS "work_images_upload_auth" ON storage.objects;
CREATE POLICY "work_images_upload_auth" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'work_images' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "work_images_read_public" ON storage.objects;
CREATE POLICY "work_images_read_public" ON storage.objects
  FOR SELECT USING (bucket_id = 'work_images');
DROP POLICY IF EXISTS "work_images_delete_auth" ON storage.objects;
CREATE POLICY "work_images_delete_auth" ON storage.objects
  FOR DELETE USING (bucket_id = 'work_images' AND auth.role() = 'authenticated');

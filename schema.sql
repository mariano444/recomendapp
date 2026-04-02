-- ═══════════════════════════════════════════════════════════════
--  APLAUSO — Supabase Schema
--  Ejecutar en: Supabase Dashboard > SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ─── ENUM TYPES ───────────────────────────────────────────────
CREATE TYPE payment_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled', 'in_process', 'refunded');
CREATE TYPE payment_method AS ENUM ('mercadopago', 'card', 'transfer', 'cash');
CREATE TYPE plan_type AS ENUM ('free', 'pro');
CREATE TYPE gallery_visibility AS ENUM ('public', 'private');
CREATE TYPE media_unlock_status AS ENUM ('pending', 'approved', 'rejected', 'cancelled');
CREATE TYPE media_kind AS ENUM ('image', 'video', 'pdf', 'file');

-- ─── TABLA: profiles ──────────────────────────────────────────
-- Extiende auth.users de Supabase Auth
CREATE TABLE IF NOT EXISTS profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  apellido      TEXT NOT NULL DEFAULT '',
  slug          TEXT UNIQUE NOT NULL,           -- ej: marcela-andres
  role          TEXT NOT NULL DEFAULT '',
  city          TEXT NOT NULL DEFAULT '',
  locality      TEXT NOT NULL DEFAULT '',
  telefono      TEXT,
  bio           TEXT NOT NULL DEFAULT '',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  avatar_url    TEXT,
  cover_url     TEXT,
  share_title   TEXT,
  share_subtitle TEXT,
  share_description TEXT,
  share_image_mode TEXT NOT NULL DEFAULT 'cover',
  review_prompt_suggestions TEXT[] NOT NULL DEFAULT ARRAY[
    'Me hizo sentir en confianza desde el primer momento.',
    'Fue muy claro/a, profesional y atento/a en todo el proceso.',
    'Lo que más valoro es la dedicación y el seguimiento.',
    'Lo/la volvería a elegir y recomendaría sin dudas.'
  ],
  plan          plan_type NOT NULL DEFAULT 'free',
  mp_alias      TEXT,                           -- alias CBU/CVU para recibir pagos
  mp_cbu        TEXT,                           -- CBU para transferencias
  allow_anon    BOOLEAN NOT NULL DEFAULT TRUE,
  min_amount    INTEGER NOT NULL DEFAULT 0,     -- 0 = sin mínimo
  verified      BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  total_earned  BIGINT NOT NULL DEFAULT 0,      -- centavos ARS
  review_count  INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profiles_share_image_mode_check'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_share_image_mode_check
      CHECK (share_image_mode IN ('cover', 'avatar', 'none'));
  END IF;
END $$;

-- Generar slug automático en base a nombre/apellido
CREATE OR REPLACE FUNCTION generate_slug(nombre TEXT, apellido TEXT)
RETURNS TEXT AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  base_slug := lower(
    regexp_replace(
      unaccent(nombre || '-' || apellido),
      '[^a-z0-9-]', '-', 'g'
    )
  );
  base_slug := regexp_replace(base_slug, '-+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  final_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM profiles WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := base_slug || '-' || counter;
  END LOOP;
  RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ─── TABLA: reviews ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reviewer_nombre TEXT,
  reviewer_email  TEXT,
  reviewer_phone  TEXT,
  reviewer_province TEXT,
  reviewer_locality TEXT,
  reviewer_avatar_url TEXT,
  review_image_url TEXT,
  is_anon         BOOLEAN NOT NULL DEFAULT FALSE,
  message         TEXT NOT NULL,
  amount_cents    BIGINT NOT NULL DEFAULT 0,   -- centavos ARS
  payment_method  payment_method NOT NULL DEFAULT 'mercadopago',
  payment_status  payment_status NOT NULL DEFAULT 'pending',
  mp_payment_id   TEXT,                        -- ID de pago de MercadoPago
  mp_preference_id TEXT,                       -- ID de preferencia MP
  reply           TEXT,
  replied_at      TIMESTAMPTZ,
  published       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER reviews_updated_at
  BEFORE UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- Índices
CREATE INDEX idx_reviews_profile_id ON reviews(profile_id);
CREATE INDEX idx_reviews_payment_status ON reviews(payment_status);
CREATE INDEX idx_reviews_mp_payment_id ON reviews(mp_payment_id);
CREATE INDEX idx_reviews_published ON reviews(published) WHERE published = TRUE;
CREATE INDEX idx_reviews_created_at ON reviews(created_at DESC);

-- ─── TABLA: mp_preferences ────────────────────────────────────
-- Registro de preferencias de pago de MercadoPago
CREATE TABLE IF NOT EXISTS mp_preferences (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  review_id      UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  preference_id  TEXT NOT NULL UNIQUE,
  init_point     TEXT NOT NULL,              -- URL de pago sandbox
  sandbox_init_point TEXT,                  -- URL de pago producción
  amount_cents   BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'created',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mp_preferences_review_id ON mp_preferences(review_id);
CREATE INDEX idx_mp_preferences_preference_id ON mp_preferences(preference_id);

-- ─── TABLA: mp_notifications ──────────────────────────────────
-- Webhooks de MercadoPago (IPN/Webhooks)
CREATE TABLE IF NOT EXISTS mp_notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mp_id        TEXT,
  topic        TEXT,
  resource     TEXT,
  raw_body     JSONB,
  processed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mp_notifications_mp_id ON mp_notifications(mp_id);
CREATE INDEX idx_mp_notifications_processed ON mp_notifications(processed);

-- ─── TABLA: profile_payment_credentials ──────────────────────
-- Credenciales privadas por perfil para cobrar reseñas con MercadoPago
CREATE TABLE IF NOT EXISTS profile_payment_credentials (
  profile_id       UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL DEFAULT 'mercadopago',
  mp_public_key    TEXT,
  mp_access_token  TEXT NOT NULL,
  mp_mode          TEXT NOT NULL DEFAULT 'production',
  mp_checkout_label TEXT NOT NULL DEFAULT 'Recomendapp',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_payment_credentials_provider_check CHECK (provider = 'mercadopago'),
  CONSTRAINT profile_payment_credentials_mode_check CHECK (mp_mode IN ('sandbox', 'production'))
);

CREATE TRIGGER profile_payment_credentials_updated_at
  BEFORE UPDATE ON profile_payment_credentials
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- ─── TABLA: analytics_events ──────────────────────────────────
CREATE TABLE IF NOT EXISTS analytics_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event_type   TEXT NOT NULL,     -- 'profile_view', 'form_open', 'payment_started', etc.
  metadata     JSONB,
  ip_hash      TEXT,              -- hash de IP para deduplicar
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_analytics_profile_id ON analytics_events(profile_id);
CREATE INDEX idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at DESC);

-- ─── TABLA: profile_reward_items ─────────────────────────────
CREATE TABLE IF NOT EXISTS profile_reward_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  download_url  TEXT,
  show_in_form  BOOLEAN NOT NULL DEFAULT FALSE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profile_reward_items_updated_at
  BEFORE UPDATE ON profile_reward_items
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX idx_profile_reward_items_profile_id ON profile_reward_items(profile_id);
CREATE INDEX idx_profile_reward_items_active ON profile_reward_items(active);

-- ─── TABLA: profile_media_items ──────────────────────────────
CREATE TABLE IF NOT EXISTS profile_media_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  description      TEXT NOT NULL DEFAULT '',
  preview_url      TEXT,
  download_url     TEXT,
  media_kind       media_kind NOT NULL DEFAULT 'image',
  allow_download   BOOLEAN NOT NULL DEFAULT TRUE,
  price_cents      BIGINT NOT NULL DEFAULT 0,
  is_combo         BOOLEAN NOT NULL DEFAULT FALSE,
  visibility       gallery_visibility NOT NULL DEFAULT 'public',
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profile_media_items_updated_at
  BEFORE UPDATE ON profile_media_items
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX idx_profile_media_items_profile_id ON profile_media_items(profile_id);
CREATE INDEX idx_profile_media_items_visibility ON profile_media_items(visibility);

-- ─── TABLA: media_unlocks ────────────────────────────────────
CREATE TABLE IF NOT EXISTS media_unlocks (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  media_item_id   UUID NOT NULL REFERENCES profile_media_items(id) ON DELETE CASCADE,
  profile_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  payment_status  media_unlock_status NOT NULL DEFAULT 'pending',
  mp_payment_id   TEXT,
  mp_preference_id TEXT,
  amount_cents    BIGINT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER media_unlocks_updated_at
  BEFORE UPDATE ON media_unlocks
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX idx_media_unlocks_media_item_id ON media_unlocks(media_item_id);
CREATE INDEX idx_media_unlocks_payment_status ON media_unlocks(payment_status);

-- ─── TABLA: profile_gallery_items ────────────────────────────
CREATE TABLE IF NOT EXISTS profile_gallery_items (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  price_cents   BIGINT NOT NULL DEFAULT 0,
  is_combo      BOOLEAN NOT NULL DEFAULT FALSE,
  visibility    gallery_visibility NOT NULL DEFAULT 'public',
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER profile_gallery_items_updated_at
  BEFORE UPDATE ON profile_gallery_items
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

CREATE INDEX idx_profile_gallery_items_profile_id ON profile_gallery_items(profile_id);
CREATE INDEX idx_profile_gallery_items_visibility ON profile_gallery_items(visibility);

-- ─── VISTAS ───────────────────────────────────────────────────
-- Vista: estadísticas de perfil (últimos 30 días)
CREATE OR REPLACE VIEW profile_stats_30d AS
SELECT
  p.id,
  p.slug,
  p.nombre || ' ' || p.apellido AS full_name,
  p.total_earned,
  p.review_count,
  COUNT(r.id) FILTER (WHERE r.created_at > NOW() - INTERVAL '30 days' AND r.published) AS reviews_30d,
  COALESCE(SUM(r.amount_cents) FILTER (WHERE r.created_at > NOW() - INTERVAL '30 days' AND r.published), 0) AS earned_30d,
  COUNT(r.id) FILTER (WHERE r.reply IS NULL AND r.published) AS pending_replies,
  COUNT(ae.id) FILTER (WHERE ae.event_type = 'profile_view' AND ae.created_at > NOW() - INTERVAL '30 days') AS views_30d
FROM profiles p
LEFT JOIN reviews r ON r.profile_id = p.id AND r.payment_status = 'approved'
LEFT JOIN analytics_events ae ON ae.profile_id = p.id
GROUP BY p.id;

-- ─── FUNCIONES ────────────────────────────────────────────────

-- Función: publicar reseña cuando el pago es aprobado
CREATE OR REPLACE FUNCTION publish_review_on_payment(p_mp_payment_id TEXT, p_status TEXT)
RETURNS VOID AS $$
DECLARE
  v_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO v_review FROM reviews WHERE mp_payment_id = p_mp_payment_id;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE reviews
  SET payment_status = p_status::payment_status,
      published = (p_status = 'approved'),
      updated_at = NOW()
  WHERE id = v_review.id;

  IF p_status = 'approved' THEN
    UPDATE profiles
    SET total_earned = total_earned + v_review.amount_cents,
        review_count = review_count + 1,
        updated_at = NOW()
    WHERE id = v_review.profile_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ─── ROW LEVEL SECURITY (RLS) ─────────────────────────────────
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE mp_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_payment_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_reward_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_media_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_unlocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_gallery_items ENABLE ROW LEVEL SECURITY;

-- profiles: lectura pública de perfiles activos
CREATE POLICY "public_read_profiles"
  ON profiles FOR SELECT
  USING (active = TRUE);

-- profiles: solo el dueño puede editar su perfil
CREATE POLICY "owner_update_profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- reviews: cualquiera puede leer reseñas publicadas
CREATE POLICY "public_read_reviews"
  ON reviews FOR SELECT
  USING (published = TRUE AND payment_status = 'approved');

-- reviews: el dueño del perfil puede leer todas sus reseñas
CREATE POLICY "owner_read_own_reviews"
  ON reviews FOR SELECT
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE id = auth.uid()
    )
  );

-- reviews: inserción pública (cualquiera puede crear una reseña)
CREATE POLICY "public_insert_reviews"
  ON reviews FOR INSERT
  WITH CHECK (TRUE);

-- reviews: el dueño del perfil puede responder
CREATE POLICY "owner_reply_reviews"
  ON reviews FOR UPDATE
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE id = auth.uid()
    )
  )
  WITH CHECK (
    profile_id IN (
      SELECT id FROM profiles WHERE id = auth.uid()
    )
  );

-- analytics: inserción pública
CREATE POLICY "public_insert_analytics"
  ON analytics_events FOR INSERT
  WITH CHECK (TRUE);

-- analytics: solo el dueño puede leer sus eventos
CREATE POLICY "owner_read_analytics"
  ON analytics_events FOR SELECT
  USING (
    profile_id IN (
      SELECT id FROM profiles WHERE id = auth.uid()
    )
  );

-- mp_preferences: inserción/lectura por service_role (Edge Functions)
CREATE POLICY "service_manage_preferences"
  ON mp_preferences FOR ALL
  USING (auth.role() = 'service_role');

-- mp_notifications: solo service_role
CREATE POLICY "service_manage_notifications"
  ON mp_notifications FOR ALL
  USING (auth.role() = 'service_role');

-- credenciales privadas: solo el dueño y service_role
CREATE POLICY "owner_read_payment_credentials"
  ON profile_payment_credentials FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "owner_insert_payment_credentials"
  ON profile_payment_credentials FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_update_payment_credentials"
  ON profile_payment_credentials FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "service_manage_payment_credentials"
  ON profile_payment_credentials FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "public_read_reward_items"
  ON profile_reward_items FOR SELECT
  USING (active = TRUE);

CREATE POLICY "owner_read_reward_items"
  ON profile_reward_items FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "owner_insert_reward_items"
  ON profile_reward_items FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_update_reward_items"
  ON profile_reward_items FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_delete_reward_items"
  ON profile_reward_items FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "public_read_media_items"
  ON profile_media_items FOR SELECT
  USING (active = TRUE);

CREATE POLICY "owner_read_media_items"
  ON profile_media_items FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "owner_insert_media_items"
  ON profile_media_items FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_update_media_items"
  ON profile_media_items FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_delete_media_items"
  ON profile_media_items FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "owner_read_media_unlocks"
  ON media_unlocks FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "service_manage_media_unlocks"
  ON media_unlocks FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "public_read_gallery_items"
  ON profile_gallery_items FOR SELECT
  USING (visibility = 'public');

CREATE POLICY "owner_read_gallery_items"
  ON profile_gallery_items FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

CREATE POLICY "owner_insert_gallery_items"
  ON profile_gallery_items FOR INSERT
  TO authenticated
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_update_gallery_items"
  ON profile_gallery_items FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "owner_delete_gallery_items"
  ON profile_gallery_items FOR DELETE
  TO authenticated
  USING (profile_id = auth.uid());

-- ─── TRIGGER: nuevo usuario → crear perfil ────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_nombre  TEXT;
  v_apellido TEXT;
  v_slug    TEXT;
BEGIN
  v_nombre  := COALESCE(NEW.raw_user_meta_data->>'nombre', split_part(NEW.email, '@', 1));
  v_apellido := COALESCE(NEW.raw_user_meta_data->>'apellido', '');
  v_slug    := generate_slug(v_nombre, v_apellido);

  INSERT INTO profiles (id, nombre, apellido, slug, role, city, locality)
  VALUES (
    NEW.id,
    v_nombre,
    v_apellido,
    v_slug,
    COALESCE(NEW.raw_user_meta_data->>'role', ''),
    COALESCE(NEW.raw_user_meta_data->>'city', ''),
    COALESCE(NEW.raw_user_meta_data->>'locality', '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── SEED: datos de ejemplo (opcional) ───────────────────────
-- Descomenta para tener datos de prueba en desarrollo
/*
INSERT INTO profiles (id, nombre, apellido, slug, role, city, bio, tags, verified, total_earned, review_count)
VALUES
  (uuid_generate_v4(), 'Marcela', 'Andrés', 'marcela-andres', 'Psicóloga clínica', 'Buenos Aires', 'Acompañamiento terapéutico especializado.', ARRAY['TCC','Sistémico','Adultos'], TRUE, 14250000, 38),
  (uuid_generate_v4(), 'Rodrigo', 'García', 'rodrigo-garcia', 'Entrenador personal', 'CABA', 'Transformá tu cuerpo y tu mente.', ARRAY['Fitness','Nutrición'], TRUE, 8900000, 24);
*/

-- ═══════════════════════════════════════════════════════════════
-- Fin del schema. 
-- Próximos pasos:
-- 1. Crear Edge Function: supabase/functions/mp-create-preference/
-- 2. Crear Edge Function: supabase/functions/mp-webhook/
-- 3. Configurar secrets en Supabase Dashboard
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON profiles TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON reviews TO anon, authenticated;
GRANT SELECT, INSERT ON analytics_events TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON profile_payment_credentials TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON profile_gallery_items TO authenticated;
GRANT ALL ON mp_preferences TO service_role;
GRANT ALL ON mp_notifications TO service_role;
GRANT ALL ON profile_payment_credentials TO service_role;

CREATE OR REPLACE FUNCTION publish_review_payment(
  p_review_id UUID,
  p_status TEXT,
  p_mp_payment_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  v_review reviews%ROWTYPE;
BEGIN
  SELECT * INTO v_review FROM reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  UPDATE reviews
  SET mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
      payment_status = p_status::payment_status,
      published = (p_status = 'approved'),
      updated_at = NOW()
  WHERE id = p_review_id;

  IF p_status = 'approved' AND v_review.payment_status IS DISTINCT FROM 'approved' THEN
    UPDATE profiles
    SET total_earned = total_earned + v_review.amount_cents,
        review_count = review_count + 1,
        updated_at = NOW()
    WHERE id = v_review.profile_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION publish_review_payment(UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION mark_media_unlock_paid(
  p_unlock_id UUID,
  p_status TEXT,
  p_mp_payment_id TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  UPDATE media_unlocks
  SET payment_status = p_status::media_unlock_status,
      mp_payment_id = COALESCE(p_mp_payment_id, mp_payment_id),
      updated_at = NOW()
  WHERE id = p_unlock_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION mark_media_unlock_paid(UUID, TEXT, TEXT) TO service_role;
-- ═══════════════════════════════════════════════════════════════

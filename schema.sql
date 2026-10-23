-- ============================================================
-- Wedding Invitation Platform — Supabase Schema
-- Run this in Supabase > SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- INVITATIONS
-- ────────────────────────────────────────────────────────────
CREATE TABLE invitations (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  slug            TEXT UNIQUE NOT NULL,          -- URL identifier, e.g. "mohammad-layla-2026"

  -- Couple
  groom_name_en   TEXT NOT NULL,
  groom_name_ar   TEXT NOT NULL,
  groom_family_en TEXT,
  groom_family_ar TEXT,
  bride_name_en   TEXT NOT NULL,
  bride_name_ar   TEXT NOT NULL,
  bride_family_en TEXT,
  bride_family_ar TEXT,

  -- Display settings
  theme           TEXT DEFAULT 'midnight-gold',  -- future: multiple themes
  language        TEXT DEFAULT 'ar-en',          -- 'ar-en' | 'en' | 'ar'

  -- Contact / sharing
  contact_phone   TEXT,
  contact_email   TEXT,
  share_text      TEXT,

  -- RSVP settings
  rsvp_deadline   DATE,
  rsvp_enabled    BOOLEAN DEFAULT TRUE,
  max_guests_per_rsvp INTEGER DEFAULT 6,

  -- Media & customization
  music_url                TEXT,
  bg_photo_url             TEXT,
  dress_code_colors        JSONB,          -- [{hex, name}]
  timeline_items           JSONB,          -- [{time, label, descAr}]
  invite_message_template  TEXT,

  -- Meta
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- EVENTS  (one invitation can have multiple events)
-- ────────────────────────────────────────────────────────────
CREATE TABLE events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invitation_id   UUID REFERENCES invitations(id) ON DELETE CASCADE,

  event_type      TEXT NOT NULL,                 -- 'ceremony' | 'reception' | 'henna' | 'other'
  sort_order      INTEGER DEFAULT 0,

  -- Names (bilingual)
  name_en         TEXT NOT NULL,
  name_ar         TEXT,
  badge_en        TEXT,                          -- e.g. "Nikah Ceremony", "Walima Reception"

  -- Dates
  date_gregorian  TIMESTAMPTZ NOT NULL,
  duration_hours  DECIMAL(4,1) DEFAULT 3.0,
  date_hijri_str  TEXT,                          -- display string, e.g. "١٢ جمادى الآخرة ١٤٤٨"

  -- Venue
  venue_name_en   TEXT,
  venue_name_ar   TEXT,
  venue_address   TEXT,
  venue_lat       DECIMAL(10,7),
  venue_lng       DECIMAL(10,7),
  venue_gmaps_url TEXT,
  venue_apple_url TEXT,
  venue_waze_url  TEXT,

  -- Details
  dress_code_en   TEXT,
  notes_en        TEXT,
  notes_ar        TEXT,

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- RSVPS
-- ────────────────────────────────────────────────────────────
CREATE TABLE rsvps (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invitation_id   UUID REFERENCES invitations(id) ON DELETE CASCADE,

  guest_name      TEXT NOT NULL,
  attending       BOOLEAN NOT NULL,
  guest_count     INTEGER DEFAULT 1,
  message         TEXT,
  phone           TEXT,

  -- Meta
  ip_address      INET,
  user_agent      TEXT,
  submitted_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- ANALYTICS  (page views, click tracking)
-- ────────────────────────────────────────────────────────────
CREATE TABLE analytics_events (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invitation_id   UUID REFERENCES invitations(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,                 -- 'view' | 'rsvp' | 'calendar_add' | 'maps_open' | 'wa_share'
  event_data      JSONB,
  ip_address      INET,
  user_agent      TEXT,
  occurred_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- INDEXES
-- ────────────────────────────────────────────────────────────
CREATE INDEX idx_events_invitation   ON events(invitation_id, sort_order);
CREATE INDEX idx_rsvps_invitation    ON rsvps(invitation_id, submitted_at DESC);
CREATE INDEX idx_analytics_inv_type  ON analytics_events(invitation_id, event_type, occurred_at DESC);

-- ────────────────────────────────────────────────────────────
-- GUEST SENDS  (tracking personalized invites sent via WhatsApp)
-- ────────────────────────────────────────────────────────────
CREATE TABLE guest_sends (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  invitation_id   UUID REFERENCES invitations(id) ON DELETE CASCADE,
  guest_name      TEXT,
  guest_phone     TEXT NOT NULL,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  opened_at       TIMESTAMPTZ
);
CREATE INDEX idx_guest_sends_inv ON guest_sends(invitation_id, sent_at DESC);
CREATE POLICY "service_all_guest_sends" ON guest_sends FOR ALL USING (auth.role() = 'service_role');
ALTER TABLE guest_sends ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- RLS POLICIES  (Row Level Security)
-- ────────────────────────────────────────────────────────────
ALTER TABLE invitations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE rsvps             ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_events  ENABLE ROW LEVEL SECURITY;

-- Public: read active invitations + their events
CREATE POLICY "public_read_invitations" ON invitations
  FOR SELECT USING (is_active = TRUE);

CREATE POLICY "public_read_events" ON events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM invitations i WHERE i.id = invitation_id AND i.is_active)
  );

-- Public: insert RSVPs and analytics
CREATE POLICY "public_insert_rsvp" ON rsvps
  FOR INSERT WITH CHECK (TRUE);

CREATE POLICY "public_insert_analytics" ON analytics_events
  FOR INSERT WITH CHECK (TRUE);

-- Service role (admin backend): full access
CREATE POLICY "service_all_invitations"      ON invitations      FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_events"           ON events           FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_rsvps"            ON rsvps            FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "service_all_analytics"        ON analytics_events FOR ALL USING (auth.role() = 'service_role');

-- ────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invitations_updated_at
  BEFORE UPDATE ON invitations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ────────────────────────────────────────────────────────────
-- SAMPLE DATA  (remove in production)
-- ────────────────────────────────────────────────────────────
INSERT INTO invitations (slug, groom_name_en, groom_name_ar, groom_family_en, groom_family_ar,
                         bride_name_en, bride_name_ar, bride_family_en, bride_family_ar,
                         contact_phone, rsvp_deadline)
VALUES (
  'mohammad-layla-2026',
  'Mohammad Abdullah', 'محمد عبدالله', 'Al-Rashid', 'آل الراشد',
  'Layla Khalid',      'ليلى خالد',   'Al-Mutairi','آل المطيري',
  '+966500000000', '2026-11-01'
);

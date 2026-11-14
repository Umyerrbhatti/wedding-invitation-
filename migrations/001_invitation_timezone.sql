-- Adds the fixed per-invitation timezone. Run once in Supabase > SQL Editor.
-- Existing invitations start at 'UTC' (their current behaviour); set the real
-- zone in Admin > Edit Invitation and event times keep their wall-clock value.
ALTER TABLE invitations
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

/**
 * Wedding Invitation Platform — Express Server
 *
 * Routes:
 *   GET  /invite/:slug              → serve the invitation page
 *   GET  /api/invitation/:slug      → invitation JSON (for client-side hydration)
 *   POST /api/rsvp                  → submit RSVP
 *   GET  /api/admin/invitations     → list all (admin only)
 *   GET  /api/admin/rsvps/:slug     → list RSVPs for one invitation (admin only)
 *   PUT  /api/admin/invitation/:id  → update invitation details (admin only)
 *   POST /api/admin/invitation      → create new invitation (admin only)
 *   POST /api/admin/login           → get JWT token
 *   GET  /api/admin/stats/:slug     → summary stats (admin only)
 *   POST /api/track                 → analytics event (public)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from '@supabase/supabase-js';
import { SignJWT, jwtVerify } from 'jose';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const ROOT  = path.join(__dir, '..');

// ─── Supabase clients ─────────────────────────────────────────
const supabasePublic  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseService = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ─── JWT secret ───────────────────────────────────────────────
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// ─── App setup ────────────────────────────────────────────────
const app = express();

app.use(helmet({ contentSecurityPolicy: false }));   // CSP handled per route
app.use(cors({ origin: process.env.BASE_URL || '*' }));
app.use(express.json({ limit: '32kb' }));
app.use(express.static(path.join(ROOT, 'public')));

// ─── Rate limiters ────────────────────────────────────────────
const rsvpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,  message: 'Too many RSVPs from this IP.' });
const apiLimiter  = rateLimit({ windowMs: 60 * 1000,       max: 60, message: 'Too many requests.' });

app.use('/api/', apiLimiter);
app.use('/api/rsvp', rsvpLimiter);

// ─── Helpers ─────────────────────────────────────────────────
async function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    await jwtVerify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────

/** Serve the invitation HTML page, hydrated with invitation data */
app.get('/invite/:slug', async (req, res) => {
  const { slug } = req.params;
  const guestName = req.query.guest || req.query.name || '';

  const { data: inv, error } = await supabasePublic
    .from('invitations')
    .select('*, events(*)')
    .eq('slug', slug)
    .eq('is_active', true)
    .order('sort_order', { referencedTable: 'events' })
    .single();

  if (error || !inv) return res.status(404).send('<h1>Invitation not found</h1>');

  // Inject wedding data into the HTML template
  let html = readFileSync(path.join(ROOT, 'public', 'invitation.html'), 'utf8');
  const config = buildConfig(inv, guestName);
  html = html.replace('/* WEDDING_CONFIG_PLACEHOLDER */', `var W = ${JSON.stringify(config)};`);

  // Track page view (fire-and-forget)
  supabaseService.from('analytics_events').insert({
    invitation_id: inv.id,
    event_type: 'view',
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  }).then(() => {});

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

/** Invitation JSON (client-side hydration / SPA) */
app.get('/api/invitation/:slug', async (req, res) => {
  const { data, error } = await supabasePublic
    .from('invitations')
    .select('*, events(*)')
    .eq('slug', req.params.slug)
    .eq('is_active', true)
    .order('sort_order', { referencedTable: 'events' })
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json(buildConfig(data));
});

/** Submit RSVP */
app.post('/api/rsvp', async (req, res) => {
  const { slug, name, attending, guestCount, message } = req.body;

  if (!slug || !name || typeof attending !== 'boolean') {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const { data: inv } = await supabasePublic
    .from('invitations').select('id, rsvp_enabled, rsvp_deadline').eq('slug', slug).single();

  if (!inv)                return res.status(404).json({ error: 'Invitation not found' });
  if (!inv.rsvp_enabled)   return res.status(403).json({ error: 'RSVP is closed' });
  if (inv.rsvp_deadline && new Date(inv.rsvp_deadline) < new Date()) {
    return res.status(403).json({ error: 'RSVP deadline has passed' });
  }

  const { error } = await supabaseService.from('rsvps').insert({
    invitation_id: inv.id,
    guest_name:    name.trim().slice(0, 120),
    attending,
    guest_count:   attending ? Math.min(parseInt(guestCount) || 1, 6) : 0,
    message:       message?.trim().slice(0, 500) || null,
    ip_address:    req.ip,
    user_agent:    req.headers['user-agent'],
  });

  if (error) return res.status(500).json({ error: 'Failed to save RSVP' });

  // Track event
  supabaseService.from('analytics_events').insert({
    invitation_id: inv.id,
    event_type: 'rsvp',
    event_data: { attending },
    ip_address: req.ip,
  }).then(() => {});

  res.json({ ok: true, message: 'RSVP confirmed' });
});

/** Analytics tracking (calendar clicks, maps opens, WhatsApp shares) */
app.post('/api/track', async (req, res) => {
  const { invitationId, eventType, eventData } = req.body;
  const allowed = ['calendar_add', 'maps_open', 'wa_share', 'view'];
  if (!invitationId || !allowed.includes(eventType)) return res.json({ ok: true }); // silent discard

  supabaseService.from('analytics_events').insert({
    invitation_id: invitationId,
    event_type: eventType,
    event_data: eventData || {},
    ip_address: req.ip,
    user_agent: req.headers['user-agent'],
  }).then(() => {});

  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────
// ADMIN ROUTES
// ─────────────────────────────────────────────────────────────

/** Admin login → returns JWT */
app.post('/api/admin/login', async (req, res) => {
  const { password } = req.body;

  if (!password) return res.status(400).json({ error: 'Password required' });

  // Compare against ADMIN_PASSWORD_HASH (bcrypt in production)
  // For simplicity here we compare directly — replace with bcrypt.compare in production
  if (password !== process.env.ADMIN_PLAIN_PASSWORD) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = await new SignJWT({ role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(JWT_SECRET);

  res.json({ token, expiresIn: '8h' });
});

/** List all invitations */
app.get('/api/admin/invitations', requireAdmin, async (_req, res) => {
  const { data, error } = await supabaseService
    .from('invitations')
    .select('id, slug, groom_name_en, bride_name_en, is_active, rsvp_deadline, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

/** Get RSVPs for an invitation */
app.get('/api/admin/rsvps/:slug', requireAdmin, async (req, res) => {
  const { data: inv } = await supabaseService.from('invitations').select('id').eq('slug', req.params.slug).single();
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const { data, error } = await supabaseService
    .from('rsvps')
    .select('*')
    .eq('invitation_id', inv.id)
    .order('submitted_at', { ascending: false });

  if (error) return res.status(500).json({ error });
  res.json(data);
});

/** Stats summary for an invitation */
app.get('/api/admin/stats/:slug', requireAdmin, async (req, res) => {
  const { data: inv } = await supabaseService.from('invitations').select('id').eq('slug', req.params.slug).single();
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const [rsvpRes, analyticsRes] = await Promise.all([
    supabaseService.from('rsvps').select('attending, guest_count').eq('invitation_id', inv.id),
    supabaseService.from('analytics_events')
      .select('event_type')
      .eq('invitation_id', inv.id),
  ]);

  const rsvps    = rsvpRes.data || [];
  const events   = analyticsRes.data || [];

  const totalRSVPs    = rsvps.length;
  const attending     = rsvps.filter(r => r.attending);
  const notAttending  = rsvps.filter(r => !r.attending);
  const totalSeats    = attending.reduce((n, r) => n + (r.guest_count || 1), 0);

  const views         = events.filter(e => e.event_type === 'view').length;
  const calAdds       = events.filter(e => e.event_type === 'calendar_add').length;
  const mapsOpens     = events.filter(e => e.event_type === 'maps_open').length;
  const waShares      = events.filter(e => e.event_type === 'wa_share').length;

  res.json({
    totalRSVPs, attending: attending.length, notAttending: notAttending.length,
    totalSeats, views, calAdds, mapsOpens, waShares,
    rsvpRate: views > 0 ? Math.round((totalRSVPs / views) * 100) : 0,
  });
});

/** Generate personalized WhatsApp invite link */
app.post('/api/admin/send-invite', requireAdmin, async (req, res) => {
  const { slug, guestName, guestPhone, messageTemplate } = req.body;
  if (!slug || !guestPhone) return res.status(400).json({ error: 'slug and guestPhone required' });

  const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const guestParam = guestName ? `?guest=${encodeURIComponent(guestName)}` : '';
  const inviteUrl = `${baseUrl}/invite/${slug}${guestParam}`;

  const template = messageTemplate ||
    `السلام عليكم ${guestName || ''},\n\nيسعدنا دعوتكم لحضور حفل زفافنا 🌹\n\n${inviteUrl}`;
  const waUrl = `https://wa.me/${guestPhone.replace(/\D/g,'')}?text=${encodeURIComponent(template)}`;

  // Log send (fire-and-forget, table may not exist yet)
  supabaseService.from('invitations').select('id').eq('slug', slug).single().then(({ data: inv }) => {
    if (inv?.id) {
      supabaseService.from('guest_sends').insert({
        invitation_id: inv.id,
        guest_name: guestName || null,
        guest_phone: guestPhone,
        sent_at: new Date().toISOString(),
      }).then(() => {});
    }
  });

  res.json({ ok: true, waUrl, inviteUrl });
});

/** Guest list CRUD */
app.get('/api/admin/invitations/:slug/guests', requireAdmin, async (req, res) => {
  const { data: inv } = await supabaseService.from('invitations').select('id').eq('slug', req.params.slug).single();
  if (!inv) return res.status(404).json({ error: 'invitation not found' });
  const { data, error } = await supabaseService.from('guests').select('*').eq('invitation_id', inv.id).order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/admin/invitations/:slug/guests', requireAdmin, async (req, res) => {
  const { name, phone, notes, title, group_label, seats, table_no } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name required' });
  const { data: inv } = await supabaseService.from('invitations').select('id').eq('slug', req.params.slug).single();
  if (!inv) return res.status(404).json({ error: 'invitation not found' });
  const { data, error } = await supabaseService.from('guests').insert({
    invitation_id: inv.id,
    name: name.trim(),
    phone: phone?.trim() || null,
    notes: notes?.trim() || null,
    title: title?.trim() || null,
    group_label: group_label?.trim() || null,
    seats: seats ? parseInt(seats) : 1,
    table_no: table_no?.trim() || null,
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.patch('/api/admin/guests/:id', requireAdmin, async (req, res) => {
  const allowed = ['rsvp_status', 'table_no', 'notes', 'seats'];
  const updates = {};
  for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'nothing to update' });
  const { data, error } = await supabaseService.from('guests').update(updates).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.delete('/api/admin/guests/:id', requireAdmin, async (req, res) => {
  const { error } = await supabaseService.from('guests').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/** Update invitation details */
app.put('/api/admin/invitation/:id', requireAdmin, async (req, res) => {
  const allowed = [
    'groom_name_en','groom_name_ar','groom_family_en','groom_family_ar',
    'bride_name_en','bride_name_ar','bride_family_en','bride_family_ar',
    'contact_phone','contact_email','share_text','rsvp_deadline',
    'rsvp_enabled','max_guests_per_rsvp','is_active',
    'music_url','bg_photo_url','dress_code_colors','invite_message_template','rsvp_message','welcome_message',
    'timeline_items',
  ];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  const { data, error } = await supabaseService
    .from('invitations').update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error });
  res.json(data);
});

/** Update a single event */
app.put('/api/admin/event/:id', requireAdmin, async (req, res) => {
  const allowed = [
    'event_type','sort_order','name_en','name_ar','badge_en',
    'date_gregorian','duration_hours','date_hijri_str',
    'venue_name_en','venue_name_ar','venue_address',
    'venue_lat','venue_lng','venue_gmaps_url','venue_apple_url','venue_waze_url',
    'dress_code_en','notes_en','notes_ar',
  ];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );

  const { data, error } = await supabaseService
    .from('events').update(updates).eq('id', req.params.id).select().single();

  if (error) return res.status(500).json({ error });
  res.json(data);
});

/** Create a new event */
app.post('/api/admin/event', requireAdmin, async (req, res) => {
  const { invitation_id } = req.body;
  if (!invitation_id) return res.status(400).json({ error: 'invitation_id required' });

  // Find next sort_order
  const { data: existing } = await supabaseService
    .from('events').select('sort_order').eq('invitation_id', invitation_id).order('sort_order', { ascending: false }).limit(1);
  const nextSort = (existing?.[0]?.sort_order || 0) + 1;

  const { data, error } = await supabaseService.from('events').insert({
    invitation_id,
    sort_order:    nextSort,
    name_en:       'New Event',
    name_ar:       'حدث جديد',
    badge_en:      'Event',
    date_gregorian: new Date().toISOString(),
    duration_hours: 3,
  }).select().single();

  if (error) return res.status(500).json({ error });
  res.status(201).json(data);
});

/** Delete an event */
app.delete('/api/admin/event/:id', requireAdmin, async (req, res) => {
  const { error } = await supabaseService.from('events').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error });
  res.json({ ok: true });
});

/** Create a new invitation */
app.post('/api/admin/invitation', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseService
    .from('invitations').insert(req.body).select().single();

  if (error) return res.status(500).json({ error });
  res.status(201).json(data);
});

/** Full invitation details + events for admin edit form */
app.get('/api/admin/invitation-details/:slug', requireAdmin, async (req, res) => {
  const { data, error } = await supabaseService
    .from('invitations')
    .select('*, events(*)')
    .eq('slug', req.params.slug)
    .order('sort_order', { referencedTable: 'events' })
    .single();

  if (error || !data) return res.status(404).json({ error: 'Not found' });
  res.json(data);
});

/** Recent sends for an invitation */
app.get('/api/admin/sends/:slug', requireAdmin, async (req, res) => {
  const { data: inv } = await supabaseService
    .from('invitations').select('id').eq('slug', req.params.slug).single();
  if (!inv) return res.status(404).json({ error: 'Not found' });

  const { data, error } = await supabaseService
    .from('guest_sends')
    .select('*')
    .eq('invitation_id', inv.id)
    .order('sent_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error });
  res.json(data || []);
});

// ─────────────────────────────────────────────────────────────
// SERVE ADMIN SPA (for /admin/* routes)
// ─────────────────────────────────────────────────────────────
app.get('/admin', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(ROOT, 'public', 'admin.html'));
});

// ─────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Wedding platform running at http://localhost:${PORT}`);
  console.log(`Invitation: http://localhost:${PORT}/invite/mohammad-layla-2026`);
  console.log(`Admin:      http://localhost:${PORT}/admin`);
});

// ─────────────────────────────────────────────────────────────
// HELPER: map DB row → invitation config for the frontend
// ─────────────────────────────────────────────────────────────
function buildConfig(inv, guestName = '') {
  const events = (inv.events || []).map(e => ({
    type:         e.event_type,
    badgeEn:      e.badge_en  || e.name_en,
    nameAr:       e.name_ar   || e.name_en,
    nameEn:       e.name_en,
    hijri:        e.date_hijri_str || '',
    dateStr:      new Date(e.date_gregorian).toLocaleDateString('en-SA', { weekday:'long', year:'numeric', month:'long', day:'numeric' }),
    timeStr:      new Date(e.date_gregorian).toLocaleTimeString('en-SA', { hour:'2-digit', minute:'2-digit', hour12:false }),
    venueAr:      e.venue_name_ar || e.venue_name_en,
    venueEn:      e.venue_name_en,
    venueAddress: e.venue_address,
    iso:          e.date_gregorian,
    durationHours: parseFloat(e.duration_hours) || 3,
    googleMaps:   e.venue_gmaps_url || `https://maps.google.com/?q=${encodeURIComponent(e.venue_address || '')}`,
    appleMaps:    e.venue_apple_url || `https://maps.apple.com/?q=${encodeURIComponent(e.venue_address || '')}`,
  }));

  const first = inv.events?.[0];
  const venue = first ? {
    nameAr:    first.venue_name_ar || first.venue_name_en,
    nameEn:    first.venue_name_en,
    address:   first.venue_address,
    googleMaps: first.venue_gmaps_url || `https://maps.google.com/?q=${encodeURIComponent(first.venue_address||'')}`,
    appleMaps:  first.venue_apple_url || `https://maps.apple.com/?q=${encodeURIComponent(first.venue_address||'')}`,
    waze:       first.venue_waze_url  || `https://waze.com/ul?q=${encodeURIComponent(first.venue_address||'')}`,
  } : {};

  // Default dress code colors if not set
  const defaultColors = [
    {hex:'#D4AF37',name:'Gold'},{hex:'#F5F0E8',name:'Ivory'},
    {hex:'#8B4A4A',name:'Rose'},{hex:'#2C4A3E',name:'Forest'},{hex:'#1A1A2E',name:'Midnight'}
  ];

  return {
    id:              inv.id,
    groomAr:         inv.groom_name_ar,
    groomEn:         inv.groom_name_en,
    groomFamilyAr:   inv.groom_family_ar,
    groomFamilyEn:   inv.groom_family_en,
    brideAr:         inv.bride_name_ar,
    brideEn:         inv.bride_name_en,
    brideFamilyAr:   inv.bride_family_ar,
    brideFamilyEn:   inv.bride_family_en,
    contactPhone:    inv.contact_phone,
    rsvpDeadline:    inv.rsvp_deadline,
    rsvpEnabled:     inv.rsvp_enabled,
    shareText:       inv.share_text || `You're invited! 💍\n`,
    guestName:       guestName || null,
    musicUrl:        inv.music_url || null,
    bgPhotoUrl:      inv.bg_photo_url || null,
    dressCodeColors: inv.dress_code_colors || defaultColors,
    timeline:        inv.timeline_items || null,
    inviteMessageTemplate: inv.invite_message_template || null,
    rsvpMessage:           inv.rsvp_message || null,
    welcomeMessage:        inv.welcome_message || null,
    events,
    venue,
    countdownISO:    inv.events?.[0]?.date_gregorian || '',
  };
}

/**
 * Seed script — inserts a sample invitation + two events into Supabase.
 * Run: npm run seed
 *
 * Requires .env with SUPABASE_URL + SUPABASE_SERVICE_KEY.
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const slug = 'mohammad-layla-2026';

async function seed() {
  console.log('Seeding…');

  // Upsert invitation
  const { data: inv, error: invErr } = await supabase
    .from('invitations')
    .upsert({
      slug,
      groom_name_en:   'Mohammad Abdullah',
      groom_name_ar:   'محمد عبدالله',
      groom_family_en: 'Al-Rashid',
      groom_family_ar: 'آل الراشد',
      bride_name_en:   'Layla Khalid',
      bride_name_ar:   'ليلى خالد',
      bride_family_en: 'Al-Mutairi',
      bride_family_ar: 'آل المطيري',
      contact_phone:   '+966500000000',
      contact_email:   'wedding@family.com',
      rsvp_deadline:   '2026-11-01',
      rsvp_enabled:    true,
      max_guests_per_rsvp: 6,
      is_active:       true,
    }, { onConflict: 'slug' })
    .select()
    .single();

  if (invErr) { console.error('Invitation error:', invErr); process.exit(1); }
  console.log('✓ Invitation:', inv.id);

  // Delete existing events (clean slate)
  await supabase.from('events').delete().eq('invitation_id', inv.id);

  // Insert events
  const events = [
    {
      invitation_id:  inv.id,
      event_type:     'ceremony',
      sort_order:     0,
      name_en:        'Akad Nikah',
      name_ar:        'عقد القران',
      badge_en:       'Nikah Ceremony',
      date_gregorian: '2026-11-12T19:00:00',
      duration_hours: 3.5,
      date_hijri_str: '١٢ جمادى الآخرة ١٤٤٨ هـ',
      venue_name_en:  'Royal Wedding Hall',
      venue_name_ar:  'قاعة الأفراح الملكية',
      venue_address:  'King Fahd Road, Al Olaya, Riyadh',
      venue_gmaps_url:'https://maps.google.com/?q=Royal+Wedding+Hall+Riyadh',
      venue_apple_url:'https://maps.apple.com/?q=Royal+Wedding+Hall+Riyadh',
      venue_waze_url: 'https://waze.com/ul?q=Royal+Wedding+Hall+Riyadh',
      dress_code_en:  'Black Tie / Traditional Gulf',
    },
    {
      invitation_id:  inv.id,
      event_type:     'reception',
      sort_order:     1,
      name_en:        'Walima Reception',
      name_ar:        'وليمة العرس',
      badge_en:       'Walima Reception',
      date_gregorian: '2026-11-13T20:00:00',
      duration_hours: 4.0,
      date_hijri_str: '١٣ جمادى الآخرة ١٤٤٨ هـ',
      venue_name_en:  'Four Seasons Hotel Riyadh',
      venue_name_ar:  'فندق فور سيزونز الرياض',
      venue_address:  'Kingdom Tower, Al Olaya, Riyadh',
      venue_gmaps_url:'https://maps.google.com/?q=Four+Seasons+Riyadh',
      venue_apple_url:'https://maps.apple.com/?q=Four+Seasons+Riyadh',
      venue_waze_url: 'https://waze.com/ul?q=Four+Seasons+Riyadh',
      dress_code_en:  'Smart Casual / Traditional',
    },
  ];

  const { error: evErr } = await supabase.from('events').insert(events);
  if (evErr) { console.error('Events error:', evErr); process.exit(1); }
  console.log('✓ Events: 2 inserted');

  console.log(`\nDone! Visit: http://localhost:3000/invite/${slug}`);
  console.log(`Admin:       http://localhost:3000/admin`);
}

seed();

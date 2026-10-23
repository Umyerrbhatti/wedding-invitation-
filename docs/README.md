# Wedding Invitation Platform

Send a beautiful digital wedding invitation via WhatsApp. Guests open a link and see a full bilingual (Arabic + English) invitation. Manage everything from the admin dashboard.

## Features

- Bilingual invitation page (Arabic RTL + English)
- Hijri + Gregorian dates, Bismillah header
- Nikah + Walima event cards
- Add to Calendar (Google, Apple/iCal, Outlook)
- Maps deep links (Google Maps, Apple Maps, Waze)
- WhatsApp share with native `navigator.share()`
- Live countdown timer
- RSVP form with guest count
- Admin dashboard: edit names/dates/venues, view RSVPs, export CSV, share links
- Analytics: page views, calendar saves, map opens, WhatsApp shares

---

## Quick Start

### 1. Install

```bash
cd wedding-platform
npm install
```

### 2. Create Supabase project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. In **SQL Editor**, run the contents of `schema.sql`.
3. Copy your **Project URL**, **anon key**, and **service_role key** from Project Settings → API.

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_KEY=eyJ...
JWT_SECRET=generate-with-node-crypto-randomBytes-64-hex
ADMIN_PLAIN_PASSWORD=your-admin-password
PORT=3000
BASE_URL=https://your-domain.com
```

Generate a JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Seed sample data

```bash
npm run seed
```

### 5. Start the server

```bash
npm run dev       # development (auto-restart on file changes)
npm start         # production
```

### 6. Open

| URL | What it is |
|-----|-----------|
| `http://localhost:3000/invite/mohammad-layla-2026` | Guest invitation page |
| `http://localhost:3000/admin` | Admin dashboard |

---

## Customizing the Invitation

Edit invitation details via the **Admin Dashboard** (`/admin`) — names, dates, venues, RSVP settings — or directly via `npm run seed` for a fresh start.

### Update Placeholder Names

The invitation.html in `public/` uses a `/* WEDDING_CONFIG_PLACEHOLDER */` comment that the server replaces at request time with real data from the database. The fallback defaults are for direct static file access only.

---

## Project Structure

```
wedding-platform/
├── public/
│   ├── invitation.html   ← guest-facing invitation page
│   └── admin.html        ← admin dashboard SPA
├── server/
│   ├── index.js          ← Express server (API + HTML serving)
│   └── seed.js           ← Supabase seed script
├── schema.sql            ← Supabase DB schema + RLS policies
├── package.json
├── .env.example
└── docs/
    └── README.md
```

---

## API Reference

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET`  | `/invite/:slug` | — | Serve invitation HTML |
| `GET`  | `/api/invitation/:slug` | — | Invitation JSON |
| `POST` | `/api/rsvp` | — | Submit RSVP |
| `POST` | `/api/track` | — | Analytics event |
| `POST` | `/api/admin/login` | — | Get JWT token |
| `GET`  | `/api/admin/invitations` | JWT | List invitations |
| `GET`  | `/api/admin/rsvps/:slug` | JWT | List RSVPs |
| `GET`  | `/api/admin/stats/:slug` | JWT | Stats summary |
| `PUT`  | `/api/admin/invitation/:id` | JWT | Update invitation |
| `PUT`  | `/api/admin/event/:id` | JWT | Update event |
| `POST` | `/api/admin/invitation` | JWT | Create invitation |

---

## Deployment

### Deploy to Railway / Render / Fly.io

1. Push to GitHub.
2. Create a new service from the repo.
3. Set all `.env` variables in the service's environment settings.
4. Set start command: `node server/index.js`
5. Done — your invitation is live at `https://your-domain.com/invite/your-slug`.

### Custom domain

Point your domain's DNS to the deployed service. Update `BASE_URL` in environment variables to match.

---

## Security Notes

- The `SUPABASE_SERVICE_KEY` is **never** exposed to guests — it is only used server-side for admin routes and RSVP writes.
- The `SUPABASE_ANON_KEY` is used for public reads (invitation + events). Row Level Security (RLS) ensures guests can only read active invitations.
- Admin JWT tokens expire after 8 hours.
- RSVPs are rate-limited to 5 per IP per 15 minutes.

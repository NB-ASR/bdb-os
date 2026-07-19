# Put Vanita Stock online

The code is ready for a Vercel website backed by a dedicated Supabase project. No private database key belongs in this repository or in browser code.

## 1. Create the Supabase project

1. Create a new Supabase project for Vanita Beauty and Wellness Spa.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it once.
3. Open **Authentication > Users** and create the approved staff accounts. The app has no public sign-up screen.
4. Copy the project URL and the public anonymous/publishable key from the project settings.

The database policy only permits authenticated users to read or update the shared `vanita` record. Never use the Supabase `service_role` key in Vercel variables intended for this app.

## 2. Configure Vercel

Create a Vercel project from this folder and add these environment variables to Production and Preview:

- `SUPABASE_URL` - the Supabase project URL
- `SUPABASE_ANON_KEY` - the public anonymous/publishable key

Deploy the project. The `/api/config` function exposes only those public connection values to the browser. Database access remains protected by Supabase login and Row Level Security.

## 3. First sign-in

Open the Vercel address and sign in with a staff account created in Supabase. On the first successful sign-in, the Vanita sample inventory is copied into the shared database. From then on, every authorized device loads the same dataset.

## Important MVP limitation

The shared cloud record is appropriate for early client testing, but simultaneous edits use last-write-wins behavior. Before a larger multi-location rollout, stock movements should be stored as individual transactional database records. Invoice OCR is still a demonstration and needs a server-side document extraction provider.

-- Supabase local development loads this file before repository migrations.
-- Production already has citext 1.6 installed in the extensions schema, but the
-- earliest repository migrations assumed that platform prerequisite without
-- recording it. Mirror the existing production prerequisite locally so the
-- immutable applied migration history can be replayed without editing an old
-- production migration or adding an out-of-order migration version.
create extension if not exists citext with schema extensions;

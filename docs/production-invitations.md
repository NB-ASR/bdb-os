# BDB OS production invitations

## Purpose

This runbook keeps customer onboarding secure, branded and repeatable. Supabase remains responsible for one-time authentication tokens; BDB OS owns the customer experience and business membership records.

## Production URL configuration

In Supabase Dashboard, open **Authentication → URL Configuration**.

Set the Site URL to:

```text
https://bdb-os-b2-db.vercel.app
```

Add these redirect URLs:

```text
https://bdb-os-b2-db.vercel.app/auth/callback?next=/activate
https://bdb-os-b2-db.vercel.app/auth/callback?next=/change-password
```

Keep local development separate:

```text
http://localhost:3000/**
```

When the official application domain is launched, replace the Vercel production URL with the official BDB OS application domain in both Vercel and Supabase.

## Link lifetime

In **Authentication → Providers → Email**, set Email OTP Expiration to exactly:

```text
86400 seconds
```

The BDB membership record is also capped at one day by `20260718193500_invitation_expiry_guard.sql`. Do not display or promise a seven-day invitation. A resent invitation starts a new one-day window and the previous secure link must be treated as invalid.

The activation screen preflights the pending membership before changing the user's password. This prevents an already expired or missing invitation from changing Auth credentials before the database accepts the business membership.

## Leaked-password protection

Before a paying pilot, open **Authentication → Attack Protection** and enable leaked-password protection.

Acceptance check:

1. Attempt to choose a password known to appear in breach lists using a dedicated test account.
2. Confirm Supabase rejects it.
3. Confirm a unique password of at least 12 characters is accepted.
4. Record the test date in ClickUp Launch Readiness.

This hosted Auth setting is not controlled by repository migrations and must be verified after every new Supabase production project is created.

## Email templates

In **Authentication → Email Templates**:

- Set the Invite User subject to `Your BDB OS business account is ready`.
- Copy `supabase/templates/invite.html` into the Invite User template.
- Set the Magic Link subject to `Your secure BDB OS access link`.
- Copy `supabase/templates/magic_link.html` into the Magic Link template.

The application callback supports implicit hash sessions, PKCE codes and token-hash links. Expired or previously used links show a BDB OS error instead of a raw authentication error.

## Production email delivery

Before onboarding real customers, configure custom SMTP using a BDB-owned sending domain. Recommended sender:

```text
BDB OS Access <access@auth.bdb-os.com>
```

Required external setup:

1. Create the transactional email provider account.
2. Verify `auth.bdb-os.com` through DNS.
3. Add SPF, DKIM and DMARC records.
4. Enter the SMTP host, port, username and password in Supabase.
5. Disable link tracking for authentication emails.
6. Test Gmail, Outlook and a Microsoft 365 business inbox.

Never forward customer authentication links through a founder mailbox. The secure token must be delivered directly to the invited recipient.

## Acceptance test

1. Create a mock business from Founder Admin.
2. Confirm the email is BDB branded and addressed directly to the owner.
3. Open only the newest invitation.
4. Confirm the browser opens the production BDB OS domain, not localhost.
5. Confirm an expired invitation is rejected before a password change.
6. Create a password and activate the membership.
7. Enter the correct workspace.
8. Log out and sign back in with email and password.
9. Resend an invitation and verify the old link is rejected cleanly.

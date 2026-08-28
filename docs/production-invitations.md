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

In **Authentication → Providers → Email**, keep Email OTP Expiration aligned with BDB OS at exactly:

```text
3600 seconds
```

Supabase uses the Email OTP Expiration value for invitation links, magic links and recovery links. BDB OS currently follows the hosted default of one hour. The application and `20260718193500_invitation_expiry_guard.sql` both cap membership invitations at the same one-hour lifetime.

Do not display or promise a seven-day invitation. A resent invitation starts a new one-hour window and the previous secure link must be treated as invalid.

The activation screen preflights the pending membership before changing the user's password. Missing, unexpired-without-a-timestamp, unavailable-workspace and expired invitations must fail closed.

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

Production currently falls back to Supabase's built-in Auth email sender. Supabase documents that this service is for trial use, only sends to project-team addresses, and defaults to two messages per hour. The observed Production `over_email_send_rate_limit` responses are therefore an infrastructure finding, not an application retry problem.

Custom SMTP is a launch requirement before onboarding real customers. Configure it in the Production Supabase project under **Project Settings → Authentication → SMTP Settings** using a BDB-owned sending domain. Recommended sender:

```text
BDB OS Access <access@auth.bdb-os.com>
```

Required external setup:

1. Create the transactional email provider account (for example Resend, Postmark, SendGrid or AWS SES).
2. Verify `auth.bdb-os.com` through DNS.
3. Add SPF, DKIM and DMARC records.
4. Enter the provider SMTP host, port, username, password, sender email and sender name in the Production Supabase project.
5. Store credentials only in the provider and Supabase project configuration. Do not commit them or mirror them into client-side environment variables.
6. Disable link tracking for authentication emails.
7. After custom SMTP is active, set an appropriate Auth email rate limit in **Authentication → Rate Limits** based on provider capacity and expected onboarding volume.
8. Test Gmail, Outlook and a Microsoft 365 business inbox.

Acceptance evidence must include a sent Owner invitation, a sent additional-user invitation, a resend after the application cooldown, and clear Founder Admin state for sent, pending, expired and failed delivery. BDB OS must continue treating SMTP/provider failures as recoverable invitation failures even after custom SMTP is enabled.

Never forward customer authentication links through a founder mailbox. The secure token must be delivered directly to the invited recipient.

## Acceptance test

1. Create a mock business from Founder Admin.
2. Confirm the email is BDB branded and addressed directly to the owner.
3. Open only the newest invitation within one hour.
4. Confirm the browser opens the production BDB OS domain, not localhost.
5. Confirm a missing or expired invitation is rejected before a password change.
6. Create a password and activate the membership.
7. Enter the correct workspace.
8. Log out and sign back in with email and password.
9. Resend an invitation and verify the old link is rejected cleanly.

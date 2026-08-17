# Custom Business Branding

## Decision

BDB OS may sell **Custom Business Branding** as a workspace-level add-on.

The add-on allows a client company logo to appear beside that business's identity inside BDB OS. BDB OS remains the product brand; this is not full white-labelling.

Founder Admin owns the commercial entitlement and the stored logo. Client workspace users do not upload, replace, enable, disable or remove this asset themselves.

## Business problem

Some clients value a more personalised operating environment and are willing to pay for it. BDB OS needs a controlled way to provide that personalisation without creating separate builds, themes, domains or customer-specific applications.

## Ownership

Founder Admin owns:

- enabling or disabling the `custom_branding` entitlement;
- uploading the client logo;
- replacing the client logo;
- removing the client logo;
- the audit evidence for those actions.

The Workspace remains the record the branding belongs to.

Workspace Settings continues to own normal business details and user-facing accessibility preferences, but it does not own the commercial company-logo entitlement.

## Data and storage

The existing `workspace_themes.client_logo_path` field remains the canonical logo reference.

Logo bytes remain in the existing private `workspace-assets` Storage bucket under the workspace-owned branding path:

`{workspace_id}/branding/{generated-file-name}`

No second branding table, storage bucket or client-specific application is introduced.

## Entitlement

`custom_branding` is a feature entitlement disabled by default for normal plans.

Founder Admin may create a workspace-specific override when the client purchases the add-on.

The logo is displayed only when:

1. the workspace has a saved logo path; and
2. the effective `custom_branding` entitlement is enabled.

Disabling the entitlement hides the logo but retains the private asset. This allows the add-on to be re-enabled without asking the client to provide the asset again.

`Remove` clears the canonical path and deletes the private object.

## Upload rules

Version 1 accepts:

- PNG;
- JPG/JPEG;
- WebP.

Maximum file size: 2 MB.

SVG is deliberately excluded from this commercial upload path to reduce unnecessary active-content and sanitisation risk.

## Security boundary

Founder branding routes require the existing MFA-protected platform-admin identity.

The trusted `set_workspace_logo` database function is hardened so an ordinary workspace Owner or Manager cannot use the old workspace Settings path to change the logo.

The Founder branding API uses the service-role client only after `requirePlatformAdmin()` succeeds.

All Founder branding changes create platform audit evidence.

## Client experience

BDB OS branding stays visible in the application navigation.

When the add-on is enabled, the client logo appears with the business identity in the workspace header. When it is disabled or no logo exists, BDB OS shows a restrained business-initial fallback.

This avoids confusing Custom Business Branding with full white-labelling.

## Offline behaviour

Branding is configuration, not an operational record.

Uploading, replacing, removing or changing the entitlement is online-only Founder administration. A logo that was already loaded may remain available through normal browser/application caching, but branding changes do not require an offline mutation queue.

## Version 1 scope

Included:

- Founder-only entitlement control;
- upload;
- replace;
- enable/disable;
- remove;
- workspace-header display;
- audit evidence.

Deferred:

- custom domains;
- customer-controlled colours;
- login-page white-labelling;
- branded system emails;
- per-client application builds;
- customer-controlled logo upload;
- full white-label contracts.

## Future implication

A future full white-label product must be designed as a separate commercial and security decision. It must not evolve accidentally from this small logo add-on.

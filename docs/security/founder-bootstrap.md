# Founder bootstrap control

## Decision

Founder privileges are never granted, restored or reactivated during normal login. They are created only through the dedicated bootstrap endpoint while an explicit one-time environment gate is enabled.

## Required controls

The route `POST /api/admin/bootstrap-founders` requires all of the following:

- `BDB_FOUNDER_BOOTSTRAP_ENABLED=true`
- `FOUNDER_BOOTSTRAP_SECRET` with at least 32 characters
- A matching bearer control value supplied by the authorised operator
- `FOUNDER_INITIAL_PASSWORD` with at least 16 characters and different from the bootstrap control
- `BDB_FOUNDER_EMAILS`
- `BDB_FOUNDER_NAMES`

By default, the route refuses to run when any platform-admin record already exists. `BDB_FOUNDER_BOOTSTRAP_ALLOW_EXISTING=true` is an emergency-only override and requires founder review before use.

## First installation procedure

1. Configure the founder emails and names.
2. Generate separate high-entropy values for the bootstrap control and temporary password.
3. Enable the bootstrap gate only for the installation window.
4. Call the endpoint once over HTTPS from a trusted machine.
5. Confirm all founders can change the temporary password and enrol MFA.
6. Confirm Founder Admin requires AAL2.
7. Set `BDB_FOUNDER_BOOTSTRAP_ENABLED=false`.
8. Remove `FOUNDER_INITIAL_PASSWORD` from the deployment environment.
9. Rotate or remove `FOUNDER_BOOTSTRAP_SECRET`.
10. Record completion in ClickUp Launch Readiness.

Never paste these values into ClickUp, GitHub, chat messages or screenshots.

## Recovery

A suspended or removed Founder must not be restored by adding their email to `BDB_FOUNDER_EMAILS` and logging in. Recovery requires:

1. Approval by another active Founder.
2. Verification that the person still owns the approved identity.
3. A reviewed database or admin operation.
4. A permanent `audit_logs` entry explaining who approved the recovery and why.
5. Immediate MFA verification.

The final-active-Founder database protection remains the last-resort safeguard against removing every control-plane administrator.

## Rollback

If the hardened endpoint prevents a legitimate first installation, do not restore login-time privilege assignment. Review the configuration, use a temporary deployment with the explicit gate enabled and keep the operation auditable.

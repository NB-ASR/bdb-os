# Calendar Staff-to-Service Eligibility

## Decision

Calendar owns one workspace-scoped relationship between an active workspace membership and a canonical Service. An active relationship means that the staff member may be assigned to that Service in an Appointment.

Appointments in `pending` or `confirmed` state are rejected unless the selected staff member has an active eligibility relationship for the selected Service.

Eligibility changes are manager-controlled and online-only. Removing an assignment is rejected while any pending or confirmed Appointment still depends on it.

## Reason

Vanita needs to prevent reception and managers from booking a Service with a staff member who cannot perform it. The rule must be enforced at the authoritative Appointment boundary rather than relying only on a dropdown filter.

The relationship belongs to Calendar because it controls scheduling eligibility. Staff identity remains owned by workspace memberships, and Service identity remains owned by the Service catalogue.

## Alternatives considered

### Store eligible staff IDs inside each Service

Rejected. This would make Service records carry mutable scheduling policy, complicate concurrency and make staff-centred queries inefficient.

### Store Service IDs inside staff profiles

Rejected. Profiles are shared identities and must not contain workspace-specific scheduling configuration.

### Allow every staff member unless explicitly blocked

Rejected. A permissive default can create unsafe bookings when a new staff member or Service is added. Eligibility is deny-by-default until an authorised manager creates an assignment.

### Client-side filtering only

Rejected. Offline replay, concurrent browser sessions and direct trusted integrations require database enforcement.

## Risks

- New Services cannot be booked until at least one eligibility assignment is configured.
- Removing eligibility requires operational cleanup of dependent Appointments.
- The current Appointment form still relies on server rejection if a user selects an ineligible combination; service-specific staff filtering remains a UX refinement.

## Future implications

Qualifications, certificates, skill levels, commission rules and payroll must remain separate records. They may inform eligibility later but must not be embedded into the core relationship.

Appointment-to-Sale conversion and Product consumption must use the accepted Appointment snapshots and must not reinterpret staff eligibility after completion.

# Service catalogue foundation

## Decision

BDB OS uses one workspace-owned `services` catalogue as the reusable definition of work sold or booked by the business.

A Service record owns:

- code and name;
- category;
- standard duration;
- preparation and recovery buffers;
- standard price and VAT rate;
- customer-bookable or staff-only visibility;
- description, notes and archive lifecycle.

## Business problem

The original Vanita workflow used Services in appointments and mixed Sales. BDB OS needs stable Service identities before those workflows become operational. Repeating Service names, prices and durations inside Calendar or Sales would create inconsistent records and prevent reliable history.

## Department ownership

The Service catalogue belongs to the Services department.

Connected departments consume the Service identity without owning the definition:

- Calendar references Services when appointments are created.
- Sales snapshots the approved Service description, price and VAT at transaction time.
- Customers display Service history through appointments and Sales.
- Accounts receives financial postings from completed commercial records, not from the Service catalogue.

## Boundaries

The Service catalogue does not own:

- staff working hours or leave;
- staff-to-Service eligibility;
- appointment availability or status;
- rooms, equipment or other resources;
- Sale, invoice, payment or balance state;
- Inventory consumption recipes.

Those records will be introduced by their owning departments and reference `services.id`.

## Reliability model

- Service changes use trusted service-role commands.
- Browser roles receive RLS-scoped reads only.
- Workspace code uniqueness is enforced in the database.
- Commands use stable idempotency keys.
- Updates use optimistic version checks.
- Services are archived rather than deleted.
- Every mutation writes a transactional Activity record.
- Active Founder support sessions are always read-only.

## Offline model

After one online load, the Service catalogue is cached per workspace in the browser.

Create, update, archive and restore actions can be queued offline. Commands retain their original idempotency key and replay sequentially. Synchronisation stops on the first conflict or validation failure so later commands cannot overtake unresolved work.

## Version 1 scope

Included:

- functional Service catalogue;
- cloud reads and trusted writes;
- create, edit, archive and restore;
- search and filters;
- cached offline reads;
- queued offline mutations;
- stale-edit rejection;
- Activity history;
- support-session denial.

Deferred:

- staff eligibility relationship;
- scheduling availability;
- appointment orchestration;
- Service consumption recipes;
- advanced variable pricing;
- packages and memberships.

## Future implication

Sales can now be implemented against stable Product and Service identities. Sales lines must preserve commercial snapshots so later catalogue edits do not rewrite historical transactions.

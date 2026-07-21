# Solo Operator Founder Review Checklist

Status: Draft founder review  
Product branch: `v2/solo-operator-tier`  
Product PR: #15

## Review route

`/solo-operator-preview`

The review route is public and no-index. It uses isolated, date-relative fictional records and does not query or modify a hosted workspace.

The protected product route is `/solo-operator` and continues to require verified authentication, an active workspace and the overview feature entitlement.

## Review purpose

Determine whether BDB Solo feels like a calm administrative operator for one person rather than a reduced version of the full BDB OS dashboard.

Review the product against the EUR 100 to EUR 150 proposition, while remembering that the price is not commercially justified until provider-backed workflows execute and verify real outcomes.

## Giovanni review

- Is the target customer immediately recognisable?
- Does Today explain what deserves attention without creating anxiety?
- Are Customers, Calendar, Inbox, Money and Documents simpler than the full workspace?
- Is the language commercially credible and free from unsupported promises?
- Would guided onboarding make the product understandable without training?
- Which two solo professions should enter the first pilot?

## Matthew review

- Can appointment reminders become the first complete provider-backed workflow?
- Are approval, retry, delivery and exception states explicit enough?
- Which communication provider should be used for the sandbox?
- What minimum information is required before a message may be prepared?
- How will provider acceptance, delivery failure and reply state be recorded?
- Which AI drafting tasks are bounded enough for the first pilot?

## Niki review

- Does the Solo profile reuse shared records without creating a product fork?
- Are the decision rules pure, deterministic and testable?
- Does the protected route remain fail-closed?
- Is preview data isolated from cloud and local workspace data?
- Are mobile layout, keyboard navigation and reduced motion acceptable?
- What command and policy schema is required before the first real workflow?

## Required screen review

Review at desktop, tablet and mobile widths:

1. Today hero and operator state
2. Daily action plan
3. Customer memory cards
4. Calendar and reminder boundary
5. Communications queue
6. Money attention queue
7. Document linkage
8. Operator autonomy controls
9. Empty states
10. Offline and failed-save states on the protected route

## Current verified behaviour

- The public preview hydrates into the Solo shell on desktop and mobile Chromium.
- The public preview displays isolated fictional records only.
- The protected Solo route does not expose workspace data without verified access.
- The full application passes TypeScript, unit tests, ESLint and production build.
- The database migration history replays from an empty database.
- Database security assertions pass.

## Current commercial boundary

This branch establishes the premium product experience, shared architecture, decision engine and bounded-autonomy model.

It does not yet provide:

- real outbound email, SMS or WhatsApp delivery;
- provider delivery receipts and retry handling;
- automatic appointment reminders;
- automatic overdue-invoice follow-up;
- live calendar-provider synchronisation;
- AI document extraction connected to Solo records;
- a durable offline command queue;
- authenticated pilot evidence.

The product should not be sold at the proposed price until at least one complete workflow executes reliably and the pilot measurement shows meaningful time or cash-flow value.

## Founder decision

After review, record one decision:

- proceed with the current Solo product direction;
- revise the positioning or operating hierarchy;
- narrow the first customer segment;
- pause Solo until the V1 pilot is stable.

Do not merge the branch merely because the interface is attractive. Merge only when its dependency chain is approved and the next implementation slice has a named owner, test contract and rollout boundary.

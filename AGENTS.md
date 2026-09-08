<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## BDB OS V1 closure rule

Before declaring any BDB OS engine `V1 Closed`, `V1 Frozen` or `V1 Live`, read and follow `docs/architecture/v1-engine-closure-standard.md`.

The four technical passes are necessary but not sufficient. The exact candidate must also pass the Customer Operational Acceptance Gate: every visible in-scope business action must be genuinely usable by an authenticated business customer, representative file operations must be exercised end-to-end, required environment dependencies must be verified, and deferred functionality must not appear as a normal disabled/broken action.

Do not merge an engine-closure PR while any Operational V1 action remains unproven.

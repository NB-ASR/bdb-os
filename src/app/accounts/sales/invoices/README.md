# Invoice register boundary

This route is intentionally a read workspace, not a second Invoice engine.

- Register rows come from `/api/accounts/invoices` in bounded pages.
- Full connected context comes from `/api/accounts/invoices/[id]` only when one Invoice is opened.
- Creation, Credit Note, Delivery Note and Payment commands remain owned by the existing Accounts command engine.
- Issued document rendering remains owned by the business-document renderer.
- Never reintroduce an assumption that all Invoices are loaded client-side.

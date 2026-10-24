# Automatic business context

For every Admin AI message, the server discovers current safe fields in registered business tables and includes recent activity and feature announcements in the model context. Historical and current records are read from PostgreSQL on demand through structured, parameterized queries. New records and safe columns appear without any teaching messages or manual synchronization.

The Admin tools cover inventory, stock history, sales, receipts, shops, staff, customers, credit, deliveries, deposits, expenditure, pre-inventory and allocations, commission settlements, role permissions, settings, announcements and audit history. Aggregate queries calculate complete totals rather than summing a limited page. Record queries provide pagination.

Only Admin receives the additional company-wide context and tools. Staff keep their existing shop and personal-commission restrictions. The knowledge service independently checks the role on every operation. Passwords, reset tokens, authentication data and binary receipt files are excluded. A receipt's recorded details are available; reading text inside uploaded documents is a separate capability.

This is live retrieval, not model retraining. There is no background model process, automatic financial action, or persistent memory of unverified chat statements. A new conversation can read historical business records without retaining another user's conversation. Future events become known when entered in the system. New business modules must register their tables in `aiKnowledge.js` and supply feature guidance when implemented; arbitrary new database tables are deliberately not exposed automatically.

Verification uses a fake model provider and mocked database responses; tests do not call a paid model or modify production records.

# Navigation

Keep Dashboard as the first sidebar navigation item on every page. Add all new sections below Dashboard; never place a section above it. Maintain this order in both the root frontend and `Reliavolt-Inventory-Frontend` copies.

# Publishing

Make and test changes locally, then ask the user before every Git push. Do not push without explicit approval for that push.

# AI business knowledge

Admin AI has company-wide read-only business access; other roles retain their existing restrictions. When adding a business module, register its tables in `backend/src/services/aiKnowledge.js`, add relevant feature guidance to the AI prompt, and test access controls. This keeps the AI aware of new features without the user having to teach it. Never expose credentials, authentication tokens, binary attachments, or unrestricted SQL through AI tools. Do not describe fresh database context as model retraining or autonomous background observation.

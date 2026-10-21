# Expenditure deployment

The frontend is served separately from the Express API on Railway. Publishing frontend files does not establish that the backend was deployed.

On 21 October 2026 the production API returned HTTP 404 for GET /api/expenditures, confirming that the running server did not have the route. The local backend registers it in backend/src/app.js and creates its separate table through backend/schema.sql during startup.

## Release and verification

1. Obtain the owner's approval before pushing changes to GitHub.
2. In Railway, check the API service's source repository, branch and deployed commit against the approved GitHub commit. The repository is AchieverBangs/reliavolt-inventory, branch main. Verify that its Root Directory is /backend and its start command runs npm start (node server.js). Check the deployment logs for schema initialization and successful startup. A frontend deployment alone will not update this API.
3. Redeploy the API from the approved commit. Review startup failures rather than masking them in the frontend. Do not reset the database or reassign records.
4. Run the read-only check:

   node backend/scripts/check-deployment.js https://reliavolt-inventory-production.up.railway.app

   The health endpoint includes the deployed revision when Railway provides it. An unauthenticated expenditure request must return 401 rather than 404.
5. Sign in and verify existing expenditure loads, create an owner-approved expense, refresh, and verify the same saved record remains. Check shop scoping. Verify existing sales, inventory and commission amounts are unchanged.

The Railway CLI wrapper installed on this computer points to a missing package. The native executable exists at C:/Users/BANGS/.railway/bin/railway.exe, but its saved login was expired when inspected. A fresh Railway login or access through Railway's dashboard is required for deployment. No deployment or GitHub push was performed during this fix.

## Local verification

Run npm.cmd --prefix backend test. The suite includes expenditure validation, shop scoping, write restrictions, frontend recovery after loading failures, confirmed-save rendering without a second fetch, and date filtering. Run the optional local PostgreSQL test in PowerShell with:

    $env:EXPENDITURE_DB_TEST='1'
    node --test backend/test/expenditures-db.test.js

Database tests use temporary tables on a dedicated connection and roll back all changes. Production hosts are rejected.

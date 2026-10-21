// Read-only deployment check. Never logs in or writes business records.
const base = process.argv[2];
if (!base || !/^https?:\/\//.test(base)) {
    console.error('Usage: node scripts/check-deployment.js <API base URL>');
    process.exit(1);
}
(async () => {
    const origin = base.replace(/\/+$/, '');
    const health = await fetch(origin + '/api/health', { signal: AbortSignal.timeout(20000) });
    if (!health.ok) throw new Error('Backend health check failed: HTTP ' + health.status);
    const info = await health.json();
    const route = await fetch(origin + '/api/expenditures', { signal: AbortSignal.timeout(20000) });
    if (route.status === 404) throw new Error('The deployed backend does not include expenditure. Deploy the backend containing the expenditure route.');
    if (route.status !== 401) throw new Error('Expenditure authentication check failed: expected HTTP 401, received ' + route.status);
    if (!info.features?.includes('expenditures')) throw new Error('The deployed backend is missing the latest expenditure release marker.');
    console.log('Backend healthy; expenditure route is deployed and requires authentication.');
    if (info.revision) console.log('Deployed revision: ' + info.revision);
})().catch(err => { console.error(err.message); process.exitCode = 1; });

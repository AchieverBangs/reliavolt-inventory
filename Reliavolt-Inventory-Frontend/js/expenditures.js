function escHtml(value) {
 const span = document.createElement('span');
 span.textContent = String(value ?? '');
 return span.innerHTML;
}
let expenditureRecords = [];
document.addEventListener('DOMContentLoaded', async () => {
 const el = id => document.getElementById(id);
 const message = text => { el('expenseMessage').textContent = text; };
 const render = () => {
  const from = el('filterFrom').value, to = el('filterTo').value;
  if (from && to && from > to) { message('From date must be before To date.'); return; }
  const rows = expenditureRecords.filter(r => (!from || r.expense_date.slice(0,10) >= from) && (!to || r.expense_date.slice(0,10) <= to));
  const cents = rows.reduce((sum,r) => sum + Math.round(Number(r.amount)*100),0);
  el('expenseTotal').textContent = formatCurrency(cents/100);
  el('expenseRows').innerHTML = rows.length ? rows.map(r => '<tr><td>'+escHtml(r.expense_date.slice(0,10))+'</td><td>'+escHtml(r.description)+'</td><td>'+escHtml(r.category)+'</td><td>'+escHtml(r.shop_name || 'Unassigned')+'</td><td>'+escHtml(formatCurrency(r.amount))+'</td><td>'+escHtml(r.recorded_by || '?')+'</td></tr>').join('') : '<tr><td colspan="6">No expenditure recorded for these dates.</td></tr>';
 };
 const load = async () => {
  const rows = await api.get('/api/expenditures');
  if (!rows) throw new Error('Please sign in again.');
  expenditureRecords = rows; render();
 };
 el('expenseDate').value = todayStr();
 el('filterFrom').addEventListener('change', render);
 el('filterTo').addEventListener('change', render);
 el('refreshExpenses').addEventListener('click', async () => {
  try { await load(); message(''); } catch(err) { message(err.message); }
 });
 el('expenditureForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = el('saveExpenditure'); button.disabled = true;
  let saved = false;
  try {
   const result = await api.post('/api/expenditures', {
    expense_date: el('expenseDate').value, shop_id: Number(el('expenseShop').value),
    description: el('expenseDescription').value.trim(), category: el('expenseCategory').value.trim(), amount: el('expenseAmount').value
   });
   if (!result) return;
   saved = true;
   el('expenseDescription').value = ''; el('expenseAmount').value = '';
   await load(); message('Expenditure recorded.');
  } catch(err) { message(saved ? 'Expenditure saved. Could not refresh records; use Refresh to try again.' : err.message); }
  finally { button.disabled = false; }
 });
 try {
  const shops = await api.get('/api/shops');
  if (!shops) return;
  const available = isAdmin() ? shops : shops.filter(s => Number(s.id) === Number(getCurrentUserShopId()));
  el('expenseShop').innerHTML = '<option value="">Select shop</option>' + available.map(s => '<option value="'+Number(s.id)+'">'+escHtml(s.name)+'</option>').join('');
  if (available.length === 1) el('expenseShop').value = available[0].id;
  if (!isAdmin()) el('expenseShop').disabled = true;
  await load();
  el('saveExpenditure').disabled = !available.length;
  if (!available.length) message('A shop must be assigned before you can record expenditure.');
 } catch(err) {
  message(err.message);
  el('expenseRows').innerHTML = '<tr><td colspan="6">Unable to load expenditure. Use Refresh to retry.</td></tr>';
 }
});

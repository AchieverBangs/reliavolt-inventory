# Reliavolt Supply — Inventory Management System (Frontend)

**"We Go For Value"**

A complete frontend-only inventory management system built with HTML5, CSS3, and JavaScript ES6. Uses LocalStorage for data persistence during this demo phase. No backend or database required to run.

---

## How to Open

Open `index.html` in any modern browser (Chrome, Edge, Firefox).

**Demo login:**
- Username: `admin`
- Password: `admin123`

---

## Pages

| Page | File | Description |
|------|------|-------------|
| Login | `index.html` | Authentication screen |
| Dashboard | `dashboard.html` | Overview stats, chart, recent sales |
| Inventory | `inventory.html` | Add/edit/delete products |
| Sales | `sales.html` | Record sales, print receipts |
| Customers | `customers.html` | Customer management, purchase history |
| Reports | `reports.html` | Daily/weekly/monthly sales, profit, low stock |
| Settings | `settings.html` | Company info, currency, theme |

---

## Project Structure

```
Reliavolt-Inventory-Frontend/
├── index.html          Login page
├── dashboard.html      Dashboard
├── inventory.html      Inventory management
├── sales.html          Sales recording
├── customers.html      Customer management
├── reports.html        Reports & analytics
├── settings.html       App settings
│
├── css/
│   ├── style.css       Global styles, layout, components
│   ├── dashboard.css   Dashboard-specific styles
│   ├── inventory.css   Inventory page styles
│   ├── sales.css       Sales page & receipt styles
│   └── pages.css       Customers, reports, settings styles
│
├── js/
│   ├── app.js          Core: auth, data access, utilities
│   ├── login.js        Login page logic
│   ├── dashboard.js    Dashboard rendering & chart
│   ├── inventory.js    Product CRUD operations
│   ├── sales.js        Sales recording & receipt
│   ├── customers.js    Customer management
│   ├── reports.js      Report generation & charts
│   └── settings.js     Settings form & data management
│
└── images/             Logo and image assets
```

---

## Features

- **Dashboard** — 6 KPI cards, 7-day sales bar chart, recent sales list, low stock alerts
- **Inventory** — Add/edit/delete products, filter by stock status, category, search, profit preview
- **Sales** — Product select, auto total calculation, payment method, receipt preview, print
- **Customers** — Add customers, view purchase history, total spend tracking
- **Reports** — Daily/weekly/monthly sales, profit by product, low stock report, bar chart
- **Settings** — Company name, currency (Le by default), receipt footer, light/dark mode, JSON export

---

## Technical Notes

- All data is stored in **browser LocalStorage** (frontend demo only)
- Sample data is seeded automatically on first load (18 products, 8 customers, 30 days of sales)
- Currency defaults to **Le (Sierra Leonean Leone)**
- No external libraries or CDN dependencies — pure HTML/CSS/JS
- Responsive for desktop and mobile screens

---

## Next Steps (Backend Integration)

When ready to connect a backend:
1. Replace `getProducts()` / `saveProducts()` calls in `js/app.js` with `fetch()` API calls
2. Replace `getSales()` / `saveSales()` with API endpoints
3. Add JWT or session-based authentication to replace the demo `sessionStorage` auth
4. Connect the reports to a real database aggregation layer

---

*Reliavolt Supply Inventory System v1.0 — Frontend Phase*

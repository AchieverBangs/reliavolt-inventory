# Reliavolt Supply — Inventory Management System (Frontend)

**"We Go For Value"**

A frontend built with HTML5, CSS3, and JavaScript ES6 that talks to a real Express + PostgreSQL backend (see `../backend`) over a JWT-authenticated REST API. Inventory is tracked per shop/branch.

---

## How to Run

- **Production:** deployed as a static site (e.g. GitHub Pages) pointing at the Railway-hosted API.
- **Local dev:** serve this folder with a local HTTP server (e.g. VS Code Live Server on port 5500) and run the backend locally (`cd ../backend && npm run dev`). `js/api.js` automatically points at `http://localhost:4000` when the page is served from `localhost`/`127.0.0.1`, and at the production API otherwise — so local development never touches production data.
- Log in with a real user from the `users` table (see `../backend/scripts/seed-passwords.js` to set/rotate passwords).

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

- All data lives in PostgreSQL, accessed via the REST API in `../backend`
- Auth uses JWT bearer tokens (`js/api.js`); the token carries the user's role and assigned `shopId`
- Products belong to a shop (`shop_id`); non-Admin roles are automatically scoped to their own shop for inventory and sales, Admins see/manage all shops
- Currency defaults to **Le (Sierra Leonean Leone)**
- No external libraries or CDN dependencies — pure HTML/CSS/JS
- Responsive for desktop and mobile screens

---

*Reliavolt Supply Inventory System*

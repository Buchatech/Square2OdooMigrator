# Square → Odoo Migrator

A full-stack web app to migrate your Square data (customers, invoices, vendors, contractors, company info) into Odoo.

## Features

- Fetch customers and invoices directly from Square API
- Manually add vendors and contractors (Square has no vendor concept)
- Enter your company info to update Odoo's company record
- Real-time migration log with progress bar
- Demo mode — test the full flow without any API credentials
- Backend proxy server eliminates CORS issues

## Deploy to Render (recommended)

1. Push this project to a GitHub repository
2. Go to [render.com](https://render.com) and create a new account (free tier works)
3. Click **New → Web Service**
4. Connect your GitHub repo
5. Render will auto-detect the `render.yaml` config
6. Click **Deploy**

Your app will be live at `https://square-odoo-migrator.onrender.com` (or similar).

## Run locally

### Prerequisites
- Node.js 18+

### Install & start

```bash
# Install root dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# Run both server + client in dev mode
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3001

## How to use

### Step 1 — Connect Square
- Check **"Use demo data"** to test without credentials, OR
- Enter your Square Access Token from developer.squareup.com → Applications → Your App → OAuth → Access Token
- Toggle sandbox/production as needed

### Step 2 — Preview Data
- Review fetched customers and invoices
- Add vendors and contractors manually (Square doesn't store these)

### Step 3 — Configure
- Choose what to migrate (customers, invoices, vendors, company info)
- Fill in your company details
- Enter Odoo URL, database, username, and password/API key

**Finding your Odoo credentials:**
- URL: the full URL of your Odoo instance, e.g. `https://mycompany.odoo.com`
- Database: shown at login screen, or Settings → General Settings
- API key: Settings → Technical → API Keys → New (recommended), or use your login password

### Step 4 — Migrate
- Click **Start migration**
- Watch the real-time log
- Errors on individual records are caught and logged without stopping the run

### Step 5 — Done
- Summary of migrated records
- Checklist of next steps in Odoo

## Odoo field mapping

| Square | Odoo model | Notes |
|--------|-----------|-------|
| Customer | `res.partner` | `customer_rank=1` |
| Invoice | `account.move` | `move_type=out_invoice` |
| Vendor/Contractor | `res.partner` | `supplier_rank=1` |
| Company info | `res.company` | Updates company id=1 |

## Architecture

```
square-odoo-migrator/
├── server/
│   └── index.js        # Express API — proxies Square & Odoo calls
├── client/
│   ├── src/
│   │   ├── App.jsx     # React migration wizard
│   │   ├── index.css   # Styles
│   │   └── main.jsx    # Entry point
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── render.yaml         # Render deployment config
└── package.json        # Root package — build + start scripts
```

The backend proxy (`server/index.js`) handles all calls to Square and Odoo APIs, which avoids CORS restrictions in the browser.

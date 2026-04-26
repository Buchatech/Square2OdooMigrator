# Square → Odoo Migrator

A full-stack web app to migrate your Square data into Odoo — customers, invoices, vendors, contractors, staff, payroll employees, bills, and company info.

## Features

- Fetches customers, invoices, vendors, staff, payroll, and bills directly from the Square API
- Add any additional vendors or contractors manually
- Enter your company info to update Odoo's company record
- Real-time migration log with progress bar
- Demo mode — test the full flow without any API credentials
- Backend proxy server eliminates CORS issues
- Docker container ready for deployment

## Deploy to Render (recommended)

1. Push this project to a GitHub repository
2. Go to [render.com](https://render.com) and create a new account (free tier works)
3. Click **New → Web Service**
4. Connect your GitHub repo
5. Render will auto-detect the `render.yaml` config and build the Docker container
6. Click **Deploy**

Your app will be live at `https://square-odoo-migrator.onrender.com` (or similar).

## Run with Docker locally

```bash
docker compose up --build
```

App will be available at http://localhost:3001

## Run without Docker locally

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

---

## Getting your Square Access Token

1. Go to [developer.squareup.com](https://developer.squareup.com) and sign in with your Square business account
2. Click **"Create your first application"** (or **"New Application"** if you have existing ones)
3. Give it a name (e.g. "Odoo Migration") and click **Create**
4. In the left sidebar, click **Credentials**
5. Make sure you are on the **Production** tab (not Sandbox)
6. Copy the **Production Access Token** — it starts with `EAAAl...`
7. Paste it into the app and make sure **"Use Square Sandbox environment"** is unchecked

**Important notes:**
- Keep your token secret — do not commit it to GitHub or share it
- The token does not expire by default, but you can rotate it from the Credentials page at any time
- The Sandbox token (also on the Credentials page) is safe for testing — it only accesses fake Square data
- Payroll data requires the **EMPLOYEES_READ** permission scope on your token. If payroll comes back empty, go to developer.squareup.com → your app → OAuth → enable that permission → regenerate your token

---

## Getting your Odoo credentials

### Odoo URL
The full web address you use to log into Odoo, for example:
```
https://mycompany.odoo.com
```

### Database name
- Visible on the Odoo login screen, shown below the username field
- On Odoo.com cloud hosting it is usually the subdomain of your URL (e.g. if your URL is `https://mycompany.odoo.com` the database is `mycompany`)
- Can also be found under Settings → General Settings → scroll to the "About" section

### Username
Your Odoo login email address.

### Password or API key
You have two options:

**Option 1 — Use your login password** (simplest): just enter the same password you use to log in.

**Option 2 — Create a dedicated API key** (recommended for security):
1. Log into Odoo and go to **Settings**
2. Click **Users** in the left sidebar
3. Click your user account
4. Click **Add API Key**
5. Give the key a name (e.g. "Square Migration") and confirm
6. Copy the key immediately — it is only shown once and cannot be retrieved again

---

## How to use

### Step 1 — Connect Square
- Check **"Use demo data"** to test without credentials, or
- Enter your Square Access Token (see above) and uncheck the Sandbox toggle for production data

### Step 2 — Preview Data
- Review all fetched records: customers, invoices, vendors, staff, payroll, and bills
- Add any additional vendors or contractors not already listed

### Step 3 — Configure
- Choose exactly what to migrate using the checkboxes
- Fill in your company details if you want to update the Odoo company record
- Enter your Odoo credentials (see above)

### Step 4 — Migrate
- Click **Start migration**
- Watch the real-time log — errors on individual records are caught and logged without stopping the run

### Step 5 — Done
- Summary count of all migrated records
- Checklist of where to verify each data type in Odoo

---

## Odoo field mapping

| Square | Odoo model | Notes |
|--------|-----------|-------|
| Customer | `res.partner` | `customer_rank=1` |
| Invoice | `account.move` | `move_type=out_invoice` |
| Vendor / Contractor | `res.partner` | `supplier_rank=1` |
| Staff / Team member | `hr.employee` | Requires HR module |
| Payroll employee | `hr.employee` | Skips duplicates already imported from staff |
| Bill | `account.move` | `move_type=in_invoice` |
| Company info | `res.company` | Updates company id=1 |

---

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
├── Dockerfile          # Multi-stage Docker build
├── docker-compose.yml  # Local container run
├── render.yaml         # Render deployment config
└── package.json        # Root package — build + start scripts
```

The backend proxy (`server/index.js`) handles all calls to the Square and Odoo APIs, which avoids CORS restrictions in the browser. No database is required — data flows directly from Square through the app into Odoo in a single session.

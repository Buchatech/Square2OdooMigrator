const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fetch = require("node-fetch");
const rateLimit = require("express-rate-limit");

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });
app.use("/api/", limiter);

// ─── Square proxy ─────────────────────────────────────────────────────────────
app.post("/api/square/fetch", async (req, res) => {
  const { token, sandbox } = req.body;
  if (!token) return res.status(400).json({ error: "Missing Square token" });

  const base = sandbox
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";

  const headers = {
    Authorization: `Bearer ${token}`,
    "Square-Version": "2024-01-17",
    "Content-Type": "application/json",
  };

  // Paginate through all pages of a Square list endpoint
  async function fetchAllPages(url, resultKey) {
    let allItems = [];
    let cursor = null;
    do {
      const pageUrl = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url;
      const response = await fetch(pageUrl, { headers });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.errors?.[0]?.detail || `Square API error: ${response.status}`);
      }
      const data = await response.json();
      allItems = allItems.concat(data[resultKey] || []);
      cursor = data.cursor || null;
    } while (cursor);
    return allItems;
  }

  try {
    // Fetch customers and locations in parallel first
    const [customers, locationsRes] = await Promise.all([
      fetchAllPages(`${base}/customers?limit=100`, "customers"),
      fetch(`${base}/locations`, { headers }),
    ]);

    // Build customer lookup map
    const custMap = {};
    customers.forEach(c => {
      custMap[c.id] = `${c.given_name || ""} ${c.family_name || ""}`.trim();
    });

    // Extract location IDs — invoices endpoint requires location_id
    let invoicesRaw = [];
    if (locationsRes.ok) {
      const locData = await locationsRes.json();
      const locationIds = (locData.locations || []).map(l => l.id).filter(Boolean);

      // Fetch invoices for each location and merge
      const invoicesByLocation = await Promise.all(
        locationIds.map(locId =>
          fetchAllPages(`${base}/invoices?limit=100&location_id=${locId}`, "invoices").catch(() => [])
        )
      );

      // Flatten and deduplicate by invoice id
      const seen = new Set();
      for (const batch of invoicesByLocation) {
        for (const inv of batch) {
          if (!seen.has(inv.id)) {
            seen.add(inv.id);
            invoicesRaw.push(inv);
          }
        }
      }
    }

    const invoices = invoicesRaw.map(inv => ({
      ...inv,
      customer_name:
        custMap[inv.primary_recipient?.customer_id] ||
        inv.primary_recipient?.email_address ||
        inv.primary_recipient?.customer_id ||
        "Unknown",
    }));

    res.json({
      customers,
      invoices,
      vendors: [],
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Odoo proxy ───────────────────────────────────────────────────────────────
app.post("/api/odoo/auth", async (req, res) => {
  const { url, db, username, password } = req.body;
  if (!url || !db || !username || !password)
    return res.status(400).json({ error: "Missing Odoo credentials" });

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/web/session/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: { db, login: username, password },
      }),
    });
    const data = await response.json();
    if (!data.result?.uid) throw new Error("Authentication failed — check credentials and database name");
    res.json({ uid: data.result.uid, name: data.result.name });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.post("/api/odoo/call", async (req, res) => {
  const { url, db, uid, password, model, method, args, kwargs } = req.body;
  if (!url || !model || !method)
    return res.status(400).json({ error: "Missing required fields" });

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/web/dataset/call_kw`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "call",
        params: {
          model,
          method,
          args: args || [],
          kwargs: { context: {}, ...(kwargs || {}) },
        },
      }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    res.json({ result: data.result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Serve React build in production ─────────────────────────────────────────
const clientBuild = path.join(__dirname, "../client/dist");
app.use(express.static(clientBuild));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuild, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Square→Odoo migrator running on port ${PORT}`);
});

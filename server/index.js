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

  try {
    const [custRes, invRes] = await Promise.all([
      fetch(`${base}/customers?limit=200`, { headers }),
      fetch(`${base}/invoices?limit=200`, { headers }),
    ]);

    if (!custRes.ok) {
      const err = await custRes.json();
      return res.status(custRes.status).json({ error: err.errors?.[0]?.detail || "Square customers error" });
    }

    const custData = await custRes.json();
    const invData = invRes.ok ? await invRes.json() : { invoices: [] };

    // Build a customer lookup map for invoice names
    const custMap = {};
    (custData.customers || []).forEach(c => {
      custMap[c.id] = `${c.given_name || ""} ${c.family_name || ""}`.trim();
    });

    const invoices = (invData.invoices || []).map(inv => ({
      ...inv,
      customer_name: custMap[inv.primary_recipient?.customer_id] || inv.primary_recipient?.customer_id || "",
    }));

    res.json({
      customers: custData.customers || [],
      invoices,
      vendors: [], // Square doesn't have a vendor concept — users add these manually
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

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

// ─── Connection log helper ────────────────────────────────────────────────────
function makeLogger() {
  const entries = [];
  const log = (msg, type = "info") => {
    const time = new Date().toISOString().split("T")[1].slice(0, 12);
    console.log(`[${type.toUpperCase()}] ${msg}`);
    entries.push({ time, msg, type });
  };
  return { log, entries };
}

// ─── Square proxy ─────────────────────────────────────────────────────────────
app.post("/api/square/fetch", async (req, res) => {
  const { token, sandbox } = req.body;
  const { log, entries } = makeLogger();

  if (!token) return res.status(400).json({ error: "Missing Square token", log: entries });

  const base = sandbox
    ? "https://connect.squareupsandbox.com/v2"
    : "https://connect.squareup.com/v2";

  log(`Connecting to Square ${sandbox ? "Sandbox" : "Production"}`);
  log(`Base URL: ${base}`);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Square-Version": "2024-01-17",
    "Content-Type": "application/json",
  };

  async function fetchAllPages(url, resultKey) {
    let allItems = [];
    let cursor = null;
    let page = 0;
    do {
      page++;
      const pageUrl = cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url;
      const response = await fetch(pageUrl, { headers });
      if (!response.ok) {
        const err = await response.json();
        const detail = err.errors?.[0]?.detail || `HTTP ${response.status}`;
        const category = err.errors?.[0]?.category || "";
        throw new Error(`${detail}${category ? ` (${category})` : ""}`);
      }
      const data = await response.json();
      const batch = data[resultKey] || [];
      allItems = allItems.concat(batch);
      cursor = data.cursor || null;
      if (page > 1 || cursor) log(`  ${resultKey}: page ${page}, ${batch.length} records${cursor ? ", more pages..." : ""}`);
    } while (cursor);
    return allItems;
  }

  async function safeFetch(label, url, resultKey) {
    try {
      log(`Fetching ${label}...`);
      const items = await fetchAllPages(url, resultKey);
      log(`  ✓ ${label}: ${items.length} records`, "success");
      return items;
    } catch (e) {
      log(`  ✗ ${label} failed: ${e.message}`, "warn");
      return [];
    }
  }

  async function fetchAllPost(url, body, resultKey) {
    let allItems = [];
    let cursor = null;
    do {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(cursor ? { ...body, cursor } : body),
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.errors?.[0]?.detail || `HTTP ${response.status}`);
      }
      const data = await response.json();
      allItems = allItems.concat(data[resultKey] || []);
      cursor = data.cursor || null;
    } while (cursor);
    return allItems;
  }

  async function safePost(label, url, body, resultKey) {
    try {
      log(`Fetching ${label}...`);
      const items = await fetchAllPost(url, body, resultKey);
      log(`  ✓ ${label}: ${items.length} records`, "success");
      return items;
    } catch (e) {
      log(`  ✗ ${label} failed: ${e.message}`, "warn");
      return [];
    }
  }

  try {
    // Round 1: customers + locations
    log("Fetching customers...");
    const [customers, locationsRes] = await Promise.all([
      fetchAllPages(`${base}/customers?limit=100`, "customers"),
      fetch(`${base}/locations`, { headers }),
    ]);
    log(`  ✓ customers: ${customers.length} records`, "success");

    const custMap = {};
    customers.forEach(c => {
      custMap[c.id] = `${c.given_name || ""} ${c.family_name || ""}`.trim();
    });

    log("Fetching locations...");
    const locData = locationsRes.ok ? await locationsRes.json() : { locations: [] };
    if (!locationsRes.ok) log(`  ✗ locations failed: HTTP ${locationsRes.status}`, "warn");
    const locationIds = (locData.locations || []).map(l => l.id).filter(Boolean);
    log(`  ✓ locations: ${locationIds.length} found`, "success");

    // Round 2: everything else in parallel
    const [invoicesByLocation, vendorRes, teamMembers, payrollEmployees, billsRaw] = await Promise.all([

      // Invoices per location
      Promise.all(
        locationIds.map(async (locId, i) => {
          log(`Fetching invoices for location ${i + 1} of ${locationIds.length}...`);
          const invs = await fetchAllPages(`${base}/invoices?limit=100&location_id=${locId}`, "invoices").catch(e => {
            log(`  ✗ invoices (location ${locId}) failed: ${e.message}`, "warn");
            return [];
          });
          log(`  ✓ invoices location ${i + 1}: ${invs.length} records`, "success");
          return invs;
        })
      ),

      // Vendors
      fetch(`${base}/vendors/search`, {
        method: "POST", headers,
        body: JSON.stringify({ filter: { status: ["ACTIVE", "INACTIVE"] } }),
      }).then(async r => {
        log("Fetching vendors...");
        if (!r.ok) { log(`  ✗ vendors failed: HTTP ${r.status}`, "warn"); return { vendors: [] }; }
        const d = await r.json();
        log(`  ✓ vendors: ${(d.vendors || []).length} records`, "success");
        return d;
      }).catch(e => { log(`  ✗ vendors failed: ${e.message}`, "warn"); return { vendors: [] }; }),

      // Team members
      safePost("team members", `${base}/team-members/search`, { limit: 100 }, "team_members"),

      // Payroll employees
      safeFetch("payroll employees", `${base}/labor/employees?limit=100`, "employees"),

      // Bills — Square Bills uses dedicated /bills endpoint, NOT orders
      // The /orders SQUARE_BILLS filter returns purchase orders, not AP bills
      (async () => {
        log("Fetching bills...");
        try {
          // Try the dedicated bills endpoint first (Square Bills product)
          const r = await fetch(`${base}/bills?limit=100`, { headers });
          if (r.ok) {
            const d = await r.json();
            const bills = d.bills || [];
            log(`  ✓ bills: ${bills.length} records`, "success");
            return bills;
          }
          // Fallback: search orders with PURCHASE source
          log(`  Bills endpoint returned ${r.status}, trying orders fallback...`, "warn");
          const fallback = await fetchAllPost(`${base}/orders/search`, {
            location_ids: locationIds, limit: 100,
            query: { filter: { source_filter: { source_names: ["SQUARE_BILLS"] } } },
          }, "orders").catch(() => []);
          log(`  ✓ bills (via orders fallback): ${fallback.length} records`, "success");
          return fallback;
        } catch (e) {
          log(`  ✗ bills failed: ${e.message}`, "warn");
          return [];
        }
      })(),
    ]);

    // Deduplicate invoices
    const seen = new Set();
    const invoicesRaw = [];
    for (const batch of invoicesByLocation) {
      for (const inv of batch) {
        if (!seen.has(inv.id)) { seen.add(inv.id); invoicesRaw.push(inv); }
      }
    }

    const invoices = invoicesRaw.map(inv => ({
      ...inv,
      customer_name:
        custMap[inv.primary_recipient?.customer_id] ||
        inv.primary_recipient?.email_address ||
        inv.primary_recipient?.customer_id || "Unknown",
    }));

    // Normalize vendors
    const vendors = (vendorRes.vendors || []).map(v => ({
      id: v.id, name: v.name || "",
      email: v.contacts?.[0]?.email_address || "",
      phone: v.contacts?.[0]?.phone_number || "",
      address: v.address || {}, account_number: v.account_number || "",
      note: v.note || "", status: v.status || "ACTIVE", type: "vendor",
    }));

    // Normalize staff
    const staff = teamMembers.map(m => ({
      id: m.id, given_name: m.given_name || "", family_name: m.family_name || "",
      email_address: m.email_address || "", phone_number: m.phone_number || "",
      status: m.status || "ACTIVE", job_title: m.assigned_locations?.assignment_type || "",
      is_owner: m.is_owner || false,
    }));

    // Normalize payroll
    const payroll = payrollEmployees.map(e => ({
      id: e.id, given_name: e.first_name || "", family_name: e.last_name || "",
      email_address: e.email || "", phone_number: e.phone_number || "",
      status: e.status || "ACTIVE",
    }));

    // Normalize bills — handle both dedicated bills format and orders fallback
    const bills = billsRaw.map(b => ({
      id: b.id,
      vendor_id: b.vendor_id || "",
      vendor_name: b.vendor?.name || b.vendor_name || vendors.find(v => v.id === b.vendor_id)?.name || "Unknown Vendor",
      total_money: b.total_money || b.net_amount_due_money || { amount: 0, currency: "USD" },
      created_at: b.created_at || b.due_date || "",
      due_date: b.due_date || "",
      status: b.status || b.state || "UNKNOWN",
      invoice_number: b.invoice_number || b.id,
    }));

    log(`Square fetch complete — customers: ${customers.length}, invoices: ${invoices.length}, vendors: ${vendors.length}, staff: ${staff.length}, payroll: ${payroll.length}, bills: ${bills.length}`, "success");

    res.json({ customers, invoices, vendors, staff, payroll, bills, log: entries });
  } catch (e) {
    log(`Fatal error: ${e.message}`, "error");
    res.status(500).json({ error: e.message, log: entries });
  }
});

// ─── Odoo auth ────────────────────────────────────────────────────────────────
app.post("/api/odoo/auth", async (req, res) => {
  const { url, db, username, password } = req.body;
  const { log, entries } = makeLogger();

  if (!url || !db || !username || !password)
    return res.status(400).json({ error: "Missing Odoo credentials", log: entries });

  const cleanUrl = url.replace(/\/$/, "");
  log(`Connecting to Odoo: ${cleanUrl}`);
  log(`Database: "${db}"`);
  log(`Username: "${username}"`);
  log(`Auth endpoint: ${cleanUrl}/web/session/authenticate`);

  try {
    const response = await fetch(`${cleanUrl}/web/session/authenticate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", method: "call",
        params: { db, login: username, password },
      }),
    });

    log(`HTTP response status: ${response.status} ${response.statusText}`);

    // Capture session cookie from Odoo's Set-Cookie header so subsequent
    // calls can be authenticated — this is the fix for silent write failures
    const setCookie = response.headers.get("set-cookie");
    let sessionCookie = null;
    if (setCookie) {
      const match = setCookie.match(/session_id=([^;]+)/);
      if (match) {
        sessionCookie = `session_id=${match[1]}`;
        log(`Session cookie captured`, "success");
      }
    }

    const data = await response.json();
    log(`Response received — jsonrpc: ${data.jsonrpc || "?"}`);

    if (data.error) {
      const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
      log(`Odoo returned an error: ${msg}`, "error");
      log(`Error code: ${data.error.code || "?"}`, "error");
      return res.status(401).json({ error: `Odoo error: ${msg}`, log: entries });
    }

    if (!data.result) {
      log("No result object in response", "error");
      log(`Full response: ${JSON.stringify(data).slice(0, 300)}`, "error");
      return res.status(401).json({ error: "Odoo returned no result — check database name", log: entries });
    }

    if (!data.result.uid) {
      log(`Result present but uid is missing: uid=${data.result.uid}`, "error");
      log(`Result keys: ${Object.keys(data.result).join(", ")}`, "error");
      if (data.result.db === false) log("Database name not found on server", "error");
      return res.status(401).json({
        error: "Authentication failed — uid missing. Wrong database name or bad credentials.",
        log: entries,
      });
    }

    log(`✓ Authenticated as "${data.result.name}" (uid: ${data.result.uid})`, "success");
    res.json({
      uid: data.result.uid,
      name: data.result.name,
      sessionCookie,  // returned to client, passed back on every odoo/call
      log: entries,
    });
  } catch (e) {
    log(`Network or parse error: ${e.message}`, "error");
    if (e.code) log(`Error code: ${e.code}`, "error");
    res.status(401).json({ error: e.message, log: entries });
  }
});

// ─── Odoo call proxy ──────────────────────────────────────────────────────────
app.post("/api/odoo/call", async (req, res) => {
  const { url, model, method, args, kwargs, sessionCookie } = req.body;
  if (!url || !model || !method)
    return res.status(400).json({ error: "Missing required fields" });

  const callHeaders = { "Content-Type": "application/json" };
  // Use session cookie for authentication on every call — this is what
  // was missing before, causing all writes to silently fail
  if (sessionCookie) callHeaders["Cookie"] = sessionCookie;

  try {
    const response = await fetch(`${url.replace(/\/$/, "")}/web/dataset/call_kw`, {
      method: "POST",
      headers: callHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0", method: "call",
        params: {
          model, method,
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

// ─── Serve React build ────────────────────────────────────────────────────────
const clientBuild = path.join(__dirname, "../client/dist");
app.use(express.static(clientBuild));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientBuild, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Square→Odoo migrator running on port ${PORT}`);
});

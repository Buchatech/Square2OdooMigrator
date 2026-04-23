import { useState, useRef, useCallback } from "react";

// ─── API helpers (call our own backend proxy) ────────────────────────────────

async function apiFetch(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Mock data ────────────────────────────────────────────────────────────────

function generateMockData() {
  const names = [
    ["Alice","Nguyen"], ["Bob","Martinson"], ["Clara","Osei"],
    ["David","Patel"], ["Emma","Schultz"], ["Femi","Adeyemi"],
    ["Grace","Kim"], ["Henry","Vasquez"],
  ];
  const customers = names.map(([first, last], i) => ({
    id: `CUST_${1000 + i}`,
    given_name: first, family_name: last,
    email_address: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
    phone_number: `+1 (612) 555-${String(1000 + i * 37).slice(0,4)}`,
    address: { address_line_1: `${100+i*11} Main St`, locality: "Minneapolis", administrative_district_level_1: "MN", postal_code: `554${String(i).padStart(2,"0")}`, country: "US" },
    reference_id: `REF-${1000+i}`,
    note: i % 3 === 0 ? "VIP customer" : "",
  }));
  const invoices = customers.slice(0, 5).map((c, i) => ({
    id: `INV_${2000+i}`,
    customer_id: c.id,
    customer_name: `${c.given_name} ${c.family_name}`,
    status: ["PAID","UNPAID","PAID","OVERDUE","PAID"][i],
    payment_requests: [{ total_money: { amount: (5000+i*1337)*10, currency:"USD" }, due_date: `2024-0${i+1}-15` }],
    invoice_number: `SQ-${2000+i}`,
    created_at: `2024-0${i+1}-01T10:00:00Z`,
    line_items: [{ name:["Consulting","Design","Dev Work","Support","Marketing"][i], quantity:"1", total_money:{ amount:(5000+i*1337)*10, currency:"USD" } }],
  }));
  const vendors = [
    { id:"VEN_001", name:"Acme Supplies Co.", email:"orders@acmesupplies.com", phone:"+1 (800) 555-0100", type:"vendor" },
    { id:"VEN_002", name:"Metro Office Products", email:"billing@metroofficepro.com", phone:"+1 (800) 555-0101", type:"vendor" },
    { id:"CON_001", name:"Jane Freelance Developer", email:"jane@janedev.io", phone:"+1 (612) 555-0200", type:"contractor" },
    { id:"CON_002", name:"Mark Graphic Design", email:"mark@markdesigns.com", phone:"+1 (612) 555-0201", type:"contractor" },
  ];
  return { customers, invoices, vendors };
}

// ─── Odoo transformers ────────────────────────────────────────────────────────

function squareCustomerToOdoo(c) {
  const a = c.address || {};
  return {
    name: [c.given_name, c.family_name].filter(Boolean).join(" ") || c.company_name || "Unknown",
    email: c.email_address || "",
    phone: c.phone_number || "",
    street: a.address_line_1 || "",
    street2: a.address_line_2 || "",
    city: a.locality || "",
    zip: a.postal_code || "",
    country_id: a.country === "US" ? 233 : false,
    customer_rank: 1,
    comment: c.note || "",
    ref: c.reference_id || c.id,
  };
}

function squareVendorToOdoo(v) {
  return {
    name: v.name, email: v.email || "", phone: v.phone || "",
    supplier_rank: 1, customer_rank: 0,
    comment: v.type === "contractor" ? "Contractor" : "Vendor",
  };
}

// ─── Small UI components ──────────────────────────────────────────────────────

function Badge({ color, children }) {
  const map = {
    blue:  { bg:"#eef2ff", text:"#1a3a9e", border:"#c7d4fc" },
    green: { bg:"#edf7f1", text:"#1a5c35", border:"#b0dfc3" },
    amber: { bg:"#fff8eb", text:"#7a4500", border:"#f5d28a" },
    red:   { bg:"#fff0f0", text:"#8a1a1a", border:"#f5b8b8" },
    gray:  { bg:"#f2f1ee", text:"#4a4a44", border:"#d0cfc9" },
    teal:  { bg:"#e8f7f4", text:"#0d5a4a", border:"#9fd9cc" },
  };
  const c = map[color] || map.gray;
  return (
    <span style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: 5, padding: "2px 9px", fontSize: 12, fontWeight: 500, whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{ background:"var(--surface)", borderRadius:"var(--radius)", border:"1px solid var(--border)",
      boxShadow:"var(--shadow)", padding:"1.25rem", ...style }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 style={{ fontSize:15, fontWeight:600, marginBottom:"0.75rem", color:"var(--text)" }}>{children}</h3>;
}

function Field({ label, children, col }) {
  return (
    <div style={{ gridColumn: col }}>
      <label style={{ fontSize:13, color:"var(--text-muted)", display:"block", marginBottom:5, fontWeight:500 }}>{label}</label>
      {children}
    </div>
  );
}

function Alert({ type, children }) {
  const colors = { error: { bg:"var(--danger-bg)", border:"#fcc", color:"var(--danger)" },
    warn: { bg:"var(--warn-bg)", border:"#fde68a", color:"var(--warn)" },
    info: { bg:"var(--accent-bg)", border:"#c7d4fc", color:"#1a3a9e" } };
  const c = colors[type] || colors.info;
  return (
    <div style={{ background:c.bg, border:`1px solid ${c.border}`, color:c.color,
      borderRadius:"var(--radius-sm)", padding:"10px 14px", fontSize:13 }}>
      {children}
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Square", "Preview", "Configure", "Migrate", "Done"];

function StepBar({ current }) {
  return (
    <div style={{ display:"flex", alignItems:"flex-start", gap:0, marginBottom:"2rem" }}>
      {STEPS.map((s, i) => (
        <div key={s} style={{ display:"flex", alignItems:"center", flex: i < STEPS.length - 1 ? 1 : 0 }}>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
            <div style={{
              width:30, height:30, borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:13, fontWeight:600, transition:"all 0.2s",
              background: i < current ? "var(--success)" : i === current ? "var(--accent)" : "var(--surface2)",
              color: i <= current ? "white" : "var(--text-faint)",
              border: i > current ? "1px solid var(--border-strong)" : "none",
            }}>
              {i < current ? "✓" : i + 1}
            </div>
            <span style={{ fontSize:12, color: i===current ? "var(--text)" : "var(--text-muted)", fontWeight: i===current ? 600 : 400 }}>
              {s}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div style={{ flex:1, height:1, margin:"-16px 6px 0",
              background: i < current ? "var(--success)" : "var(--border)" }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Log component ────────────────────────────────────────────────────────────

function LogPanel({ entries, logRef }) {
  const colors = { success:"var(--success)", error:"var(--danger)", warn:"var(--warn)", info:"var(--text-muted)" };
  const icons  = { success:"✓", error:"✗", warn:"⚠", info:"·" };
  return (
    <div ref={logRef} style={{ maxHeight:260, overflowY:"auto", fontFamily:"var(--mono)",
      fontSize:12, lineHeight:1.7, background:"var(--surface2)", borderRadius:"var(--radius-sm)",
      padding:"0.75rem", border:"1px solid var(--border)" }}>
      {entries.length === 0 && <span style={{ color:"var(--text-faint)" }}>Waiting to start...</span>}
      {entries.map((e, i) => (
        <div key={i} style={{ display:"flex", gap:8 }}>
          <span style={{ color: colors[e.type] || colors.info, flexShrink:0 }}>{icons[e.type]||"·"}</span>
          <span style={{ color:"var(--text-faint)", flexShrink:0 }}>{e.time}</span>
          <span style={{ color: colors[e.type] || "var(--text)" }}>{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [step, setStep] = useState(0);
  // Square
  const [squareToken, setSquareToken]   = useState("");
  const [squareSandbox, setSquareSandbox] = useState(true);
  const [useMock, setUseMock]           = useState(true);
  // Odoo
  const [odooUrl, setOdooUrl]   = useState("");
  const [odooDB, setOdooDB]     = useState("");
  const [odooUser, setOdooUser] = useState("");
  const [odooPass, setOdooPass] = useState("");
  const [odooUID, setOdooUID]   = useState(null);
  // Data
  const [preview, setPreview] = useState({ customers:[], invoices:[], vendors:[] });
  // Manual vendors
  const [manualVendors, setManualVendors] = useState([]);
  const [newVendor, setNewVendor] = useState({ name:"", email:"", phone:"", type:"vendor" });
  // Selection
  const [sel, setSel] = useState({ customers:true, invoices:true, vendors:true, companyInfo:true });
  // Company info
  const [company, setCompany] = useState({ name:"", email:"", phone:"", street:"", city:"", zip:"", country:"US", vat:"" });
  // Migration
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState({ done:0, total:0, label:"" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState({ customers:0, invoices:0, vendors:0 });
  const logRef = useRef(null);

  const addLog = useCallback((msg, type="info") => {
    const time = new Date().toLocaleTimeString();
    setLog(prev => [...prev, { msg, type, time }]);
    setTimeout(() => { if(logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, 40);
  }, []);

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // ── Step 0: Fetch Square data ──
  async function handleFetchSquare() {
    setLoading(true); setError("");
    try {
      if (useMock) {
        await sleep(600);
        setPreview(generateMockData());
      } else {
        const data = await apiFetch("/api/square/fetch", { token: squareToken, sandbox: squareSandbox });
        setPreview({ customers: data.customers||[], invoices: data.invoices||[], vendors: [] });
      }
      setStep(1);
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  // ── Step 2 → 3: Authenticate Odoo ──
  async function handleOdooAuth() {
    setLoading(true); setError("");
    try {
      if (useMock) {
        await sleep(400);
        setOdooUID(1);
      } else {
        const data = await apiFetch("/api/odoo/auth", { url:odooUrl, db:odooDB, username:odooUser, password:odooPass });
        setOdooUID(data.uid);
      }
      setStep(3);
    } catch(e) { setError(e.message); }
    setLoading(false);
  }

  async function odooCall(model, method, args, kwargs={}) {
    const data = await apiFetch("/api/odoo/call", {
      url:odooUrl, db:odooDB, uid:odooUID, password:odooPass,
      model, method, args, kwargs,
    });
    return data.result;
  }

  // ── Step 3: Run migration ──
  async function handleMigrate() {
    setLoading(true); setLog([]); setError("");
    const allVendors = [...preview.vendors, ...manualVendors];
    const total =
      (sel.companyInfo && company.name ? 1 : 0) +
      (sel.customers ? preview.customers.length : 0) +
      (sel.vendors ? allVendors.length : 0) +
      (sel.invoices ? preview.invoices.length : 0);

    setProgress({ done:0, total, label:"Starting..." });
    const res = { customers:0, invoices:0, vendors:0 };
    let done = 0;

    const tick = (label) => { done++; setProgress({ done, total, label }); };

    try {
      // Company info
      if (sel.companyInfo && company.name) {
        addLog("Updating company information...");
        if (!useMock) {
          await odooCall("res.company", "write", [[1], {
            name:company.name, email:company.email, phone:company.phone,
            street:company.street, city:company.city, zip:company.zip, vat:company.vat,
          }]);
        } else { await sleep(300); }
        addLog(`Company info updated: ${company.name}`, "success");
        tick("Company info");
      }

      // Customers
      if (sel.customers) {
        addLog(`Migrating ${preview.customers.length} customers...`);
        for (const c of preview.customers) {
          const payload = squareCustomerToOdoo(c);
          if (!useMock) { await odooCall("res.partner", "create", [payload]); }
          else { await sleep(60); }
          res.customers++;
          tick(`Customer: ${payload.name}`);
        }
        addLog(`${res.customers} customers migrated`, "success");
      }

      // Vendors & contractors
      if (sel.vendors && allVendors.length > 0) {
        addLog(`Migrating ${allVendors.length} vendors/contractors...`);
        for (const v of allVendors) {
          const payload = squareVendorToOdoo(v);
          if (!useMock) { await odooCall("res.partner", "create", [payload]); }
          else { await sleep(80); }
          res.vendors++;
          tick(`Vendor: ${v.name}`);
        }
        addLog(`${res.vendors} vendors/contractors migrated`, "success");
      }

      // Invoices
      if (sel.invoices) {
        addLog(`Migrating ${preview.invoices.length} invoices...`);
        for (const inv of preview.invoices) {
          try {
            if (!useMock) {
              const partners = await odooCall("res.partner", "search_read",
                [[["ref","=",inv.customer_id]]], { fields:["id"], limit:1 });
              const lines = (inv.line_items||[]).map(item => [0, 0, {
                name: item.name||"Item",
                quantity: parseFloat(item.quantity)||1,
                price_unit: (item.total_money?.amount||0)/100,
              }]);
              await odooCall("account.move", "create", [{
                move_type: "out_invoice",
                partner_id: partners[0]?.id || false,
                invoice_date: inv.created_at?.split("T")[0],
                invoice_date_due: inv.payment_requests?.[0]?.due_date,
                ref: inv.invoice_number,
                invoice_line_ids: lines,
              }]);
            } else { await sleep(90); }
            res.invoices++;
            tick(`Invoice: ${inv.invoice_number||inv.id}`);
          } catch(e) {
            addLog(`Invoice ${inv.invoice_number||inv.id} failed: ${e.message}`, "warn");
            tick(`Invoice failed: ${inv.invoice_number||inv.id}`);
          }
        }
        addLog(`${res.invoices} invoices migrated`, "success");
      }

      addLog("Migration complete!", "success");
      setResults(res);
      setStep(4);
    } catch(e) {
      addLog(`Fatal: ${e.message}`, "error");
      setError(e.message);
    }
    setLoading(false);
  }

  // ─── Renders ──────────────────────────────────────────────────────────────

  function Step0() {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
        <Card>
          <SectionTitle>Square API</SectionTitle>
          <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:14, cursor:"pointer", marginBottom:16 }}>
            <input type="checkbox" checked={useMock} onChange={e=>setUseMock(e.target.checked)} />
            Use demo data (no API key required — great for testing)
          </label>
          {!useMock && (
            <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              <Field label="Square Access Token">
                <input type="password" value={squareToken} onChange={e=>setSquareToken(e.target.value)}
                  placeholder="EAAAl..." />
              </Field>
              <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:14, cursor:"pointer" }}>
                <input type="checkbox" checked={squareSandbox} onChange={e=>setSquareSandbox(e.target.checked)} />
                Use Square Sandbox environment
              </label>
              <p style={{ fontSize:12, color:"var(--text-muted)" }}>
                Get your token at <strong>developer.squareup.com</strong> → Applications → Your App → OAuth → Access Token
              </p>
            </div>
          )}
          {useMock && (
            <p style={{ fontSize:13, color:"var(--text-muted)" }}>
              Demo mode generates 8 sample customers, 5 invoices, and 4 vendors/contractors so you can test the full flow without any credentials.
            </p>
          )}
        </Card>

        {error && <Alert type="error">{error}</Alert>}

        <div style={{ display:"flex", justifyContent:"flex-end" }}>
          <button className="primary" onClick={handleFetchSquare}
            disabled={loading || (!useMock && !squareToken)}>
            {loading ? "Fetching..." : "Fetch Square data →"}
          </button>
        </div>
      </div>
    );
  }

  function Step1() {
    const { customers, invoices, vendors } = preview;
    const pct = (n,d) => d>0 ? `${Math.round(n/d*100)}%` : "—";
    const paid = invoices.filter(i=>i.status==="PAID").length;
    const totalAmt = invoices.reduce((s,i)=>s+(i.payment_requests?.[0]?.total_money?.amount||0),0);

    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {[
            ["Customers", customers.length, "var(--accent)"],
            ["Invoices", invoices.length, "var(--success)"],
            ["Vendors / Contractors", vendors.length + manualVendors.length, "var(--warn)"],
          ].map(([label, count, color]) => (
            <Card key={label} style={{ textAlign:"center" }}>
              <div style={{ fontSize:32, fontWeight:600, color }}>{count}</div>
              <div style={{ fontSize:13, color:"var(--text-muted)", marginTop:2 }}>{label}</div>
            </Card>
          ))}
        </div>

        {/* Customers table */}
        {customers.length > 0 && (
          <Card>
            <SectionTitle>Customers</SectionTitle>
            <div style={{ overflowX:"auto" }}>
              <table>
                <thead><tr>
                  {["Name","Email","Phone","City","State"].map(h=><th key={h}>{h}</th>)}
                </tr></thead>
                <tbody>{customers.slice(0,6).map(c=>(
                  <tr key={c.id}>
                    <td style={{ fontWeight:500 }}>{c.given_name} {c.family_name}</td>
                    <td style={{ color:"var(--text-muted)" }}>{c.email_address}</td>
                    <td style={{ color:"var(--text-muted)" }}>{c.phone_number}</td>
                    <td>{c.address?.locality}</td>
                    <td>{c.address?.administrative_district_level_1}</td>
                  </tr>
                ))}</tbody>
              </table>
              {customers.length > 6 && <p style={{ fontSize:12, color:"var(--text-muted)", padding:"6px 12px" }}>+{customers.length-6} more customers</p>}
            </div>
          </Card>
        )}

        {/* Invoices table */}
        {invoices.length > 0 && (
          <Card>
            <SectionTitle>Invoices — ${(totalAmt/100).toLocaleString()} total · {pct(paid,invoices.length)} paid</SectionTitle>
            <div style={{ overflowX:"auto" }}>
              <table>
                <thead><tr>
                  {["Invoice #","Customer","Amount","Status","Due Date"].map(h=><th key={h}>{h}</th>)}
                </tr></thead>
                <tbody>{invoices.slice(0,5).map(inv=>{
                  const amt = inv.payment_requests?.[0]?.total_money?.amount||0;
                  const color = { PAID:"green", UNPAID:"amber", OVERDUE:"red" }[inv.status]||"gray";
                  return (
                    <tr key={inv.id}>
                      <td style={{ fontFamily:"var(--mono)", fontSize:13 }}>{inv.invoice_number||inv.id}</td>
                      <td>{inv.customer_name}</td>
                      <td style={{ fontWeight:500 }}>${(amt/100).toLocaleString()}</td>
                      <td><Badge color={color}>{inv.status}</Badge></td>
                      <td style={{ color:"var(--text-muted)" }}>{inv.payment_requests?.[0]?.due_date}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Manual vendors section */}
        <Card>
          <SectionTitle>Vendors & Contractors</SectionTitle>
          <p style={{ fontSize:13, color:"var(--text-muted)", marginBottom:12 }}>
            Square doesn't store vendor/contractor records. Add them manually here and they'll be created in Odoo.
          </p>
          {manualVendors.length > 0 && (
            <div style={{ overflowX:"auto", marginBottom:14 }}>
              <table>
                <thead><tr>{["Name","Email","Phone","Type",""].map(h=><th key={h}>{h}</th>)}</tr></thead>
                <tbody>{manualVendors.map((v,i)=>(
                  <tr key={i}>
                    <td style={{ fontWeight:500 }}>{v.name}</td>
                    <td style={{ color:"var(--text-muted)" }}>{v.email}</td>
                    <td style={{ color:"var(--text-muted)" }}>{v.phone}</td>
                    <td><Badge color={v.type==="contractor"?"teal":"blue"}>{v.type}</Badge></td>
                    <td><button onClick={()=>setManualVendors(prev=>prev.filter((_,j)=>j!==i))} style={{ fontSize:12, padding:"2px 8px", color:"var(--danger)" }}>remove</button></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
            <Field label="Name" col="1/2">
              <input value={newVendor.name} onChange={e=>setNewVendor(p=>({...p,name:e.target.value}))} placeholder="Acme Supplies" />
            </Field>
            <Field label="Type" col="2/3">
              <select value={newVendor.type} onChange={e=>setNewVendor(p=>({...p,type:e.target.value}))}>
                <option value="vendor">Vendor</option>
                <option value="contractor">Contractor</option>
              </select>
            </Field>
            <Field label="Email" col="1/2">
              <input type="email" value={newVendor.email} onChange={e=>setNewVendor(p=>({...p,email:e.target.value}))} placeholder="contact@example.com" />
            </Field>
            <Field label="Phone" col="2/3">
              <input type="tel" value={newVendor.phone} onChange={e=>setNewVendor(p=>({...p,phone:e.target.value}))} placeholder="+1 (800) 555-0100" />
            </Field>
          </div>
          <button onClick={()=>{ if(!newVendor.name) return; setManualVendors(p=>[...p,{...newVendor,id:`MAN_${Date.now()}`}]); setNewVendor({name:"",email:"",phone:"",type:"vendor"}); }}
            style={{ marginTop:12 }} disabled={!newVendor.name}>
            + Add vendor/contractor
          </button>
        </Card>

        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button onClick={()=>setStep(0)}>← Back</button>
          <button className="primary" onClick={()=>setStep(2)}>Configure migration →</button>
        </div>
      </div>
    );
  }

  function Step2() {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
        <Card>
          <SectionTitle>What to migrate</SectionTitle>
          {[
            ["customers", `Customers (${preview.customers.length})`, "Created as contacts with Customer rank in Odoo (res.partner)"],
            ["invoices",  `Invoices (${preview.invoices.length})`, "Created as customer invoices in Odoo Accounting (account.move)"],
            ["vendors",   `Vendors & Contractors (${[...preview.vendors,...manualVendors].length})`, "Created as contacts with Supplier rank in Odoo (res.partner)"],
            ["companyInfo","My company info", "Updates your company record in Odoo Settings (res.company)"],
          ].map(([key,label,desc])=>(
            <label key={key} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"10px 0",
              borderBottom:"1px solid var(--border)", cursor:"pointer" }}>
              <input type="checkbox" checked={sel[key]} onChange={e=>setSel(p=>({...p,[key]:e.target.checked}))} style={{ marginTop:3 }} />
              <div>
                <div style={{ fontWeight:500, fontSize:14 }}>{label}</div>
                <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>{desc}</div>
              </div>
            </label>
          ))}
        </Card>

        {sel.companyInfo && (
          <Card>
            <SectionTitle>Your company information</SectionTitle>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <Field label="Company name" col="1/-1"><input value={company.name} onChange={e=>setCompany(p=>({...p,name:e.target.value}))} placeholder="Acme Inc." /></Field>
              <Field label="Email"><input type="email" value={company.email} onChange={e=>setCompany(p=>({...p,email:e.target.value}))} placeholder="info@acme.com" /></Field>
              <Field label="Phone"><input type="tel" value={company.phone} onChange={e=>setCompany(p=>({...p,phone:e.target.value}))} placeholder="+1 (612) 555-0100" /></Field>
              <Field label="Street address" col="1/-1"><input value={company.street} onChange={e=>setCompany(p=>({...p,street:e.target.value}))} /></Field>
              <Field label="City"><input value={company.city} onChange={e=>setCompany(p=>({...p,city:e.target.value}))} /></Field>
              <Field label="ZIP code"><input value={company.zip} onChange={e=>setCompany(p=>({...p,zip:e.target.value}))} /></Field>
              <Field label="Tax ID / VAT" col="1/-1"><input value={company.vat} onChange={e=>setCompany(p=>({...p,vat:e.target.value}))} placeholder="US123456789" /></Field>
            </div>
          </Card>
        )}

        <Card>
          <SectionTitle>Odoo credentials</SectionTitle>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Odoo URL" col="1/-1">
              <input value={odooUrl} onChange={e=>setOdooUrl(e.target.value)}
                placeholder={useMock ? "https://mycompany.odoo.com (optional in demo)" : "https://mycompany.odoo.com"} />
            </Field>
            <Field label="Database"><input value={odooDB} onChange={e=>setOdooDB(e.target.value)} placeholder="mycompany" /></Field>
            <Field label="Username"><input value={odooUser} onChange={e=>setOdooUser(e.target.value)} placeholder="admin@acme.com" /></Field>
            <Field label="Password or API key" col="1/-1"><input type="password" value={odooPass} onChange={e=>setOdooPass(e.target.value)} /></Field>
          </div>
          {!useMock && (
            <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:10 }}>
              Create API keys in Odoo: Settings → Technical → API Keys. Use your login password if API keys aren't available.
            </p>
          )}
        </Card>

        {error && <Alert type="error">{error}</Alert>}

        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button onClick={()=>setStep(1)}>← Back</button>
          <button className="primary" onClick={handleOdooAuth}
            disabled={loading || (!useMock && (!odooUrl||!odooDB||!odooUser||!odooPass))}>
            {loading ? "Connecting to Odoo..." : "Connect to Odoo →"}
          </button>
        </div>
      </div>
    );
  }

  function Step3() {
    const allVendors = [...preview.vendors, ...manualVendors];
    const pct = progress.total > 0 ? Math.round(progress.done/progress.total*100) : 0;
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
        {!loading && log.length === 0 && (
          <Card>
            <SectionTitle>Ready to migrate</SectionTitle>
            <p style={{ fontSize:13, color:"var(--text-muted)", marginBottom:12 }}>
              The following will be written to your Odoo instance. Review before proceeding — this cannot be automatically undone.
            </p>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              {sel.customers   && <Badge color="blue">{preview.customers.length} customers</Badge>}
              {sel.invoices    && <Badge color="green">{preview.invoices.length} invoices</Badge>}
              {sel.vendors     && allVendors.length > 0 && <Badge color="amber">{allVendors.length} vendors/contractors</Badge>}
              {sel.companyInfo && company.name && <Badge color="gray">company info</Badge>}
            </div>
            {useMock && <Alert type="info" style={{ marginTop:12 }}>Demo mode — no real data will be written to Odoo.</Alert>}
          </Card>
        )}

        {(loading || log.length > 0) && (
          <Card>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
              <SectionTitle style={{ margin:0 }}>Migration log</SectionTitle>
              {loading && <span style={{ fontSize:13, fontWeight:500, color:"var(--accent)" }}>{pct}%</span>}
            </div>
            {loading && progress.total > 0 && (
              <div style={{ marginBottom:12 }}>
                <div style={{ height:6, background:"var(--surface2)", borderRadius:3, overflow:"hidden", border:"1px solid var(--border)" }}>
                  <div style={{ height:"100%", width:`${pct}%`, background:"var(--accent)", borderRadius:3, transition:"width 0.25s" }} />
                </div>
                <p style={{ fontSize:12, color:"var(--text-muted)", marginTop:4 }}>{progress.label}</p>
              </div>
            )}
            <LogPanel entries={log} logRef={logRef} />
          </Card>
        )}

        {error && <Alert type="error">{error}</Alert>}

        <div style={{ display:"flex", justifyContent:"space-between" }}>
          <button onClick={()=>setStep(2)} disabled={loading}>← Back</button>
          <button className="primary" onClick={handleMigrate} disabled={loading}>
            {loading ? `Migrating... ${pct}%` : "Start migration"}
          </button>
        </div>
      </div>
    );
  }

  function Step4() {
    return (
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:"1.5rem", padding:"2rem 0", textAlign:"center" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"var(--success-bg)",
          display:"flex", alignItems:"center", justifyContent:"center", fontSize:32, color:"var(--success)",
          border:"2px solid #b0dfc3" }}>✓</div>
        <div>
          <h2 style={{ fontSize:22, fontWeight:600, marginBottom:6 }}>Migration complete</h2>
          <p style={{ color:"var(--text-muted)", fontSize:14 }}>Your Square data has been successfully imported into Odoo.</p>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, width:"100%", maxWidth:420 }}>
          {[["Customers",results.customers,"var(--accent)"],["Invoices",results.invoices,"var(--success)"],["Vendors",results.vendors,"var(--warn)"]].map(([l,n,c])=>(
            <Card key={l} style={{ textAlign:"center" }}>
              <div style={{ fontSize:28, fontWeight:600, color:c }}>{n}</div>
              <div style={{ fontSize:12, color:"var(--text-muted)", marginTop:2 }}>{l}</div>
            </Card>
          ))}
        </div>
        <Card style={{ width:"100%", maxWidth:500, textAlign:"left" }}>
          <SectionTitle>Next steps in Odoo</SectionTitle>
          {[
            ["Contacts → Customers", "Verify imported customer records"],
            ["Accounting → Customers → Invoices", "Review migrated invoices"],
            ["Purchase → Vendors", "Check vendor and contractor records"],
            ["Settings → General Settings → Companies", "Confirm your company info"],
            ["Settings → Technical → Currencies", "Set up bank accounts and payment methods"],
          ].map(([path, desc], i) => (
            <div key={i} style={{ display:"flex", gap:12, padding:"8px 0", borderBottom:"1px solid var(--border)", fontSize:13 }}>
              <span style={{ color:"var(--text-faint)", minWidth:18, fontWeight:600 }}>{i+1}.</span>
              <div>
                <div style={{ fontFamily:"var(--mono)", fontSize:12, color:"var(--accent)", marginBottom:2 }}>{path}</div>
                <div style={{ color:"var(--text-muted)" }}>{desc}</div>
              </div>
            </div>
          ))}
        </Card>
        <button onClick={()=>{ setStep(0); setLog([]); setProgress({done:0,total:0,label:""}); }}>
          Run another migration
        </button>
      </div>
    );
  }

  const steps = [Step0, Step1, Step2, Step3, Step4];
  const CurrentStep = steps[step];

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", padding:"2rem 1rem" }}>
      <div style={{ maxWidth:700, margin:"0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom:"2rem" }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
            <div style={{ width:36, height:36, borderRadius:8, background:"var(--accent)",
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:18 }}>⇄</div>
            <h1 style={{ fontSize:22, fontWeight:600, letterSpacing:"-0.5px" }}>Square → Odoo Migrator</h1>
          </div>
          <p style={{ fontSize:14, color:"var(--text-muted)", marginLeft:46 }}>
            Migrate customers, invoices, vendors & contractors, and company info
          </p>
        </div>

        <StepBar current={step} />
        <CurrentStep />
      </div>
    </div>
  );
}

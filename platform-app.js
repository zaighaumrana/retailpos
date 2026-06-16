/* ═══════════════════════════════════════════════════════════════════
   RetailOS — Platform Admin Console
   Backend: Supabase (platform project — separate from client projects)
   Access: retailpos.ahwad.com/platform.html
═══════════════════════════════════════════════════════════════════ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

// YOUR platform Supabase project — not the client's
const PLATFORM_URL  = "https://ukbhyerxshteyetwomqy.supabase.co";
const PLATFORM_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrYmh5ZXJ4c2h0ZXlldHdvbXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTc2NTUsImV4cCI6MjA5Njc3MzY1NX0.ioAMUo2YZcfhvHGeZOVa5UYMTSZiEMXj9HISrWCa-Do";
const pb            = createClient(PLATFORM_URL, PLATFORM_ANON);

/* ── State ─────────────────────────────────────────────────────── */
const pState = {
  page:       "login",   // login | overview | clients | client-detail | support | settings
  theme:      localStorage.getItem("retailos-platform-theme") || "light",
  online:     navigator.onLine,
  data:       { clients: [], support: [], config: {} },
  modal:      null,
  filter:     "",
  selectedClient: null,   // full client row
  clientData:     {},     // live data pulled from selected client's Supabase
  adminPin:       "",
  authenticated:  false,
};

let PCFG = { admin_password: "1234" };

/* ── Supabase helpers ──────────────────────────────────────────── */
async function loadPlatform() {
  const [clients, support, config, usage, invoices] = await Promise.all([
    pb.from("clients").select("*").order("created_at", { ascending: false }),
    pb.from("support_tickets").select("*").order("created_at", { ascending: false }),
    pb.from("platform_config").select("*").single(),
    pb.from("usage_logs").select("*").gte("recorded_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
    pb.from("billing_cycles").select("*").order("created_at", { ascending: false }),
  ]);
  pState.data.clients  = clients.data  || [];
  pState.data.support  = support.data  || [];
  pState.data.usage    = usage.data    || [];
  pState.data.invoices = invoices.data || [];
  if (config.data) PCFG = config.data;
  render();
}

// Connect to a specific client's Supabase and pull their live data
async function loadClientData(client) {
  const csb = createClient(client.supabase_url, client.supabase_anon);
  const [cfg, tickets, sales, employees, udhar] = await Promise.all([
    csb.from("shop_config").select("*").single(),
    csb.from("tickets").select("*").order("id", { ascending: false }).limit(50),
    csb.from("sales").select("*").order("id", { ascending: false }).limit(50),
    csb.from("employees").select("id, name, role, status"),
    csb.from("udhar").select("*").order("id", { ascending: false }).limit(30),
  ]);
  pState.clientData = {
    config:    cfg.data      || {},
    tickets:   tickets.data  || [],
    sales:     sales.data    || [],
    employees: employees.data|| [],
    udhar:     udhar.data    || [],
    _sb:       csb,           // keep client sb instance for writes
  };
}

async function updateClientConfig(client, updates) {
  const csb = pState.clientData._sb || createClient(client.supabase_url, client.supabase_anon);
  const { error } = await csb.from("shop_config").update(updates).eq("id", 1);
  if (error) { alert("Error updating client config: " + error.message); return false; }
  return true;
}

/* ── Render ────────────────────────────────────────────────────── */
const money = (v, sym = "Rs.") =>
  `${sym} ${Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const NAV = [
  { page: "overview", icon: "▦", label: "Overview"        },
  { page: "clients",  icon: "◉", label: "Clients"         },
  { page: "billing",  icon: "◑", label: "Billing"         },
  { page: "support",  icon: "◈", label: "Support Tickets" },
  { page: "settings", icon: "◐", label: "Settings"        },
];

function render() {
  const app = document.getElementById("platform-app");
  document.documentElement.dataset.theme = pState.theme;

  if (!pState.authenticated) {
  app.innerHTML = loginPage();

  const tw = document.getElementById("cf-turnstile-platform");

  if (tw && window.turnstile && !tw.dataset.mounted) {
    tw.dataset.mounted = "1";

    window.turnstile.render(tw, {
      sitekey: "0x4AAAAAADl87EDGnxcg5eJZ",
      theme: "light",
      callback: () => {
        const btn = document.getElementById("platform-login-btn");
        if (btn) btn.disabled = false;
      }
    });

    const btn = document.getElementById("platform-login-btn");
    if (btn) btn.disabled = true;
  }

  return;
}

  app.innerHTML = `
    <div class="platform-shell">
      <aside class="platform-sidebar" id="p-sidebar">
        <div class="brand" style="padding:4px 0 14px">
          <div class="platform-logo">RA</div>
          <div>
            <strong style="color:#f3f7fa;font-size:15px">RetailOS</strong>
            <span style="color:#5c9986;font-size:12px;display:block">Platform Console</span>
          </div>
        </div>
        <nav class="platform-nav">
          ${NAV.map(n => `
            <button class="platform-nav-btn ${pState.page === n.page ? "active" : ""}"
              data-p-page="${n.page}">
              <span>${n.icon}</span><span>${n.label}</span>
            </button>`).join("")}
        </nav>
        <div style="margin-top:auto;padding-top:14px;
                    border-top:1px solid #1e3830">
          <div style="color:#4a7a6e;font-size:12px;padding:6px 12px">
            Platform owner access only.
          </div>
          <button class="platform-nav-btn" data-p-action="logout"
            style="color:#c24132">
            <span>⏻</span><span>Logout</span>
          </button>
        </div>
      </aside>
      <div class="platform-main">
        <header class="platform-topbar">
          <h2 style="font-size:16px;color:var(--muted)">
            ${NAV.find(n => n.page === pState.page)?.label || "Platform"}
            ${pState.selectedClient && pState.page === "client-detail"
              ? ` — ${pState.selectedClient.name}` : ""}
          </h2>
          <div class="top-actions">
            <span class="chip">
              <i class="dot ${pState.online ? "" : "offline"}"></i>
              ${pState.online ? "Online" : "Offline"}
            </span>
            <span class="chip">
              ${pState.data.clients.length} clients
            </span>
            <button class="icon-button" data-p-action="theme">
              ${pState.theme === "dark" ? "Light" : "Dark"}
            </button>
          </div>
        </header>
        <section class="content">${platformPage()}</section>
      </div>
    </div>
    ${pModal()}
  `;
}

function platformPage() {
  switch (pState.page) {
    case "overview":      return pageOverview();
    case "clients":       return pageClients();
    case "client-detail": return pageClientDetail();
    case "billing":       return pageBilling();
    case "support":       return pageSupport();
    case "settings":      return pageSettings();
    default:              return pageOverview();
  }
}

/* ── Login ─────────────────────────────────────────────────────── */
function loginPage() {
  return `
    <div style="min-height:100vh;display:grid;place-items:center;background:var(--bg)">
      <div class="card" style="width:min(380px,90vw);display:grid;gap:18px;padding:32px">
        <div style="text-align:center">
          <div class="logo" style="margin:0 auto 14px;width:56px;height:56px;
                                   font-size:16px;background:#0f1a17;color:#7aada0">
            RA
          </div>
          <h2>RetailOS Platform</h2>
          <p class="muted">Enter admin password to continue</p>
        </div>
        
        <input id="platform-pin" type="password" class="search"
          placeholder="Admin password"
          style="text-align:center;font-size:20px;letter-spacing:8px">
          
        <div id="cf-turnstile-platform" style="display:flex;justify-content:center;margin:8px 0"></div>
        
        <div id="platform-pin-error" class="hidden"
          style="color:var(--danger);text-align:center;font-size:13px">
          Wrong password.
        </div>
        
        <button class="primary-button" data-p-action="do-login"
          style="min-height:48px;font-size:16px">
          Login
        </button>
      </div>
    </div>`;
}

/* ── Overview ──────────────────────────────────────────────────── */
function pageOverview() {
  const clients  = pState.data.clients;
  const active   = clients.filter(c => c.status === "Active").length;
  const suspended= clients.filter(c => c.status === "Suspended").length;
  const support  = pState.data.support.filter(s => s.status === "Open").length;
  const plans    = { Premium: 149, Standard: 79, Basic: 29 };
  const mrr      = clients.reduce((s, c) => s + (plans[c.plan] || 29), 0);

  return `
    ${tit("Platform Overview", "Live status across all clients.", `
      <button class="primary-button" data-p-modal="add-client">+ Add Client</button>`)}
    <div class="grid kpi-grid">
      ${[
        ["Total Clients",  clients.length, ""],
        ["Active",         active,         "good"],
        ["Suspended",      suspended,      suspended ? "bad" : ""],
        ["Platform MRR",   `$${mrr}`,      "good"],
        ["Open Tickets",   support,        support ? "warn" : ""],
      ].map(([l, v, mod]) => `
        <div class="card kpi">
          <span class="label">${l}</span>
          <span class="value">${v}</span>
          ${mod ? `<span class="badge ${mod}" style="width:fit-content">${
            mod === "good" ? "Healthy" : mod === "bad" ? "Attention" : "Pending"
          }</span>` : ""}
        </div>`).join("")}
    </div>
    <div class="card">
      <h2 style="margin-bottom:12px">Client Overview</h2>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th>Business</th><th>Plan</th><th>Status</th>
            <th>Shop URL</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${clients.map(c => `<tr>
              <td><strong>${c.name}</strong><br>
                <small class="muted">${c.industry}</small></td>
              <td>${c.plan}</td>
              <td><span class="badge ${c.status === "Active" ? "good" : "bad"}">
                ${c.status}</span></td>
              <td>${c.shop_url
                ? `<a href="${c.shop_url}" target="_blank"
                     style="color:var(--primary);font-size:13px">
                     Open ↗</a>`
                : "—"}</td>
              <td style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="secondary-button"
                  data-p-action="open-client" data-p-id="${c.id}">
                  Manage
                </button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ── Clients list ──────────────────────────────────────────────── */
function pageClients() {
  const clients = pState.data.clients
    .filter(c => c.name.toLowerCase().includes(pState.filter.toLowerCase()));
  return `
    ${tit("All Clients", "Manage every client on the platform.", `
      <button class="primary-button" data-p-modal="add-client">+ Add Client</button>`)}
    <div class="toolbar">
      <input class="search" data-p-filter placeholder="Search clients…"
        value="${pState.filter}" style="min-width:260px">
    </div>
    <div class="grid tenant-grid">
      ${clients.map(c => `
        <div class="tenant-card">
          <div class="tenant-card-head">
            <div>
              <strong>${c.name}</strong>
              <p class="muted" style="font-size:13px;margin-top:3px">
                ${c.industry} · ${c.plan}
              </p>
            </div>
            <span class="badge ${c.status === "Active" ? "good" : "bad"}">
              ${c.status}
            </span>
          </div>
          <div style="font-size:13px;color:var(--muted)">
            ${c.shop_url || "No shop URL set"}
          </div>
          <div class="tenant-card-actions">
            <button class="secondary-button"
              data-p-action="open-client" data-p-id="${c.id}">
              Manage
            </button>
            <button class="${c.status === "Active"
              ? "danger-button" : "primary-button"}"
              data-p-action="${c.status === "Active"
                ? "suspend-client" : "activate-client"}"
              data-p-id="${c.id}">
              ${c.status === "Active" ? "Suspend" : "Activate"}
            </button>
          </div>
        </div>`).join("")}
    </div>`;
}

/* ── Client detail ─────────────────────────────────────────────── */
function pageClientDetail() {
  const c = pState.selectedClient;
  if (!c) return `<p class="muted">No client selected.</p>`;
  const cd  = pState.clientData;
  const cfg = cd.config || {};
  const loading = !cd.tickets;

  if (loading) return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <button class="secondary-button" data-p-page="clients">← Back</button>
      <h1 style="font-size:22px">${c.name}</h1>
    </div>
    <div class="empty">Loading client data…</div>`;

  const revenue = (cd.sales || [])
    .reduce((s, x) => s + Number(x.total_bill || 0), 0);
  const pending = (cd.tickets || [])
    .filter(t => !["Delivered","Declined"].includes(t.status)).length;
  const udharBal = (cd.udhar || [])
    .filter(u => u.status !== "Settled")
    .reduce((s, u) => s + Number(u.balance_due || 0), 0);

  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap">
      <button class="secondary-button" data-p-page="clients">← Back</button>
      <h1 style="font-size:22px">${c.name}</h1>
      <span class="badge ${c.status === "Active" ? "good" : "bad"}">${c.status}</span>
    </div>

    <div class="grid kpi-grid">
      ${[
        ["Total Sales",    (cd.sales||[]).length],
        ["Revenue",        money(revenue, cfg.currency||"Rs.")],
        ["Pending Repairs",pending],
        ["Udhar Balance",  money(udharBal, cfg.currency||"Rs.")],
        ["Employees",      (cd.employees||[]).length],
        ["Plan",           c.plan],
      ].map(([l,v]) => `
        <div class="card kpi">
          <span class="label">${l}</span>
          <span class="value" style="font-size:20px">${v}</span>
        </div>`).join("")}
    </div>

    <div class="grid two-col">
      <div class="card">
        <h2 style="margin-bottom:12px">Module Controls</h2>
        <div style="display:grid;gap:10px">
          <div style="display:flex;justify-content:space-between;
                      align-items:center;padding:10px;
                      background:var(--surface-2);border-radius:8px">
            <div>
              <strong>Repair Ticket Module</strong>
              <p class="muted" style="font-size:12px;margin:2px 0 0">
                New Ticket button in POS
              </p>
            </div>
            <button class="${cfg.repair_module_enabled !== false
              ? "danger-button" : "primary-button"}"
              data-p-action="toggle-repair" style="min-width:80px">
              ${cfg.repair_module_enabled !== false ? "Disable" : "Enable"}
            </button>
          </div>
          <div style="display:flex;justify-content:space-between;
                      align-items:center;padding:10px;
                      background:var(--surface-2);border-radius:8px">
            <div>
              <strong>Inventory Module</strong>
              <p class="muted" style="font-size:12px;margin:2px 0 0">
                Product catalog in Admin
              </p>
            </div>
            <button class="${cfg.inventory_module_enabled
              ? "danger-button" : "primary-button"}"
              data-p-action="toggle-inventory" style="min-width:80px">
              ${cfg.inventory_module_enabled ? "Disable" : "Enable"}
            </button>
          </div>
          <div style="display:flex;justify-content:space-between;
                      align-items:center;padding:10px;
                      background:var(--surface-2);border-radius:8px">
            <div>
              <strong>Technician Module</strong>
              <p class="muted" style="font-size:12px;margin:2px 0 0">
                Ticket editor for technicians
              </p>
            </div>
            <button class="${cfg.technician_module_enabled
              ? "danger-button" : "primary-button"}"
              data-p-action="toggle-technician" style="min-width:80px">
              ${cfg.technician_module_enabled ? "Disable" : "Enable"}
            </button>
          </div>
          <div style="display:flex;justify-content:space-between;
                      align-items:center;padding:10px;
                      background:var(--surface-2);border-radius:8px">
            <div>
              <strong>Subscription Status</strong>
            </div>
            <button class="${c.status === "Active"
              ? "danger-button" : "primary-button"}"
              data-p-action="${c.status === "Active"
                ? "suspend-client" : "activate-client"}"
              data-p-id="${c.id}">
              ${c.status === "Active" ? "Suspend" : "Activate"}
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-bottom:12px">Quick Access</h2>
        <div style="display:grid;gap:8px">
          ${c.shop_url ? `
            <a class="secondary-button link-button"
              href="${c.shop_url}" target="_blank">
              Open Client POS ↗
            </a>
            <a class="secondary-button link-button"
              href="${c.shop_url}?route=admin" target="_blank">
              Open Client Admin ↗
            </a>` : ""}
          <button class="secondary-button" data-p-modal="edit-client">
            Edit Client Details
          </button>
        </div>
        <div style="margin-top:14px">
          <h2 style="margin-bottom:8px">Recent Sales</h2>
          ${(cd.sales || []).slice(0, 5).map(s => `
            <div class="list-row" style="margin-bottom:6px">
              <span>INV-${s.id}</span>
              <span class="muted" style="font-size:12px">
                ${new Date(s.created_at).toLocaleDateString()}
              </span>
              <strong>${money(s.total_bill, cfg.currency||"Rs.")}</strong>
            </div>`).join("") || `<div class="empty">No sales yet.</div>`}
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom:12px">Open Repair Tickets</h2>
      ${pending === 0
        ? `<div class="empty">No open tickets.</div>`
        : `<div class="table-wrap"><table>
            <thead><tr>
              <th>Ticket</th><th>Customer</th><th>Device</th><th>Status</th>
            </tr></thead>
            <tbody>
              ${(cd.tickets||[])
                .filter(t => !["Delivered","Declined"].includes(t.status))
                .map(t => `<tr>
                  <td>${t.ticket_number}</td>
                  <td>${t.customer_name}</td>
                  <td>${t.device_brand} ${t.device_model}</td>
                  <td><span class="badge warn">${t.status}</span></td>
                </tr>`).join("")}
            </tbody>
          </table></div>`}
    </div>`;
}

/* ── Support ───────────────────────────────────────────────────── */
function pageBilling() {
  const clients  = pState.data.clients  || [];
  const usage    = pState.data.usage    || [];
  const invoices = pState.data.invoices || [];
  const now      = new Date();
  const monthLabel = now.toLocaleString("default", { month: "long", year: "numeric" });

  const rows = clients.filter(c => c.status === "Active").map(c => {
    const receipts    = usage.filter(u => u.client_id === c.id).length;
    const fixedFee    = Number(c.fixed_fee || 0);
    const rate        = Number(c.per_receipt_rate || 0);
    const model       = c.billing_model || "fixed";
    const usageFee    = model === "fixed" ? 0 : receipts * rate;
    const total       = model === "fixed" ? fixedFee : model === "hybrid"
      ? fixedFee + usageFee : usageFee;
    const lastInvoice = invoices.find(i => i.client_id === c.id);
    const status      = lastInvoice?.status || "—";
    return { c, receipts, fixedFee, usageFee, total, model, status, lastInvoice };
  });

  const totalDue  = rows.reduce((s, r) => s + r.total, 0);
  const totalRcpt = rows.reduce((s, r) => s + r.receipts, 0);
  const unpaid    = rows.filter(r => r.status === "Unpaid").length;

  return `
    ${tit("Billing", `${monthLabel} — Usage & Invoices`, "")}
    <div class="kpi-grid grid" style="margin-bottom:16px">
      ${[
        ["This Month's Receipts", totalRcpt, ""],
        ["Total Revenue Due",     `Rs. ${totalDue.toLocaleString()}`, "good"],
        ["Unpaid Invoices",       unpaid, unpaid ? "bad" : ""],
      ].map(([l,v,m]) => `<div class="card kpi">
        <span class="label">${l}</span>
        <span class="value">${v}</span>
        ${m ? `<span class="badge ${m}" style="width:fit-content">${m==="good"?"Healthy":"Attention"}</span>` : ""}
      </div>`).join("")}
    </div>
    <div class="card" style="display:grid;gap:0">
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;
                  gap:12px;padding:10px 14px;font-size:12px;font-weight:600;
                  color:var(--muted);border-bottom:1px solid var(--border)">
        <span>Client</span><span>Model</span><span>Receipts</span>
        <span>Amount Due</span><span>Status</span><span></span>
      </div>
      ${rows.map(({ c, receipts, total, model, status, lastInvoice }) => `
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr 1fr 1fr auto;
                    gap:12px;padding:12px 14px;align-items:center;
                    border-bottom:1px solid var(--border)">
          <div>
            <strong style="font-size:14px">${c.name}</strong>
            <div class="muted" style="font-size:12px">${c.plan}</div>
          </div>
          <span style="font-size:13px;text-transform:capitalize">${model}</span>
          <span style="font-size:13px">${receipts}</span>
          <span style="font-size:14px;font-weight:600">Rs. ${total.toLocaleString()}</span>
          <span class="badge ${status==="Paid"?"good":status==="Unpaid"?"bad":"warn"}"
            style="width:fit-content">${status}</span>
          <div style="display:flex;gap:6px">
            ${status !== "Paid" ? `
              <button class="primary-button" style="font-size:12px;padding:5px 10px"
                data-p-action="generate-invoice" data-p-id="${c.id}"
                data-p-total="${total}" data-p-receipts="${receipts}">
                Invoice
              </button>` : ""}
            ${lastInvoice?.status === "Unpaid" ? `
              <button class="secondary-button" style="font-size:12px;padding:5px 10px"
                data-p-action="mark-paid" data-p-id="${lastInvoice.id}">
                Paid ✓
              </button>` : ""}
          </div>
        </div>`).join("")}
    </div>`;
}

function pageSupport() {
  const tickets = pState.data.support
    .filter(s => s.subject?.toLowerCase().includes(pState.filter.toLowerCase())
              || s.client_name?.toLowerCase().includes(pState.filter.toLowerCase()));
  return `
    ${tit("Support Tickets", "Problem reports submitted by clients.", "")}
    <div class="toolbar">
      <input class="search" data-p-filter placeholder="Search tickets…"
        value="${pState.filter}" style="min-width:260px">
    </div>
    <div class="card">
      ${tickets.length ? `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Client</th><th>Subject</th><th>Status</th><th>Date</th><th></th>
          </tr></thead>
          <tbody>
            ${tickets.map(t => `<tr>
              <td>${t.client_name}</td>
              <td>${t.subject}</td>
              <td><span class="badge ${t.status === "Open" ? "warn" : "good"}">
                ${t.status}</span></td>
              <td>${new Date(t.created_at).toLocaleDateString()}</td>
              <td>
                ${t.status === "Open"
                  ? `<button class="primary-button"
                       data-p-action="resolve-ticket"
                       data-p-id="${t.id}">Resolve</button>`
                  : ""}
              </td>
            </tr>`).join("")}
          </tbody>
        </table></div>` :
        `<div class="empty">No support tickets.</div>`}
    </div>`;
}

/* ── Settings ──────────────────────────────────────────────────── */
function pageSettings() {
  return `
    ${tit("Platform Settings", "Admin password and platform configuration.", "")}
    <div class="card" style="max-width:480px;display:grid;gap:14px">
      <h2>Change Admin Password</h2>
      <form data-p-form="change-password" style="display:grid;gap:10px">
        <label class="field">
          <span>Current Password</span>
          <input name="current" type="password">
        </label>
        <label class="field">
          <span>New Password</span>
          <input name="newpass" type="password">
        </label>
        <label class="field">
          <span>Confirm New Password</span>
          <input name="confirm" type="password">
        </label>
        <button class="primary-button">Update Password</button>
      </form>
    </div>`;
}

/* ── Modals ────────────────────────────────────────────────────── */
function pModal() {
  if (!pState.modal) return "";
  const { type } = pState.modal;
  const c = pState.selectedClient || {};

  const forms = {
    "add-client": `
      <form class="modal" data-p-form="add-client" style="max-width:520px">
        <h2>Add New Client</h2>
        <div class="form-grid">
          <label class="field"><span>Business Name</span>
            <input name="name" required></label>
          <label class="field"><span>Industry</span>
            <input name="industry" value="Mobile Repair Shop"></label>
          <label class="field"><span>Plan</span>
            <select name="plan">
              <option>Basic</option>
              <option>Standard</option>
              <option selected>Premium</option>
            </select>
          </label>
          <label class="field"><span>Shop URL</span>
            <input name="shop_url" placeholder="https://…"></label>
          <label class="field" style="grid-column:1/-1">
            <span>Client Supabase URL</span>
            <input name="supabase_url" placeholder="https://xxx.supabase.co" required>
          </label>
          <label class="field" style="grid-column:1/-1">
            <span>Client Supabase Anon Key</span>
            <input name="supabase_anon" placeholder="eyJ…" required>
          </label>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-p-close>Cancel</button>
          <button class="primary-button">Save Client</button>
        </div>
      </form>`,

    "edit-client": `
      <form class="modal" data-p-form="edit-client" style="max-width:520px">
        <h2>Edit — ${c.name}</h2>
        <div class="form-grid">
          <label class="field"><span>Business Name</span>
            <input name="name" value="${c.name||""}"></label>
          <label class="field"><span>Industry</span>
            <input name="industry" value="${c.industry||""}"></label>
          <label class="field"><span>Plan</span>
            <select name="plan">
              ${["Basic","Standard","Premium"].map(p =>
                `<option ${c.plan===p?"selected":""}>${p}</option>`).join("")}
            </select>
          </label>
          <label class="field"><span>Shop URL</span>
            <input name="shop_url" value="${c.shop_url||""}"></label>
        </div>
        <div class="modal-actions">
          <button type="button" class="secondary-button" data-p-close>Cancel</button>
          <button class="primary-button">Save</button>
        </div>
      </form>`,
  };

  return `<div class="modal-backdrop">${forms[type] || ""}</div>`;
}

/* ── UI helpers (same as shop app) ────────────────────────────── */
const tit = (h, sub, action) =>
  `<div class="page-title"><div><h1>${h}</h1><p class="muted">${sub}</p></div>
   <div>${action}</div></div>`;

/* ── Event delegation ──────────────────────────────────────────── */
document.addEventListener("click", async event => {
  const el = event.target.closest(
    "button,a,[data-p-page],[data-p-action],[data-p-modal],[data-p-close]"
  );
  if (!el) return;

  if (el.dataset.pClose !== undefined) {
    pState.modal = null; render(); return;
  }
  if (el.dataset.pPage) {
    pState.page = el.dataset.pPage; pState.filter = ""; render(); return;
  }
  if (el.dataset.pModal) {
    pState.modal = { type: el.dataset.pModal }; render(); return;
  }

  const action = el.dataset.pAction;
  if (!action) return;

  if (action === "theme") {
    pState.theme = pState.theme === "dark" ? "light" : "dark";
    localStorage.setItem("retailos-platform-theme", pState.theme);
    render(); return;
  }

  if (action === "do-login") {
    const pin = document.getElementById("platform-pin")?.value;
    if (String(pin) === String(PCFG.admin_password)) {
      pState.authenticated = true;
      pState.page = "overview";
      render();
    } else {
      document.getElementById("platform-pin-error")
        ?.classList.remove("hidden");
    }
    return;
  }

  if (action === "logout") {
    pState.authenticated = false;
    pState.page = "login";
    render(); return;
  }

  if (action === "open-client") {
    const client = pState.data.clients.find(
      c => String(c.id) === String(el.dataset.pId)
    );
    if (!client) return;
    pState.selectedClient = client;
    pState.page = "client-detail";
    pState.clientData = {};   // clear old data
    render();
    // load live data in background then re-render
    await loadClientData(client);
    render(); return;
  }

  if (action === "suspend-client" || action === "activate-client") {
    const newStatus = action === "suspend-client" ? "Suspended" : "Active";
    const isSuspending = newStatus === "Suspended";

    // 1. Update platform clients table
    const { error } = await pb.from("clients")
      .update({ status: newStatus })
      .eq("id", el.dataset.pId);
    if (error) { alert(error.message); return; }

    // 2. Also write suspension flag into the client's own shop_config
    const client = pState.clients?.find(c => c.id === Number(el.dataset.pId))
      || pState.selectedClient;
    if (client?.supabase_url && client?.supabase_anon) {
      try {
        const clientSb = supabase.createClient(client.supabase_url, client.supabase_anon);
        await clientSb.from("shop_config").update({ suspended: isSuspending }).eq("id", 1);
      } catch (e) {
        console.warn("Could not write suspension to client DB:", e.message);
      }
    }

    if (pState.selectedClient?.id === Number(el.dataset.pId)) {
      pState.selectedClient.status = newStatus;
    }
    await loadPlatform(); return;
  }

  if (action === "toggle-repair") {
    const cfg = pState.clientData.config || {};
    const next = cfg.repair_module_enabled === false ? true : false;
    const ok = await updateClientConfig(pState.selectedClient, {
      repair_module_enabled: next,
    });
    if (ok) {
      pState.clientData.config.repair_module_enabled = next;
      render();
    }
    return;
  }

  if (action === "toggle-inventory") {
    const cfg = pState.clientData.config || {};
    const next = !cfg.inventory_module_enabled;
    const ok = await updateClientConfig(pState.selectedClient, {
      inventory_module_enabled: next,
    });
    if (ok) {
      pState.clientData.config.inventory_module_enabled = next;
      render();
    }
    return;
  }

  if (action === "toggle-technician") {
    const cfg = pState.clientData.config || {};
    const next = !cfg.technician_module_enabled;
    const ok = await updateClientConfig(pState.selectedClient, {
      technician_module_enabled: next,
    });
    if (ok) {
      pState.clientData.config.technician_module_enabled = next;
      render();
    }
    return;
  }
  if (action === "generate-invoice") {
    const clientId = Number(el.dataset.pId);
    const client   = pState.data.clients.find(c => c.id === clientId);
    if (!client) return;
    const now        = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];
    const { error } = await pb.from("billing_cycles").insert({
      client_id:        clientId,
      period_start:     periodStart,
      period_end:       periodEnd,
      fixed_fee:        Number(client.fixed_fee || 0),
      receipt_count:    Number(el.dataset.pReceipts),
      per_receipt_rate: Number(client.per_receipt_rate || 0),
      total_due:        Number(el.dataset.pTotal),
      status:           "Unpaid",
    });
    if (error) { alert(error.message); return; }
    await loadPlatform(); return;
  }

  if (action === "mark-paid") {
    const { error } = await pb.from("billing_cycles")
      .update({ status: "Paid", paid_at: new Date().toISOString() })
      .eq("id", el.dataset.pId);
    if (error) { alert(error.message); return; }
    await loadPlatform(); return;
  }
  if (action === "resolve-ticket") {
    const { error } = await pb.from("support_tickets")
      .update({ status: "Resolved", resolved_at: new Date().toISOString() })
      .eq("id", el.dataset.pId);
    if (error) { alert(error.message); return; }
    await loadPlatform(); return;
  }
});

document.addEventListener("input", event => {
  if (event.target.dataset.pFilter !== undefined) {
    pState.filter = event.target.value; render();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Enter" && !pState.authenticated) {
    document.querySelector("[data-p-action='do-login']")?.click();
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.pForm;

  if (type === "add-client") {
    const { error } = await pb.from("clients").insert({
      name:         data.name,
      industry:     data.industry || "Retail",
      plan:         data.plan     || "Basic",
      status:       "Active",
      supabase_url: data.supabase_url,
      supabase_anon:data.supabase_anon,
      shop_url:     data.shop_url || "",
    });
    if (error) { alert("Error: " + error.message); return; }
    pState.modal = null;
    await loadPlatform(); return;
  }

  if (type === "edit-client") {
    const { error } = await pb.from("clients")
      .update({
        name:     data.name,
        industry: data.industry,
        plan:     data.plan,
        shop_url: data.shop_url,
      })
      .eq("id", pState.selectedClient.id);
    if (error) { alert("Error: " + error.message); return; }
    pState.selectedClient = { ...pState.selectedClient, ...data };
    pState.modal = null;
    await loadPlatform(); return;
  }

  if (type === "change-password") {
    if (data.current !== PCFG.admin_password) {
      alert("Current password is wrong."); return;
    }
    if (data.newpass !== data.confirm) {
      alert("New passwords don't match."); return;
    }
    const { error } = await pb.from("platform_config")
      .update({ admin_password: data.newpass }).eq("id", 1);
    if (error) { alert("Error: " + error.message); return; }
    PCFG.admin_password = data.newpass;
    alert("Password updated.");
    return;
  }
});

window.addEventListener("online",  () => { pState.online = true;  render(); });
window.addEventListener("offline", () => { pState.online = false; render(); });

await loadPlatform();

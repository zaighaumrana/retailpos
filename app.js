/* ═══════════════════════════════════════════════════════════════════
   RetailOS — Shop App
   Backend: Supabase (replaces IndexedDB + Google Sheets)
═══════════════════════════════════════════════════════════════════ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL  = "YOUR_SUPABASE_URL";   // e.g. https://xxxx.supabase.co
const SUPABASE_ANON = "YOUR_SUPABASE_ANON_KEY";
const sb            = createClient(SUPABASE_URL, SUPABASE_ANON);

const money  = (v, sym = "Rs.") => `${sym} ${Number(v||0).toLocaleString(undefined,{maximumFractionDigits:0})}`;
const params = new URLSearchParams(location.search);

// ── App state (no tenantId needed — single shop per Supabase project) ──
const state = {
  route:        params.get("route") || "pos",
  adminModule:  "dashboard",
  role:         "Business Owner",
  theme:        localStorage.getItem("retailos-theme") || "light",
  online:       navigator.onLine,
  filter:       "",
  category:     "All",
  cart:         [],
  data:         { tickets:[], sales:[], employees:[], udhar:[], returns:[], config:{} },
  modal:        null,
  installPrompt:null,
  settingsTab:  "branding",
  checkoutPayment: "Cash",
  cartTicketId:    null,
  udharName:       "",
  udharPhone:      "",
};

// ── Session (employee logged in via PIN) ──
let SESSION = { employee: null, loginSkipped: false };

// ── Config cache (from shop_config table) ──
let CFG = {
  admin_password:       "1234",
  strict_login_mode:    false,
  discount_pin_required:true,
  partial_udhar_allowed:true,
  quick_components:     ["Screen","Battery","Body","Board","Camera","Mic","Speaker","Charging Port","Back Glass","SIM Tray","Power Button","Volume Button"],
  terms_text:           "Warranty: 30 days on parts replaced.",
  shop_name:            "FixPoint Mobile Care",
  shop_address:         "42 Market Street, Lahore",
  shop_phone:           "+92 300 555 0188",
  primary_color:        "#126c5b",
  secondary_color:      "#e9b949",
  currency:             "Rs.",
  tax_rate:             0,
};

function uid(p) { return `${p}-${Math.random().toString(36).slice(2,7).toUpperCase()}`; }
// ── Load config from Supabase ──────────────────────────────────────
async function loadConfig() {
  const { data, error } = await sb.from("shop_config").select("*").single();
  if (error) { console.warn("Config load failed, using defaults.", error.message); return; }
  // shop_config is a single row — merge into CFG
  Object.assign(CFG, data);
  // quick_components may be stored as JSONB array already parsed by Supabase
  if (typeof CFG.quick_components === "string") {
    try { CFG.quick_components = JSON.parse(CFG.quick_components); } catch {}
  }
  applyBranding();
}

// ── Load all operational data ──────────────────────────────────────
async function load() {
  await loadConfig();
  const [tickets, sales, employees, udhar, returns_] = await Promise.all([
    sb.from("tickets").select("*").order("id", { ascending: false }),
    sb.from("sales").select("*").order("id", { ascending: false }),
    sb.from("employees").select("id, name, role, status").order("name"), // never fetch pin_code on load
    sb.from("udhar").select("*").order("id", { ascending: false }),
    sb.from("returns").select("*").order("id", { ascending: false }),
  ]);
  state.data = {
    tickets:   tickets.data   || [],
    sales:     sales.data     || [],
    employees: employees.data || [],
    udhar:     udhar.data     || [],
    returns:   returns_.data  || [],
    config:    CFG,
  };
  applyBranding();
  render();
}

// ── Branding from CFG (no tenant object needed) ────────────────────
function applyBranding() {
  document.documentElement.dataset.theme = state.theme;
  document.documentElement.style.setProperty("--primary",   CFG.primary_color   || "#126c5b");
  document.documentElement.style.setProperty("--secondary", CFG.secondary_color || "#e9b949");
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", CFG.primary_color || "#126c5b");
}

// ── currentTenant shim (keep UI functions working unchanged) ───────
function currentTenant() {
  return {
    name:                CFG.shop_name        || "My Shop",
    address:             CFG.shop_address     || "",
    phone:               CFG.shop_phone       || "",
    whatsapp:            CFG.shop_phone       || "",
    primaryColor:        CFG.primary_color    || "#126c5b",
    secondaryColor:      CFG.secondary_color  || "#e9b949",
    currency:            CFG.currency         || "Rs.",
    taxRate:             Number(CFG.tax_rate  || 0),
    receiptFooter:       CFG.terms_text       || "",
    repairModuleEnabled: true,
    logo:                CFG.shop_logo        || "",
    businessDescription: CFG.shop_description || "",
    plan:                "Premium",
    status:              "Active",
  };
}

// ── scoped() shim — no tenantId filtering needed anymore ──────────
function scoped(store) {
  // map old store names to new state.data keys
  const map = { repairs:"tickets", products:[], customers:[] };
  if (store === "repairs")   return state.data.tickets   || [];
  if (store === "sales")     return state.data.sales     || [];
  if (store === "employees") return state.data.employees || [];
  if (store === "udhar")     return state.data.udhar     || [];
  if (store === "returns")   return state.data.returns   || [];
  // products/customers not in Supabase for this build — return empty
  return [];
}
/* ── Role-based access ──────────────────────────────────────────── */
const ACCESS = {
  "Business Owner": ["dashboard","inventory","purchases","customers","pos","repairs","reports","employees","subscriptions","settings"],
  "Manager":        ["dashboard","inventory","purchases","customers","pos","repairs","reports"],
  "Cashier":        ["pos","customers"],
  "Technician":     ["repairs","customers"],
  "Inventory Staff":["inventory","purchases"],
};
function can(mod) { return ACCESS[state.role]?.includes(mod); }

const ADMIN_MODULES = [
  ["dashboard","▦","Dashboard"],
  ["inventory","▤","Inventory"],
  ["purchases","↧","Purchases"],
  ["customers","◉","Customers"],
  ["repairs","◈","Repair Tickets"],
  ["reports","▧","Reports"],
  ["employees","♙","Employees"],
  ["subscriptions","◎","Subscription"],
  ["settings","◐","Business Settings"],
];

/* ── Print helper ───────────────────────────────────────────────── */
function printContent(html) {
  const zone = document.getElementById("print-zone");
  zone.innerHTML = html;
  window.print();
  // restore after browser finishes print dialog
  setTimeout(()=>{ zone.innerHTML=""; },1500);
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════════════ */
function render() {
  const active = document.activeElement;
  const focusInfo = active?.dataset?.filter ? { filter:active.dataset.filter, start:active.selectionStart, end:active.selectionEnd } : null;
  const app    = document.getElementById("app");
  const tenant = currentTenant();

  // Cashiers can only see POS
  if (state.role === "Cashier" || state.role === "Technician" || state.role === "Inventory Staff") {
    if (state.route !== "pos") state.route = can("pos") ? "pos" : "admin";
  }
  if (!["pos","admin"].includes(state.route)) state.route = "pos";
  if (!can(state.adminModule)) state.adminModule = "dashboard";

  app.innerHTML = `
    <div class="app-shell client-shell">
      <main class="main">
        <header class="topbar">
          <div class="brand top-brand">
            <div class="logo">${tenant.logo?`<img alt="" src="${tenant.logo}">`:`${tenant.name.slice(0,2).toUpperCase()}`}</div>
            <div>
              <strong>${tenant.name}</strong>
              <span class="muted" style="font-size:12px">${state.role} · ${state.route==="pos"?"POS Counter":"Back Office"}</span>
            </div>
          </div>
          <div class="top-actions">
            ${state.route==="admin"?`<select class="tenant-switcher compact-select" data-action="admin-module">${ADMIN_MODULES.filter(([k])=>can(k)).map(([k,,l])=>`<option value="${k}" ${k===state.adminModule?"selected":""}>${l}</option>`).join("")}</select>`:""}
            <span class="chip"><i class="dot ${state.online?(state.syncing?"syncing":""):"offline"}"></i>${state.online?(state.syncing?"Syncing":"Online"):"Offline"}</span>
            ${can("pos") ?`<button class="${state.route==="pos"?"primary-button":"secondary-button"}" data-route="pos">POS</button>`:""}
            ${can("dashboard")||can("inventory")?`<button class="${state.route==="admin"?"primary-button":"secondary-button"}" data-route="admin">Admin</button>`:""}
            ${state.installPrompt?`<button class="icon-button" data-action="install">Install</button>`:""}
            <button class="icon-button" data-action="theme">${state.theme==="dark"?"Light":"Dark"}</button>
          </div>
        </header>
        <section class="content">${pageContent()}</section>
      </main>
    </div>
    ${modal()}
  `;
  if (focusInfo) {
    const n = document.querySelector(`[data-filter="${focusInfo.filter}"]`);
    n?.focus(); n?.setSelectionRange?.(focusInfo.start,focusInfo.end);
  }
}

function pageContent() {
  if (state.route==="pos") return pos();
  const pages = { dashboard, inventory, purchases, customers, repairs, reports, employees, subscriptions, settings };
  if (!can(state.adminModule)) state.adminModule = "dashboard";
  return adminShell((pages[state.adminModule]||dashboard)());
}

function adminShell(content) {
  const tenant = currentTenant();
  return `
    <div class="admin-header">
      <div>
        <h1>Business Admin</h1>
        <p class="muted">${tenant.name} · ${ADMIN_MODULES.find(([k])=>k===state.adminModule)?.[2]||""}</p>
      </div>
      <select class="tenant-switcher compact-select" data-action="role">
        ${["Business Owner","Manager","Cashier","Technician","Inventory Staff"].map(r=>`<option ${r===state.role?"selected":""}>${r}</option>`).join("")}
      </select>
    </div>
    ${content}
  `;
}

/* ── UI helpers ─────────────────────────────────────────────────── */
const tit = (h,sub,action) => `<div class="page-title"><div><h1>${h}</h1><p class="muted">${sub}</p></div><div>${action}</div></div>`;
const tlb = (ph,fkey,right)  => `<div class="toolbar"><div class="toolbar-left"><input class="search" data-filter="${fkey}" value="${state.filter}" placeholder="${ph}"></div><div class="toolbar-right">${right}</div></div>`;
const tbl = (cap,heads,rows) => `<h2>${cap}</h2><div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const fld = (label,name,val="",type="text") => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${String(val).replaceAll('"','&quot;')}"></label>`;
const statusBadge = s => { const bad=["Suspended","Cancelled"],good=["Active","Delivered","Ready for Pickup","Received"]; return `<span class="badge ${bad.includes(s)?"bad":good.includes(s)?"good":"warn"}">${s}</span>`; };
const stockBadge  = p => `<span class="badge ${p.qty<=p.min?"bad":p.qty<p.min*2?"warn":"good"}">${p.qty<=p.min?"Low Stock":"In Stock"}</span>`;
const productName = p => `<div style="display:flex;align-items:center;gap:10px"><span class="product-img">${p.image?`<img alt="" src="${p.image}">`:`${p.name.slice(0,1)}`}</span><span><strong>${p.name}</strong><br><small class="muted">${p.brand}</small></span></div>`;
const modalActions = () => `<div class="modal-actions"><button type="button" class="secondary-button" data-close>Cancel</button><button class="primary-button">Save</button></div>`;

/* ═══════════════════════════════════════════════════════════════════
   SETTINGS PAGE  — accessible from Admin nav (Business Owner / Manager)
═══════════════════════════════════════════════════════════════════ */
function settings() {
  return `
    ${tit("Business Settings","White-label branding, contact info, tax, currency, and receipt configuration.","")}
    <div class="settings-tabs">
      <button class="settings-tab ${state.settingsTab==="branding"?"active":""}" data-settings-tab="branding">Branding & Colors</button>
      <button class="settings-tab ${state.settingsTab==="contact"?"active":""}" data-settings-tab="contact">Contact & Business</button>
      <button class="settings-tab ${state.settingsTab==="receipt"?"active":""}" data-settings-tab="receipt">Receipt & Tax</button>
    </div>
    ${settingsTabContent()}
  `;
}

function settingsTabContent() {
  const t = currentTenant();
  if (state.settingsTab==="branding") return `
    <form class="card form-grid" data-form="settings">
      ${fld("Business Name","name",t.name)}
      ${fld("Business Description","businessDescription",t.businessDescription||"")}
      ${fld("Primary Color","primaryColor",t.primaryColor,"color")}
      ${fld("Secondary Color","secondaryColor",t.secondaryColor,"color")}
      <label class="field"><span>Logo Upload</span><input name="logo" type="file" accept="image/*"></label>
      <div class="field"><span>Current Palette</span><div class="swatches"><span class="swatch" style="background:${t.primaryColor}"></span><span class="swatch" style="background:${t.secondaryColor}"></span></div></div>
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Branding</button></div>
    </form>`;
  if (state.settingsTab==="contact") return `
    <form class="card form-grid" data-form="settings">
      ${fld("Business Name","name",t.name)}
      ${fld("Address","address",t.address)}
      ${fld("Phone","phone",t.phone)}
      ${fld("WhatsApp","whatsapp",t.whatsapp)}
      ${fld("Email","email",t.email)}
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Contact Info</button></div>
    </form>`;
  if (state.settingsTab==="receipt") return `
    <form class="card form-grid" data-form="settings">
      ${fld("Currency Symbol","currency",t.currency)}
      ${fld("Tax Rate %","taxRate",t.taxRate,"number")}
      <label class="field" style="grid-column:1/-1"><span>Receipt Footer</span><textarea name="receiptFooter">${t.receiptFooter}</textarea></label>
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Receipt Settings</button></div>
    </form>`;
  return "";
}

/* ── Branding modal (quick access from topbar — removed, now in settings page only) ── */
// Settings are now ONLY in the Admin → Business Settings page.
// The old floating "Branding" button in the topbar is gone for cleanliness.

/* ═══════════════════════════════════════════════════════════════════
   POS PAGE
═══════════════════════════════════════════════════════════════════ */
function pos() {
  const tenant   = currentTenant();
  const products = scoped("products").filter(p=>(state.category==="All"||p.category===state.category)&&p.name.toLowerCase().includes(state.filter.toLowerCase()));
  const cats     = ["All",...new Set(scoped("products").map(p=>p.category))];
  const subtotal = state.cart.reduce((s,i)=>s+i.soldPrice*i.qty,0);
  const disc     = state.cart.reduce((s,i)=>s+(i.originalPrice-i.soldPrice)*i.qty,0);
  const tax      = subtotal*(tenant.taxRate/100);

  return `
    <div class="page-title">
      <div>
        <h1>Point of Sale</h1>
        <p class="muted">Counter workspace · ${tenant.name}</p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="secondary-button" data-action="shift-stats">📋 Shift Stats</button>
        ${tenant.repairModuleEnabled?`<button class="primary-button" data-modal="repair">+ New Repair Ticket</button>`:""}
      </div>
    </div>
    <div class="grid pos-layout">
      <div class="grid">
        <input class="search" data-filter="product" value="${state.filter}" placeholder="Search products or scan barcode">
        <div class="category-tabs">${cats.map(c=>`<button class="${c===state.category?"primary-button":"secondary-button"}" data-category="${c}">${c}</button>`).join("")}</div>
        <div class="grid product-grid">${products.map(p=>`
          <button class="product-card" data-add-cart="${p.id}">
            <div class="product-img">${p.image?`<img alt="" src="${p.image}">`:`${p.name.slice(0,1)}`}</div>
            <strong>${p.name}</strong>
            <span class="muted">${p.qty} in stock · ${p.sku}</span>
            <strong>${money(p.price,tenant.currency)}</strong>
          </button>`).join("")}
        </div>
      </div>
      <aside class="card cart">
        <h2>Cart</h2>
        ${state.cart.length?state.cart.map(item=>`
          <div class="cart-line">
            <div><strong>${item.name}</strong><br><small class="muted">${money(item.soldPrice,tenant.currency)} each${item.reason?" · "+item.reason:""}</small></div>
            <div class="qty-controls">
              <button data-qty="${item.productId}" data-delta="-1">−</button>
              <strong>${item.qty}</strong>
              <button data-qty="${item.productId}" data-delta="1">+</button>
            </div>
            <button class="secondary-button" data-modal="override" data-id="${item.productId}">Override</button>
          </div>`).join(""):`<div class="empty">Tap a product to add it.</div>`}
        <div class="totals">
          <div class="total-row"><span>Subtotal</span><strong>${money(subtotal,tenant.currency)}</strong></div>
          <div class="total-row"><span>Discounts</span><strong>${money(disc,tenant.currency)}</strong></div>
          <div class="total-row"><span>Tax ${tenant.taxRate}%</span><strong>${money(tax,tenant.currency)}</strong></div>
          <div class="total-row grand"><span>Total</span><strong>${money(subtotal+tax,tenant.currency)}</strong></div>
        </div>
        <select class="tenant-switcher" data-action="payment"><option>Cash</option><option>Card</option><option>Bank Transfer</option><option>Mixed Payment</option></select>
        <button class="primary-button" data-action="checkout" ${state.cart.length?"":"disabled"}>Checkout & Receipt</button>
      </aside>
    </div>`;
}

/* ── Shift stats HTML (print-safe) ─────────────────────────────── */
function buildShiftStats() {
  const tenant   = currentTenant();
  const employee = scoped("employees").find(e=>e.role===state.role&&e.status==="Active") || scoped("employees").find(e=>e.role==="Cashier") || scoped("employees")[0];
  const date     = today.toISOString().slice(0,10);
  const shiftSales  = scoped("sales").filter(s=>s.cashier===employee?.name&&s.date.slice(0,10)===date);
  const itemsSold   = shiftSales.reduce((s,sale)=>s+sale.items.reduce((x,i)=>x+i.qty,0),0);
  const cashEarned  = shiftSales.reduce((s,sale)=>s+sale.total,0);
  const cashOnly    = shiftSales.filter(s=>s.payment==="Cash"||s.payment==="Mixed Payment").reduce((s,sale)=>s+sale.total,0);
  const discounts   = shiftSales.reduce((s,sale)=>s+sale.items.reduce((x,i)=>x+i.discount*i.qty,0),0);
  const custCount   = new Set(shiftSales.map(s=>s.customer)).size;
  const shiftTkts   = scoped("repairs").filter(r=>(r.createdBy===employee?.name||r.technician===employee?.name)&&(r.createdAt||"").slice(0,10)===date);
  const pendingAll  = scoped("repairs").filter(r=>!["Delivered","Cancelled"].includes(r.status));
  const processed   = shiftTkts.filter(r=>["Delivered","Ready for Pickup"].includes(r.status));
  const stillPend   = shiftTkts.filter(r=>!["Delivered","Cancelled"].includes(r.status));

  return `
    <div class="shift-print">
      <center>
        <strong style="font-size:15px">${tenant.name}</strong><br>
        Shift Summary &mdash; ${date}<br>
        ${employee?.name||"Counter Employee"} &nbsp;&bull;&nbsp; ${state.role}
      </center>
      <hr>
      <div class="section-head">Sales</div>
      <div class="stat-row"><span class="stat-label">Products sold</span><span class="stat-val">${itemsSold}</span></div>
      <div class="stat-row"><span class="stat-label">Total revenue</span><span class="stat-val">${money(cashEarned,tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Cash collected</span><span class="stat-val">${money(cashOnly,tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Discounts given</span><span class="stat-val">${money(discounts,tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Customers served</span><span class="stat-val">${custCount}</span></div>
      ${tenant.repairModuleEnabled?`
      <hr>
      <div class="section-head">Repair Tickets</div>
      <div class="stat-row"><span class="stat-label">Tickets created this shift</span><span class="stat-val">${shiftTkts.length}</span></div>
      <div class="stat-row"><span class="stat-label">Pending from this shift</span><span class="stat-val">${stillPend.length}</span></div>
      <div class="stat-row"><span class="stat-label">Successfully processed</span><span class="stat-val">${processed.length}</span></div>
      <div class="stat-row"><span class="stat-label">Pending from everyone</span><span class="stat-val">${pendingAll.length}</span></div>
      ${shiftTkts.length?`<hr><div class="section-head">This Shift Ticket List</div>${shiftTkts.map(r=>`<div class="stat-row"><span class="stat-label">${r.ticket} &nbsp;${r.customer}</span><span class="stat-val">${r.status}</span></div>`).join("")}`:""}
      `:""}
      <hr>
      <center style="color:#888;font-size:11px">Printed ${new Date().toLocaleString()}</center>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   ADMIN PAGES
═══════════════════════════════════════════════════════════════════ */
function dashboard() {
  const tenant  = currentTenant();
  const sales   = scoped("sales");
  const reps    = scoped("repairs");
  const prods   = scoped("products");
  const todayS  = sales.filter(s=>s.date.slice(0,10)==="2026-06-09");
  const total   = sales.reduce((s,x)=>s+x.total,0);
  const profit  = sales.reduce((s,x)=>s+x.profit,0);
  const low     = prods.filter(p=>p.qty<=p.min);
  const kpis    = [["Today's Sales",todayS.reduce((s,x)=>s+x.total,0),"+12.4%"],["Weekly Sales",sales.slice(0,7).reduce((s,x)=>s+x.total,0),"+8.1%"],["Monthly Sales",total,"+18.6%"],["Quarterly Sales",total*2.9,"+22.0%"],["Total Revenue",total,"+15.3%"],["Total Profit",profit,"+9.8%"]];
  return `
    ${tit("Dashboard","Analytics, offline health, and operating highlights.",`<button class="primary-button" data-action="new-sale">New Sale</button>`)}
    <div class="grid kpi-grid">${kpis.map(([l,v,tr])=>`<div class="card kpi"><span class="label">${l}</span><span class="value">${money(v,tenant.currency)}</span><span class="trend">${tr} vs prior</span></div>`).join("")}</div>
    <div class="grid two-col">
      <div class="card"><h2>Revenue Trends</h2><div class="chart-bars">${[44,62,51,78,70,88,95].map((h,i)=>`<div class="bar" style="height:${h}%"><span>${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"][i]}</span></div>`).join("")}</div></div>
      <div class="card"><h2>Operational Alerts</h2><div class="list">
        <div class="list-row"><span>Pending Repairs</span><strong>${reps.filter(r=>!["Delivered","Cancelled"].includes(r.status)).length}</strong></div>
        <div class="list-row"><span>Low Stock Alerts</span><strong>${low.length}</strong></div>
        <div class="list-row"><span>Sync Conflicts</span><strong>${state.data.conflicts.length}</strong></div>
        <div class="list-row"><span>Best Seller</span><strong>${prods[2]?.name||"USB-C Fast Charger"}</strong></div>
      </div></div>
    </div>
    <div class="grid two-col">
      <div class="card">${tbl("Recent Transactions",["Receipt","Customer","Payment","Total"],sales.slice(0,6).map(s=>[s.receiptNo,s.customer,s.payment,money(s.total,tenant.currency)]))}</div>
      <div class="card"><h2>Best Selling Products</h2><div class="list">${prods.slice(0,5).map((p,i)=>`<div class="list-row"><span>${p.name}<br><small class="muted">${p.category}</small></span><strong>${Math.max(8,38-i*5)} sold</strong></div>`).join("")}</div></div>
    </div>`;
}

function inventory() {
  const prods = scoped("products").filter(p=>(`${p.name} ${p.sku} ${p.category}`).toLowerCase().includes(state.filter.toLowerCase()));
  const t     = currentTenant();
  return `
    ${tit("Inventory","Catalog, barcode, stock movement, and low-stock controls.",`<button class="primary-button" data-modal="product">Add Product</button>`)}
    ${tlb("Search products, SKU, category","product",`<button class="secondary-button" data-action="bulk">Bulk Import</button><button class="secondary-button" data-modal="stock">Stock Adjustment</button>`)}
    <div class="card">${tbl("Products",["Product","SKU","Category","Cost","Price","Qty","Status",""],prods.map(p=>[productName(p),p.sku,p.category,money(p.cost,t.currency),money(p.price,t.currency),p.qty,stockBadge(p),`<button class="secondary-button" data-modal="product" data-id="${p.id}">Edit</button> <button class="danger-button" data-delete="products" data-id="${p.id}">Delete</button>`]))}</div>`;
}

function purchases() {
  const rows = scoped("products").slice(0,7).map((p,i)=>[`PO-${3300+i}`,["TechSource Wholesale","Mobile Parts Hub","Retail Supply Co."][i%3],p.name,`${12+i*3} received`,i%4?"Received":"Damaged review"]);
  return `
    ${tit("Purchases","Supplier management, purchase orders, receiving, and damaged inventory.",`<button class="primary-button" data-modal="purchase">New Purchase Order</button>`)}
    <div class="grid three-col">${["Open Purchase Orders","Damaged Units","Returned Items"].map((x,i)=>`<div class="card kpi"><span class="label">${x}</span><span class="value">${[8,3,11][i]}</span></div>`).join("")}</div>
    <div class="card">${tbl("Recent Stock Intake",["PO","Supplier","Item","Quantity","Status"],rows)}</div>`;
}

function customers() {
  const rows = scoped("customers").filter(c=>(`${c.name} ${c.phone} ${c.email}`).toLowerCase().includes(state.filter.toLowerCase()));
  return `
    ${tit("Customers","Customer profiles, loyalty points, purchase and repair history.",`<button class="primary-button" data-modal="customer">Add Customer</button>`)}
    ${tlb("Search customers","customer","")}
    <div class="card">${tbl("Customer Directory",["Name","Phone","Email","Loyalty","Notes"],rows.map(c=>[c.name,c.phone,c.email,`${c.loyalty} pts`,c.notes]))}</div>`;
}

function repairs() {
  const rows = scoped("repairs").filter(r=>(`${r.ticket} ${r.customer} ${r.model} ${r.status}`).toLowerCase().includes(state.filter.toLowerCase()));
  return `
    ${tit("Repair Tickets","Device repair workflow, technician assignment, status, warranty, and timeline.",`<button class="primary-button" data-modal="repair">New Ticket</button>`)}
    ${tlb("Search tickets, customer, device, status","repair","")}
    <div class="grid two-col">
      <div class="card">${tbl("Repair Queue",["Ticket","Customer","Device","Technician","ETA","Status",""],rows.map(r=>[r.ticket,r.customer,`${r.brand} ${r.model}`,r.technician,r.eta,statusBadge(r.status),`<button class="secondary-button" data-modal="repairView" data-id="${r.id}">View</button>`]))}</div>
      <div class="card"><h2>Status Mix</h2><div class="list">${["Received","Diagnosing","Waiting for Parts","In Progress","Ready for Pickup","Delivered"].map(s=>`<div class="list-row"><span>${s}</span><strong>${rows.filter(r=>r.status===s).length}</strong></div>`).join("")}</div></div>
    </div>`;
}

function reports() {
  const tenant = currentTenant();
  const sales  = scoped("sales");
  const disc   = sales.reduce((s,x)=>s+x.items.reduce((a,i)=>a+i.discount*i.qty,0),0);
  return `
    ${tit("Reports","Daily, weekly, monthly analytics with discount tracking.","")}
    <div class="grid kpi-grid">${[["Revenue",sales.reduce((s,x)=>s+x.total,0)],["Profit",sales.reduce((s,x)=>s+x.profit,0)],["Discounts",disc],["Transactions",sales.length],["Avg Order",sales.reduce((s,x)=>s+x.total,0)/sales.length],["Yearly Run Rate",sales.reduce((s,x)=>s+x.total,0)*12]].map(([l,v])=>`<div class="card kpi"><span class="label">${l}</span><span class="value">${typeof v==="number"&&l!=="Transactions"?money(v,tenant.currency):v}</span></div>`).join("")}</div>
    <div class="grid two-col">
      <div class="card"><h2>Monthly Sales</h2><div class="chart-bars">${[52,57,63,68,75,82,92].map((h,i)=>`<div class="bar" style="height:${h}%"><span>${["Jan","Feb","Mar","Apr","May","Jun","Jul"][i]}</span></div>`).join("")}</div></div>
      <div class="card">${tbl("Product Performance",["Product","Revenue","Profit","Discounts"],scoped("products").slice(0,6).map((p,i)=>[p.name,money(p.price*(18-i),tenant.currency),money((p.price-p.cost)*(18-i),tenant.currency),money(i%2?12:0,tenant.currency)]))}</div>
    </div>`;
}

function employees() {
  return `
    ${tit("Employees","Role-based access, status controls, and permission management.",`<button class="primary-button" data-modal="employee">Add Employee</button>`)}
    <div class="card">${tbl("Team",["Name","Phone","Email","Role","Status"],scoped("employees").map(e=>[e.name,e.phone,e.email,e.role,`<span class="badge ${e.status==="Active"?"good":"bad"}">${e.status}</span>`]))}</div>`;
}

function subscriptions() {
  const tenant = currentTenant();
  return `
    ${tit("Subscriptions","Billing and plan overview.","")}
    <div class="grid plans">${["Basic","Standard","Premium"].map((plan,i)=>`<div class="card plan"><h2>${plan}</h2><strong>${money([29,79,149][i],tenant.currency)}/mo</strong><p class="muted">${["Limited employees and products","Growing shops with reporting","Unlimited usage and white-label"][i]}</p><span class="badge ${tenant.plan===plan?"good":""}">${tenant.plan===plan?"Current Plan":"Available"}</span></div>`).join("")}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════════════════ */
function modal() {
  if (!state.modal) return "";
  const { type, id } = state.modal;
  const product  = scoped("products").find(p=>p.id===id)||{};
  const repair   = scoped("repairs").find(r=>r.id===id);
  const cartItem = state.cart.find(i=>i.productId===id);
  const tenant   = currentTenant();

  const forms = {
    product: `<form class="modal" data-form="product"><h2>${id?"Edit":"Add"} Product</h2><div class="form-grid">${fld("Name","name",product.name||"")}${fld("SKU","sku",product.sku||"")}${fld("Barcode","barcode",product.barcode||"")}${fld("Category","category",product.category||"")}${fld("Brand","brand",product.brand||"")}${fld("Cost Price","cost",product.cost||"","number")}${fld("Selling Price","price",product.price||"","number")}${fld("Quantity","qty",product.qty||"","number")}${fld("Min Stock","min",product.min||"","number")}<label class="field"><span>Image</span><input name="image" type="file" accept="image/*"></label><label class="field"><span>Description</span><textarea name="description">${product.description||""}</textarea></label></div>${modalActions()}</form>`,
    customer: `<form class="modal" data-form="customer"><h2>Add Customer</h2><div class="form-grid">${fld("Name","name")}${fld("Phone","phone")}${fld("Email","email")}${fld("Address","address")}<label class="field"><span>Notes</span><textarea name="notes"></textarea></label></div>${modalActions()}</form>`,
    employee: `<form class="modal" data-form="employee"><h2>Add Employee</h2><div class="form-grid">${fld("Name","name")}${fld("Phone","phone")}${fld("Email","email")}<label class="field"><span>Role</span><select name="role"><option>Manager</option><option>Cashier</option><option>Technician</option><option>Inventory Staff</option></select></label></div>${modalActions()}</form>`,
    repair:   `<form class="modal" data-form="repair"><h2>New Repair Ticket</h2><div class="form-grid">${fld("Customer Name","customer")}${fld("Customer Phone","phone")}${fld("Device Brand","brand")}${fld("Device Model","model")}${fld("IMEI","imei")}${fld("Serial Number","serial")}${fld("Assigned Technician","technician","Ali Imran")}${fld("Estimated Completion","eta",new Date().toISOString().slice(0,10),"date")}<label class="field"><span>Status</span><select name="status"><option>Received</option><option>Diagnosing</option><option>Waiting for Parts</option><option>In Progress</option><option>Ready for Pickup</option><option>Delivered</option><option>Cancelled</option></select></label><label class="field"><span>Issue Description</span><textarea name="issue"></textarea></label></div>${modalActions()}</form>`,
    override: `<form class="modal" data-form="override"><h2>Price Override</h2><p class="muted">Original: ${money(cartItem?.originalPrice||0,tenant.currency)}</p>${fld("Sold Price","soldPrice",cartItem?.soldPrice||0,"number")}<label class="field"><span>Reason for Discount</span><textarea name="reason">${cartItem?.reason||""}</textarea></label>${modalActions()}</form>`,
    stock:    `<form class="modal" data-form="stock"><h2>Stock Adjustment</h2><div class="form-grid">${fld("SKU","sku")}${fld("Quantity Change","qty",1,"number")}<label class="field"><span>Reason</span><select name="reason"><option>Manual Count</option><option>Damaged Inventory</option><option>Returned Inventory</option></select></label></div>${modalActions()}</form>`,
    purchase: `<form class="modal" data-form="purchase"><h2>Purchase Order</h2><div class="form-grid">${fld("Supplier","supplier")}${fld("Product","product")}${fld("Quantity","qty",10,"number")}${fld("Expected Date","eta",new Date().toISOString().slice(0,10),"date")}</div>${modalActions()}</form>`,
    receipt:  `<div class="modal"><h2>Receipt</h2>${receiptPreview(state.modal.sale)}<div class="modal-actions"><button class="secondary-button" data-close>Close</button><button class="primary-button" data-action="print-receipt">Print Receipt</button></div></div>`,
    shiftStats:`<div class="modal" style="max-width:480px"><h2>Shift Stats</h2><div class="shift-print-wrap">${buildShiftStats()}</div><div class="modal-actions"><button class="secondary-button" data-close>Close</button><button class="primary-button" data-action="print-shift">Print Summary</button></div></div>`,
    repairView:`<div class="modal"><h2>${repair?.ticket}</h2><p class="muted">${repair?.customer} · ${repair?.brand} ${repair?.model} · ${repair?.status}</p><div class="timeline">${(repair?.timeline||[]).map(step=>`<div class="timeline-step"><div><strong>${step}</strong></div></div>`).join("")}</div><div class="modal-actions"><button class="secondary-button" data-close>Close</button></div></div>`,
  };
  return `<div class="modal-backdrop">${forms[type]||""}</div>`;
}

function receiptPreview(sale) {
  const t = currentTenant();
  return `<div class="receipt-preview"><center><strong>${t.name}</strong><br>${t.address}<br>${t.phone}</center><hr>
    Receipt ${sale.receiptNo}<br>Date ${new Date(sale.date).toLocaleString()}<br>Cashier ${sale.cashier}<hr>
    ${sale.items.map(i=>`${i.name}<br>${i.qty} × ${money(i.soldPrice,t.currency)}${i.discount?` (disc ${money(i.discount,t.currency)})`:""}`)  .join("<br>")}
    <hr>Tax ${money(sale.tax,t.currency)}<br><strong>Total ${money(sale.total,t.currency)}</strong><br>Payment ${sale.payment}<hr><center>${t.receiptFooter}</center>
  </div>`;
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); });
}

/* ═══════════════════════════════════════════════════════════════════
   CART / CHECKOUT
═══════════════════════════════════════════════════════════════════ */
function addToCart(productId) {
  const p   = scoped("products").find(x=>x.id===productId);
  const ex  = state.cart.find(i=>i.productId===productId);
  if (ex) ex.qty += 1;
  else state.cart.push({productId,name:p.name,qty:1,originalPrice:p.price,soldPrice:p.price,discount:0,reason:""});
  render();
}
function updateQty(productId,delta) {
  const item = state.cart.find(i=>i.productId===productId);
  if (!item) return;
  item.qty += delta;
  state.cart = state.cart.filter(i=>i.qty>0);
  render();
}
async function checkout() {
  const t       = currentTenant();
  const subtotal = state.cart.reduce((s,i)=>s+i.soldPrice*i.qty,0);
  const tax      = subtotal*(t.taxRate/100);
  const sale     = {
    id: uid("sale"), tenantId:state.tenantId,
    receiptNo:`R-${Math.floor(2000+Math.random()*7000)}`,
    date: new Date().toISOString(),
    cashier: scoped("employees").find(e=>e.role==="Cashier")?.name||"Demo Cashier",
    customer:"Walk-in Customer",
    items: state.cart.map(i=>({...i})),
    subtotal, tax, total:subtotal+tax,
    profit: state.cart.reduce((s,i)=>{ const p=scoped("products").find(x=>x.id===i.productId); return s+(i.soldPrice-(p?.cost||0))*i.qty; },0),
    payment: document.querySelector('[data-action="payment"]')?.value||"Cash",
    syncStatus:"Pending Sync",
  };
  await repo.put("sales",sale,true);
  for (const item of state.cart) {
    const p = scoped("products").find(x=>x.id===item.productId);
    if (p) await repo.put("products",{...p,qty:Math.max(0,p.qty-item.qty)},true);
  }
  state.cart  = [];
  state.modal = { type:"receipt", sale };
  await load();
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT DELEGATION
═══════════════════════════════════════════════════════════════════ */
document.addEventListener("click", async event => {
  const el = event.target.closest("button,[data-route],[data-add-cart],[data-category],[data-modal],[data-delete],[data-close],[data-settings-tab]");
  if (!el) return;

  if (el.dataset.route)       { state.route=el.dataset.route; state.filter=""; render(); return; }
  if (el.dataset.settingsTab) { state.settingsTab=el.dataset.settingsTab; render(); return; }
  if (el.dataset.action==="theme")    { state.theme=state.theme==="dark"?"light":"dark"; localStorage.setItem("retailos-theme",state.theme); applyBranding(currentTenant()); render(); return; }
  if (el.dataset.action==="install"&&state.installPrompt) { state.installPrompt.prompt(); state.installPrompt=null; render(); return; }
  if (el.dataset.action==="new-sale") { state.route="pos"; render(); return; }
  if (el.dataset.action==="bulk")     { alert("Bulk import wired as a service boundary for CSV/Firebase expansion."); return; }
  if (el.dataset.category)            { state.category=el.dataset.category; render(); return; }
  if (el.dataset.addCart)             { addToCart(el.dataset.addCart); return; }
  if (el.dataset.qty)                 { updateQty(el.dataset.qty,Number(el.dataset.delta)); return; }
  if (el.dataset.modal)               { state.modal={ type:el.dataset.modal, id:el.dataset.id }; render(); return; }
  if (el.dataset.close!==undefined)   { state.modal=null; render(); return; }
  if (el.dataset.delete)              { await repo.delete(el.dataset.delete,el.dataset.id); await load(); return; }
  if (el.dataset.action==="checkout") { await checkout(); return; }

  if (el.dataset.action==="shift-stats") {
    state.modal = { type:"shiftStats" };
    render();
    return;
  }
  if (el.dataset.action==="print-shift") {
    printContent(buildShiftStats());
    return;
  }
  if (el.dataset.action==="print-receipt") {
    const sale = state.modal?.sale;
    if (sale) printContent(receiptPreview(sale));
    return;
  }
});

document.addEventListener("input", event => {
  if (event.target.dataset.filter) { state.filter=event.target.value; render(); }
});
document.addEventListener("change", async event => {
  if (event.target.dataset.action==="tenant")       { state.tenantId=event.target.value; state.cart=[]; state.filter=""; await load(); }
  if (event.target.dataset.action==="role")         { state.role=event.target.value; state.adminModule=can(state.adminModule)?state.adminModule:"dashboard"; render(); }
  if (event.target.dataset.action==="admin-module") { state.adminModule=event.target.value; state.filter=""; render(); }
});
document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form;

  if (type==="settings") {
    const logo = await fileToDataUrl(form.logo?.files?.[0]);
    const next = { ...currentTenant(), ...data, taxRate:Number(data.taxRate||currentTenant().taxRate), logo:logo||currentTenant().logo };
    // repairModuleEnabled is NOT changeable from the shop panel — only platform admin controls it
    next.repairModuleEnabled = currentTenant().repairModuleEnabled;
    await repo.put("tenants",next,true);
  }
  if (type==="product") {
    const ex    = scoped("products").find(p=>p.id===state.modal.id)||{};
    const image = await fileToDataUrl(form.image?.files?.[0]);
    await repo.put("products",{...ex,id:ex.id||uid("prod"),tenantId:state.tenantId,...data,cost:Number(data.cost),price:Number(data.price),qty:Number(data.qty),min:Number(data.min),image:image||ex.image||""},true);
  }
  if (type==="customer")  await repo.put("customers",{id:uid("cust"),tenantId:state.tenantId,...data,loyalty:0},true);
  if (type==="employee")  await repo.put("employees",{id:uid("emp"), tenantId:state.tenantId,...data,status:"Active"},true);
  if (type==="repair") {
    const emp = scoped("employees").find(e=>e.role===state.role&&e.status==="Active")||scoped("employees")[0];
    await repo.put("repairs",{id:uid("repair"),tenantId:state.tenantId,ticket:`FP-${Math.floor(3000+Math.random()*900)}`,...data,notes:"",parts:"",labor:0,total:0,warranty:"30 days",createdBy:emp?.name||"Counter Staff",createdAt:new Date().toISOString(),timeline:["Received at counter"]},true);
  }
  if (type==="override") {
    const item = state.cart.find(i=>i.productId===state.modal.id);
    if (item) { item.soldPrice=Number(data.soldPrice); item.discount=Math.max(0,item.originalPrice-item.soldPrice); item.reason=data.reason; }
  }
  if (["stock","purchase"].includes(type)) await repo.queue({entity:type,action:"create",tenantId:state.tenantId,payload:data});
  state.modal=null;
  await load();
});

/* ── Lifecycle ───────────────────────────────────────────────────── */
window.addEventListener("online",  ()=>{ state.online=true;  load(); });
window.addEventListener("offline", ()=>{ state.online=false; render(); });
window.addEventListener("beforeinstallprompt", event=>{ event.preventDefault(); state.installPrompt=event; render(); });
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

await seed();
await load();

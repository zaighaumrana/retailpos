/* ═══════════════════════════════════════════════════════════════════
   RetailOS — Shop App
   Backend: Supabase (replaces IndexedDB + Google Sheets)
═══════════════════════════════════════════════════════════════════ */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

const SUPABASE_URL  = "https://kxmovywgshyltwusghhj.supabase.co";   // e.g. https://xxxx.supabase.co
const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4bW92eXdnc2h5bHR3dXNnaGhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODM2OTIsImV4cCI6MjA5Njc1OTY5Mn0.JGDedCaow_Vg5Pk5RC6XprzKmRsaCCUNGWg1TaWAGLg";
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

// ── Session (persisted in sessionStorage — clears on tab close) ──
function _loadSession() {
  try {
    const s = sessionStorage.getItem("retailos_session");
    return s ? JSON.parse(s) : { employee: null, isAdmin: false, loginSkipped: false };
  } catch { return { employee: null, isAdmin: false, loginSkipped: false }; }
}
function _saveSession() {
  try { sessionStorage.setItem("retailos_session", JSON.stringify(SESSION)); } catch {}
}
function _clearSession() {
  try { sessionStorage.removeItem("retailos_session"); } catch {}
}
// ── Platform billing reporter ─────────────────────────────────────
let _pbReporter = null;
function getPlatformReporter() {
  if (_pbReporter) return _pbReporter;
  if (CFG.platform_url && CFG.platform_anon) {
    _pbReporter = supabase.createClient(CFG.platform_url, CFG.platform_anon);
  }
  return _pbReporter;
}
async function pingUsage() {
  if (!CFG.platform_client_id) return;
  try {
    const reporter = getPlatformReporter();
    if (!reporter) return;
    await reporter.from("usage_logs").insert({ client_id: CFG.platform_client_id });
  } catch (e) {
    console.warn("Usage ping failed:", e.message);
  }
}
let SESSION = _loadSession();

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
  inventory_module_enabled: false,
  repair_module_enabled:    true,
  suspended:                false,
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
  if (typeof CFG.quick_items === "string") {
    try { CFG.quick_items = JSON.parse(CFG.quick_items); } catch { CFG.quick_items = []; }
  }
  if (!Array.isArray(CFG.quick_items)) CFG.quick_items = [];
  applyBranding();
}

// ── Load all operational data ──────────────────────────────────────
async function load() {
  await loadConfig();
  // CFG is now fresh — read inventory_module_enabled after loadConfig()
  const fetchInventory = CFG.inventory_module_enabled === true
    ? sb.from("inventory").select("*").order("name")
    : Promise.resolve({ data: [] });

  const [tickets, sales, employees, udhar, returns_, inventory_] = await Promise.all([
    sb.from("tickets").select("*").order("id", { ascending: false }),
    sb.from("sales").select("*").order("id", { ascending: false }),
    sb.from("employees").select("id, name, role, status").order("name"),
    sb.from("udhar").select("*").order("id", { ascending: false }),
    sb.from("returns").select("*").order("id", { ascending: false }),
    fetchInventory,
  ]);
  state.data = {
    tickets:   tickets.data    || [],
    sales:     sales.data      || [],
    employees: employees.data  || [],
    udhar:     udhar.data      || [],
    returns:   returns_.data   || [],
    inventory: inventory_.data || [],
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
    repairModuleEnabled: CFG.repair_module_enabled !== false,
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
  "Business Owner": ["dashboard","repairs","inventory","reports","receipts","employees","settings","pos"],
  "Manager":        ["dashboard","repairs","inventory","reports","receipts","pos"],
  "Cashier":        ["pos"],
  "Technician":     ["repairs","pos"],
};
function can(mod) {
  // Also gate by module toggles from CFG
  if (mod === "repairs"   && !CFG.repair_module_enabled)    return false;
  if (mod === "inventory" && !CFG.inventory_module_enabled) return false;
  return ACCESS[state.role]?.includes(mod) ?? false;
}

const ADMIN_MODULES = [
  ["dashboard", "▦", "Dashboard"],
  ["repairs",   "◈", "Repair Tickets"],
  ["inventory", "▤", "Inventory"],
  ["reports",   "▧", "Reports"],
  ["employees", "♙", "Employees"],
  ["receipts",  "◉", "Receipts"],
  ["settings",  "◐", "Settings"],
];

/* ═══════════════════════════════════════════════════════════════════
   SUPABASE OPERATIONS
═══════════════════════════════════════════════════════════════════ */

// ── PIN verification (never loads pin_code on GET, only verifies) ──
async function verifyPin(pin) {
  // We do a direct match query — pin_code never comes to the client
  const { data, error } = await sb
    .from("employees")
    .select("id, name, role, status")
    .eq("pin_code", String(pin))
    .eq("status", "Active")
    .single();
  if (error || !data) return { ok: false };
  return { ok: true, employee: { id: data.id, name: data.name, role: data.role } };
}

async function verifyAdmin(pin) {
  return String(pin) === String(CFG.admin_password)
    ? { ok: true }
    : { ok: false };
}

// ── Ticket number generator ────────────────────────────────────────
function generateTicketNumber() {
  const year = new Date().getFullYear();
  const rand = String(Math.floor(1000 + Math.random() * 9000));
  return `FP-${year}-${rand}`;
}

// ── Create repair ticket ───────────────────────────────────────────
async function createTicket(payload) {
  const ticket_number = generateTicketNumber();
  const { data, error } = await sb.from("tickets").insert({
    ticket_number,
    customer_name:   payload.customerName   || "",
    customer_phone:  payload.customerPhone  || "",
    device_brand:    payload.deviceBrand    || "",
    device_model:    payload.deviceModel    || "",
    imei:            payload.imei           || "",
    components_noted: payload.components   || [],
    estimated_quote: Number(payload.estimatedQuote || 0),
    advance_payment: Number(payload.advance        || 0),
    advance_method:  payload.advanceMethod  || "",
    status:          "Pending",
    technician_note: payload.technicianNote || "",
    created_by:      SESSION.employee?.name || "Counter",
  }).select().single();

  if (error) { console.error("createTicket:", error); return { ok: false, error: error.message }; }
  return { ok: true, data };
}

// ── Update ticket (add components at checkout, status change, decline) ──
async function updateTicket(id, updates) {
  // remap JS camelCase keys to Supabase snake_case column names
  const mapped = {};
  if (updates.components    !== undefined) mapped.components_noted = updates.components;
  if (updates.status        !== undefined) mapped.status            = updates.status;
  if (updates.declineReason !== undefined) mapped.decline_reason    = updates.declineReason;
  if (updates.technicianNote!== undefined) mapped.technician_note   = updates.technicianNote;
  if (updates.settledAt     !== undefined) mapped.settled_at        = updates.settledAt;

  const { error } = await sb.from("tickets").update(mapped).eq("id", id);
  if (error) { console.error("updateTicket:", error); return { ok: false, error: error.message }; }
  return { ok: true };
}

// ── Employee login screen HTML ─────────────────────────────────────
function loginScreen() {
  const preview = loginScreen._preview || null;
  return `
    <div style="min-height:100vh;display:grid;place-items:center;background:var(--bg);padding:16px">
      <div class="card" style="width:min(400px,95vw);display:grid;gap:20px;padding:32px">
        <div style="text-align:center;display:grid;gap:8px">
          <div class="logo" style="margin:0 auto 8px;width:60px;height:60px;font-size:20px">
            ${CFG.shop_name?.slice(0,2).toUpperCase()||"FP"}
          </div>
          <h2 style="margin:0">${CFG.shop_name||"RetailOS"}</h2>
          <p class="muted" style="font-size:13px;margin:0">Sign in to continue</p>
        </div>

        ${preview ? `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
                    background:var(--surface-2);border-radius:10px;
                    border:1px solid var(--border)">
          <div class="logo" style="width:38px;height:38px;font-size:13px;flex-shrink:0">
            ${preview.name.slice(0,2).toUpperCase()}
          </div>
          <div style="display:grid;gap:2px">
            <strong style="font-size:14px">${preview.name}</strong>
            <span class="muted" style="font-size:12px">${preview.role}</span>
          </div>
          <span class="badge good" style="margin-left:auto;font-size:11px">Found</span>
        </div>` : `
        <div style="height:62px;border-radius:10px;border:1px dashed var(--border);
                    display:grid;place-items:center">
          <span class="muted" style="font-size:13px">Enter password to identify</span>
        </div>`}

        <div style="display:grid;gap:10px">
          <label class="field">
            <span>Password</span>
            <input id="login-password" type="password"
              autocomplete="current-password"
              placeholder="Enter your password"
              minlength="6"
              style="font-size:15px;letter-spacing:2px"
              autofocus>
          </label>
          <div id="login-error" class="hidden"
            style="color:var(--danger);font-size:13px;text-align:center;padding:4px 0">
            Incorrect password. Please try again.
          </div>
          <div id="cf-turnstile-wrap" style="display:flex;justify-content:center;margin:4px 0"></div>
          <button id="login-btn" class="primary-button"
            style="width:100%;font-size:15px;padding:12px;margin-top:2px"
            data-action="login-submit">
            Login
          </button>
        </div>

        <p class="muted" style="text-align:center;font-size:12px;margin:0">
          ${CFG.shop_address||""}
        </p>
      </div>
    </div>`;
}
loginScreen._preview = null;

// ── Password login handlers ───────────────────────────────────────
async function _lookupPassword(val) {
  if (!val || val.length < 6) { loginScreen._preview = null; return; }
  // Check admin password
  if (String(val) === String(CFG.admin_password)) {
    loginScreen._preview = { name: "Admin", role: "Business Owner" };
    render(); return;
  }
  // Check employee
  const { data } = await sb.from("employees")
    .select("name, role, status")
    .eq("pin_code", val)
    .eq("status", "Active")
    .maybeSingle();
  loginScreen._preview = data ? { name: data.name, role: data.role } : null;
  render();
}

let _lookupTimer = null;
function onPasswordInput(val) {
  clearTimeout(_lookupTimer);
  loginScreen._preview = null;
  if (val.length >= 6) {
    _lookupTimer = setTimeout(() => _lookupPassword(val), 400);
  } else {
    render();
  }
}

async function submitPin() {
  const input   = document.getElementById("login-password");
  const errEl   = document.getElementById("login-error");
  const btn     = document.getElementById("login-btn");
  const entered = input?.value?.trim() || "";

  if (entered.length < 6) {
    if (errEl) { errEl.textContent = "Password must be at least 6 characters."; errEl.classList.remove("hidden"); }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = "Logging in…"; }
  if (errEl) errEl.classList.add("hidden");

  // 1. Check admin password
  if (String(entered) === String(CFG.admin_password)) {
    SESSION = { employee: { name: "Admin", role: "Business Owner" }, isAdmin: true, loginSkipped: false };
    state.role = "Business Owner";
    loginScreen._preview = null;
    _saveSession();
    render();
    return;
  }

  // 2. Check employee
  const res = await verifyPin(entered);
  if (res.ok) {
    SESSION = { employee: res.employee, isAdmin: false, loginSkipped: false };
    const role = res.employee.role;
    state.role = role;
    if (role === "Cashier" || role === "Technician") state.route = "pos";
    loginScreen._preview = null;
    _saveSession();
    render();
  } else {
    if (btn) { btn.disabled = false; btn.textContent = "Login"; }
    if (errEl) { errEl.textContent = "Incorrect password. Please try again."; errEl.classList.remove("hidden"); }
    const inp = document.getElementById("login-password");
    if (inp) { inp.value = ""; inp.focus(); }
    loginScreen._preview = null;
  }
}
// ── PIN prompt modal (discount / checkout / admin / settle / return) ──
let ppBuffer   = "";
let ppPurpose  = "";
let ppCallback = null;

function openPinPrompt(purpose, callback) {
  ppBuffer   = "";
  ppPurpose  = purpose;
  ppCallback = callback;
  state.modal = { type: "pinPrompt", purpose };
  render();
}

function pinPromptHTML(purpose) {
  const label = {
    admin:    "Admin password required",
    settle:   "Admin PIN to settle credit",
    return:   "Admin PIN to process return",
    checkout: "Enter your employee PIN",
    discount: "PIN required to apply discount",
  }[purpose] || "Verify identity";
  return `
    <div class="modal" style="max-width:340px">
      <h2>${label}</h2>
      <div id="pp-display"
        style="text-align:center;font-size:30px;letter-spacing:16px;min-height:48px;
               border-bottom:2px solid var(--border);padding-bottom:8px;margin:10px 0">····</div>
      <div id="pp-error" class="hidden"
        style="color:var(--danger);text-align:center;font-size:13px;margin-bottom:8px">
        Wrong PIN.
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
        ${[1,2,3,4,5,6,7,8,9,"⌫",0,"✓"].map(k=>`
          <button class="secondary-button"
            style="font-size:20px;min-height:50px"
            data-pp-key="${k}">${k}</button>`).join("")}
      </div>
      <div class="modal-actions" style="margin-top:10px">
        <button class="secondary-button" data-close>Cancel</button>
      </div>
    </div>`;
}

function handlePpKey(key) {
  const display = document.getElementById("pp-display");
  const errEl   = document.getElementById("pp-error");
  if (!display) return;
  if (key === "⌫") {
    ppBuffer = ppBuffer.slice(0, -1);
  } else if (key === "✓") {
    submitPp(); return;
  } else {
    if (ppBuffer.length >= 4) return;
    ppBuffer += String(key);
  }
  display.textContent = "●".repeat(ppBuffer.length).padEnd(4, "·");
  if (errEl) errEl.classList.add("hidden");
  if (ppBuffer.length === 4) submitPp();
}

async function submitPp() {
  const pin = ppBuffer;
  ppBuffer  = "";
  let res;
  if (["admin","settle","return"].includes(ppPurpose)) {
    res = await verifyAdmin(pin);
    if (res.ok) { state.modal = null; ppCallback && ppCallback(pin, null); }
  } else {
    res = await verifyPin(pin);
    if (res.ok) { state.modal = null; ppCallback && ppCallback(pin, res.employee); }
  }
  if (!res.ok) {
    const errEl   = document.getElementById("pp-error");
    const display = document.getElementById("pp-display");
    if (errEl)   errEl.classList.remove("hidden");
    if (display) display.textContent = "····";
  }
}

/* ── Print helper ───────────────────────────────────────────────── */
function printThermal(contentHtml) {
  const old = document.getElementById("thermal-frame");
  if (old) old.remove();
  const iframe = document.createElement("iframe");
  iframe.id    = "thermal-frame";
  Object.assign(iframe.style, {
    position:"fixed", top:"-9999px", left:"-9999px",
    width:"80mm", height:"1px", border:"none",
  });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <style>
      *    { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:'Courier New',Courier,monospace; font-size:12px;
             color:#000; background:#fff; width:80mm; padding:4mm; line-height:1.6; }
      .c   { text-align:center; }
      .b   { font-weight:bold; }
      .r   { text-align:right; }
      .lg  { font-size:15px; font-weight:bold; }
      .sm  { font-size:10px; color:#555; }
      .row { display:flex; justify-content:space-between; }
      .ln  { border-top:1px dashed #000; margin:5px 0; }
      .bw  { text-align:center; margin:6px 0; }
      @page { margin:0; size:80mm auto; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  </head><body>
    ${contentHtml}
    <script>
      window.addEventListener('load', function() {
        if (typeof JsBarcode !== 'undefined') {
          document.querySelectorAll('.bc').forEach(function(el) {
            try {
              JsBarcode(el, el.dataset.val,
                { format:'CODE128', width:1.4, height:38, displayValue:false });
            } catch(e) {}
          });
        }
        setTimeout(function(){ window.print(); }, 400);
      });
    <\/script>
  </body></html>`);
  doc.close();
}

function buildTicketSlip(ticket) {
  const comps = ticket.components_noted || [];
  return `
    ${CFG.shop_logo
  ? `<div class="c" style="margin-bottom:4px">
       <img src="${CFG.shop_logo}"
         style="max-width:140px;max-height:50px;object-fit:contain">
     </div>`
  : ""}
<div class="c b lg">${CFG.shop_name || "Repair Shop"}</div>
    <div class="c sm">${CFG.shop_address || ""}</div>
    <div class="c sm">${CFG.shop_phone   || ""}</div>
    <div class="ln"></div>
    <div class="c b">REPAIR TICKET</div>
    <div class="c lg">${ticket.ticket_number}</div>
    <div class="bw"><svg class="bc" data-val="${ticket.ticket_number}"></svg></div>
    <div class="ln"></div>
    <div class="row"><span>Customer</span><span>${ticket.customer_name}</span></div>
    <div class="row"><span>Phone</span><span>${ticket.customer_phone}</span></div>
    <div class="row"><span>Device</span>
      <span>${ticket.device_brand} ${ticket.device_model}</span></div>
    ${ticket.imei
      ? `<div class="row"><span>IMEI</span><span class="sm">${ticket.imei}</span></div>`
      : ""}
    <div class="row"><span>Date</span>
      <span>${new Date(ticket.created_at).toLocaleDateString()}</span></div>
    <div class="ln"></div>
    <div class="b">Issues Noted:</div>
    ${comps.length
      ? comps.map(c =>
          `<div class="row">
            <span>· ${c.name}</span>
            <span class="sm">${c.condition || ""}</span>
          </div>`).join("")
      : `<div class="sm">No components noted yet.</div>`}
    <div class="ln"></div>
    <div class="row">
      <span>Estimated Quote</span>
      <span>${money(ticket.estimated_quote, CFG.currency)}</span>
    </div>
    ${Number(ticket.advance_payment) > 0 ? `
    <div class="row">
      <span>Advance Paid</span>
      <span>${money(ticket.advance_payment, CFG.currency)}
        (${ticket.advance_method})</span>
    </div>` : ""}
    <div class="ln"></div>
    ${ticket.technician_note
      ? `<div class="sm">Note: ${ticket.technician_note}</div><div class="ln"></div>`
      : ""}
    ${CFG.terms_text
      ? `<div class="c sm">${CFG.terms_text}</div><div class="ln"></div>`
      : ""}
    <div class="c sm">Thank you for your trust.</div>`;
}

function buildReceiptSlip(sale) {
  const items = sale.items || [];
  return `
    ${CFG.shop_logo
  ? `<div class="c" style="margin-bottom:4px">
       <img src="${CFG.shop_logo}"
         style="max-width:140px;max-height:50px;object-fit:contain">
     </div>`
  : ""}
<div class="c b lg">${CFG.shop_name || "Repair Shop"}</div>
    <div class="c sm">${CFG.shop_address || ""}</div>
    <div class="c sm">${CFG.shop_phone   || ""}</div>
    <div class="ln"></div>
    <div class="c b">RECEIPT</div>
    <div class="c">${sale.receiptNo}</div>
    <div class="bw"><svg class="bc" data-val="${sale.receiptNo}"></svg></div>
    <div class="ln"></div>
    <div class="row"><span>Date</span>
      <span>${new Date(sale.date || sale.created_at || Date.now())
        .toLocaleDateString()}</span></div>
    ${sale.customer
      ? `<div class="row"><span>Customer</span><span>${sale.customer}</span></div>`
      : ""}
    ${sale.cashier
      ? `<div class="row"><span>Cashier</span><span>${sale.cashier}</span></div>`
      : ""}
    <div class="ln"></div>
    ${items.map(i => `
      <div class="row">
        <span>${i.name}</span>
        <span>${money(i.soldPrice * i.qty, CFG.currency)}</span>
      </div>
      <div class="sm row">
        <span>  ${i.qty} × ${money(i.soldPrice, CFG.currency)}
          ${i.discount > 0 ? ` (disc ${money(i.discount, CFG.currency)})` : ""}
        </span>
      </div>`).join("")}
    <div class="ln"></div>
    ${Number(sale.discount) > 0
      ? `<div class="row"><span>Discount</span>
           <span>${money(sale.discount, CFG.currency)}</span></div>` : ""}
    ${Number(sale.labour) > 0
      ? `<div class="row"><span>Labour</span>
           <span>${money(sale.labour, CFG.currency)}</span></div>` : ""}
    ${Number(sale.tax) > 0
      ? `<div class="row"><span>Tax</span>
           <span>${money(sale.tax, CFG.currency)}</span></div>` : ""}
    <div class="row b lg">
      <span>TOTAL</span>
      <span>${money(sale.total, CFG.currency)}</span>
    </div>
    <div class="row"><span>Payment</span><span>${sale.payment}</span></div>
    <div class="ln"></div>
    <div class="c sm">${CFG.terms_text || "Thank you for your business."}</div>`;
}

function buildReturnSlip(data) {
  return `
    <div class="c b lg">${CFG.shop_name || "Retail Shop"}</div>
    <div class="c sm">${CFG.shop_address || ""}</div>
    <div class="ln"></div>
    <div class="c b">RETURN / REFUND</div>
    <div class="ln"></div>
    <div class="row"><span>Original Invoice</span><span>INV-${data.saleId}</span></div>
    <div class="row"><span>Date</span>
      <span>${new Date().toLocaleDateString()}</span></div>
    <div class="ln"></div>
    ${data.items.map(i =>
      `<div class="row">
        <span>${i.name} × ${i.qty}</span>
        <span>${money(i.sold_price * i.qty, CFG.currency)}</span>
      </div>`).join("")}
    <div class="ln"></div>
    <div class="row b lg">
      <span>REFUND</span>
      <span>${money(data.refund, CFG.currency)}</span>
    </div>
    <div class="row"><span>Method</span><span>${data.method}</span></div>
    <div class="ln"></div>
    <div class="c sm">Please retain this slip for your records.</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════════════ */
function render() {
  // ── Gateway: always require login ──
  if (!SESSION.employee && !SESSION.loginSkipped) {
    document.getElementById("app").innerHTML = loginScreen();
    return;
  }
  // ── Suspension gate ──
  if (CFG.suspended === true) {
    document.getElementById("app").innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;
                  justify-content:center;height:100vh;gap:16px;text-align:center;padding:24px">
        <div style="font-size:48px">🔒</div>
        <h2 style="color:var(--danger)">Account Suspended</h2>
        <p class="muted" style="max-width:360px;line-height:1.6">
          This RetailOS account has been suspended. Please contact your service provider to restore access.
        </p>
      </div>`;
    return;
  }
  // Restore role from session on every render
  if (SESSION.employee?.role) state.role = SESSION.employee.role;
  if (SESSION.isAdmin) state.role = "Business Owner";
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
            ${SESSION.employee ? `
  <span class="chip" style="gap:6px">
    <strong style="font-size:12px">${SESSION.employee.name}</strong>
    <span class="muted" style="font-size:11px">· ${SESSION.employee.role}</span>
  </span>` : ""}
<span class="chip"><i class="dot ${state.online?(state.syncing?"syncing":""):"offline"}"></i>${state.online?(state.syncing?"Syncing":"Online"):"Offline"}</span>
            ${can("pos") ?`<button class="${state.route==="pos"?"primary-button":"secondary-button"}" data-route="pos">POS</button>`:""}
            ${(SESSION.isAdmin || (can("dashboard")||can("inventory")) && !["Cashier","Technician"].includes(state.role))?`<button class="${state.route==="admin"?"primary-button":"secondary-button"}" data-route="admin">Admin</button>`:""}
            ${state.installPrompt?`<button class="icon-button" data-action="install">Install</button>`:""}
            <button class="icon-button" data-action="theme">${state.theme==="dark"?"Light":"Dark"}</button>
            <button class="icon-button" data-action="logout" style="color:var(--danger)">Logout</button>
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
  if (state.route === "pos") return pos();
  const pages = {
    dashboard,
    repairs,
    inventory,
    reports,
    employees,
    receipts,
    settings,
  };
  if (!can(state.adminModule)) state.adminModule = "dashboard";
  return adminShell((pages[state.adminModule] || dashboard)());
}

function adminShell(content) {
  const tenant = currentTenant();
  const modLabel = ADMIN_MODULES.find(([k]) => k === state.adminModule)?.[2] || "";
  return `
    <div class="admin-header">
      <div>
        <h1>${modLabel}</h1>
        <p class="muted">${tenant.name}</p>
      </div>
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
      <button class="settings-tab ${state.settingsTab==="components"?"active":""}" data-settings-tab="components">Repair Components</button>
      <button class="settings-tab ${state.settingsTab==="quickitems"?"active":""}" data-settings-tab="quickitems">Quick Items</button>
      <button class="settings-tab ${state.settingsTab==="staff"?"active":""}" data-settings-tab="staff">Staff & Security</button>
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
    if (state.settingsTab === "components") {
  const comps = CFG.quick_components || [];
  return `
    <div class="card" style="display:grid;gap:14px">
      <div>
        <h2>Quick-Tap Components</h2>
        <p class="muted" style="font-size:13px">
          These appear as buttons when creating a repair ticket.
        </p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px" id="comp-list">
        ${comps.map((c, i) => `
          <div style="display:flex;align-items:center;gap:6px;
                      background:var(--surface-2);border:1px solid var(--border);
                      border-radius:8px;padding:6px 10px">
            <span style="font-size:13px">${c}</span>
            <button type="button" data-remove-quick="${i}"
              style="color:var(--danger);background:none;border:none;
                     font-size:16px;line-height:1;padding:0 2px;cursor:pointer">×</button>
          </div>`).join("")}
      </div>
      <div style="display:flex;gap:8px">
        <input id="new-comp-input" class="search" placeholder="New component name"
          style="flex:1">
        <button class="primary-button" data-action="add-quick-comp">Add</button>
      </div>
      <button class="primary-button" data-action="save-quick-comps">
        Save Components List
      </button>
    </div>`;
}
  if (state.settingsTab === "quickitems") {
    const items = CFG.quick_items || [];
    return `
      <div class="card" style="display:grid;gap:16px">
        <div>
          <h2>Quick Sale Items</h2>
          <p class="muted" style="font-size:13px">
            These appear as tap buttons in the POS cart.
            Each item has preset price options the cashier picks from.
          </p>
        </div>
        ${items.map((item, i) => `
          <div style="padding:12px;background:var(--surface-2);
                      border-radius:8px;display:grid;gap:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <strong>${item.name}</strong>
              <button type="button" data-remove-qitem="${i}"
                style="color:var(--danger);background:none;border:none;
                       font-size:18px;cursor:pointer">×</button>
            </div>
            <div style="font-size:13px;color:var(--muted)">
              Price options: ${item.prices.map((p,pi) => `
                <span style="display:inline-flex;align-items:center;gap:4px;
                             margin-right:6px">
                  ${money(p, CFG.currency)}
                  <button type="button" data-remove-qprice="${i}-${pi}"
                    style="color:var(--danger);background:none;border:none;
                           font-size:14px;cursor:pointer;padding:0">×</button>
                </span>`).join("")}
            </div>
            <div style="display:flex;gap:8px">
              <input type="number" placeholder="Add price option"
                id="qprice-input-${i}" min="1"
                style="flex:1;border:1px solid var(--border);border-radius:6px;
                       padding:7px 9px;background:var(--surface);color:var(--text)">
              <button type="button" class="secondary-button"
                data-add-qprice="${i}">+ Price</button>
            </div>
          </div>`).join("")}
        <div style="display:flex;gap:8px">
          <input id="qitem-name" class="search" placeholder="Item name (e.g. Handsfree)"
            style="flex:1">
          <button class="primary-button" data-action="add-qitem">Add Item</button>
        </div>
        <button class="primary-button" data-action="save-qitems">
          Save Quick Items
        </button>
      </div>`;
  }
  if (state.settingsTab === "staff") {
    const emps = state.data.employees || [];
    return `
      <div style="display:grid;gap:16px">
        <div class="card" style="display:grid;gap:14px">
          <h2>Employees</h2>
          ${emps.length ? `
            <div class="table-wrap"><table>
              <thead><tr>
                <th>Name</th><th>Role</th><th>Status</th><th>PIN</th><th></th>
              </tr></thead>
              <tbody>
                ${emps.map(e => `<tr>
                  <td><strong>${e.name}</strong></td>
                  <td>${e.role}</td>
                  <td><span class="badge ${e.status==="Active"?"good":"bad"}">${e.status}</span></td>
                  <td><span class="muted">••••</span></td>
                  <td>
                    <button class="secondary-button" style="font-size:12px"
                      data-action="edit-employee" data-emp-id="${e.id}"
                      data-emp-name="${e.name}" data-emp-role="${e.role}"
                      data-emp-status="${e.status}">Edit</button>
                  </td>
                </tr>`).join("")}
              </tbody>
            </table></div>` : `<p class="muted">No employees yet.</p>`}
          <button class="primary-button" style="width:fit-content" data-modal="employee">+ Add Employee</button>
        </div>
        <div class="card" style="display:grid;gap:14px">
          <h2>Change Admin Password</h2>
          <p class="muted" style="font-size:13px">Used to access Admin panel and settings.</p>
          <form class="form-grid" data-form="change-admin-password">
            <label class="field"><span>Current Password</span>
              <input name="current" type="password" autocomplete="off" required></label>
            <label class="field"><span>New Password</span>
              <input name="newpass" type="password" autocomplete="off" required></label>
            <div class="modal-actions" style="grid-column:1/-1">
              <button class="primary-button">Update Password</button>
            </div>
          </form>
        </div>
      </div>`;
  }
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
  const subtotal = state.cart.reduce((s, i) => s + i.soldPrice * i.qty, 0);
  const disc     = state.cart.reduce((s, i) => s + (i.originalPrice - i.soldPrice) * i.qty, 0);
  const tax      = subtotal * (tenant.taxRate / 100);

  return `
    <div class="page-title">
      <div>
        <h1>Point of Sale</h1>
        <p class="muted">Counter · ${tenant.name}
          ${SESSION.employee ? `· <strong>${SESSION.employee.name}</strong>` : ""}
        </p>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="secondary-button" data-action="shift-stats">📋 Shift Stats</button>
        ${tenant.repairModuleEnabled ? `
          <button class="primary-button" data-modal="repair">+ New Ticket</button>
          <button class="secondary-button" data-action="add-ticket-to-cart">Collect Repair</button>
        ` : ""}
        <button class="secondary-button" data-action="open-return">↩ Return</button>
        <button class="secondary-button" data-action="open-udhar">₨ Credits</button>
      </div>
    </div>

    <div class="grid pos-layout">
      <!-- Left: Recent tickets as quick-add if repair module on -->
      <div class="grid" style="align-content:start;gap:12px">
      ${(CFG.quick_items||[]).length ? `
          <div class="card">
            <h2 style="margin-bottom:10px">Quick Items</h2>
            <div style="display:flex;flex-wrap:wrap;gap:8px">
              ${(CFG.quick_items||[]).map(item => `
                <div style="position:relative">
                  <button class="secondary-button" style="font-size:13px;padding:7px 12px"
                    data-qitem-name="${item.name}"
                    data-qitem-prices='${JSON.stringify(item.prices)}'>
                    ${item.name}
                  </button>
                </div>`).join("")}
            </div>
          </div>` : ""}  
      ${tenant.repairModuleEnabled ? `
          <div class="card">
            <h2 style="margin-bottom:12px">Open Repair Tickets</h2>
            ${(state.data.tickets || [])
              .filter(t => !["Delivered","Declined"].includes(t.status))
              .slice(0, 8)
              .map(t => `
                <div class="list-row" style="margin-bottom:6px">
                  <div>
                    <strong>${t.customer_name}</strong>
                    <span class="badge warn" style="margin-left:6px">${t.status}</span><br>
                    <small class="muted">${t.ticket_number} · ${t.device_brand} ${t.device_model}</small>
                  </div>
                  <button class="primary-button" style="font-size:12px;padding:6px 10px"
                    data-quick-collect="${t.id}">Collect</button>
                </div>`).join("") ||
              `<div class="empty">No open tickets.</div>`}
          </div>
        ` : `
          <div class="card">
            <h2>Quick Sale</h2>
            <p class="muted" style="font-size:13px">
              Add items to cart using the cart panel.
              Inventory module can be enabled from Platform Admin.
            </p>
          </div>
        `}
      </div>

      <!-- Right: Cart -->
      <aside class="card cart">
        <h2>Cart</h2>
        ${state.cart.length ? state.cart.map(item => `
          <div class="cart-line">
            <div>
              <strong>${item.name}</strong><br>
              <small class="muted">${money(item.soldPrice, tenant.currency)} each
                ${item.reason ? " · " + item.reason : ""}
              </small>
            </div>
            <div class="qty-controls">
              <button data-qty="${item.productId}" data-delta="-1">−</button>
              <strong>${item.qty}</strong>
              <button data-qty="${item.productId}" data-delta="1">+</button>
            </div>
            <button class="secondary-button"
              data-modal="override" data-id="${item.productId}">Price</button>
          </div>`).join("") :
          `<div class="empty">No items in cart.</div>`}

        <div class="totals">
          <div class="total-row">
            <span>Subtotal</span>
            <strong>${money(subtotal, tenant.currency)}</strong>
          </div>
          ${disc > 0 ? `
          <div class="total-row">
            <span>Discounts</span>
            <strong style="color:var(--success)">− ${money(disc, tenant.currency)}</strong>
          </div>` : ""}
          ${tax > 0 ? `
          <div class="total-row">
            <span>Tax ${tenant.taxRate}%</span>
            <strong>${money(tax, tenant.currency)}</strong>
          </div>` : ""}
          <div class="total-row grand">
            <span>Total</span>
            <strong>${money(subtotal + tax, tenant.currency)}</strong>
          </div>
        </div>

        <select class="tenant-switcher" data-action="payment">
          <option ${state.checkoutPayment==="Cash"?"selected":""}>Cash</option>
          <option ${state.checkoutPayment==="Raast"?"selected":""}>Raast</option>
          <option ${state.checkoutPayment==="JazzCash"?"selected":""}>JazzCash</option>
          <option ${state.checkoutPayment==="EasyPaisa"?"selected":""}>EasyPaisa</option>
          <option ${state.checkoutPayment==="Bank Transfer"?"selected":""}>Bank Transfer</option>
          <option ${state.checkoutPayment==="Udhar (Credit)"?"selected":""}>Udhar (Credit)</option>
        </select>

        ${state.checkoutPayment === "Udhar (Credit)" ? `
          <div style="display:grid;gap:8px">
            <input class="search" placeholder="Customer name *"
              data-udhar="name" value="${state.udharName || ""}">
            <input class="search" placeholder="Customer phone *"
              data-udhar="phone" value="${state.udharPhone || ""}">
          </div>` : ""}

        <button class="primary-button" data-action="checkout"
          ${state.cart.length ? "" : "disabled"}>
          Checkout & Receipt
        </button>
      </aside>
    </div>`;
}

/* ── Shift stats HTML (print-safe) ─────────────────────────────── */
function buildShiftStats() {
  const tenant    = currentTenant();
  const todayStr  = new Date().toISOString().slice(0, 10);
  const empName   = SESSION.employee?.name || "";
  const allSales  = state.data.sales || [];
  const allTickets= state.data.tickets || [];

  const shiftSales = allSales.filter(s =>
    (s.created_at || "").slice(0, 10) === todayStr &&
    (!empName || s.employee_name === empName)
  );

  const itemsSold  = shiftSales.reduce((s, sale) =>
    s + (sale.items_sold || []).reduce((x, i) => x + (i.qty || 1), 0), 0);
  const cashEarned = shiftSales.reduce((s, sale) => s + Number(sale.total_bill || 0), 0);
  const cashOnly   = shiftSales
    .filter(s => s.payment_method === "Cash")
    .reduce((s, sale) => s + Number(sale.total_bill || 0), 0);
  const discounts  = shiftSales.reduce((s, sale) => s + Number(sale.discount || 0), 0);
  const custCount  = new Set(shiftSales.map(s => s.customer_name).filter(Boolean)).size;

  const shiftTkts  = allTickets.filter(t =>
    (t.created_at || "").slice(0, 10) === todayStr &&
    (!empName || t.created_by === empName)
  );
  const pendingAll = allTickets.filter(t => !["Delivered","Declined"].includes(t.status));
  const processed  = shiftTkts.filter(t => t.status === "Delivered");
  const stillPend  = shiftTkts.filter(t => !["Delivered","Declined"].includes(t.status));

  return `
    <div class="shift-print">
      <center>
        <strong style="font-size:15px">${tenant.name}</strong><br>
        Shift Summary — ${todayStr}<br>
        ${empName || "All Staff"}
      </center>
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
      <div class="section-head">Sales</div>
      <div class="stat-row"><span class="stat-label">Products sold</span><span class="stat-val">${itemsSold}</span></div>
      <div class="stat-row"><span class="stat-label">Total revenue</span><span class="stat-val">${money(cashEarned, tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Cash collected</span><span class="stat-val">${money(cashOnly, tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Discounts given</span><span class="stat-val">${money(discounts, tenant.currency)}</span></div>
      <div class="stat-row"><span class="stat-label">Customers served</span><span class="stat-val">${custCount}</span></div>
      ${tenant.repairModuleEnabled ? `
        <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
        <div class="section-head">Repair Tickets</div>
        <div class="stat-row"><span class="stat-label">Created this shift</span><span class="stat-val">${shiftTkts.length}</span></div>
        <div class="stat-row"><span class="stat-label">Delivered this shift</span><span class="stat-val">${processed.length}</span></div>
        <div class="stat-row"><span class="stat-label">Pending from this shift</span><span class="stat-val">${stillPend.length}</span></div>
        <div class="stat-row"><span class="stat-label">All pending (shop-wide)</span><span class="stat-val">${pendingAll.length}</span></div>
      ` : ""}
      <hr style="border:none;border-top:1px dashed #bbb;margin:8px 0">
      <center style="color:#888;font-size:11px">Printed ${new Date().toLocaleString()}</center>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   ADMIN PAGES
═══════════════════════════════════════════════════════════════════ */
function dashboard() {
  const tenant  = currentTenant();
  const sales   = state.data.sales   || [];
  const tickets = state.data.tickets || [];
  const udhar   = state.data.udhar   || [];
  const todayStr = new Date().toISOString().slice(0,10);
  const todayS   = sales.filter(s => (s.created_at||"").slice(0,10) === todayStr);
  const total    = sales.reduce((s,x) => s + Number(x.total_bill||0), 0);
  const todayRev = todayS.reduce((s,x) => s + Number(x.total_bill||0), 0);
  const pending  = tickets.filter(t => !["Delivered","Declined"].includes(t.status)).length;
  const udharBal = udhar.filter(u => u.status !== "Settled")
                        .reduce((s,u) => s + Number(u.balance_due||0), 0);
  const kpis = [
    ["Today's Revenue",  todayRev,          ""],
    ["Total Revenue",    total,             ""],
    ["Total Sales",      sales.length,      ""],
    ["Open Tickets",     pending,           ""],
    ["Udhar Balance",    udharBal,          ""],
    ["Employees",        (state.data.employees||[]).length, ""],
  ];
  return `
    ${tit("Dashboard","Live overview of sales, tickets, and operations.",
      `<button class="primary-button" data-action="new-sale">Go to POS</button>`)}
    <div class="grid kpi-grid">
      ${kpis.map(([l,v]) => `
        <div class="card kpi">
          <span class="label">${l}</span>
          <span class="value">${typeof v === "number" && l !== "Total Sales" && l !== "Open Tickets" && l !== "Employees"
            ? money(v, tenant.currency) : v}</span>
        </div>`).join("")}
    </div>
    <div class="grid two-col">
      <div class="card">
        <h2>Recent Sales</h2>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Invoice</th><th>Customer</th><th>Payment</th><th>Total</th>
          </tr></thead>
          <tbody>
            ${sales.slice(0,8).map(s => `<tr>
              <td>INV-${s.id}</td>
              <td>${s.customer_name || "Walk-in"}</td>
              <td>${s.payment_method}</td>
              <td>${money(s.total_bill, tenant.currency)}</td>
            </tr>`).join("")}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>Operational Alerts</h2>
        <div class="list">
          <div class="list-row">
            <span>Pending Repairs</span><strong>${pending}</strong>
          </div>
          <div class="list-row">
            <span>Outstanding Udhar</span>
            <strong>${udhar.filter(u=>u.status!=="Settled").length}</strong>
          </div>
          <div class="list-row">
            <span>Today's Transactions</span>
            <strong>${todayS.length}</strong>
          </div>
          <div class="list-row">
            <span>Active Employees</span>
            <strong>${(state.data.employees||[]).filter(e=>e.status==="Active").length}</strong>
          </div>
        </div>
      </div>
    </div>`;
}

function repairs() {
  const rows = (state.data.tickets || [])
    .filter(t => (`${t.customer_name} ${t.ticket_number} ${t.device_model} ${t.device_brand} ${t.status} ${t.customer_phone}`)
      .toLowerCase().includes(state.filter.toLowerCase()));
  const tenant = currentTenant();
  const statusColors = {
    "Pending":"warn","In Progress":"warn",
    "Ready":"good","Delivered":"good","Declined":"bad"
  };
  return `
    ${tit("Repair Tickets","Full repair queue with status tracking.",
      `<button class="primary-button" data-modal="repair">New Ticket</button>`)}
    ${tlb("Search by customer name, device, ticket…","repair","")}
    <div class="grid two-col">
      <div class="card">
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Ticket</th><th>Customer</th><th>Device</th>
            <th>Advance</th><th>Status</th><th></th>
          </tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `<tr style="cursor:pointer" data-view-ticket="${r.id}">
              <td><strong>${r.customer_name}</strong><br>
              <small class="muted">${r.customer_phone}</small></td>
               <td><span style="color:var(--primary);font-size:12px">${r.ticket_number}</span></td>
              <td>${r.device_brand} ${r.device_model}<br>
                <small class="muted">${r.imei||""}</small></td>
              <td>${Number(r.advance_payment||0) > 0
                ? money(r.advance_payment, tenant.currency) : "—"}</td>
              <td><span class="badge ${statusColors[r.status]||"warn"}">
                ${r.status}</span></td>
              <td style="display:flex;gap:6px;align-items:center">
                ${CFG.technician_module_enabled !== false ? `
                <button class="secondary-button"
                  data-action="open-ticket-editor"
                  data-ticket-id="${r.id}"
                  style="font-size:12px"
                  onclick="event.stopPropagation()">Edit</button>` : ""}
                <button class="secondary-button"
                  data-action="add-ticket-to-cart"
                  style="font-size:12px"
                  onclick="event.stopPropagation()">Collect</button>
              </td>
            </tr>`).join("") :
            `<tr><td colspan="6" style="text-align:center;color:var(--muted)">
              No tickets found.</td></tr>`}
          </tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>Status Summary</h2>
        <div class="list">
          ${["Pending","In Progress","Ready","Delivered","Declined"].map(s => `
            <div class="list-row">
              <span>${s}</span>
              <strong>${(state.data.tickets||[]).filter(t=>t.status===s).length}</strong>
            </div>`).join("")}
        </div>
      </div>
    </div>`;
}

function reports() {
  const tenant  = currentTenant();
  const sales   = state.data.sales   || [];
  const tickets = state.data.tickets || [];
  const udhar   = state.data.udhar   || [];
  const total   = sales.reduce((s,x) => s + Number(x.total_bill||0), 0);
  const disc    = sales.reduce((s,x) => s + Number(x.discount||0), 0);
  const labour  = sales.reduce((s,x) => s + Number(x.labour_cost||0), 0);
  const avgOrder= sales.length ? total / sales.length : 0;
  const udharOut= udhar.filter(u=>u.status!=="Settled")
                       .reduce((s,u)=>s+Number(u.balance_due||0),0);
  return `
    ${tit("Reports","Sales analytics, discounts, and outstanding credits.","")}
    <div class="grid kpi-grid">
      ${[
        ["Total Revenue",   total],
        ["Discounts Given", disc],
        ["Labour Income",   labour],
        ["Average Invoice", avgOrder],
        ["Udhar Outstanding", udharOut],
        ["Total Invoices",  sales.length],
      ].map(([l,v]) => `
        <div class="card kpi">
          <span class="label">${l}</span>
          <span class="value">${l === "Total Invoices"
            ? v : money(v, tenant.currency)}</span>
        </div>`).join("")}
    </div>
    <div class="grid two-col">
      <div class="card">
        <h2>Payment Method Breakdown</h2>
        <div class="list">
          ${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer","Udhar"].map(m => {
            const count = sales.filter(s=>s.payment_method===m).length;
            const rev   = sales.filter(s=>s.payment_method===m)
                               .reduce((s,x)=>s+Number(x.total_bill||0),0);
            return count ? `
              <div class="list-row">
                <span>${m} <small class="muted">(${count})</small></span>
                <strong>${money(rev, tenant.currency)}</strong>
              </div>` : "";
          }).join("")}
        </div>
      </div>
      <div class="card">
        <h2>Repair Summary</h2>
        <div class="list">
          <div class="list-row">
            <span>Total Tickets</span>
            <strong>${tickets.length}</strong>
          </div>
          <div class="list-row">
            <span>Delivered</span>
            <strong>${tickets.filter(t=>t.status==="Delivered").length}</strong>
          </div>
          <div class="list-row">
            <span>Declined</span>
            <strong>${tickets.filter(t=>t.status==="Declined").length}</strong>
          </div>
          <div class="list-row">
            <span>Still Open</span>
            <strong>${tickets.filter(t=>!["Delivered","Declined"].includes(t.status)).length}</strong>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <h2>Recent Invoices</h2>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Invoice</th><th>Customer</th><th>Items</th>
          <th>Payment</th><th>Total</th><th>Date</th>
        </tr></thead>
        <tbody>
          ${sales.slice(0,15).map(s => `<tr>
            <td>INV-${s.id}</td>
            <td>${s.customer_name||"Walk-in"}</td>
            <td>${(s.items_sold||[]).length} item(s)</td>
            <td>${s.payment_method}</td>
            <td>${money(s.total_bill, tenant.currency)}</td>
            <td>${new Date(s.created_at).toLocaleDateString()}</td>
          </tr>`).join("")}
        </tbody>
      </table></div>
    </div>`;
}

function employees() {
  const emps = state.data.employees || [];
  return `
    ${tit("Employees","Staff PINs, roles, and access control.",
      `<button class="primary-button" data-modal="employee">Add Employee</button>`)}
    <div class="card">
      ${emps.length ? `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Name</th><th>Role</th><th>Status</th><th>PIN</th>
          </tr></thead>
          <tbody>
            ${emps.map(e => `<tr>
              <td><strong>${e.name}</strong></td>
              <td>${e.role}</td>
              <td><span class="badge ${e.status==="Active"?"good":"bad"}">
                ${e.status}</span></td>
              <td><span class="muted">••••</span></td>
            </tr>`).join("")}
          </tbody>
        </table></div>` :
        `<div class="empty">No employees yet. Add one above.</div>`}
    </div>`;
}

function receipts() {
  const sales = (state.data.sales || []);
  const filtered = sales.filter(s =>
    (`${s.customer_name} ${s.payment_method} ${s.employee_name}`)
      .toLowerCase().includes(state.filter.toLowerCase())
  );
  const expanded = state.receiptsExpanded || null;
  return `
    ${tit("Receipts Archive","Full log of all completed sales and invoices.","")}
    ${tlb("Search by customer, payment method…","receipts","")}
    <div class="card" style="display:grid;gap:0">
      ${filtered.length ? filtered.map(s => {
        const isOpen = expanded === s.id;
        const items  = Array.isArray(s.items_sold) ? s.items_sold : [];
        return `
          <div style="border-bottom:1px solid var(--border);padding:12px 4px">
            <div style="display:flex;justify-content:space-between;align-items:center;
                        cursor:pointer;gap:12px" data-action="toggle-receipt" data-receipt-id="${s.id}">
              <div style="display:grid;gap:2px">
                <strong>${s.customer_name || "Walk-in"}</strong>
                <span class="muted" style="font-size:12px">
                  INV-${s.id} · ${s.payment_method} · ${s.employee_name || ""}
                </span>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div><strong>${money(s.total_bill, CFG.currency)}</strong></div>
                <span class="muted" style="font-size:11px">
                  ${new Date(s.created_at).toLocaleDateString()} ${new Date(s.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                </span>
              </div>
            </div>
            ${isOpen ? `
              <div style="margin-top:10px;padding:10px;background:var(--surface-2);
                          border-radius:8px;display:grid;gap:6px">
                ${items.length ? items.map(i => `
                  <div style="display:flex;justify-content:space-between;font-size:13px">
                    <span>${i.name || i.productName || "Item"} × ${i.qty || 1}</span>
                    <span>${money((i.soldPrice || i.price || 0) * (i.qty || 1), CFG.currency)}</span>
                  </div>`).join("") : `<span class="muted" style="font-size:13px">No item breakdown available.</span>`}
                <div style="border-top:1px solid var(--border);margin-top:4px;padding-top:6px;
                            display:flex;justify-content:space-between;font-size:13px">
                  ${s.discount > 0 ? `<span>Discount</span><span>- ${money(s.discount, CFG.currency)}</span>` : ""}
                </div>
                <div style="display:flex;justify-content:space-between;font-weight:600">
                  <span>Total</span><span>${money(s.total_bill, CFG.currency)}</span>
                </div>
              </div>` : ""}
          </div>`;
      }).join("") : `<div class="empty" style="padding:24px;text-align:center;color:var(--muted)">No sales found.</div>`}
    </div>`;
}

function inventory() {
  const tenant = currentTenant();
  const items  = state.data.inventory || [];
  const filter = (state.filter || "").toLowerCase();
  const filtered = items.filter(i =>
    !filter ||
    (i.name     || "").toLowerCase().includes(filter) ||
    (i.sku      || "").toLowerCase().includes(filter) ||
    (i.category || "").toLowerCase().includes(filter)
  );
  const lowStock = items.filter(i => Number(i.qty || 0) <= Number(i.min_qty || 0) && Number(i.min_qty || 0) > 0);
  return `
    ${tit("Inventory","Stock levels, pricing, and alerts.",
      `<button class="primary-button" data-modal="inv-add">+ Add Item</button>`)}
    ${lowStock.length ? `
      <div style="background:color-mix(in srgb,var(--warning) 12%,var(--surface));border:1px solid color-mix(in srgb,var(--warning) 30%,var(--border));border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:12px">
        ⚠ ${lowStock.length} item${lowStock.length>1?"s":""} low on stock:
        ${lowStock.map(i=>`<strong>${i.name}</strong> (${i.qty} left)`).join(", ")}
      </div>` : ""}
    <div class="card">
      <div style="margin-bottom:10px">
        <input class="search-input" placeholder="Search inventory…" data-filter="inv" value="${state.filter||""}" style="width:100%;border:1px solid var(--border);border-radius:8px;padding:8px 12px;background:var(--surface);color:var(--text)">
      </div>
      ${filtered.length ? `
        <div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Qty</th><th>Sell Price</th><th>Cost</th><th>Actions</th></tr></thead>
          <tbody>
            ${filtered.map(i => `<tr>
              <td><strong>${i.name}</strong></td>
              <td class="muted">${i.sku||"—"}</td>
              <td>${i.category||"—"}</td>
              <td><span class="badge ${Number(i.qty||0) <= Number(i.min_qty||0) && Number(i.min_qty||0)>0 ? "bad" : "good"}">${i.qty}</span></td>
              <td>${money(i.price, tenant.currency)}</td>
              <td class="muted">${money(i.cost, tenant.currency)}</td>
              <td>
                <button class="secondary-button" style="font-size:12px;padding:4px 10px" data-inv-edit="${i.id}">Edit</button>
                <button class="secondary-button" style="font-size:12px;padding:4px 10px;color:var(--danger)" data-inv-delete="${i.id}">Delete</button>
              </td>
            </tr>`).join("")}
          </tbody>
        </table></div>` :
        `<div class="empty">${filter ? "No items match your search." : "No inventory items yet. Add one above."}</div>`}
    </div>`;
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
  const cartItem = state.cart.find(i => i.productId === id);
  const tenant   = currentTenant();

  // Ticket lookup for checkout modal
  const ticket = (state.data.tickets || []).find(t => String(t.id) === String(id));

  const forms = {

    "qitem-pick": (() => {
      const { name, prices } = state.modal;
      if (!prices) return "";
      return `
        <div class="modal" style="max-width:340px">
          <h2>${name}</h2>
          <p class="muted">Select price:</p>
          <div style="display:grid;gap:8px;margin-top:8px">
            ${prices.map((p, i) => `
              <button class="secondary-button" style="font-size:16px;min-height:48px"
                data-pick-price="${i}">
                ${money(p, CFG.currency)}
              </button>`).join("")}
          </div>
          <div class="modal-actions">
            <button class="secondary-button" data-close>Cancel</button>
          </div>
        </div>`;
    })(),

    // ── Repair ticket creation ──────────────────────────────────────
    repair: (() => {
      const comps = CFG.quick_components || [];
      const tags  = ["Repaired","Replaced","New","Cleaned","Checked"];
      const sel   = state.modal?.selectedComponents || [];
      const d     = state.modal?._draft || {};
      const fldV  = (label, name, val="", type="text") =>
        `<label class="field"><span>${label}</span>
          <input name="${name}" type="${type}"
            value="${String(val).replace(/"/g,'&quot;')}"
            placeholder="${label}"
            style="width:100%;border:1px solid var(--border);border-radius:8px;
                   padding:8px 12px;background:var(--surface);color:var(--text)">
        </label>`;
      return `
        <form class="modal" data-form="repair" style="max-width:680px">
          <h2>New Repair Ticket</h2>
          <div class="form-grid">
            ${fldV("Customer Name","customerName", d.customerName)}
            ${fldV("Customer Phone","customerPhone", d.customerPhone, "tel")}
            ${fldV("Device Brand","deviceBrand", d.deviceBrand)}
            ${fldV("Device Model","deviceModel", d.deviceModel)}
            ${fldV("IMEI / Serial","imei", d.imei)}
            ${fldV("Estimated Quote","estimatedQuote", d.estimatedQuote ?? "", "number")}
            ${fldV("Advance Received","advance", d.advance ?? "", "number")}
            <label class="field"><span>Advance Method</span>
              <select name="advanceMethod">
                <option value="">None</option>
                ${["Cash","Raast","JazzCash","EasyPaisa","Bank Transfer"].map(m =>
                  `<option ${d.advanceMethod===m?"selected":""}>${m}</option>`).join("")}
              </select>
            </label>
            <label class="field" style="grid-column:1/-1">
              <span>Technician Note</span>
              <textarea name="technicianNote" style="min-height:56px">${d.technicianNote||""}</textarea>
            </label>
          </div>
          <p class="muted" style="font-size:13px;margin:8px 0 6px">Tap to add issues:</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
            ${comps.map(c => {
              const active = sel.find(s => s.name === c);
              return `<button type="button"
                class="${active ? "primary-button" : "secondary-button"}"
                style="font-size:13px;padding:6px 14px"
                data-comp="${c}">${c}${active ? " ✓" : ""}</button>`;
            }).join("")}
          </div>
          ${sel.length ? `<div style="display:grid;gap:6px;margin-bottom:10px">
            ${sel.map((s, i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:8px;
                          background:var(--surface-2);border-radius:8px">
                <strong style="flex:1">${s.name}</strong>
                <select data-comp-tag="${i}"
                  style="border:1px solid var(--border);border-radius:6px;
                         padding:5px 8px;background:var(--surface);color:var(--text)">
                  ${tags.map(t => `<option ${t === s.tag ? "selected" : ""}>${t}</option>`).join("")}
                </select>
                <button type="button" data-remove-comp="${i}"
                  style="color:var(--danger);background:none;border:none;
                         font-size:20px;line-height:1;padding:0 4px">×</button>
              </div>`).join("")}
          </div>` : ""}
          ${modalActions()}
        </form>`;
    })(),

    // ── Ticket Detail — view + update status ────────────────────────
    ticketDetail: (() => {
      if (type !== "ticketDetail") return "";
      const tk = (state.data.tickets || []).find(t => String(t.id) === String(id));
      if (!tk) return `<div class="modal"><p class="muted">Ticket not found.</p>
        <div class="modal-actions"><button class="secondary-button" data-close>Close</button></div></div>`;
      const comps = tk.components_noted || [];
      const statusColors = { "Pending":"warn","In Progress":"warn","Ready":"good","Delivered":"good","Declined":"bad" };
      const statuses = ["Pending","In Progress","Evaluated","Ready","Delivered","Declined"];
      return `
        <div class="modal" style="max-width:600px">
          <h2>${tk.ticket_number}
            <span class="badge ${statusColors[tk.status]||"warn"}" style="margin-left:8px">${tk.status}</span>
          </h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 16px;
                      font-size:14px;margin-bottom:14px;padding:12px;
                      background:var(--surface-2);border-radius:8px">
            <div><span class="muted">Customer</span><br><strong>${tk.customer_name}</strong></div>
            <div><span class="muted">Phone</span><br><strong>${tk.customer_phone||"—"}</strong></div>
            <div><span class="muted">Device</span><br><strong>${tk.device_brand} ${tk.device_model}</strong></div>
            <div><span class="muted">IMEI</span><br><strong>${tk.imei||"—"}</strong></div>
            <div><span class="muted">Estimated Quote</span><br><strong>${money(tk.estimated_quote||0, tenant.currency)}</strong></div>
            <div><span class="muted">Advance Paid</span><br><strong>${money(tk.advance_payment||0, tenant.currency)} ${tk.advance_method ? "("+tk.advance_method+")" : ""}</strong></div>
          </div>
          ${tk.technician_note ? `
            <div style="background:color-mix(in srgb,var(--warning) 10%,var(--surface));
                        border-left:3px solid var(--warning);padding:10px 14px;
                        border-radius:0 8px 8px 0;margin-bottom:12px;font-size:14px">
              <strong>Technician Note:</strong> ${tk.technician_note}
            </div>` : ""}
          ${comps.length ? `
            <p class="muted" style="font-size:13px;margin:0 0 6px"><strong>Components:</strong></p>
            <div style="display:grid;gap:6px;margin-bottom:12px">
              ${comps.map(c => `
                <div style="display:flex;justify-content:space-between;align-items:center;
                            padding:8px 12px;background:var(--surface-2);border-radius:8px;font-size:14px">
                  <span><strong>${c.name}</strong> <span class="badge warn" style="font-size:11px">${c.condition||""}</span></span>
                  <span>${c.price > 0 ? money(c.price, tenant.currency) : '<span class="muted">Not priced</span>'}</span>
                </div>`).join("")}
            </div>` : `<p class="muted" style="font-size:13px">No components logged yet.</p>`}
          <div style="border-top:1px solid var(--border);padding-top:12px;margin-top:4px">
            <p style="font-size:13px;margin:0 0 8px"><strong>Update Status & Actual Quote:</strong></p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <select id="td-status"
                style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;
                       background:var(--surface);color:var(--text);flex:1">
                ${statuses.map(s => `<option ${s===tk.status?"selected":""}>${s}</option>`).join("")}
              </select>
              <input type="number" id="td-actual-quote" placeholder="Actual price (optional)"
                value="${tk.actual_quote||""}"
                style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;
                       background:var(--surface);color:var(--text);width:180px">
            </div>
            <textarea id="td-note" placeholder="Add a note for the customer or next technician…"
              style="width:100%;margin-top:8px;min-height:60px;border:1px solid var(--border);
                     border-radius:8px;padding:8px 12px;background:var(--surface);
                     color:var(--text);box-sizing:border-box">${tk.update_note||""}</textarea>
          </div>
          <div class="modal-actions">
            <button class="secondary-button" data-close>Close</button>
            <button class="primary-button" data-action="save-ticket-detail" data-id="${tk.id}">Save Update</button>
          </div>
        </div>`;
    })(),

    // ── Ticket checkout — fill prices + add components ──────────────
    ticketCheckout: (() => {
      if (!ticket) return `<div class="modal"><p class="muted">Ticket not found.</p>
        <div class="modal-actions"><button class="secondary-button" data-close>Close</button></div></div>`;
      const comps   = ticket.components_noted || [];
      const advance = Number(ticket.advance_payment || 0);
      return `
        <div class="modal" style="max-width:640px">
          <h2>Checkout — ${ticket.ticket_number}</h2>
          <p class="muted">${ticket.customer_name} · ${ticket.device_brand} ${ticket.device_model}</p>
          ${advance > 0 ? `
            <div style="background:color-mix(in srgb,var(--warning) 12%,var(--surface));
                        border:1px solid color-mix(in srgb,var(--warning) 30%,var(--border));
                        border-radius:8px;padding:10px 14px;font-size:13px;margin-bottom:8px">
              Advance paid: ${money(advance, tenant.currency)}
              (${ticket.advance_method}) — deducted from total.
            </div>` : ""}
          <div style="display:grid;gap:6px;margin-bottom:10px" id="tc-list">
            ${comps.map((c, i) => `
              <div style="display:flex;align-items:center;gap:8px;padding:9px;
                          background:var(--surface-2);border-radius:8px">
                <span style="flex:1">
                  <strong>${c.name}</strong>
                  <span class="badge warn" style="margin-left:6px">${c.condition || ""}</span>
                </span>
                <input type="number" placeholder="Price" value="${c.price || ""}"
                  data-tc-price="${i}" min="0"
                  style="width:110px;border:1px solid var(--border);border-radius:6px;
                         padding:7px 9px;background:var(--surface);color:var(--text)">
                <button type="button" data-tc-remove="${i}"
                  style="color:var(--danger);background:none;border:none;
                         font-size:20px;line-height:1;padding:0 4px">×</button>
              </div>`).join("")}
          </div>
          <button type="button" class="secondary-button" data-tc-add
            style="font-size:13px;margin-bottom:12px">+ Add Component</button>
          <div style="border-top:1px solid var(--border);padding-top:10px;
                      display:flex;align-items:center;gap:10px">
            <label style="flex:1;font-size:14px">Labour / Technician Cost</label>
            <input type="number" id="tc-labour" value="${state.cartLabour || 0}" min="0"
              style="width:120px;border:1px solid var(--border);border-radius:6px;
                     padding:7px 9px;background:var(--surface);color:var(--text)">
          </div>
          ${advance > 0 ? `
            <div style="display:flex;justify-content:space-between;
                        padding-top:8px;color:var(--success)">
              <span>Advance Deduction</span>
              <strong>− ${money(advance, tenant.currency)}</strong>
            </div>` : ""}
          <div style="display:flex;justify-content:space-between;padding-top:8px;
                      font-size:20px;font-weight:800">
            <span>Total Payable</span>
            <strong id="tc-total">${money(0, tenant.currency)}</strong>
          </div>
          <div class="modal-actions" style="margin-top:12px">
            <button class="secondary-button" data-close>Cancel</button>
            <button class="danger-button" data-tc-decline>Declined by Customer</button>
            <button class="primary-button" data-tc-confirm>Add to Cart</button>
          </div>
        </div>
        <script>
          (function(){
            function recalc(){
              const prices = [...document.querySelectorAll('[data-tc-price]')]
                .map(i => Number(i.value) || 0);
              const labour  = Number(document.getElementById('tc-labour')?.value || 0);
              const advance = ${advance};
              const total   = prices.reduce((s,p) => s+p, 0) + labour - advance;
              const el      = document.getElementById('tc-total');
              if (el) el.textContent = 'Rs. ' + Math.max(0, total).toLocaleString();
            }
            document.addEventListener("keydown", e => {
  const onLoginScreen = !SESSION.employee && !SESSION.loginSkipped;
  if (onLoginScreen && e.key === "Enter") { e.preventDefault(); submitPin(); return; }
});

document.addEventListener("input", e => {
  if (e.target.id === "login-password") {
    onPasswordInput(e.target.value);
  }
  // existing input handlers below continue...
            recalc();
          })();
        <\/script>`;
    })(),

    // ── Price override ──────────────────────────────────────────────
    override: `
      <form class="modal" data-form="override">
        <h2>Price Override</h2>
        <p class="muted">Original: ${money(cartItem?.originalPrice || 0, tenant.currency)}</p>
        ${fld("Sold Price","soldPrice", cartItem?.soldPrice || 0, "number")}
        <label class="field"><span>Reason for Discount</span>
          <textarea name="reason">${cartItem?.reason || ""}</textarea>
        </label>
        ${modalActions()}
      </form>`,

    // ── Udhar customer info ─────────────────────────────────────────
    udharInfo: `
      <form class="modal" data-form="udharInfo" style="max-width:420px">
        <h2>Credit Sale — Customer Details</h2>
        <p class="muted">Enter customer info before completing the sale.</p>
        <div class="form-grid">
          ${fld("Customer Name","udharName")}
          ${fld("Customer Phone","udharPhone","","tel")}
        </div>
        ${modalActions()}
      </form>`,

    // ── Outstanding credits (Udhar list) ────────────────────────────
    udharList: (() => {
      const outstanding = (state.data.udhar || [])
        .filter(u => u.status !== "Settled");
      return `
        <div class="modal" style="max-width:640px">
          <h2>Outstanding Credits</h2>
          ${outstanding.length === 0
            ? `<div class="empty">No outstanding credits.</div>`
            : `<div style="display:grid;gap:10px">
              ${outstanding.map(u => `
                <div style="padding:12px;background:var(--surface-2);
                            border-radius:8px;display:grid;gap:8px">
                  <div style="display:flex;justify-content:space-between;
                              align-items:flex-start">
                    <div>
                      <strong>${u.customer_name}</strong> · ${u.customer_phone}<br>
                      <small class="muted">INV-${u.sale_id} ·
                        ${new Date(u.created_at).toLocaleDateString()}</small>
                    </div>
                    <span class="badge ${u.status === "Settled" ? "good" : "bad"}">
                      ${u.status}
                    </span>
                  </div>
                  <div style="display:flex;justify-content:space-between">
                    <span>Balance: <strong>${money(u.balance_due, tenant.currency)}</strong></span>
                    <span class="muted">Total: ${money(u.total_amount, tenant.currency)}</span>
                  </div>
                  <div style="display:flex;gap:8px;align-items:center">
                    <input type="number" placeholder="Amount to settle"
                      data-settle-amount="${u.id}" min="1"
                      style="flex:1;border:1px solid var(--border);border-radius:6px;
                             padding:7px 9px;background:var(--surface);color:var(--text)">
                    <select data-settle-method="${u.id}"
                      style="border:1px solid var(--border);border-radius:6px;
                             padding:7px 9px;background:var(--surface);color:var(--text)">
                      <option>Cash</option><option>Raast</option>
                      <option>JazzCash</option><option>EasyPaisa</option>
                      <option>Bank Transfer</option>
                    </select>
                    <button class="primary-button" data-settle-id="${u.id}">Settle</button>
                  </div>
                </div>`).join("")}
            </div>`}
          <div class="modal-actions">
            <button class="secondary-button" data-close>Close</button>
          </div>
        </div>`;
    })(),

    // ── Return flow ─────────────────────────────────────────────────
    returnFlow: (() => {
      const receiptInput = state.modal?.receiptNo || "";
      const saleId       = receiptInput.replace("INV-","");
      const sale         = (state.data.sales || [])
        .find(s => String(s.id) === String(saleId));

      if (!sale) return `
        <form class="modal" data-form="return-lookup" style="max-width:440px">
          <h2>Process Return</h2>
          <p class="muted">Enter the invoice number from the original receipt.</p>
          ${fld("Invoice No. (e.g. INV-42)","receiptNo", receiptInput)}
          ${state.modal?.notFound
            ? `<p style="color:var(--danger);font-size:13px">Invoice not found.</p>`
            : ""}
          <div class="modal-actions">
            <button class="secondary-button" data-close>Cancel</button>
            <button class="primary-button">Look Up</button>
          </div>
        </form>`;

      const items = sale.items_sold || [];
      return `
        <form class="modal" data-form="return-confirm" style="max-width:560px">
          <h2>Return — INV-${sale.id}</h2>
          <p class="muted">${sale.customer_name || "Walk-in"} ·
            ${new Date(sale.created_at).toLocaleDateString()}</p>
          <div style="display:grid;gap:8px;margin:10px 0">
            ${items.map((item, i) => `
              <label style="display:flex;align-items:center;gap:10px;padding:10px;
                            background:var(--surface-2);border-radius:8px">
                <input type="checkbox" name="ret_${i}" value="${i}" checked>
                <span style="flex:1">${item.name} × ${item.qty}</span>
                <strong>${money(item.sold_price * item.qty, tenant.currency)}</strong>
              </label>`).join("")}
          </div>
          <label class="field"><span>Refund Method</span>
            <select name="refundMethod">
              <option>Cash</option><option>Raast</option>
              <option>JazzCash</option><option>EasyPaisa</option>
              <option>Bank Transfer</option>
            </select>
          </label>
          <label class="field"><span>Notes</span>
            <textarea name="notes"></textarea>
          </label>
          <input type="hidden" name="saleId" value="${sale.id}">
          <div class="modal-actions">
            <button class="secondary-button" data-close>Cancel</button>
            <button class="primary-button">Process Return</button>
          </div>
        </form>`;
    })(),

    // ── Receipt ─────────────────────────────────────────────────────
    receipt: (() => {
      if (type !== "receipt") return "";
      return `
      <div class="modal">
        <h2>Receipt</h2>
        ${receiptPreview(state.modal?.sale)}
        <div class="modal-actions">
          <button class="secondary-button" data-close>Close</button>
          <button class="primary-button" data-action="print-receipt">Print / Save PDF</button>
        </div>
      </div>`;
    })(),

    // ── Shift stats ─────────────────────────────────────────────────
    shiftStats: (() => {
      if (type !== "shiftStats") return "";
      return `
      <div class="modal" style="max-width:480px">
        <h2>Shift Stats</h2>
        <div class="shift-print-wrap">${buildShiftStats()}</div>
        <div class="modal-actions">
          <button class="secondary-button" data-close>Close</button>
          <button class="primary-button" data-action="print-shift">Print / Save PDF</button>
        </div>
      </div>`;
    })(),

        // ── Employee add/edit ───────────────────────────────────────────
    employee: (() => {
      if (state.modal?.type === "ticket-editor") {
    const tk = state.data.tickets.find(t => String(t.id) === String(state.modal.id));
    if (!tk) return "";
    const comps = tk.components_noted || [];
    const partsTotal  = comps.reduce((s, c) => s + Number(c.price || 0), 0);
    const labourVal   = state.teLabour ?? Number(tk.estimated_quote - partsTotal) ?? 0;
    const grandTotal  = partsTotal + (isNaN(labourVal) ? 0 : labourVal);
    return `<div class="modal-backdrop" data-close>
      <div class="modal" style="max-width:500px;max-height:85vh;overflow-y:auto"
           onclick="event.stopPropagation()">
        <h2 style="margin-bottom:4px">${tk.customer_name}</h2>
        <p class="muted" style="font-size:13px;margin-bottom:16px">
          ${tk.ticket_number} · ${tk.device_brand} ${tk.device_model}
        </p>
        <div style="display:grid;gap:8px;margin-bottom:14px">
          <strong style="font-size:13px">Components</strong>
          ${comps.map((c, i) => `
            <div style="display:grid;grid-template-columns:1fr auto auto;gap:8px;align-items:center">
              <span style="font-size:13px">${c.name}
                <small class="muted">(${c.condition})</small></span>
              <input type="number" min="0"
                id="te-price-${i}"
                value="${c.price || 0}"
                style="width:100px;border:1px solid var(--border);border-radius:6px;
                       padding:5px 8px;background:var(--surface);color:var(--text);font-size:13px"
                data-te-price="${i}">
              <button type="button" data-te-remove="${i}"
                style="color:var(--danger);background:none;border:none;
                       font-size:18px;cursor:pointer;padding:0 4px">×</button>
            </div>`).join("")}
          ${comps.length === 0 ? `<p class="muted" style="font-size:13px">No components yet.</p>` : ""}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <input id="te-new-comp" class="search" placeholder="Component name" style="flex:1">
          <select id="te-new-cond"
            style="border:1px solid var(--border);border-radius:6px;padding:7px 9px;
                   background:var(--surface);color:var(--text);font-size:13px">
            ${["Repaired","Replaced","New","Cleaned","Checked"].map(c =>
              `<option>${c}</option>`).join("")}
          </select>
          <button type="button" class="secondary-button" data-action="te-add-comp">+ Add</button>
        </div>
        <label style="display:flex;justify-content:space-between;align-items:center;
                      padding:10px;background:var(--surface-2);border-radius:8px;
                      margin-bottom:8px;gap:12px">
          <span style="font-size:13px;font-weight:500">Labour Charge</span>
          <input type="number" min="0" id="te-labour" value="${labourVal < 0 ? 0 : labourVal}"
            style="width:110px;border:1px solid var(--border);border-radius:6px;
                   padding:5px 8px;background:var(--surface);color:var(--text);font-size:13px"
            data-te-labour>
        </label>
        <div style="display:flex;justify-content:space-between;font-weight:600;
                    padding:10px;background:var(--surface-2);border-radius:8px;margin-bottom:16px">
          <span>Updated Quote</span>
          <span id="te-total">${money(grandTotal, CFG.currency)}</span>
        </div>
        <div class="modal-actions">
          <button class="secondary-button" data-close>Cancel</button>
          <button class="primary-button" data-action="te-save">Save to Ticket</button>
        </div>
      </div>
    </div>`;
  }

      if (state.modal?.type === "edit-employee") {
        const e = state.modal;
        return `<form class="modal" data-form="edit-employee" style="max-width:420px" data-emp-id="${e.id}">
          <h2>Edit Employee</h2>
          <div class="form-grid">
            <label class="field"><span>Name</span>
              <input name="name" value="${e.name}" required></label>
            <label class="field"><span>New PIN (leave blank to keep)</span>
              <input name="pin_code" type="password" autocomplete="off" maxlength="6" placeholder="••••"></label>
            <label class="field"><span>Role</span>
              <select name="role">
                ${["Business Owner","Manager","Cashier","Technician"].map(r =>
                  `<option ${r===e.role?"selected":""}>${r}</option>`).join("")}
              </select></label>
            <label class="field"><span>Status</span>
              <select name="status">
                <option ${e.status==="Active"?"selected":""}>Active</option>
                <option ${e.status==="Inactive"?"selected":""}>Inactive</option>
              </select></label>
          </div>
          <div class="modal-actions">
            <button type="button" class="secondary-button" data-close>Cancel</button>
            <button class="primary-button">Save Changes</button>
          </div>
        </form>`;
      }
      return `
        <form class="modal" data-form="employee" style="max-width:440px">
          <h2>Add Employee</h2>
          <p class="muted" style="font-size:13px">Admin PIN will be required to save.</p>
          <div class="form-grid">
            ${fld("Full Name","name")}
            ${fld("4-digit PIN","pin_code","","number")}
            <label class="field"><span>Role</span>
              <select name="role">
                <option>Cashier</option>
                <option>Technician</option>
                <option>Admin</option>
              </select>
            </label>
          </div>
          ${modalActions()}
        </form>`;
    })(),

    // ── PIN prompt ──────────────────────────────────────────────────
    pinPrompt: pinPromptHTML(state.modal?.purpose),

"inv-add": `
      <form class="modal" data-form="inv-add" style="max-width:500px">
        <h2>Add Inventory Item</h2>
        <div class="form-grid">
          ${fld("Name","name")}
          ${fld("SKU","sku")}
          ${fld("Category","category","General")}
          ${fld("Selling Price","price","0","number")}
          ${fld("Cost Price","cost","0","number")}
          ${fld("Quantity","qty","0","number")}
          ${fld("Min Stock Alert","min_qty","0","number")}
        </div>
        ${modalActions()}
      </form>`,

    "inv-edit": (() => {
      const item = (state.data.inventory || [])
        .find(p => String(p.id) === String(id));
      if (!item) return `<div class="modal"><p>Not found.</p>
        <div class="modal-actions">
          <button class="secondary-button" data-close>Close</button>
        </div></div>`;
      return `
        <form class="modal" data-form="inv-edit" style="max-width:500px">
          <h2>Edit Item</h2>
          <input type="hidden" name="id" value="${item.id}">
          <div class="form-grid">
            ${fld("Name","name",item.name)}
            ${fld("SKU","sku",item.sku)}
            ${fld("Category","category",item.category)}
            ${fld("Selling Price","price",item.price,"number")}
            ${fld("Cost Price","cost",item.cost,"number")}
            ${fld("Quantity","qty",item.qty,"number")}
            ${fld("Min Stock Alert","min_qty",item.min_qty,"number")}
          </div>
          ${modalActions()}
        </form>`;
    })(),
  };

  return `<div class="modal-backdrop">${forms[type] || ""}</div>`;
}

// ── Settle Udhar ───────────────────────────────────────────────────
async function settleUdhar(udharId, amount, method) {
  const rec = state.data.udhar.find(u => u.id === udharId);
  if (!rec) return;
  const history  = rec.payment_history || [];
  history.push({ date: new Date().toISOString().slice(0,10), paid: amount, method });
  const newPaid    = Number(rec.amount_paid) + Number(amount);
  const newBalance = Math.max(0, Number(rec.total_amount) - newPaid);
  const newStatus  = newBalance <= 0 ? "Settled" : "Partial";
  const { error } = await sb.from("udhar").update({
    amount_paid:     newPaid,
    balance_due:     newBalance,
    payment_history: history,
    status:          newStatus,
    settled_at:      newBalance <= 0 ? new Date().toISOString() : null,
  }).eq("id", udharId);
  if (error) { alert("Settle error: " + error.message); return; }
  await load();
  state.modal = { type: "udharList" };
  render();
}

// ── Process Return ─────────────────────────────────────────────────
async function processReturn(saleId, returnedItems, refundAmount, method, notes) {
  const { error } = await sb.from("returns").insert({
    original_sale_id: saleId,
    returned_items:   returnedItems,
    refund_amount:    refundAmount,
    processed_by:     SESSION.employee?.id || null,
    notes,
  });
  if (error) { alert("Return error: " + error.message); return; }
  printThermal(buildReturnSlip({
    saleId, items: returnedItems, refund: refundAmount, method,
  }));
  state.modal = null;
  await load();
}



function receiptPreview(sale) {
  if (!sale) return "";
  const t     = currentTenant();
  const items = sale.items || [];
  return `
    <div class="receipt-preview">
      <center>
        ${t.logo ? `<img src="${t.logo}" style="max-width:120px;max-height:44px;object-fit:contain;margin-bottom:6px"><br>` : ""}
        <strong>${t.name}</strong><br>${t.address || ""}<br>${t.phone || ""}
      </center>
      <hr>
      Receipt: ${sale.receiptNo || "—"}<br>
      Date: ${sale.date ? new Date(sale.date).toLocaleString() : new Date().toLocaleString()}<br>
      Cashier: ${sale.cashier || "Counter"}<br>
      Customer: ${sale.customer || "Walk-in"}
      <hr>
      ${items.map(i => `${i.name}<br><small>${i.qty} × ${money(i.soldPrice, t.currency)}${i.discount > 0 ? ` (disc ${money(i.discount, t.currency)})` : ""}</small>`).join("<br>")}
      <hr>
      ${sale.discount > 0 ? `Discount: ${money(sale.discount, t.currency)}<br>` : ""}
      ${sale.tax > 0 ? `Tax: ${money(sale.tax, t.currency)}<br>` : ""}
      <strong>Total: ${money(sale.total, t.currency)}</strong><br>
      Payment: ${sale.payment || "—"}
      <hr>
      <center>${t.receiptFooter || ""}</center>
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
  const p  = scoped("products").find(x => x.id === productId);
  if (!p) return;
  const ex = state.cart.find(i => i.productId === productId);
  if (ex) ex.qty += 1;
  else state.cart.push({ productId, name: p.name, qty: 1, originalPrice: p.price, soldPrice: p.price, discount: 0, reason: "" });
  render();
}
function updateQty(productId,delta) {
  const item = state.cart.find(i=>i.productId===productId);
  if (!item) return;
  item.qty += delta;
  state.cart = state.cart.filter(i=>i.qty>0);
  render();
}
/* ── Checkout ─────────────────────────────────────────────────────── */
async function checkout() {
  const hasDiscount = state.cart.some(i => i.discount > 0);

  // Discount PIN gate
  if (hasDiscount && CFG.discount_pin_required) {
    openPinPrompt("discount", (pin, emp) => {
      if (emp) SESSION.employee = emp;
      doCheckout();
    });
    return;
  }
  // Login-at-checkout gate
  doCheckout();
}

async function doCheckout() {
  const isUdhar  = state.checkoutPayment === "Udhar (Credit)";
  const tenant   = currentTenant();
  const subtotal = state.cart.reduce((s, i) => s + i.soldPrice * i.qty, 0);
  const discount = state.cart.reduce((s, i) => s + (i.originalPrice - i.soldPrice) * i.qty, 0);
  const labour   = state.cartLabour || 0;
  const tax      = subtotal * (Number(CFG.tax_rate || 0) / 100);
  const advance  = state.cartAdvance || 0;
  const total    = subtotal + labour + tax - advance;

  // Require udhar customer info before proceeding
  if (isUdhar && (!state.udharName?.trim() || !state.udharPhone?.trim())) {
    state.modal = { type: "udharInfo" };
    render();
    return;
  }

  const { data: saleData, error: saleErr } = await sb.from("sales").insert({
    ticket_id:      state.cartTicketId || null,
    customer_name:  state.udharName    || "",
    items_sold:     state.cart.map(i => ({
      name:          i.name,
      qty:           i.qty,
      original_price:i.originalPrice,
      sold_price:    i.soldPrice,
      discount:      i.discount,
      reason:        i.reason || "",
    })),
    labour_cost:    labour,
    discount:       discount,
    tax:            tax,
    total_bill:     Math.max(0, total),
    payment_method: isUdhar ? "Udhar" : state.checkoutPayment,
    employee_id:    SESSION.employee?.id   || null,
    employee_name:  SESSION.employee?.name || "",
  }).select().single();

  if (saleErr) { alert("Sale error: " + saleErr.message); return; }

  // If ticket was linked, mark it delivered
  if (state.cartTicketId) {
    await updateTicket(state.cartTicketId, {
      status:    "Delivered",
      settledAt: new Date().toISOString(),
    });
  }

  // If udhar, create credit ledger row
  if (isUdhar) {
    await sb.from("udhar").insert({
      sale_id:        saleData.id,
      customer_name:  state.udharName,
      customer_phone: state.udharPhone,
      total_amount:   Math.max(0, total),
      amount_paid:    0,
      balance_due:    Math.max(0, total),
      payment_history:[],
      status:         "Outstanding",
    });
  }

  // Build receipt object for the modal (uses same shape as before)
  const sale = {
    receiptNo:    `INV-${saleData.id}`,
    date:         saleData.created_at,
    cashier:      SESSION.employee?.name || "Counter",
    customer:     state.udharName || "Walk-in",
    items:        state.cart.map(i => ({...i})),
    subtotal,
    labour,
    tax,
    discount,
    total:        Math.max(0, total),
    payment:      isUdhar ? "Udhar" : state.checkoutPayment,
  };

  // Reset cart state
  state.cart           = [];
  state.cartTicketId   = null;
  state.cartLabour     = 0;
  state.cartAdvance    = 0;
  state.udharName      = "";
  state.udharPhone     = "";
  state.checkoutPayment = "Cash";
  state.modal          = { type: "receipt", sale };
  pingUsage(); // silent — doesn't block or alert

  await load();
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT DELEGATION
═══════════════════════════════════════════════════════════════════ */
/* ═══════════════════════════════════════════════════════════════════
   EVENT DELEGATION
═══════════════════════════════════════════════════════════════════ */
document.addEventListener("click", async event => {
  const el = event.target.closest(
    "button,[data-route],[data-add-cart],[data-category]," +
    "[data-modal],[data-close],[data-settings-tab]," +
    "[data-pin-key],[data-pp-key],[data-comp],[data-remove-comp]," +
    "[data-tc-add],[data-tc-remove],[data-tc-decline],[data-tc-confirm]," +
    "[data-settle-id],[data-action],[data-remove-quick],[data-quick-collect]," +
    "[data-inv-edit],[data-inv-delete],[data-remove-qitem],[data-add-qprice]," +
    "[data-remove-qprice],[data-qitem-name],[data-pick-price],[data-view-ticket]"
  );
  if (!el) return;

    // ── Quick collect from ticket list on POS ────────────────────────
  if (el.dataset.quickCollect) {
    const found = state.data.tickets.find(t => String(t.id) === String(el.dataset.quickCollect));
    if (!found) return;
    state.cartTicketId = found.id;
    state.cartAdvance  = Number(found.advance_payment || 0);
    state.modal        = { type: "ticketCheckout", id: String(found.id) };
    render(); return;
  }
if (el.dataset.removeQuick !== undefined) {
  const comps = [...(CFG.quick_components || [])];
  comps.splice(Number(el.dataset.removeQuick), 1);
  CFG.quick_components = comps;
  render(); return;
}

if (el.dataset.action === "add-quick-comp") {
  const input = document.getElementById("new-comp-input");
  const val   = input?.value?.trim();
  if (!val) return;
  CFG.quick_components = [...(CFG.quick_components || []), val];
  render(); return;
}

if (el.dataset.action === "save-quick-comps") {
  const { error } = await sb.from("shop_config")
    .update({ quick_components: CFG.quick_components })
    .eq("id", 1);
  if (error) { alert("Save failed: " + error.message); return; }
  alert("Components saved.");
  await load(); return;
}
  // ── Navigation ──────────────────────────────────────────────────
  if (el.dataset.route) {
    state.route = el.dataset.route; state.filter = ""; render(); return;
  }
  if (el.dataset.settingsTab) {
    state.settingsTab = el.dataset.settingsTab; render(); return;
  }

  // ── Theme ────────────────────────────────────────────────────────
  if (el.dataset.action === "theme") {
    state.theme = state.theme === "dark" ? "light" : "dark";
    localStorage.setItem("retailos-theme", state.theme);
    applyBranding(); render(); return;
  }

  // ── PWA install ──────────────────────────────────────────────────
  if (el.dataset.action === "install" && state.installPrompt) {
    state.installPrompt.prompt();
    state.installPrompt = null; render(); return;
  }

  // ── Login screen PIN pad ─────────────────────────────────────────
  if (el.dataset.action === "login-submit") {
    submitPin(); return;
  }
  if (el.dataset.action === "skip-login") {
    return; // disabled — login is now mandatory
  }
  if (el.dataset.action === "edit-employee") {
    state.modal = {
      type:   "edit-employee",
      id:     el.dataset.empId,
      name:   el.dataset.empName,
      role:   el.dataset.empRole,
      status: el.dataset.empStatus,
    };
    render(); return;
  }

  if (el.dataset.action === "open-ticket-editor") {
    const ticketId = el.dataset.ticketId;
    const tk = state.data.tickets.find(t => String(t.id) === String(ticketId));
    if (!tk) return;
    const partsTotal = (tk.components_noted || []).reduce((s,c) => s + Number(c.price||0), 0);
    state.teLabour = Math.max(0, Number(tk.estimated_quote || 0) - partsTotal);
    state.modal = { type: "ticket-editor", id: ticketId };
    render(); return;
  }
  // ── Ticket Editor: add component ─────────────────────────────────
  if (el.dataset.action === "te-add-comp") {
    const name = document.getElementById("te-new-comp")?.value?.trim();
    const cond = document.getElementById("te-new-cond")?.value || "New";
    if (!name) return;
    const tk = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (!tk) return;
    // snapshot current prices before re-render
    document.querySelectorAll("[data-te-price]").forEach((inp, i) => {
      if (tk.components_noted[i]) tk.components_noted[i].price = Number(inp.value) || 0;
    });
    state.teLabour = Number(document.getElementById("te-labour")?.value || 0);
    tk.components_noted = [...tk.components_noted, { name, condition: cond, price: 0 }];
    render(); return;
  }

  // ── Ticket Editor: remove component ──────────────────────────────
  if (el.dataset.teRemove !== undefined) {
    const tk = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (!tk) return;
    document.querySelectorAll("[data-te-price]").forEach((inp, i) => {
      if (tk.components_noted[i]) tk.components_noted[i].price = Number(inp.value) || 0;
    });
    state.teLabour = Number(document.getElementById("te-labour")?.value || 0);
    tk.components_noted.splice(Number(el.dataset.teRemove), 1);
    render(); return;
  }

  // ── Ticket Editor: save to Supabase ──────────────────────────────
  if (el.dataset.action === "te-save") {
    const tk = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (!tk) return;
    document.querySelectorAll("[data-te-price]").forEach((inp, i) => {
      if (tk.components_noted[i]) tk.components_noted[i].price = Number(inp.value) || 0;
    });
    const labour     = Number(document.getElementById("te-labour")?.value || 0);
    const partsTotal = tk.components_noted.reduce((s, c) => s + Number(c.price || 0), 0);
    const newQuote   = partsTotal + labour;
    const { error }  = await sb.from("tickets").update({
      components_noted: tk.components_noted,
      estimated_quote:  newQuote,
    }).eq("id", tk.id);
    if (error) { alert("Save failed: " + error.message); return; }
    tk.estimated_quote = newQuote;
    state.teLabour = null;
    state.modal    = null;
    await load(); return;
  }
  if (el.dataset.action === "toggle-receipt") {
    const id = Number(el.dataset.receiptId);
    state.receiptsExpanded = state.receiptsExpanded === id ? null : id;
    render(); return;
  }

  if (el.dataset.action === "logout") {
    if (!confirm("Log out of RetailOS?")) return;
    _clearSession();
    SESSION = { employee: null, isAdmin: false, loginSkipped: false };
    state.role = "Business Owner";
    state.route = "pos";
    render(); return;
  }

  // ── PIN prompt pad ───────────────────────────────────────────────
  if (el.dataset.ppKey !== undefined) {
    handlePpKey(el.dataset.ppKey); return;
  }

  // ── Modal open / close ───────────────────────────────────────────
  if (el.dataset.modal) {
    state.modal = { type: el.dataset.modal, id: el.dataset.id };
    render(); return;
  }
  if (el.dataset.close !== undefined) {
    state.modal = null; render(); return;
  }

  // ── Cart ─────────────────────────────────────────────────────────
  if (el.dataset.category) {
    state.category = el.dataset.category; render(); return;
  }
  if (el.dataset.addCart) {
    addToCart(el.dataset.addCart); return;
  }
  if (el.dataset.qty) {
    updateQty(el.dataset.qty, Number(el.dataset.delta)); return;
  }

  // ── Checkout ─────────────────────────────────────────────────────
  if (el.dataset.action === "checkout") {
    await checkout(); return;
  }

  // ── Add ticket to cart by ID lookup ─────────────────────────────
  if (el.dataset.action === "add-ticket-to-cart") {
    const raw = prompt("Enter Ticket Number (e.g. FP-2026-1234):");
    if (!raw) return;
    const found = state.data.tickets.find(
      t => t.ticket_number.toUpperCase() === raw.trim().toUpperCase()
    );
    if (!found) { alert("Ticket not found."); return; }
    if (["Delivered","Declined"].includes(found.status)) {
      alert(`Ticket is already marked as ${found.status}.`); return;
    }
    state.cartTicketId  = found.id;
    state.cartAdvance   = Number(found.advance_payment || 0);
    state.modal         = { type: "ticketCheckout", id: String(found.id) };
    render(); return;
  }

  // ── Shift stats ──────────────────────────────────────────────────
  if (el.dataset.action === "shift-stats") {
    state.modal = { type: "shiftStats" }; render(); return;
  }
  if (el.dataset.action === "print-shift") {
    printThermal(buildShiftStats()); return;
  }
  if (el.dataset.action === "print-receipt") {
    if (state.modal?.sale) printThermal(buildReceiptSlip(state.modal.sale));
    return;
  }

  // ── New sale shortcut from dashboard ────────────────────────────
  if (el.dataset.action === "new-sale") {
    state.route = "pos"; render(); return;
  }

  // ── View ticket detail ───────────────────────────────────────────
  const viewTicketEl = el.closest("[data-view-ticket]");
  if (viewTicketEl) {
    state.modal = { type: "ticketDetail", id: String(viewTicketEl.dataset.viewTicket) };
    render(); return;
  }

  // ── Save ticket detail update ─────────────────────────────────────
  if (el.dataset.action === "save-ticket-detail") {
    const ticketId   = el.dataset.id;
    const newStatus  = document.getElementById("td-status")?.value;
    const actualQuote = Number(document.getElementById("td-actual-quote")?.value || 0);
    const note       = document.getElementById("td-note")?.value || "";
    const updates    = { status: newStatus, update_note: note };
    if (actualQuote > 0) updates.actual_quote = actualQuote;
    const { error } = await sb.from("tickets")
      .update(updates).eq("id", ticketId);
    if (error) { alert("Update failed: " + error.message); return; }
    state.modal = null;
    await load(); return;
  }

  // ── Repair component tap buttons ─────────────────────────────────
  if (el.dataset.comp !== undefined) {
    const name = el.dataset.comp;
    const sel  = state.modal.selectedComponents || [];
    const idx  = sel.findIndex(s => s.name === name);
    if (idx >= 0) sel.splice(idx, 1);
    else sel.push({ name, tag: "Repaired", price: 0 });
    state.modal.selectedComponents = sel;
    // Save typed field values so render() doesn't wipe them
    const form = document.querySelector("[data-form='repair']");
    if (form) {
      const fd = new FormData(form);
      state.modal._draft = Object.fromEntries(fd.entries());
    }
    render(); return;
  }
  if (el.dataset.removeComp !== undefined) {
    const sel = state.modal.selectedComponents || [];
    sel.splice(Number(el.dataset.removeComp), 1);
    state.modal.selectedComponents = sel;
    const form = document.querySelector("[data-form='repair']");
    if (form) {
      const fd = new FormData(form);
      state.modal._draft = Object.fromEntries(fd.entries());
    }
    render(); return;
  }

  // ── Ticket checkout: add component inline ────────────────────────
  if (el.dataset.tcAdd !== undefined) {
    const name = prompt("Component name:");
    if (!name) return;
    const ticket = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (ticket) {
      // Read current prices from DOM inputs and write them back FIRST
      document.querySelectorAll("[data-tc-price]").forEach((inp, i) => {
        if (ticket.components_noted[i]) ticket.components_noted[i].price = Number(inp.value) || 0;
      });
      // Also save labour so it survives re-render
      const labourEl = document.getElementById("tc-labour");
      if (labourEl) state.cartLabour = Number(labourEl.value) || 0;
      ticket.components_noted = [...ticket.components_noted, { name, condition: "New", price: 0 }];
    }
    render(); return;
  }
  if (el.dataset.tcRemove !== undefined) {
    const ticket = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (ticket) {
      // Save current prices before removing
      document.querySelectorAll("[data-tc-price]").forEach((inp, i) => {
        if (ticket.components_noted[i]) ticket.components_noted[i].price = Number(inp.value) || 0;
      });
      const labourEl = document.getElementById("tc-labour");
      if (labourEl) state.cartLabour = Number(labourEl.value) || 0;
      ticket.components_noted.splice(Number(el.dataset.tcRemove), 1);
    }
    render(); return;
  }

  // ── Ticket checkout: declined ────────────────────────────────────
  if (el.dataset.tcDecline !== undefined) {
    const reason = prompt("Reason customer declined repair:");
    if (reason === null) return;
    await updateTicket(state.modal.id, { status: "Declined", declineReason: reason });
    state.modal = null;
    await load(); return;
  }

  // ── Ticket checkout: confirm → add to cart ───────────────────────
  if (el.dataset.tcConfirm !== undefined) {
    const ticket  = state.data.tickets.find(t => String(t.id) === String(state.modal?.id));
    if (!ticket) return;
    const comps   = ticket.components_noted || [];
    const priceEls = document.querySelectorAll("[data-tc-price]");
    priceEls.forEach((inp, i) => {
      if (comps[i]) comps[i].price = Number(inp.value) || 0;
    });
    const labour  = Number(document.getElementById("tc-labour")?.value || 0);
    const advance = Number(ticket.advance_payment || 0);
    const parts   = comps.reduce((s, c) => s + Number(c.price || 0), 0);
    const total   = Math.max(0, parts + labour - advance);

    // Save updated components back to Supabase
    await updateTicket(ticket.id, { components: comps });

    state.cartLabour   = labour;
    state.cartAdvance  = advance;
    state.cartTicketId = ticket.id;

    // Add as single line item in cart
    state.cart.push({
      productId:     `ticket-${ticket.id}`,
      name:          `Repair: ${ticket.device_brand} ${ticket.device_model} (${ticket.ticket_number})`,
      qty:           1,
      originalPrice: total,
      soldPrice:     total,
      discount:      0,
      reason:        "",
      isTicket:      true,
    });
    state.modal = null;
    render(); return;
  }

  // ── Settle Udhar ─────────────────────────────────────────────────
  if (el.dataset.settleId) {
    const udharId = Number(el.dataset.settleId);
    const amount  = Number(
      document.querySelector(`[data-settle-amount="${udharId}"]`)?.value
    );
    const method  = document.querySelector(
      `[data-settle-method="${udharId}"]`
    )?.value || "Cash";
    if (!amount || amount <= 0) { alert("Enter a valid amount."); return; }
    openPinPrompt("settle", async () => {
      await settleUdhar(udharId, amount, method);
    });
    return;
  }

  // ── Open udhar list / return flow ────────────────────────────────
  if (el.dataset.action === "open-udhar") {
    state.modal = { type: "udharList" }; render(); return;
  }
  if (el.dataset.action === "open-return") {
    state.modal = { type: "returnFlow" }; render(); return;
  }

  // ── Quick items ──────────────────────────────────────────────────
  if (el.dataset.qitemName) {
    const prices = JSON.parse(el.dataset.qitemPrices || "[]");
    const name   = el.dataset.qitemName;
    if (prices.length === 1) {
      // only one price — add directly
      state.cart.push({
        productId:     `qi-${name}-${Date.now()}`,
        name,
        qty:           1,
        originalPrice: prices[0],
        soldPrice:     prices[0],
        discount:      0,
        reason:        "",
      });
      render();
    } else {
      // show price picker
      state.modal = { type: "qitem-pick", name, prices };
      render();
    }
    return;
  }

  if (el.dataset.action === "add-qitem") {
    const input = document.getElementById("qitem-name");
    const val   = input?.value?.trim();
    if (!val) return;
    CFG.quick_items = [...(CFG.quick_items||[]), { name: val, prices: [] }];
    render(); return;
  }
  if (el.dataset.action === "save-qitems") {
    const { error } = await sb.from("shop_config")
      .update({ quick_items: CFG.quick_items }).eq("id", 1);
    if (error) { alert("Save failed: " + error.message); return; }
    alert("Quick items saved.");
    await load(); return;
  }
  if (el.dataset.removeQitem !== undefined) {
    const items = [...(CFG.quick_items||[])];
    items.splice(Number(el.dataset.removeQitem), 1);
    CFG.quick_items = items;
    render(); return;
  }
  if (el.dataset.addQprice !== undefined) {
    const idx   = Number(el.dataset.addQprice);
    const input = document.getElementById(`qprice-input-${idx}`);
    const val   = Number(input?.value);
    if (!val || val <= 0) return;
    CFG.quick_items[idx].prices.push(val);
    render(); return;
  }
  if (el.dataset.removeQprice !== undefined) {
    const [i, pi] = el.dataset.removeQprice.split("-").map(Number);
    CFG.quick_items[i].prices.splice(pi, 1);
    render(); return;
  }

  // ── Quick item price picker (when multiple prices) ───────────────
  if (el.dataset.pickPrice !== undefined) {
    const { name, prices } = state.modal;
    const price = prices[Number(el.dataset.pickPrice)];
    state.cart.push({
      productId:     `qi-${name}-${Date.now()}`,
      name,
      qty:           1,
      originalPrice: price,
      soldPrice:     price,
      discount:      0,
      reason:        "",
    });
    state.modal = null;
    render(); return;
  }

  // ── Inventory ────────────────────────────────────────────────────
  if (el.dataset.invEdit) {
    state.modal = { type: "inv-edit", id: el.dataset.invEdit };
    render(); return;
  }
  if (el.dataset.invDelete) {
    if (!confirm("Delete this item?")) return;
    const { error } = await sb.from("inventory")
      .delete().eq("id", Number(el.dataset.invDelete));
    if (error) { alert("Error: " + error.message); return; }
    await load(); return;
  }
});

/* ── Input ───────────────────────────────────────────────────────── */
document.addEventListener("input", event => {
  if (event.target.dataset.filter) {
    state.filter = event.target.value; render();
  }
// Ticket editor live total
  if (event.target.dataset.tePrice !== undefined || event.target.dataset.teLabour !== undefined) {
    const prices = [...document.querySelectorAll("[data-te-price]")]
      .reduce((s, inp) => s + (Number(inp.value) || 0), 0);
    const labour = Number(document.getElementById("te-labour")?.value || 0);
    const totalEl = document.getElementById("te-total");
    if (totalEl) totalEl.textContent = money(prices + labour, CFG.currency);
  }
});

/* ── Change ──────────────────────────────────────────────────────── */
document.addEventListener("change", async event => {
  const t = event.target;

  if (t.dataset.action === "role") {
    state.role = t.value;
    state.adminModule = can(state.adminModule) ? state.adminModule : "dashboard";
    render(); return;
  }
  if (t.dataset.action === "admin-module") {
    state.adminModule = t.value; state.filter = ""; render(); return;
  }
  if (t.dataset.action === "payment") {
    state.checkoutPayment = t.value; render(); return;
  }
  if (t.dataset.udhar === "name")  { state.udharName  = t.value; return; }
  if (t.dataset.udhar === "phone") { state.udharPhone = t.value; return; }

  // Component tag change inside repair modal
  if (t.dataset.compTag !== undefined) {
    const sel = state.modal?.selectedComponents || [];
    const idx = Number(t.dataset.compTag);
    if (sel[idx]) {
      sel[idx].tag = t.value;
      const form = document.querySelector("[data-form='repair']");
      if (form) {
        const fd = new FormData(form);
        state.modal._draft = Object.fromEntries(fd.entries());
      }
      render();
    }
    return;
  }
});

/* ── Submit ──────────────────────────────────────────────────────── */
document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.form;

  // ── Repair ticket creation ──────────────────────────────────────
  if (type === "repair") {
    const sel = state.modal?.selectedComponents || [];
    const res = await createTicket({
      customerName:   data.customerName,
      customerPhone:  data.customerPhone,
      deviceBrand:    data.deviceBrand,
      deviceModel:    data.deviceModel,
      imei:           data.imei,
      components:     sel.map(s => ({ name: s.name, condition: s.tag, price: 0 })),
      estimatedQuote: Number(data.estimatedQuote || 0),
      advance:        Number(data.advance        || 0),
      advanceMethod:  data.advanceMethod || "",
      technicianNote: data.technicianNote || "",
    });
    if (!res.ok) { alert("Error saving ticket: " + res.error); return; }
    state.modal = null;
    printThermal(buildTicketSlip(res.data));
    await load(); return;
  }

  // ── Udhar customer info (called from checkout flow) ──────────────
  if (type === "udharInfo") {
    state.udharName  = data.udharName;
    state.udharPhone = data.udharPhone;
    state.modal      = null;
    await doCheckout(); return;
  }

  // ── Return: receipt lookup ────────────────────────────────────────
  if (type === "return-lookup") {
    const raw    = data.receiptNo.trim().toUpperCase().replace("INV-", "");
    const sale   = state.data.sales.find(s => String(s.id) === raw);
    if (!sale) {
      state.modal = { type: "returnFlow", notFound: true, receiptNo: data.receiptNo };
      render(); return;
    }
    state.modal = { type: "returnFlow", receiptNo: `INV-${sale.id}` };
    render(); return;
  }

  // ── Return: confirm + admin PIN ───────────────────────────────────
  if (type === "return-confirm") {
    const saleId   = Number(data.saleId);
    const sale     = state.data.sales.find(s => s.id === saleId);
    const items    = sale?.items_sold || [];
    const returned = items.filter((_, i) => data[`ret_${i}`] !== undefined);
    const refund   = returned.reduce((s, it) => s + it.sold_price * it.qty, 0);
    openPinPrompt("return", async () => {
      await processReturn(saleId, returned, refund, data.refundMethod, data.notes || "");
    });
    return;
  }

  // ── Employee save (requires admin PIN) ───────────────────────────
  if (type === "edit-employee") {
    const empId = form.dataset.empId;
    const updates = { name: data.name, role: data.role, status: data.status };
    if (data.pin_code?.trim()) updates.pin_code = String(data.pin_code.trim());
    const { error } = await sb.from("employees").update(updates).eq("id", empId);
    if (error) { alert("Error updating employee: " + error.message); return; }
    state.modal = null;
    await load(); return;
  }

  if (type === "change-admin-password") {
    if (data.current !== CFG.admin_password) {
      alert("Current password is incorrect."); return;
    }
    if (!data.newpass?.trim()) { alert("New password cannot be empty."); return; }
    const { error } = await sb.from("shop_config").update({ admin_password: data.newpass }).eq("id", 1);
    if (error) { alert("Error updating password: " + error.message); return; }
    CFG.admin_password = data.newpass;
    alert("Admin password updated successfully.");
    return;
  }

  if (type === "employee") {
    openPinPrompt("admin", async () => {
      const { error } = await sb.from("employees").insert({
        name:     data.name,
        pin_code: String(data.pin_code),
        role:     data.role || "Cashier",
        status:   "Active",
      });
      if (error) { alert("Error saving employee: " + error.message); return; }
      state.modal = null;
      await load();
    });
    return;
  }

  // ── Business settings ─────────────────────────────────────────────
  if (type === "settings") {
    const updates = {};
    // Logo upload — convert to base64 and store in shop_config
const logoFile = form.querySelector('[name="logo"]')?.files?.[0];
if (logoFile) {
  const base64 = await new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(logoFile);
  });
  updates.shop_logo = base64;
}
    if (data.name)          updates.shop_name    = data.name;
    if (data.address)       updates.shop_address = data.address;
    if (data.phone)         updates.shop_phone   = data.phone;
    if (data.primaryColor)  updates.primary_color   = data.primaryColor;
    if (data.secondaryColor)updates.secondary_color = data.secondaryColor;
    if (data.currency)      updates.currency     = data.currency;
    if (data.taxRate)       updates.tax_rate     = Number(data.taxRate);
    if (data.receiptFooter) updates.terms_text   = data.receiptFooter;
    const { error } = await sb.from("shop_config").update(updates).eq("id", 1);
    if (error) { alert("Settings error: " + error.message); return; }
    state.modal = null;
    await load(); return;
  }

  // ── Price override ────────────────────────────────────────────────
  if (type === "override") {
    const item = state.cart.find(i => i.productId === state.modal?.id);
    if (item) {
      item.soldPrice = Number(data.soldPrice);
      item.discount  = Math.max(0, item.originalPrice - item.soldPrice);
      item.reason    = data.reason;
    }
    state.modal = null; render(); return;
  }
if (type === "inv-add") {
    const { error } = await sb.from("inventory").insert({
      name:     data.name,
      sku:      data.sku      || "",
      category: data.category || "General",
      price:    Number(data.price  || 0),
      cost:     Number(data.cost   || 0),
      qty:      Number(data.qty    || 0),
      min_qty:  Number(data.min_qty|| 0),
    });
    if (error) { alert("Error: " + error.message); return; }
    state.modal = null;
    await load(); return;
  }

  if (type === "inv-edit") {
    const { error } = await sb.from("inventory").update({
      name:     data.name,
      sku:      data.sku,
      category: data.category,
      price:    Number(data.price),
      cost:     Number(data.cost),
      qty:      Number(data.qty),
      min_qty:  Number(data.min_qty),
    }).eq("id", Number(data.id));
    if (error) { alert("Error: " + error.message); return; }
    state.modal = null;
    await load(); return;
  }
  state.modal = null;
  await load();
});

/* ── Boot ─────────────────────────────────────────────────────────── */
window.addEventListener("online",  () => { state.online = true;  render(); });
window.addEventListener("offline", () => { state.online = false; render(); });
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); state.installPrompt = e; render();
});
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");

await load(); // single boot call — no seed, no IndexedDB

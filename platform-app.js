/* ═══════════════════════════════════════════════════════════════════
   RetailOS  —  Platform Admin  (platform.html)
   Separate entry point. Never loaded by the shop app.
   Future deployment: separate server / separate CNAME (e.g. admin.retailos.com)
   Accesses the same shared IndexedDB so it can read/write all tenant data.
═══════════════════════════════════════════════════════════════════ */

const DB_NAME    = "retailos-demo";
const DB_VERSION = 1;
const STORES     = ["tenants","products","customers","employees","sales","repairs","movements","settings","syncQueue","conflicts"];

const money = (v,sym="$") => `${sym}${Number(v||0).toLocaleString(undefined,{maximumFractionDigits:2})}`;

// Platform state — completely separate from shop state
const pState = {
  page:        "overview",   // "overview" | "tenants" | "tenant-detail" | "branding" | "modules" | "activity"
  tenantId:    null,          // selected tenant for detail/branding work
  settingsTab: "branding",
  theme:       localStorage.getItem("retailos-platform-theme")||"light",
  online:      navigator.onLine,
  syncing:     false,
  filter:      "",
  data:        {},
  modal:       null,
};

// Shop app URL for generating client access links
const SHOP_URL = (() => {
  const u = new URL(location.href);
  return `${u.protocol}//${u.hostname}:4174`;
})();

/* ── IndexedDB (shared with shop app) ──────────────────────────── */
function openDb() {
  return new Promise((res,rej) => {
    const req = indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded = () => { const db=req.result; STORES.forEach(s=>{ if(!db.objectStoreNames.contains(s)) db.createObjectStore(s,{keyPath:"id"}); }); };
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}
const repo = {
  async all(store)              { const db=await openDb(); return new Promise((res,rej)=>{ const r=db.transaction(store,"readonly").objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); },
  async put(store,item,q=false) { const db=await openDb(); const s={...item,updatedAt:new Date().toISOString()}; await new Promise((res,rej)=>{ const tx=db.transaction(store,"readwrite"); tx.objectStore(store).put(s); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); if(q) await repo.queue({entity:store,action:"upsert",recordId:s.id,payload:s}); return s; },
  async queue(c) { return repo.put("syncQueue",{id:uid("sync"),status:"Pending Sync",createdAt:new Date().toISOString(),...c},false); },
};
function uid(p) { return `${p}-${Math.random().toString(36).slice(2,9)}-${Date.now().toString(36)}`; }

async function load() {
  const [tenants,products,customers,employees,sales,repairs,queue,conflicts] = await Promise.all([repo.all("tenants"),repo.all("products"),repo.all("customers"),repo.all("employees"),repo.all("sales"),repo.all("repairs"),repo.all("syncQueue"),repo.all("conflicts")]);
  pState.data = { tenants,products,customers,employees,sales,repairs,queue,conflicts };
  document.documentElement.dataset.theme = pState.theme;
  render();
}

function currentTenantData() {
  return pState.data.tenants?.find(t=>t.id===pState.tenantId)||null;
}

async function fileToDataUrl(file) {
  if (!file) return "";
  return new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); });
}

/* ═══════════════════════════════════════════════════════════════════
   RENDER
═══════════════════════════════════════════════════════════════════ */
const NAV = [
  { page:"overview",      icon:"▦", label:"Overview"         },
  { page:"tenants",       icon:"◉", label:"All Businesses"   },
  { page:"modules",       icon:"◈", label:"Module Control"   },
  { page:"branding",      icon:"◐", label:"Client Branding"  },
  { page:"activity",      icon:"▧", label:"Activity & Sync"  },
];

function render() {
  const app    = document.getElementById("platform-app");
  const active = document.activeElement;
  const fi     = active?.dataset?.filter ? { f:active.dataset.filter, s:active.selectionStart, e:active.selectionEnd } : null;

  app.innerHTML = `
    <div class="platform-shell">
      <aside class="platform-sidebar" id="p-sidebar">
        <div class="brand" style="padding:4px 0 12px">
          <div class="platform-logo">RA</div>
          <div>
            <strong style="color:#f3f7fa;font-size:15px">RetailOS</strong>
            <span style="color:#5c9986;font-size:12px;display:block">Platform Console</span>
          </div>
        </div>
        <div class="platform-nav">
          ${NAV.map(n=>`<button class="platform-nav-btn${pState.page===n.page?" active":""}" data-p-page="${n.page}"><span>${n.icon}</span><span>${n.label}</span></button>`).join("")}
        </div>
        <div style="margin-top:auto;padding-top:14px;border-top:1px solid #1e3830">
          <div style="color:#4a7a6e;font-size:12px;padding:6px 12px">Platform owner access only.<br>Not visible to clients.</div>
        </div>
      </aside>
      <div class="platform-main">
        <header class="platform-topbar">
          <div style="display:flex;align-items:center;gap:10px">
            <button class="icon-button" id="p-menu-btn" style="display:none">☰</button>
            <h2 style="font-size:16px;color:var(--muted)">${NAV.find(n=>n.page===pState.page)?.label||"Platform Console"}</h2>
          </div>
          <div class="top-actions">
            <span class="chip"><i class="dot ${pState.online?"":"offline"}"></i>${pState.online?"Online":"Offline"}</span>
            <span class="chip">Tenants: ${pState.data.tenants?.length||0}</span>
            <button class="icon-button" data-p-action="theme">${pState.theme==="dark"?"Light":"Dark"}</button>
          </div>
        </header>
        <section class="content">${platformPage()}</section>
      </div>
    </div>
    ${platformModal()}
  `;

  if (fi) { const n=document.querySelector(`[data-filter="${fi.f}"]`); n?.focus(); n?.setSelectionRange?.(fi.s,fi.e); }
}

function platformPage() {
  switch (pState.page) {
    case "overview":      return pageOverview();
    case "tenants":       return pageTenants();
    case "tenant-detail": return pageTenantDetail();
    case "modules":       return pageModules();
    case "branding":      return pageBranding();
    case "activity":      return pageActivity();
    default:              return pageOverview();
  }
}

/* ── UI helpers ─────────────────────────────────────────────────── */
const tit = (h,sub,action) => `<div class="page-title"><div><h1>${h}</h1><p class="muted">${sub}</p></div><div>${action}</div></div>`;
const tbl = (cap,heads,rows) => `<h2>${cap}</h2><div class="table-wrap"><table><thead><tr>${heads.map(h=>`<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const fld = (label,name,val="",type="text") => `<label class="field"><span>${label}</span><input name="${name}" type="${type}" value="${String(val).replaceAll('"','&quot;')}"></label>`;
const statusBadge = s => { const bad=["Suspended","Cancelled"],good=["Active","Delivered"]; return `<span class="badge ${bad.includes(s)?"bad":good.includes(s)?"good":"warn"}">${s}</span>`; };

/* ═══════════════════════════════════════════════════════════════════
   PLATFORM PAGES
═══════════════════════════════════════════════════════════════════ */
function pageOverview() {
  const tenants  = pState.data.tenants||[];
  const active   = tenants.filter(t=>t.status==="Active").length;
  const susp     = tenants.filter(t=>t.status==="Suspended").length;
  const withRep  = tenants.filter(t=>t.repairModuleEnabled).length;
  const sales    = pState.data.sales||[];
  const mrr      = tenants.reduce((s,t)=>s+(t.plan==="Premium"?149:t.plan==="Standard"?79:29),0);
  const kpis     = [["Active Businesses",active,"good"],["Suspended",susp,susp?"bad":""],["Platform MRR",`$${mrr}`,"good"],["Repair Module On",withRep,""],["Pending Sync",pState.data.queue?.length||0,""],["Total Sales Records",sales.length,""]];
  return `
    ${tit("Platform Overview","Live visibility across all tenants, billing, and system health.",`<button class="primary-button" data-p-modal="create-tenant">+ Create Business</button>`)}
    <div class="grid kpi-grid">${kpis.map(([l,v,mod])=>`<div class="card kpi"><span class="label">${l}</span><span class="value">${v}</span>${mod?`<span class="trend ${mod==="bad"?"" :""}">${mod==="good"?"✓ Healthy":mod==="bad"?"⚠ Attention":""}</span>`:""}</div>`).join("")}</div>
    <div class="grid two-col">
      <div class="card">
        ${tbl("Tenant Summary",["Business","Plan","Status","Repairs","Actions"],tenants.map(t=>[
          `<strong>${t.name}</strong><br><small class="muted">${t.industry}</small>`,
          t.plan,
          statusBadge(t.status),
          `<span class="badge ${t.repairModuleEnabled?"good":"warn"}">${t.repairModuleEnabled?"On":"Off"}</span>`,
          `<button class="secondary-button" data-p-tenant="${t.id}" data-p-action="open-detail">Manage</button>`,
        ]))}
      </div>
      <div class="card">
        <h2>Quick Access — Client Systems</h2>
        <p class="muted" style="font-size:13px;margin-bottom:12px">Open a client's POS or Admin panel directly from here. Data is shared in real-time via IndexedDB (production: Firestore).</p>
        <div class="list">${tenants.map(t=>`
          <div class="list-row">
            <div><strong>${t.name}</strong><br><small class="muted">${t.status}</small></div>
            <div style="display:flex;gap:6px">
              <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=pos" target="_blank" style="font-size:12px">POS</a>
              <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=admin" target="_blank" style="font-size:12px">Admin</a>
            </div>
          </div>`).join("")}
        </div>
      </div>
    </div>`;
}

function pageTenants() {
  const tenants = (pState.data.tenants||[]).filter(t=>t.name.toLowerCase().includes(pState.filter.toLowerCase()));
  return `
    ${tit("All Businesses","Create, suspend, activate, and manage every client tenant on the platform.",`<button class="primary-button" data-p-modal="create-tenant">+ Create Business</button>`)}
    <div class="toolbar"><div class="toolbar-left"><input class="search" data-filter="tenant" value="${pState.filter}" placeholder="Search businesses…"></div></div>
    <div class="grid tenant-grid">
      ${tenants.map(t=>`
        <div class="tenant-card">
          <div class="tenant-card-head">
            <div>
              <strong>${t.name}</strong>
              <p class="muted" style="font-size:13px;margin-top:3px">${t.industry} · ${t.plan}</p>
            </div>
            ${statusBadge(t.status)}
          </div>
          <div style="font-size:13px;color:var(--muted)">${t.address||"No address"}</div>
          <div style="font-size:13px;color:var(--muted)">${t.email}</div>
          <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span class="badge ${t.repairModuleEnabled?"good":"warn"}">Repairs ${t.repairModuleEnabled?"On":"Off"}</span>
          </div>
          <div class="tenant-card-actions">
            <button class="secondary-button" data-p-tenant="${t.id}" data-p-action="open-detail">Manage</button>
            <button class="${t.repairModuleEnabled?"danger-button":"primary-button"}" data-p-tenant="${t.id}" data-p-action="toggle-repairs">${t.repairModuleEnabled?"Disable Repairs":"Enable Repairs"}</button>
            <button class="${t.status==="Active"?"danger-button":"primary-button"}" data-p-tenant="${t.id}" data-p-action="${t.status==="Active"?"suspend":"activate"}">${t.status==="Active"?"Suspend":"Activate"}</button>
          </div>
        </div>`).join("")}
    </div>`;
}

function pageTenantDetail() {
  const t = currentTenantData();
  if (!t) return `<p class="muted">No tenant selected. <button class="secondary-button" data-p-page="tenants">Back to list</button></p>`;
  const sales    = (pState.data.sales||[]).filter(s=>s.tenantId===t.id);
  const repairs  = (pState.data.repairs||[]).filter(r=>r.tenantId===t.id);
  const products = (pState.data.products||[]).filter(p=>p.tenantId===t.id);
  const revenue  = sales.reduce((s,x)=>s+x.total,0);
  const pending  = repairs.filter(r=>!["Delivered","Cancelled"].includes(r.status)).length;

  return `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:8px">
      <button class="secondary-button" data-p-page="tenants">← All Businesses</button>
      <h1 style="font-size:22px">${t.name}</h1>
      ${statusBadge(t.status)}
    </div>
    <div class="grid kpi-grid">
      ${[["Total Sales",sales.length],["Revenue",money(revenue,t.currency)],["Products",products.length],["Pending Repairs",pending],["Plan",t.plan],["Repair Module",t.repairModuleEnabled?"On":"Off"]].map(([l,v])=>`<div class="card kpi"><span class="label">${l}</span><span class="value">${v}</span></div>`).join("")}
    </div>
    <div class="grid two-col">
      <div class="card">
        <h2>Business Profile</h2>
        <div class="list">
          ${[["Industry",t.industry],["Address",t.address],["Phone",t.phone],["Email",t.email],["Tax Rate",`${t.taxRate}%`],["Currency",t.currency]].map(([l,v])=>`<div class="list-row"><span class="muted">${l}</span><span>${v||"—"}</span></div>`).join("")}
        </div>
      </div>
      <div class="card">
        <h2>Controls</h2>
        <div class="grid" style="gap:10px">
          <div class="platform-alert">⚠ Changes made here affect the live client system immediately.</div>
          <button class="${t.repairModuleEnabled?"danger-button":"primary-button"}" data-p-tenant="${t.id}" data-p-action="toggle-repairs">${t.repairModuleEnabled?"Disable Repair Module":"Enable Repair Module"}</button>
          <button class="${t.status==="Active"?"danger-button":"primary-button"}" data-p-tenant="${t.id}" data-p-action="${t.status==="Active"?"suspend":"activate"}">${t.status==="Active"?"Suspend Business":"Activate Business"}</button>
          <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=pos" target="_blank">Open Client POS ↗</a>
          <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=admin" target="_blank">Open Client Admin ↗</a>
          <button class="secondary-button" data-p-tenant="${t.id}" data-p-action="edit-branding">Edit Branding & Settings</button>
        </div>
      </div>
    </div>
    ${tbl("Recent Sales",["Receipt","Customer","Total","Payment","Date"],sales.slice(0,8).map(s=>[s.receiptNo,s.customer,money(s.total,t.currency),s.payment,new Date(s.date).toLocaleDateString()]))}
    ${t.repairModuleEnabled?tbl("Repair Queue",["Ticket","Customer","Device","Status","ETA"],repairs.slice(0,8).map(r=>[r.ticket,r.customer,`${r.brand} ${r.model}`,r.status,r.eta])):""}
  `;
}

function pageModules() {
  const tenants = pState.data.tenants||[];
  return `
    ${tit("Module Control","Turn features on or off per client. Changes take effect in the client's POS immediately.","")}
    <div class="card">
      ${tbl("Repair Module Status",["Business","Plan","Status","Repair Module","Action"],tenants.map(t=>[
        t.name, t.plan, statusBadge(t.status),
        `<span class="badge ${t.repairModuleEnabled?"good":"warn"}">${t.repairModuleEnabled?"Enabled":"Disabled"}</span>`,
        `<button class="${t.repairModuleEnabled?"danger-button":"primary-button"}" data-p-tenant="${t.id}" data-p-action="toggle-repairs">${t.repairModuleEnabled?"Turn Off":"Turn On"}</button>`,
      ]))}
    </div>
    <div class="card">
      <h2>Module Notes</h2>
      <p class="muted" style="font-size:14px;line-height:1.7">
        When the <strong>Repair Module</strong> is enabled for a client, their POS counter shows a "New Repair Ticket" button and the cashier can create tickets directly from the POS page.<br><br>
        The repair ticket data (pending tickets, processed, shift stats) all appear in the client's Admin → Repair Tickets module and in their POS Shift Stats popup.<br><br>
        Disabling the module hides the button from the counter but preserves all existing ticket data.
      </p>
    </div>`;
}

function pageBranding() {
  const tenants = pState.data.tenants||[];
  const t       = currentTenantData();
  return `
    ${tit("Client Branding","Edit any client's logo, colors, business description, and receipt footer.","")}
    <div class="grid two-col">
      <div>
        <label class="field" style="margin-bottom:14px">
          <span>Select Client to Edit</span>
          <select class="tenant-switcher" data-p-action="select-tenant">
            <option value="">— Choose a business —</option>
            ${tenants.map(ten=>`<option value="${ten.id}" ${ten.id===pState.tenantId?"selected":""}>${ten.name}</option>`).join("")}
          </select>
        </label>
        ${t?`
        <div class="settings-tabs">
          <button class="settings-tab ${pState.settingsTab==="branding"?"active":""}" data-p-settings-tab="branding">Branding</button>
          <button class="settings-tab ${pState.settingsTab==="contact"?"active":""}" data-p-settings-tab="contact">Contact</button>
          <button class="settings-tab ${pState.settingsTab==="receipt"?"active":""}" data-p-settings-tab="receipt">Receipt & Tax</button>
          <button class="settings-tab ${pState.settingsTab==="modules"?"active":""}" data-p-settings-tab="modules">Modules</button>
        </div>
        ${platformSettingsTabContent(t)}`:`<div class="empty">Select a client above to edit their branding and settings.</div>`}
      </div>
      <div class="card" style="align-self:start">
        <h2>Live Preview</h2>
        ${t?`
          <div style="display:flex;align-items:center;gap:12px;padding:14px;background:var(--surface-2);border-radius:8px;margin-bottom:12px">
            <div style="width:44px;height:44px;border-radius:8px;background:${t.primaryColor};color:white;display:grid;place-items:center;font-weight:800;overflow:hidden">${t.logo?`<img src="${t.logo}" style="width:100%;height:100%;object-fit:cover">`:`${t.name.slice(0,2).toUpperCase()}`}</div>
            <div>
              <strong>${t.name}</strong>
              <p class="muted" style="font-size:12px;margin:0">${t.businessDescription||""}</p>
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-bottom:12px">
            <div style="flex:1;height:38px;border-radius:8px;background:${t.primaryColor}"></div>
            <div style="flex:1;height:38px;border-radius:8px;background:${t.secondaryColor}"></div>
          </div>
          <p class="muted" style="font-size:13px">Receipt footer: "${t.receiptFooter}"</p>
          <div style="display:flex;gap:6px;margin-top:10px">
            <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=pos" target="_blank" style="font-size:12px">Preview POS ↗</a>
            <a class="secondary-button link-button" href="${SHOP_URL}/index.html?tenant=${t.id}&route=admin" target="_blank" style="font-size:12px">Preview Admin ↗</a>
          </div>
        `:`<div class="empty">No client selected.</div>`}
      </div>
    </div>`;
}

function platformSettingsTabContent(t) {
  if (pState.settingsTab==="branding") return `
    <form class="card form-grid" data-p-form="settings" style="margin-top:12px">
      ${fld("Business Name","name",t.name)}
      ${fld("Business Description","businessDescription",t.businessDescription||"")}
      ${fld("Primary Color","primaryColor",t.primaryColor,"color")}
      ${fld("Secondary Color","secondaryColor",t.secondaryColor,"color")}
      <label class="field"><span>Logo Upload</span><input name="logo" type="file" accept="image/*"></label>
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Branding</button></div>
    </form>`;
  if (pState.settingsTab==="contact") return `
    <form class="card form-grid" data-p-form="settings" style="margin-top:12px">
      ${fld("Business Name","name",t.name)}
      ${fld("Address","address",t.address)}
      ${fld("Phone","phone",t.phone)}
      ${fld("WhatsApp","whatsapp",t.whatsapp)}
      ${fld("Email","email",t.email)}
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Contact Info</button></div>
    </form>`;
  if (pState.settingsTab==="receipt") return `
    <form class="card form-grid" data-p-form="settings" style="margin-top:12px">
      ${fld("Currency Symbol","currency",t.currency)}
      ${fld("Tax Rate %","taxRate",t.taxRate,"number")}
      <label class="field" style="grid-column:1/-1"><span>Receipt Footer</span><textarea name="receiptFooter">${t.receiptFooter}</textarea></label>
      <div class="modal-actions" style="grid-column:1/-1"><button class="primary-button">Save Receipt Settings</button></div>
    </form>`;
  if (pState.settingsTab==="modules") return `
    <form class="card" data-p-form="modules" style="margin-top:12px;display:grid;gap:14px">
      <div class="checkbox-field">
        <label><input type="checkbox" name="repairModuleEnabled" ${t.repairModuleEnabled?"checked":""}> Enable Repair Module for ${t.name}</label>
      </div>
      <p class="muted" style="font-size:13px">Turning this on shows the "New Repair Ticket" button in the client's POS panel and includes ticket stats in their shift summary popup.</p>
      <div class="modal-actions"><button class="primary-button">Save Module Settings</button></div>
    </form>`;
  return "";
}

function pageActivity() {
  const queue     = pState.data.queue||[];
  const conflicts = pState.data.conflicts||[];
  return `
    ${tit("Activity & Sync","Pending sync queue, conflict log, and audit trail across all tenants.","")}
    <div class="grid two-col">
      <div class="card">
        ${tbl("Pending Sync Queue",["ID","Entity","Action","Status","Time"],queue.slice(0,15).map(q=>[q.id.slice(0,10)+"…",q.entity,q.action,`<span class="badge warn">${q.status}</span>`,new Date(q.createdAt).toLocaleString()]))}
        ${!queue.length?`<div class="empty">All changes synced.</div>`:""}
      </div>
      <div class="card">
        ${tbl("Conflict Log",["Tenant","Message","Time"],conflicts.map(c=>[c.tenantId,c.message,new Date(c.createdAt).toLocaleString()]))}
        ${!conflicts.length?`<div class="empty">No conflicts logged.</div>`:""}
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   PLATFORM MODALS
═══════════════════════════════════════════════════════════════════ */
function platformModal() {
  if (!pState.modal) return "";
  const { type } = pState.modal;
  const forms = {
    "create-tenant": `<form class="modal" data-p-form="create-tenant"><h2>Create New Business</h2><div class="form-grid">
      ${fld("Business Name","name")}${fld("Industry","industry","General Retail Store")}
      <label class="field"><span>Plan</span><select name="plan"><option>Basic</option><option>Standard</option><option>Premium</option></select></label>
      ${fld("Primary Color","primaryColor","#126c5b","color")}
    </div><div class="modal-actions"><button type="button" class="secondary-button" data-p-close>Cancel</button><button class="primary-button">Create</button></div></form>`,
  };
  return `<div class="modal-backdrop">${forms[type]||""}</div>`;
}

/* ═══════════════════════════════════════════════════════════════════
   EVENT DELEGATION
═══════════════════════════════════════════════════════════════════ */
document.addEventListener("click", async event => {
  const el = event.target.closest("button,a,[data-p-page],[data-p-action],[data-p-modal],[data-p-close],[data-p-settings-tab]");
  if (!el) return;

  if (el.dataset.pPage) { pState.page=el.dataset.pPage; pState.filter=""; render(); return; }
  if (el.dataset.pModal) { pState.modal={ type:el.dataset.pModal }; render(); return; }
  if (el.dataset.pClose!==undefined) { pState.modal=null; render(); return; }
  if (el.dataset.pSettingsTab) { pState.settingsTab=el.dataset.pSettingsTab; render(); return; }

  if (el.dataset.pAction==="theme") {
    pState.theme = pState.theme==="dark"?"light":"dark";
    localStorage.setItem("retailos-platform-theme",pState.theme);
    document.documentElement.dataset.theme = pState.theme;
    render(); return;
  }
  if (el.dataset.pAction==="open-detail") {
    pState.tenantId = el.dataset.pTenant;
    pState.page     = "tenant-detail";
    render(); return;
  }
  if (el.dataset.pAction==="edit-branding") {
    pState.tenantId = el.dataset.pTenant;
    pState.page     = "branding";
    render(); return;
  }
  if (el.dataset.pAction==="toggle-repairs") {
    const t = pState.data.tenants.find(x=>x.id===el.dataset.pTenant);
    if (t) { await repo.put("tenants",{...t,repairModuleEnabled:!t.repairModuleEnabled},true); await load(); }
    return;
  }
  if (el.dataset.pAction==="suspend"||el.dataset.pAction==="activate") {
    const t = pState.data.tenants.find(x=>x.id===el.dataset.pTenant);
    if (t) { await repo.put("tenants",{...t,status:el.dataset.pAction==="suspend"?"Suspended":"Active"},true); await load(); }
    return;
  }
});

document.addEventListener("change", async event => {
  if (event.target.dataset.pAction==="select-tenant") {
    pState.tenantId = event.target.value||null;
    render();
  }
});

document.addEventListener("input", event => {
  if (event.target.dataset.filter) { pState.filter=event.target.value; render(); }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  const form = event.target;
  const data = Object.fromEntries(new FormData(form).entries());
  const type = form.dataset.pForm;

  if (type==="settings") {
    const t    = currentTenantData();
    if (!t) return;
    const logo = await fileToDataUrl(form.logo?.files?.[0]);
    const next = { ...t, ...data, taxRate:Number(data.taxRate||t.taxRate), logo:logo||t.logo };
    // keep repairModuleEnabled as-is here (controlled by modules tab)
    next.repairModuleEnabled = t.repairModuleEnabled;
    await repo.put("tenants",next,true);
    await load();
  }
  if (type==="modules") {
    const t = currentTenantData();
    if (!t) return;
    await repo.put("tenants",{...t,repairModuleEnabled:!!data.repairModuleEnabled},true);
    await load();
  }
  if (type==="create-tenant") {
    await repo.put("tenants",{ id:uid("tenant"), ...data, status:"Active", address:"", phone:"", whatsapp:"", email:"", receiptFooter:"Thank you.", secondaryColor:"#e9b949", currency:"$", taxRate:5, logo:"", businessDescription:"", repairModuleEnabled:false },true);
    pState.modal=null;
    await load();
  }
});

/* ── Lifecycle ─────────────────────────────────────────────────── */
window.addEventListener("online",  ()=>{ pState.online=true;  load(); });
window.addEventListener("offline", ()=>{ pState.online=false; render(); });

await load();

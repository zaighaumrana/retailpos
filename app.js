// ===== SIMPLE DEMO POS SYSTEM =====

const state = {
  products: [
    { id: "1", name: "iPhone Screen", price: 120, stock: 5 },
    { id: "2", name: "Battery Pack", price: 35, stock: 12 },
    { id: "3", name: "Charging Port", price: 18, stock: 8 }
  ],
  cart: [],
  repairTickets: [],
  employeePin: "1234",
  authenticated: false
};

// ---------- CART ----------
function addToCart(id) {
  const p = state.products.find(x => x.id === id);
  const item = state.cart.find(x => x.id === id);

  if (item) item.qty++;
  else state.cart.push({ ...p, qty: 1, discount: 0 });

  render();
}

function updatePrice(id, newPrice, reason) {
  const item = state.cart.find(x => x.id === id);
  if (!item) return;

  item.price = newPrice;
  item.discountReason = reason;
  render();
}

// ---------- REPAIR TICKET ----------
function createRepairTicket(data) {
  const ticket = {
    id: "TKT-" + Date.now(),
    ...data
  };

  state.repairTickets.push(ticket);

  // optional: add as cart service item
  state.cart.push({
    id: ticket.id,
    name: `Repair: ${data.device}`,
    price: 0,
    qty: 1
  });

  render();
}

// ---------- CHECKOUT ----------
function checkout(pin) {
  if (pin !== state.employeePin) {
    alert("Invalid PIN");
    return;
  }

  const invoice = {
    items: state.cart,
    total: state.cart.reduce((s, i) => s + i.price * i.qty, 0),
    date: new Date().toISOString()
  };

  // save locally (demo backend)
  const sales = JSON.parse(localStorage.getItem("sales") || "[]");
  sales.push(invoice);
  localStorage.setItem("sales", JSON.stringify(sales));

  printReceipt(invoice);
  state.cart = [];
  render();
}

// ---------- THERMAL PRINT ----------
function printReceipt(inv) {
  const html = `
  <div style="width:300px;font-family:monospace">
    <h3>RetailPOS Demo</h3>
    -------------------------
    ${inv.items.map(i => `
      ${i.name}<br>
      ${i.qty} x ${i.price}<br>
    `).join("")}
    -------------------------
    TOTAL: ${inv.total}
  </div>`;

  const w = window.open("");
  w.document.write(html);
  w.print();
  w.close();
}

// ---------- RENDER ----------
function render() {
  document.body.innerHTML = `
    <div style="display:flex">

      <!-- PRODUCTS -->
      <div style="width:60%">
        <h2>Products</h2>
        ${state.products.map(p => `
          <div onclick="addToCart('${p.id}')"
               style="border:1px solid #ccc;margin:5px;padding:10px">
            ${p.name} - $${p.price}
          </div>
        `).join("")}
      </div>

      <!-- CART -->
      <div style="width:40%">
        <h2>Cart</h2>

        ${state.cart.map(i => `
          <div>
            ${i.name} | $${i.price}
            <button onclick="updatePrice('${i.id}', prompt('New price'), 'override')">
              Discount
            </button>
          </div>
        `).join("")}

        <hr/>
        <button onclick="checkout(prompt('Enter PIN'))">
          Checkout & Print
        </button>

        <button onclick="showRepair()">
          New Repair Ticket
        </button>
      </div>
    </div>
  `;
}

// ---------- REPAIR UI ----------
function showRepair() {
  const device = prompt("Device");
  const issue = prompt("Issue");

  createRepairTicket({
    device,
    issue,
    customer: prompt("Customer Name")
  });
}

// init
render();

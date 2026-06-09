// ======================
// STATE (offline-first)
// ======================
const state = {
  view: "pos",
  pin: "1234",
  cart: [],
  products: JSON.parse(localStorage.getItem("products")) || [
    { id: "1", name: "iPhone Screen", price: 120, stock: 5 },
    { id: "2", name: "Battery Pack", price: 35, stock: 10 },
    { id: "3", name: "Charging Port", price: 18, stock: 8 }
  ],
  tickets: JSON.parse(localStorage.getItem("tickets")) || []
};

// ======================
// SAVE (offline persistence)
// ======================
function save() {
  localStorage.setItem("products", JSON.stringify(state.products));
  localStorage.setItem("tickets", JSON.stringify(state.tickets));
}

// ======================
// ADMIN
// ======================
function openAdmin() {
  const pin = prompt("Admin PIN");
  if (pin !== state.pin) return alert("Wrong PIN");
  state.view = "admin";
  render();
}

function backToPOS() {
  state.view = "pos";
  render();
}

// ======================
// CART
// ======================
function add(id) {
  const p = state.products.find(x => x.id === id);
  const item = state.cart.find(x => x.id === id);

  if (item) item.qty++;
  else state.cart.push({ ...p, qty: 1, overridePrice: p.price });

  render();
}

function discount(id) {
  const pin = prompt("Employee PIN");
  if (pin !== state.pin) return alert("Denied");

  const item = state.cart.find(x => x.id === id);
  const newPrice = prompt("New price");
  const reason = prompt("Reason");

  item.overridePrice = Number(newPrice);
  item.reason = reason;

  render();
}

// ======================
// REPAIR TICKET (WITH IMAGE)
// ======================
async function createTicket() {
  const customer = prompt("Customer name");
  const device = prompt("Device");
  const issue = prompt("Issue");

  let image = "";

  const useCamera = confirm("Use camera?");
  if (useCamera) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";

    await new Promise(res => {
      input.onchange = () => {
        const file = input.files[0];
        const reader = new FileReader();
        reader.onload = () => {
          image = reader.result;
          res();
        };
        reader.readAsDataURL(file);
      };
      input.click();
    });
  }

  const ticket = {
    id: "TKT-" + Date.now(),
    customer,
    device,
    issue,
    image
  };

  state.tickets.push(ticket);
  save();

  // add as service item in cart
  state.cart.push({
    id: ticket.id,
    name: `Repair: ${device}`,
    price: 0,
    qty: 1
  });

  render();
}

// ======================
// CHECKOUT + THERMAL PRINT
// ======================
function checkout() {
  const total = state.cart.reduce((s, i) => s + i.overridePrice * i.qty, 0);

  const receipt = `
==== RETAILPOS ====
${state.cart.map(i =>
  `${i.name}
  ${i.qty} x ${i.overridePrice}`
).join("\n")}

TOTAL: ${total}
===================
`;

  const w = window.open("");
  w.document.write(`<pre style="font-size:14px">${receipt}</pre>`);
  w.print();
  w.close();

  state.cart = [];
  render();
}

// ======================
// POS UI
// ======================
function renderPOS() {
  document.getElementById("app").innerHTML = `
    <div class="pos">

      <div class="products">
        <h2>Products</h2>

        ${state.products.map(p => `
          <div class="product" onclick="add('${p.id}')">
            <strong>${p.name}</strong><br>
            $${p.price} | Stock: ${p.stock}
          </div>
        `).join("")}

        <button onclick="createTicket()">+ Repair Ticket</button>
      </div>

      <div class="cart">
        <h2>Cart</h2>

        ${state.cart.map(i => `
          <div class="cart-item">
            <span>${i.name}</span>
            <span>$${i.overridePrice}</span>
            <button onclick="discount('${i.id}')">-</button>
          </div>
        `).join("")}

        <hr>

        <button class="primary" onclick="checkout()">
          Checkout & Print
        </button>
      </div>

    </div>
  `;
}

// ======================
// ADMIN (simple placeholder v2)
// ======================
function renderAdmin() {
  document.getElementById("app").innerHTML = `
    <div style="padding:20px">
      <h1>Admin Panel</h1>

      <button onclick="backToPOS()">Back to POS</button>

      <hr>

      <p>Inventory / Settings / Employees (next upgrade layer)</p>
    </div>
  `;
}

// ======================
function render() {
  if (state.view === "pos") renderPOS();
  else renderAdmin();
}

render();

// ======================
// STATE
// ======================
const state = {
  view: "pos",
  pin: "1234",
  cart: [],
  products: [
    { id: "1", name: "iPhone Screen", price: 120 },
    { id: "2", name: "Battery Pack", price: 35 },
    { id: "3", name: "Charging Port", price: 18 }
  ]
};

// ======================
// NAVIGATION
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
function addToCart(id) {
  const p = state.products.find(x => x.id === id);
  const item = state.cart.find(x => x.id === id);

  if (item) item.qty++;
  else state.cart.push({ ...p, qty: 1 });

  render();
}

function checkout() {
  const total = state.cart.reduce((s, i) => s + i.price * i.qty, 0);

  const receipt = `
RETAIL POS
------------------
${state.cart.map(i => `${i.name} x${i.qty} = ${i.price * i.qty}`).join("\n")}
------------------
TOTAL: ${total}
`;

  const w = window.open("");
  w.document.write(`<pre>${receipt}</pre>`);
  w.print();
  w.close();

  state.cart = [];
  render();
}

// ======================
// POS VIEW (IMPORTANT)
// ======================
function renderPOS() {
  const productsHTML = state.products.map(p => `
    <div onclick="addToCart('${p.id}')"
      style="padding:10px;margin:5px;border:1px solid #ddd;cursor:pointer">
      ${p.name} - $${p.price}
    </div>
  `).join("");

  const cartHTML = state.cart.map(i => `
    <div>${i.name} x${i.qty}</div>
  `).join("");

  document.getElementById("app").innerHTML = `
    <div style="display:flex;height:100vh">

      <!-- PRODUCTS -->
      <div style="flex:2;padding:10px">
        <h2>Products</h2>
        ${productsHTML}
      </div>

      <!-- CART -->
      <div style="flex:1;padding:10px;border-left:1px solid #ddd">
        <h2>Cart</h2>
        ${cartHTML}
        <hr>
        <button onclick="checkout()">Checkout & Print</button>
      </div>

    </div>
  `;
}

// ======================
// ADMIN VIEW (placeholder)
// ======================
function renderAdmin() {
  document.getElementById("app").innerHTML = `
    <div style="padding:20px">
      <h1>Admin Panel</h1>
      <button onclick="backToPOS()">Back to POS</button>
      <p>Inventory, Employees, Settings go here</p>
    </div>
  `;
}

// ======================
// RENDER ENGINE
// ======================
function render() {
  if (state.view === "pos") renderPOS();
  else renderAdmin();
}

render();

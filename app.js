// =========================
// SIMPLE MOCK DATABASE
// =========================

let products = JSON.parse(localStorage.getItem("products")) || [];
let cart = [];
let tickets = JSON.parse(localStorage.getItem("tickets")) || [];
let settings = JSON.parse(localStorage.getItem("settings")) || {
  shopName: "RetailPOS"
};

let adminLoggedIn = false;

// apply settings
document.getElementById("shopName").innerText = settings.shopName;

// =========================
// PAGE SWITCHER
// =========================
function showPage(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.getElementById(page).classList.add("active");

  if (page === "pos") loadPOS();
  if (page === "inventory") loadInventory();
  if (page === "repairs") loadTickets();
}

// =========================
// INVENTORY
// =========================
function addProduct() {
  let name = document.getElementById("pname").value;
  let price = document.getElementById("pprice").value;
  let qty = document.getElementById("pqty").value;
  let imgInput = document.getElementById("pimg");

  let img = "";

  if (imgInput.files && imgInput.files[0]) {
    let reader = new FileReader();
    reader.onload = function (e) {
      img = e.target.result;

      saveProduct(name, price, qty, img);
    };
    reader.readAsDataURL(imgInput.files[0]);
  } else {
    saveProduct(name, price, qty, img);
  }
}

function saveProduct(name, price, qty, img) {
  let product = {
    id: Date.now(),
    name,
    price: Number(price),
    qty: Number(qty),
    img
  };

  products.push(product);
  localStorage.setItem("products", JSON.stringify(products));

  document.getElementById("pname").value = "";
  document.getElementById("pprice").value = "";
  document.getElementById("pqty").value = "";
  document.getElementById("pimg").value = "";

  loadInventory();
}

// render inventory
function loadInventory() {
  let list = document.getElementById("productList");
  list.innerHTML = "";

  products.forEach(p => {
    list.innerHTML += `
      <div class="item">
        <b>${p.name}</b><br>
        Price: Rs ${p.price}<br>
        Stock: ${p.qty}
      </div>
    `;
  });
}

// =========================
// POS SYSTEM
// =========================
function loadPOS() {
  let box = document.getElementById("posProducts");
  box.innerHTML = "";

  products.forEach(p => {
    box.innerHTML += `
      <div class="product" onclick="addToCart(${p.id})">
        <b>${p.name}</b><br>
        Rs ${p.price}
      </div>
    `;
  });

  renderCart();
}

function addToCart(id) {
  let product = products.find(p => p.id === id);

  cart.push({
    id: product.id,
    name: product.name,
    price: product.price
  });

  renderCart();
}

function renderCart() {
  let box = document.getElementById("cart");
  let totalBox = document.getElementById("total");

  box.innerHTML = "";
  let total = 0;

  cart.forEach((item, i) => {
    total += item.price;

    box.innerHTML += `
      <div>
        ${item.name} - Rs ${item.price}
        <button onclick="removeItem(${i})">X</button>
      </div>
    `;
  });

  totalBox.innerText = total;
}

function removeItem(i) {
  cart.splice(i, 1);
  renderCart();
}

// checkout
function checkout() {
  if (cart.length === 0) return alert("Cart empty");

  let invoice = {
    id: Date.now(),
    items: cart,
    total: cart.reduce((sum, i) => sum + i.price, 0),
    date: new Date().toLocaleString()
  };

  alert("Sale Completed! Invoice #" + invoice.id);

  cart = [];
  renderCart();
}

// =========================
// REPAIR TICKETS
// =========================
function addTicket() {
  let name = document.getElementById("cname").value;
  let device = document.getElementById("device").value;
  let issue = document.getElementById("issue").value;

  let ticket = {
    id: "R-" + Math.floor(1000 + Math.random() * 9000),
    name,
    device,
    issue,
    status: "Received"
  };

  tickets.push(ticket);
  localStorage.setItem("tickets", JSON.stringify(tickets));

  document.getElementById("cname").value = "";
  document.getElementById("device").value = "";
  document.getElementById("issue").value = "";

  loadTickets();
}

function loadTickets() {
  let box = document.getElementById("ticketList");
  box.innerHTML = "";

  tickets.forEach(t => {
    box.innerHTML += `
      <div class="ticket">
        <b>${t.id}</b><br>
        ${t.name} - ${t.device}<br>
        Issue: ${t.issue}<br>
        Status: ${t.status}<br>

        <button onclick="addTicketToCart('${t.id}')">
          Add to POS
        </button>
      </div>
    `;
  });
}

// add repair to cart
function addTicketToCart(id) {
  let ticket = tickets.find(t => t.id === id);

  cart.push({
    id: ticket.id,
    name: "Repair: " + ticket.device,
    price: 5000 // demo fixed repair price
  });

  alert("Repair added to cart");
  showPage("pos");
}

// =========================
// ADMIN
// =========================
function loginAdmin() {
  let pass = document.getElementById("adminPass").value;

  if (pass === "1234") {
    adminLoggedIn = true;
    document.getElementById("adminPanel").style.display = "block";
    alert("Admin logged in");
  } else {
    alert("Wrong PIN");
  }
}

function saveSettings() {
  let name = document.getElementById("shopInput").value;

  settings.shopName = name;
  localStorage.setItem("settings", JSON.stringify(settings));

  document.getElementById("shopName").innerText = name;

  alert("Settings saved");
}

// init
loadInventory();
loadTickets();

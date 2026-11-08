
const cfg = window.CHIPA_CONFIG;
const markets = window.AFRICAN_MARKETS;

const $ = s => document.querySelector(s);

let sb = null;
let products = [];
let cart = [];
let rates = { USD: 1 };
let currency = "USD";
let country = "";
let currentUser = null;
let customerOrders = [];

const MINIMUM_ORDER_USD = 100;

// ------------------------------
// SUPABASE CONNECTION
// ------------------------------

if (
  cfg.SUPABASE_URL.startsWith("http") &&
  !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_")
) {
  sb = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );
}

// ------------------------------
// COUNTRY AND CURRENCY
// ------------------------------

const select = $("#countrySelect");

markets.forEach(([name, code, cur]) => {
  const option = document.createElement("option");
  option.value = code;
  option.textContent = `${name} (${cur})`;
  select.append(option);
});

const saved = localStorage.getItem("chipa-country") || "NG";
select.value = saved;
setMarket(saved);

select.addEventListener("change", () => {
  setMarket(select.value);
  renderProducts();
  renderCart();
});

function setMarket(code) {
  country = code;
  const market = markets.find(x => x[1] === code);
  currency = market ? market[2] : "USD";
  localStorage.setItem("chipa-country", code);
}

// ------------------------------
// EXCHANGE RATES
// ------------------------------

async function loadRates() {
  try {
    const response = await fetch(
      "https://open.er-api.com/v6/latest/USD"
    );

    const data = await response.json();

    if (data.result === "success") {
      rates = data.rates;

      $("#rateStatus").textContent =
        "Reference rates updated: " +
        new Date(data.time_last_update_utc).toLocaleDateString();
    }
  } catch {
    $("#rateStatus").textContent =
      "Exchange rates unavailable; showing USD prices.";
  }
}

function money(usd) {
  const amount = Number(usd) * (rates[currency] || 1);

  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function salePrice(product) {
  return product.discount_enabled
    ? Number(product.price_usd) *
      (1 - cfg.DISCOUNT_PERCENT / 100)
    : Number(product.price_usd);
}

// ------------------------------
// CART CALCULATIONS
// ------------------------------

function getCartTotal() {
  return cart.reduce(
    (sum, product) => sum + salePrice(product),
    0
  );
}

function getCartGroups() {
  const groups = new Map();

  cart.forEach(product => {
    if (!groups.has(product.id)) {
      groups.set(product.id, {
        product,
        quantity: 0
      });
    }

    groups.get(product.id).quantity++;
  });

  return Array.from(groups.values());
}

function canCheckout() {
  return cart.length > 0 &&
    getCartTotal() >= MINIMUM_ORDER_USD;
}

// ------------------------------
// SECURITY / HTML DISPLAY
// ------------------------------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showMessage(message) {
  $("#accountMessage").textContent = message;
}

// ------------------------------
// CUSTOMER AUTHENTICATION
// ------------------------------

function emailRedirectUrl() {
  return window.location.origin + window.location.pathname;
}

function updateAccountInterface() {
  const loggedIn = Boolean(currentUser);

  $("#registerSection").hidden = loggedIn;
  $("#loginSection").hidden = loggedIn;
  $("#resendVerification").hidden = loggedIn;
  $("#loggedInSection").hidden = !loggedIn;

  if (loggedIn) {
    const name =
      currentUser.user_metadata?.full_name ||
      currentUser.email;

    $("#customerGreeting").textContent =
      `Welcome, ${name}`;

    showMessage("You are signed in.");
  } else {
    $("#customerGreeting").textContent = "";
  }
}

async function refreshCustomerOrders() {
  if (!sb || !currentUser) return;

  const { data, error } = await sb
    .from("orders")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    $("#customerOrders").textContent =
      "Could not load orders: " + error.message;
    return;
  }

  customerOrders = data || [];
  renderCustomerOrders();
}

function renderCustomerOrders() {
  const container = $("#customerOrders");

  if (!customerOrders.length) {
    container.innerHTML = "<p>You have no orders yet.</p>";
    return;
  }

  container.innerHTML = customerOrders.map(order => `
    <article class="product">
      <div class="product-info">
        <h3>Order ${esc(order.id.slice(0, 8))}</h3>
        <p>Date: ${esc(new Date(order.created_at).toLocaleString())}</p>
        <p>Status: ${esc(order.status)}</p>
        <p>Total: USD ${Number(order.total_usd).toFixed(2)}</p>
        <button type="button" data-receipt="${esc(order.id)}">
          View receipt
        </button>
      </div>
    </article>
  `).join("");

  container.querySelectorAll("[data-receipt]").forEach(button => {
    button.addEventListener("click", () => {
      const order = customerOrders.find(
        item => item.id === button.dataset.receipt
      );

      if (order) showReceipt(order);
    });
  });
}

// REGISTER
$("#registerForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!sb) return alert("Supabase is not configured.");

  const form = new FormData(event.target);

  const fullName = form.get("full_name").trim();
  const email = form.get("email").trim();
  const password = form.get("password");

  showMessage("Creating your account...");

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: emailRedirectUrl()
    }
  });

  if (error) {
    showMessage(error.message);
    return;
  }

  if (data.session) {
    showMessage("Your account is ready. You are signed in.");
  } else {
    showMessage(
      "Registration successful! Check your email and verify your account."
    );
  }

  event.target.reset();
});

// LOGIN
$("#loginForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!sb) return alert("Supabase is not configured.");

  const form = new FormData(event.target);

  showMessage("Signing in...");

  const { error } = await sb.auth.signInWithPassword({
    email: form.get("email").trim(),
    password: form.get("password")
  });

  if (error) {
    showMessage(error.message);
    return;
  }

  showMessage("Login successful.");
  event.target.reset();
});

// RESEND VERIFICATION
$("#resendVerification").addEventListener("click", async () => {
  if (!sb) return;

  const email = $("#registerForm [name=email]").value.trim()
    || $("#loginForm [name=email]").value.trim();

  if (!email) {
    showMessage("Enter your email address first.");
    return;
  }

  showMessage("Sending verification email...");

  const { error } = await sb.auth.resend({
    type: "signup",
    email,
    options: {
      emailRedirectTo: emailRedirectUrl()
    }
  });

  showMessage(
    error ? error.message : "Verification email sent."
  );
});

// LOGOUT
$("#signOutButton").addEventListener("click", async () => {
  if (!sb) return;

  const { error } = await sb.auth.signOut();

  if (error) {
    showMessage(error.message);
    return;
  }

  currentUser = null;
  customerOrders = [];
  updateAccountInterface();

  $("#orderHistory").hidden = true;
  showMessage("You have signed out.");
});

// ACCOUNT DIALOG
$("#accountButton").addEventListener("click", () => {
  $("#accountDialog").showModal();
});

$("#closeAccount").addEventListener("click", () => {
  $("#accountDialog").close();
});

$("#viewOrdersButton").addEventListener("click", async () => {
  $("#accountDialog").close();
  $("#orderHistory").hidden = false;
  $("#orderHistory").scrollIntoView({ behavior: "smooth" });

  await refreshCustomerOrders();
});

// CHECK EXISTING LOGIN SESSION
async function initializeAuth() {
  if (!sb) {
    showMessage("Connect Supabase before using customer accounts.");
    return;
  }

  const { data } = await sb.auth.getSession();

  currentUser = data.session?.user || null;
  updateAccountInterface();

  if (currentUser) {
    await refreshCustomerOrders();
  }

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAccountInterface();
  });
}

// ------------------------------
// PRODUCTS
// ------------------------------

async function loadProducts() {
  if (!sb) {
    $("#products").innerHTML =
      "<p>Connect Supabase in config.js and add products in the admin portal.</p>";
    return;
  }

  const { data, error } = await sb
    .from("products")
    .select("*")
    .eq("active", true)
    .order("created_at", { ascending: false });

  if (error) {
    $("#products").textContent = error.message;
    return;
  }

  products = data || [];
  renderProducts();
}

function renderProducts() {
  const query = $("#search").value.toLowerCase();

  const shown = products.filter(product =>
    (product.name + " " + (product.description || ""))
      .toLowerCase()
      .includes(query)
  );

  $("#products").innerHTML = shown.length
    ? shown.map(product => `
      <article class="product">
        <img
          src="${esc(product.image_url || "https://placehold.co/600x400?text=Chipafrimarket")}"
          alt="${esc(product.name)}"
        >

        <div class="product-info">
          <h3>${esc(product.name)}</h3>

          <div class="price">
            ${money(salePrice(product))}
            ${product.discount_enabled
              ? `<span class="old">${money(product.price_usd)}</span>`
              : ""}
          </div>

          <p>${esc(product.description || "")}</p>

          <button type="button" data-add="${esc(product.id)}">
            Add to cart
          </button>
        </div>
      </article>
    `).join("")
    : "<p>No products found.</p>";

  document.querySelectorAll("[data-add]").forEach(button => {
    button.addEventListener("click", () => {
      const product = products.find(
        item => item.id === button.dataset.add
      );

      if (product) {
        cart.push(product);
        renderCart();
      }
    });
  });
}

// ------------------------------
// SHOPPING CART
// ------------------------------

function renderCart() {
  const groups = getCartGroups();
  const totalUSD = getCartTotal();

  $("#cartCount").textContent = cart.length;

  $("#cartItems").innerHTML = groups.map(({ product, quantity }) => `
    <div class="cart-line">
      <div class="product-info">
        <strong>${esc(product.name)}</strong>

        <p>${money(salePrice(product))} each</p>

        <div class="quantity-controls">
          <button type="button"
            data-minus="${esc(product.id)}">−</button>

          <strong>${quantity}</strong>

          <button type="button"
            data-plus="${esc(product.id)}">+</button>
        </div>

        <p>Subtotal:
          ${money(salePrice(product) * quantity)}
        </p>
      </div>

      <button type="button"
        data-remove="${esc(product.id)}">
        Remove
      </button>
    </div>
  `).join("");

  $("#cartTotal").textContent =
    "Total after discount: " + money(totalUSD);

  // Minimum purchase message
  let minimumMessage = $("#minimumOrderMessage");

  if (!minimumMessage) {
    minimumMessage = document.createElement("p");
    minimumMessage.id = "minimumOrderMessage";

    $("#checkoutBtn").insertAdjacentElement(
      "beforebegin",
      minimumMessage
    );
  }

  if (totalUSD >= MINIMUM_ORDER_USD) {
    minimumMessage.textContent =
      "Minimum order reached! You can checkout.";

    minimumMessage.style.color = "green";
  } else {
    minimumMessage.textContent =
      `Add ${money(MINIMUM_ORDER_USD - totalUSD)} more to reach the $100 minimum order.`;

    minimumMessage.style.color = "red";
  }

  $("#checkoutBtn").disabled = !canCheckout();

  // Increase quantity
  document.querySelectorAll("[data-plus]").forEach(button => {
    button.addEventListener("click", () => {
      const product = products.find(
        item => item.id === button.dataset.plus
      );

      if (product) {
        cart.push(product);
        renderCart();
      }
    });
  });

  // Decrease quantity
  document.querySelectorAll("[data-minus]").forEach(button => {
    button.addEventListener("click", () => {
      const index = cart.findIndex(
        item => item.id === button.dataset.minus
      );

      if (index !== -1) {
        cart.splice(index, 1);
        renderCart();
      }
    });
  });

  // Remove all quantities
  document.querySelectorAll("[data-remove]").forEach(button => {
    button.addEventListener("click", () => {
      cart = cart.filter(
        item => item.id !== button.dataset.remove
      );

      renderCart();
    });
  });
}

$("#cartButton").addEventListener("click", () => {
  $("#cartPanel").classList.add("open");
});

$("#closeCart").addEventListener("click", () => {
  $("#cartPanel").classList.remove("open");
});

$("#search").addEventListener("input", renderProducts);

// ------------------------------
// CHECKOUT
// ------------------------------

$("#checkoutBtn").addEventListener("click", () => {
  if (!cart.length) {
    alert("Your cart is empty.");
    return;
  }

  if (!canCheckout()) {
    alert("Minimum purchase is $100 USD after discount.");
    return;
  }

  $("#checkoutDialog").showModal();

  if (currentUser) {
    $("#checkoutForm [name=email]").value =
      currentUser.email || "";

    $("#checkoutForm [name=customer_name]").value =
      currentUser.user_metadata?.full_name || "";
  }
});

$("#cancelCheckout").addEventListener("click", () => {
  $("#checkoutDialog").close();
});

// ------------------------------
// ORDER RECEIPT
// ------------------------------

function showReceipt(order) {
  const items = Array.isArray(order.items) ? order.items : [];

  $("#receiptContent").innerHTML = `
    <p><strong>Chipafrimarket</strong></p>
    <p>Order reference: ${esc(order.id || "Submitted")}</p>
    <p>Customer: ${esc(order.customer_name)}</p>
    <p>Email: ${esc(order.email)}</p>
    <p>Phone: ${esc(order.phone)}</p>
    <p>Delivery address: ${esc(order.address)}</p>

    <p>Date: ${esc(order.created_at
      ? new Date(order.created_at).toLocaleString()
      : new Date().toLocaleString())}</p>

    <hr>

    <h3>Items</h3>

    ${items.map(item => `
      <p>
        ${esc(item.name)} × ${Number(item.quantity || 1)}
        — USD ${(Number(item.unit_price_usd) *
          Number(item.quantity || 1)).toFixed(2)}
      </p>
    `).join("")}

    <hr>

    <h3>Total: USD ${Number(order.total_usd).toFixed(2)}</h3>

    <p>Status: ${esc(order.status || "pending")}</p>

    <p>Thank you for shopping with Chipafrimarket.</p>
  `;

  $("#receiptDialog").showModal();
}

$("#closeReceipt").addEventListener("click", () => {
  $("#receiptDialog").close();
});

// ------------------------------
// SUBMIT ORDER
// ------------------------------

$("#checkoutForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (!sb) return alert("Supabase is not configured.");

  if (!cart.length) return alert("Your cart is empty.");

  const total = getCartTotal();

  if (total < MINIMUM_ORDER_USD) {
    alert("Your discounted order must be at least $100 USD.");
    return;
  }

  const form = new FormData(event.target);

  const order = {
    customer_name: form.get("customer_name"),
    email: form.get("email"),
    phone: form.get("phone"),
    address: form.get("address"),
    country_code: country,
    currency_code: currency,

    user_id: currentUser ? currentUser.id : null,

    items: getCartGroups().map(({ product, quantity }) => ({
      product_id: product.id,
      name: product.name,
      quantity: quantity,
      unit_price_usd: salePrice(product)
    })),

    total_usd: total,
    status: "pending"
  };

  const { data, error } = await sb
    .from("orders")
    .insert(order)
    .select()
    .single();

  if (error) {
    alert("Order request failed: " + error.message);
    return;
  }

  cart = [];
  renderCart();

  event.target.reset();

  $("#checkoutDialog").close();
  $("#cartPanel").classList.remove("open");

  showReceipt(data);

  if (currentUser) {
    await refreshCustomerOrders();
  }
});

// ------------------------------
// START WEBSITE
// ------------------------------

(async () => {
  await initializeAuth();
  await loadRates();
  await loadProducts();
  renderCart();
})();

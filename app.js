
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
let paymentInstructions = [];
let paymentReceipts = [];
let customerNotifications = [];

const MINIMUM_ORDER_USD = 100;
const MAX_RECEIPT_SIZE = 5 * 1024 * 1024;

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
// SECURITY / DISPLAY
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

function readableStatus(value) {
  return String(value || "pending")
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
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

// ------------------------------
// PAYMENT CENTRE CONTAINER
// ------------------------------

function getNotificationsContainer() {
  let container = $("#customerNotifications");

  if (!container) {
    container = document.createElement("div");
    container.id = "customerNotifications";

    container.style.margin = "20px 0";

    $("#customerOrders").insertAdjacentElement(
      "beforebegin",
      container
    );
  }

  return container;
}

// ------------------------------
// LOAD ORDERS AND PAYMENT DATA
// ------------------------------

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

  const orderIds = customerOrders.map(order => order.id);

  paymentInstructions = [];
  paymentReceipts = [];
  customerNotifications = [];

  if (orderIds.length) {
    const [instructionsResult, receiptsResult] =
      await Promise.all([
        sb.from("payment_instructions")
          .select("*")
          .in("order_id", orderIds),

        sb.from("payment_receipts")
          .select("*")
          .in("order_id", orderIds)
          .order("submitted_at", { ascending: false })
      ]);

    if (instructionsResult.error) {
      console.error(instructionsResult.error);
    } else {
      paymentInstructions = instructionsResult.data || [];
    }

    if (receiptsResult.error) {
      console.error(receiptsResult.error);
    } else {
      paymentReceipts = receiptsResult.data || [];
    }
  }

  const notificationResult = await sb
    .from("notifications")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (notificationResult.error) {
    console.error(notificationResult.error);
  } else {
    customerNotifications = notificationResult.data || [];
  }

  renderCustomerOrders();
}

// ------------------------------
// CUSTOMER NOTIFICATIONS
// ------------------------------

function renderCustomerNotifications() {
  const container = getNotificationsContainer();

  if (!customerNotifications.length) {
    container.innerHTML = `
      <h3>Notifications</h3>
      <p>No notifications yet.</p>
    `;
    return;
  }

  container.innerHTML = `
    <h3>Notifications</h3>

    ${customerNotifications.map(note => `
      <article class="product" style="margin-bottom:10px;padding:12px;">
        <strong>${esc(note.title)}</strong>

        <p>${esc(note.message)}</p>

        <small>
          ${esc(new Date(note.created_at).toLocaleString())}
        </small>
      </article>
    `).join("")}
  `;
}

// ------------------------------
// CUSTOMER ORDER HISTORY
// ------------------------------

function renderCustomerOrders() {
  const container = $("#customerOrders");

  const heading = $("#orderHistory h2");

  if (heading) {
    heading.textContent = "My Orders & Payment Centre";
  }

  renderCustomerNotifications();

  if (!customerOrders.length) {
    container.innerHTML = "<p>You have no orders yet.</p>";
    return;
  }

  container.innerHTML = customerOrders.map(order => {
    const instruction = paymentInstructions.find(
      item => item.order_id === order.id
    );

    const receipt = paymentReceipts.find(
      item => item.order_id === order.id
    );

    const paymentStatus = order.payment_status ||
      (instruction ? "awaiting_payment" : "unpaid");

    let receiptMessage = "No receipt submitted yet.";

    if (receipt) {
      receiptMessage =
        "Receipt status: " + readableStatus(receipt.review_status);
    }

    const canUpload =
      Boolean(instruction) &&
      paymentStatus !== "paid" &&
      (!receipt ||
        receipt.review_status === "rejected");

    return `
      <article class="product"
        style="margin-bottom:20px;padding:15px;">

        <div class="product-info">

          <h3>Order ${esc(order.id.slice(0, 8))}</h3>

          <p>
            Date:
            ${esc(new Date(order.created_at).toLocaleString())}
          </p>

          <p>
            Order status:
            <strong>${esc(readableStatus(order.status))}</strong>
          </p>

          <p>
            Payment status:
            <strong>${esc(readableStatus(paymentStatus))}</strong>
          </p>

          <p>
            Total:
            <strong>USD ${Number(order.total_usd).toFixed(2)}</strong>
          </p>

          <button type="button"
            data-receipt="${esc(order.id)}">
            View order receipt
          </button>

          <hr>

          <h4>Payment instructions</h4>

          ${
            instruction
              ? `
                <p>
                  Method:
                  <strong>${esc(instruction.payment_method)}</strong>
                </p>

                <div style="white-space:pre-wrap;background:#f3f3f3;padding:12px;border-radius:8px;">${esc(instruction.instructions)}</div>

                <small>
                  Sent:
                  ${esc(new Date(instruction.sent_at).toLocaleString())}
                </small>
              `
              : `
                <p>
                  Payment instructions have not been sent yet.
                  Please check your notifications later.
                </p>
              `
          }

          <hr>

          <h4>Payment receipt</h4>

          <p>${esc(receiptMessage)}</p>

          ${
            receipt && receipt.admin_note
              ? `<p>Admin message: ${esc(receipt.admin_note)}</p>`
              : ""
          }

          ${
            canUpload
              ? `
                <div style="margin-top:12px;">
                  <label>
                    Upload payment receipt
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      data-payment-file="${esc(order.id)}"
                    >
                  </label>

                  <button
                    type="button"
                    data-upload-receipt="${esc(order.id)}">
                    Submit receipt
                  </button>

                  <small>
                    Maximum 5MB. JPG, PNG, WEBP or PDF.
                  </small>
                </div>
              `
              : receipt && receipt.review_status === "submitted"
                ? "<p>Your receipt is awaiting admin review.</p>"
                : paymentStatus === "paid"
                  ? "<p>Payment has been verified. Thank you!</p>"
                  : ""
          }

        </div>
      </article>
    `;
  }).join("");

  // View order receipts
  container.querySelectorAll("[data-receipt]").forEach(button => {
    button.addEventListener("click", () => {
      const order = customerOrders.find(
        item => item.id === button.dataset.receipt
      );

      if (order) showReceipt(order);
    });
  });

  // Submit payment receipts
  container.querySelectorAll("[data-upload-receipt]").forEach(button => {
    button.addEventListener("click", async () => {
      const orderId = button.dataset.uploadReceipt;

      const input = container.querySelector(
        `[data-payment-file="${orderId}"]`
      );

      const file = input?.files?.[0];

      if (!file) {
        alert("Please select a receipt file first.");
        return;
      }

      await uploadPaymentReceipt(orderId, file, button);
    });
  });
}

// ------------------------------
// CUSTOMER PAYMENT RECEIPT UPLOAD
// ------------------------------

async function uploadPaymentReceipt(orderId, file, button) {
  if (!sb || !currentUser) {
    alert("Please sign in first.");
    return;
  }

  const order = customerOrders.find(
    item => item.id === orderId
  );

  if (!order || order.user_id !== currentUser.id) {
    alert("This order does not belong to your account.");
    return;
  }

  if (file.size > MAX_RECEIPT_SIZE) {
    alert("Your receipt must not exceed 5MB.");
    return;
  }

  const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "application/pdf"
  ];

  if (!allowedTypes.includes(file.type)) {
    alert("Use JPG, PNG, WEBP or PDF.");
    return;
  }

  const instruction = paymentInstructions.find(
    item => item.order_id === orderId
  );

  if (!instruction) {
    alert("Wait until payment instructions have been sent.");
    return;
  }

  const existingReceipt = paymentReceipts.find(
    item => item.order_id === orderId
  );

  if (
    existingReceipt &&
    existingReceipt.review_status !== "rejected"
  ) {
    alert("Your previous receipt is still being reviewed or has been approved.");
    return;
  }

  const extension = file.name.split(".").pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

  const safeName =
    `${Date.now()}-${crypto.randomUUID()}.${extension || "file"}`;

  const storagePath =
    `${currentUser.id}/${orderId}/${safeName}`;

  button.disabled = true;
  button.textContent = "Uploading...";

  // Upload to private storage bucket
  const { error: uploadError } = await sb.storage
    .from("payment-receipts")
    .upload(storagePath, file, {
      contentType: file.type,
      upsert: false
    });

  if (uploadError) {
    alert("File upload failed: " + uploadError.message);
    button.disabled = false;
    button.textContent = "Submit receipt";
    return;
  }

  // Save receipt record
  const { error: insertError } = await sb
    .from("payment_receipts")
    .insert({
      order_id: orderId,
      user_id: currentUser.id,
      storage_path: storagePath,
      file_name: file.name,
      review_status: "submitted"
    });

  if (insertError) {
    await sb.storage
      .from("payment-receipts")
      .remove([storagePath]);

    alert("Receipt record failed: " + insertError.message);

    button.disabled = false;
    button.textContent = "Submit receipt";
    return;
  }

  alert(
    "Receipt submitted successfully. Your payment is awaiting verification."
  );

  await refreshCustomerOrders();
}

// ------------------------------
// REGISTER
// ------------------------------

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

// ------------------------------
// LOGIN
// ------------------------------

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

// ------------------------------
// RESEND VERIFICATION
// ------------------------------

$("#resendVerification").addEventListener("click", async () => {
  if (!sb) return;

  const email =
    $("#registerForm [name=email]").value.trim() ||
    $("#loginForm [name=email]").value.trim();

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

// ------------------------------
// LOGOUT
// ------------------------------

$("#signOutButton").addEventListener("click", async () => {
  if (!sb) return;

  const { error } = await sb.auth.signOut();

  if (error) {
    showMessage(error.message);
    return;
  }

  currentUser = null;
  customerOrders = [];
  paymentInstructions = [];
  paymentReceipts = [];
  customerNotifications = [];

  updateAccountInterface();

  $("#orderHistory").hidden = true;

  showMessage("You have signed out.");
});

// ------------------------------
// ACCOUNT DIALOG
// ------------------------------

$("#accountButton").addEventListener("click", () => {
  $("#accountDialog").showModal();
});

$("#closeAccount").addEventListener("click", () => {
  $("#accountDialog").close();
});

$("#viewOrdersButton").addEventListener("click", async () => {
  if (!currentUser) {
    showMessage("Please sign in first.");
    return;
  }

  $("#accountDialog").close();
  $("#orderHistory").hidden = false;

  $("#orderHistory").scrollIntoView({
    behavior: "smooth"
  });

  await refreshCustomerOrders();
});

// ------------------------------
// CHECK EXISTING SESSION
// ------------------------------

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
        item => item.id === b

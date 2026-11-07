
const cfg = window.CHIPA_CONFIG;

const sb = (
  cfg &&
  !cfg.SUPABASE_URL.startsWith("YOUR_") &&
  !cfg.SUPABASE_ANON_KEY.startsWith("YOUR_")
)
  ? window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    )
  : null;

const $ = s => document.querySelector(s);
let imageUrl = null;

// ADMIN LOGIN
$("#loginBtn").onclick = async () => {
  if (!sb) {
    $("#loginMsg").textContent =
      "Add Supabase settings to config.js first.";
    return;
  }

  const { error } = await sb.auth.signInWithPassword({
    email: $("#email").value,
    password: $("#password").value
  });

  $("#loginMsg").textContent =
    error ? error.message : "Signed in.";

  if (!error) showDashboard();
};

// VERIFY ADMIN
async function showDashboard() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;

  const { data: role, error } = await sb
    .from("user_roles")
    .select("is_admin")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !role?.is_admin) {
    await sb.auth.signOut();
    $("#loginMsg").textContent =
      "This account is not an authorized admin.";
    return;
  }

  $("#login").hidden = true;
  $("#dashboard").hidden = false;

  loadAdminData();
}

// LOGOUT
$("#logoutBtn").onclick = async () => {
  await sb.auth.signOut();
  location.reload();
};

// SAVE PRODUCT
$("#productForm").onsubmit = async e => {
  e.preventDefault();

  const file = $("#photo").files[0];

  if (file) {
    const path =
      `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "")}`;

    const { error } = await sb.storage
      .from("product-images")
      .upload(path, file, { upsert: true });

    if (error) return alert(error.message);

    const { data } = sb.storage
      .from("product-images")
      .getPublicUrl(path);

    imageUrl = data.publicUrl;
  }

  const row = {
    name: $("#name").value,
    description: $("#description").value,
    price_usd: Number($("#price").value),
    discount_enabled: $("#discount").checked,
    active: true
  };

  if (imageUrl) row.image_url = imageUrl;

  const id = $("#productId").value;

  const result = id
    ? await sb.from("products").update(row).eq("id", id)
    : await sb.from("products").insert(row);

  if (result.error) {
    alert(result.error.message);
  } else {
    e.target.reset();
    $("#productId").value = "";
    imageUrl = null;
    loadAdminData();
  }
};

// RESET PRODUCT FORM
$("#resetBtn").onclick = () => {
  $("#productForm").reset();
  $("#productId").value = "";
  imageUrl = null;
};

// DELETE ORDER
async function deleteOrder(orderId, button) {
  const confirmed = confirm(
    "PERMANENTLY DELETE THIS ORDER?\n\n" +
    "This action cannot be undone.\n" +
    "The order will also disappear from the customer's order history."
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Deleting...";

  const { error } = await sb
    .from("orders")
    .delete()
    .eq("id", orderId);

  if (error) {
    alert("Could not delete order: " + error.message);
    button.disabled = false;
    button.textContent = "Delete Order";
    return;
  }

  alert("Order deleted successfully.");

  await loadAdminData();
}

// LOAD ADMIN DATA
async function loadAdminData() {
  // PRODUCTS
  const { data: ps, error: productError } = await sb
    .from("products")
    .select("*")
    .order("created_at", { ascending: false });

  if (productError) {
    alert("Could not load products: " + productError.message);
    return;
  }

  $("#productList").innerHTML = (ps || []).map(p => `
    <div class="item">
      <b>${p.name}</b> · $${Number(p.price_usd).toFixed(2)} USD

      <button data-edit="${p.id}">Edit</button>
      <button data-delete="${p.id}">Delete</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-edit]").forEach(b => {
    b.onclick = () => {
      const p = ps.find(x => x.id === b.dataset.edit);

      if (!p) return;

      $("#productId").value = p.id;
      $("#name").value = p.name;
      $("#description").value = p.description || "";
      $("#price").value = p.price_usd;
      $("#discount").checked = p.discount_enabled;

      imageUrl = p.image_url;
    };
  });

  document.querySelectorAll("[data-delete]").forEach(b => {
    b.onclick = async () => {
      if (!confirm("Delete this product?")) return;

      const { error } = await sb
        .from("products")
        .delete()
        .eq("id", b.dataset.delete);

      if (error) {
        alert(error.message);
        return;
      }

      await loadAdminData();
    };
  });

  // ORDERS
  const { data: orders, error: orderError } = await sb
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (orderError) {
    $("#orderList").textContent =
      "Could not load orders: " + orderError.message;
    return;
  }

  $("#orderList").innerHTML = (orders || []).map(o => `
    <div class="item">
      <b>${o.customer_name}</b>
      · ${o.country_code}
      · $${Number(o.total_usd).toFixed(2)} USD
      · ${o.status}

      <br>

      <small>
        ${o.email} · ${o.phone} · ${o.address}
      </small>

      <br>

      <button data-status="${o.id}">
        Mark contacted
      </button>

      <button
        data-order-delete="${o.id}"
        style="background:#b30000;color:white;"
      >
        Delete Order
      </button>
    </div>
  `).join("");

  // MARK CONTACTED
  document.querySelectorAll("[data-status]").forEach(b => {
    b.onclick = async () => {
      b.disabled = true;

      const { error } = await sb
        .from("orders")
        .update({ status: "contacted" })
        .eq("id", b.dataset.status);

      if (error) {
        alert(error.message);
        b.disabled = false;
        return;
      }

      await loadAdminData();
    };
  });

  // DELETE ORDER BUTTONS
  document.querySelectorAll("[data-order-delete]").forEach(b => {
    b.onclick = () => deleteOrder(b.dataset.orderDelete, b);
  });
}

// RESTORE EXISTING LOGIN SESSION
(async () => {
  if (sb) {
    const { data: { user } } = await sb.auth.getUser();

    if (user) showDashboard();
  }
})();

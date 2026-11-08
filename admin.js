
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
let adminUser = null;

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

// ------------------------------
// ADMIN LOGIN
// ------------------------------

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

  if (!error) await showDashboard();
};

// ------------------------------
// VERIFY ADMIN
// ------------------------------

async function showDashboard() {
  const { data: { user }, error: userError } =
    await sb.auth.getUser();

  if (userError || !user) return;

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

  adminUser = user;

  $("#login").hidden = true;
  $("#dashboard").hidden = false;

  await loadAdminData();
}

// ------------------------------
// LOGOUT
// ------------------------------

$("#logoutBtn").onclick = async () => {
  if (sb) await sb.auth.signOut();
  location.reload();
};

// ------------------------------
// SAVE PRODUCT
// ------------------------------

$("#productForm").onsubmit = async e => {
  e.preventDefault();

  if (!sb) return alert("Supabase is not connected.");

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
    await loadAdminData();
  }
};

// ------------------------------
// RESET PRODUCT FORM
// ------------------------------

$("#resetBtn").onclick = () => {
  $("#productForm").reset();
  $("#productId").value = "";
  imageUrl = null;
};

// ------------------------------
// SEND CUSTOMER NOTIFICATION
// ------------------------------

async function notifyCustomer(order, title, message) {
  if (!order.user_id) {
    return {
      guest: true
    };
  }

  const { error } = await sb
    .from("notifications")
    .insert({
      user_id: order.user_id,
      order_id: order.id,
      title,
      message
    });

  if (error) {
    return { error };
  }

  return { success: true };
}

// ------------------------------
// SEND PAYMENT INSTRUCTIONS
// ------------------------------

async function sendPaymentInstructions(order, button) {
  const card = button.closest("[data-order-card]");

  const method = card.querySelector(
    "[data-payment-method]"
  ).value;

  const instructions = card.querySelector(
    "[data-payment-instructions]"
  ).value.trim();

  if (!method || !instructions) {
    alert("Choose a payment method and enter the instructions.");
    return;
  }

  if (!confirm(
    "Send these payment instructions to the customer?"
  )) return;

  button.disabled = true;
  button.textContent = "Sending...";

  const { error } = await sb
    .from("payment_instructions")
    .upsert({
      order_id: order.id,
      payment_method: method,
      instructions,
      created_by: adminUser.id,
      sent_at: new Date().toISOString()
    }, {
      onConflict: "order_id"
    });

  if (error) {
    alert("Could not save instructions: " + error.message);
    button.disabled = false;
    button.textContent = "Send Instructions";
    return;
  }

  const result = await notifyCustomer(
    order,
    "Payment instructions",
    `Payment instructions for order ${order.id}: ${method}. ${instructions}`
  );

  if (result.error) {
    alert(
      "Instructions were saved, but the customer notification failed: " +
      result.error.message
    );
  } else if (result.guest) {
    alert(
      "Instructions saved. This customer checked out as a guest. " +
      "Send the instructions through your verified business email or WhatsApp."
    );
  } else {
    alert("Payment instructions saved and customer notified.");
  }

  await loadAdminData();
}

// ------------------------------
// VIEW PRIVATE PAYMENT RECEIPT
// ------------------------------

async function viewPaymentReceipt(receipt, button) {
  button.disabled = true;
  button.textContent = "Opening...";

  const { data, error } = await sb.storage
    .from("payment-receipts")
    .createSignedUrl(receipt.storage_path, 300);

  button.disabled = false;
  button.textContent = "View Receipt";

  if (error) {
    alert("Could not open receipt: " + error.message);
    return;
  }

  window.open(data.signedUrl, "_blank", "noopener");
}

// ------------------------------
// REVIEW PAYMENT RECEIPT
// ------------------------------

async function reviewPaymentReceipt(
  order,
  receipt,
  decision,
  button
) {
  if (decision === "approved") {
    const confirmed = confirm(
      "Have you checked the actual business account and confirmed the payment?"
    );

    if (!confirmed) return;
  }

  const note = prompt(
    decision === "approved"
      ? "Optional admin note:"
      : "Enter the reason for rejecting this receipt:"
  );

  if (decision === "rejected" && !note?.trim()) {
    alert("Please enter a reason for rejection.");
    return;
  }

  if (note === null) return;

  button.disabled = true;
  button.textContent = "Updating...";

  const { error } = await sb
    .from("payment_receipts")
    .update({
      review_status: decision,
      admin_note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: adminUser.id
    })
    .eq("id", receipt.id);

  if (error) {
    alert("Receipt review failed: " + error.message);
    button.disabled = false;
    button.textContent =
      decision === "approved" ? "Approve" : "Reject";
    return;
  }

  // Update order payment status only after admin review.
  if (decision === "approved") {
    const { error: paymentError } = await sb
      .from("orders")
      .update({
        payment_status: "paid"
      })
      .eq("id", order.id);

    if (paymentError) {
      alert(
        "Receipt approved, but payment status could not be updated: " +
        paymentError.message
      );

      await loadAdminData();
      return;
    }
  } else {
    const { error: paymentError } = await sb
      .from("orders")
      .update({
        payment_status: "unpaid"
      })
      .eq("id", order.id);

    if (paymentError) {
      alert("Could not update payment status: " + paymentError.message);
    }
  }

  const message = decision === "approved"
    ? "Your payment receipt has been approved. Your payment is confirmed."
    : `Your payment receipt was not approved. Reason: ${note}`;

  const result = await notifyCustomer(
    order,
    decision === "approved"
      ? "Payment confirmed"
      : "Payment receipt needs attention",
    message
  );

  if (result.error) {
    alert("Payment updated, but notification failed: " + result.error.message);
  } else if (result.guest) {
    alert("Payment review completed. This customer checked out as a guest.");
  } else {
    alert("Payment review completed and customer notified.");
  }

  await loadAdminData();
}

// ------------------------------
// DELETE ORDER
// ------------------------------

async function deleteOrder(orderId, button) {
  const confirmed = confirm(
    "PERMANENTLY DELETE THIS ORDER?\n\n" +
    "This action cannot be undone."
  );

  if (!confirmed) return;

  button.disabled = true;
  button.textContent = "Deleting...";

  // Remove private receipt files first.
  const { data: receipts, error: receiptError } = await sb
    .from("payment_receipts")
    .select("storage_path")
    .eq("order_id", orderId);

  if (receiptError) {
    alert("Could not check receipt files: " + receiptError.message);
    button.disabled = false;
    button.textContent = "Delete Order";
    return;
  }

  const paths = (receipts || []).map(r => r.storage_path);

  if (paths.length) {
    const { error: storageError } = await sb.storage
      .from("payment-receipts")
      .remove(paths);

    if (storageError) {
      alert("Could not delete receipt files: " + storageError.message);
      button.disabled = false;
      button.textContent = "Delete Order";
      return;
    }
  }

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

// ------------------------------
// LOAD ADMIN DATA
// ------------------------------

async function loadAdminData() {
  if (!sb || !adminUser) return;

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
      <b>${esc(p.name)}</b>
      · $${Number(p.price_usd).toFixed(2)} USD

      <button data-edit="${esc(p.id)}">Edit</button>
      <button data-delete="${esc(p.id)}">Delete</button>
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

  const orderIds = (orders || []).map(o => o.id);

  let instructions = [];
  let receipts = [];

  if (orderIds.length) {
    const { data: instructionData, error: instructionError } = await sb
      .from("payment_instructions")
      .select("*")
      .in("order_id", orderIds);

    if (instructionError) {
      alert("Could not load payment instructions: " + instructionError.message);
      return;
    }

    instructions = instructionData || [];

    const { data: receiptData, error: receiptError } = await sb
      .from("payment_receipts")
      .select("*")
      .in("order_id", orderIds)
      .order("submitted_at", { ascending: false });

    if (receiptError) {
      alert("Could not load payment receipts: " + receiptError.message);
      return;
    }

    receipts = receiptData || [];
  }

  const instructionMap = new Map(
    instructions.map(item => [item.order_id, item])
  );

  const receiptMap = new Map();

  receipts.forEach(receipt => {
    if (!receiptMap.has(receipt.order_id)) {
      receiptMap.set(receipt.order_id, []);
    }

    receiptMap.get(receipt.order_id).push(receipt);
  });

  $("#orderList").innerHTML = (orders || []).map(o => {
    const instruction = instructionMap.get(o.id);
    const orderReceipts = receiptMap.get(o.id) || [];

    return `
      <div class="item" data-order-card="${esc(o.id)}">

        <h3>${esc(o.customer_name)}</h3>

        <p>
          ${esc(o.country_code)}
          · USD ${Number(o.total_usd).toFixed(2)}
          · Order: ${esc(o.status)}
        </p>

        <p>
          <b>Payment:</b>
          ${esc(o.payment_status || "unpaid")}
        </p>

        <small>
          ${esc(o.email)} · ${esc(o.phone)}
          · ${esc(o.address)}
        </small>

        <hr>

        <h4>Payment instructions</h4>

        <p>Choose the payment method and enter the instructions
        you want to send to this customer.</p>

        <select data-payment-method>
          <option value="">Choose payment method</option>
          <option value="Bank Transfer"
            ${instruction?.payment_method === "Bank Transfer" ? "selected" : ""}>
            Bank Transfer
          </option>
          <option value="Orange Money"
            ${instruction?.payment_method === "Orange Money" ? "selected" : ""}>
            Orange Money
          </option>
          <option value="Other"
            ${instruction?.payment_method === "Other" ? "selected" : ""}>
            Other
          </option>
        </select>

        <textarea
          data-payment-instructions
          rows="4"
          placeholder="Enter verified business payment instructions..."
        >${esc(instruction?.instructions || "")}</textarea>

        <button type="button" data-send-instructions="${esc(o.id)}">
          ${instruction ? "Update & Send Instructions" : "Send Instructions"}
        </button>

        <hr>

        <h4>Customer payment receipts</h4>

        ${
          orderReceipts.length
            ? orderReceipts.map(receipt => `
              <div class="item">
                <p><b>${esc(receipt.file_name)}</b></p>
                <p>Review: ${esc(receipt.review_status)}</p>
                <p>Submitted: ${esc(new Date(receipt.submitted_at).toLocaleString())}</p>

                <button type="button"
                  data-view-receipt="${esc(receipt.id)}">
                  View Receipt
                </button>

                ${
                  receipt.review_status === "submitted"
                    ? `
                      <button type="button"
                        data-approve="${esc(receipt.id)}">
                        Approve
                      </button>

                      <button type="button"
                        data-reject="${esc(receipt.id)}">
                        Reject
                      </button>
                    `
                    : `<p>Admin note: ${esc(receipt.admin_note || "None")}</p>`
                }
              </div>
            `).join("")
            : "<p>No payment receipt uploaded yet.</p>"
        }

        <hr>

        <button type="button" data-status="${esc(o.id)}">
          Mark contacted
        </button>

        <button
          type="button"
          data-order-delete="${esc(o.id)}"
          style="background:#b30000;color:white;"
        >
          Delete Order
        </button>

      </div>
    `;
  }).join("");

  // SEND PAYMENT INSTRUCTIONS
  document.querySelectorAll("[data-send-instructions]").forEach(b => {
    b.onclick = () => {
      const order = orders.find(o => o.id === b.dataset.sendInstructions);
      if (order) sendPaymentInstructions(order, b);
    };
  });

  // VIEW RECEIPTS
  document.querySelectorAll("[data-view-receipt]").forEach(b => {
    b.onclick = () => {
      const receipt = receipts.find(
        r => r.id === b.dataset.viewReceipt
      );

      if (receipt) viewPaymentReceipt(receipt, b);
    };
  });

  // APPROVE RECEIPTS
  document.querySelectorAll("[data-approve]").forEach(b => {
    b.onclick = () => {
      const receipt = receipts.find(
        r => r.id === b.dataset.approve
      );

      const order = orders.find(
        o => o.id === receipt?.order_id
      );

      if (receipt && order) {
        reviewPaymentReceipt(order, receipt, "approved", b);
      }
    };
  });

  // REJECT RECEIPTS
  document.querySelectorAll("[data-reject]").forEach(b => {
    b.onclick = () => {
      const receipt = receipts.find(
        r => r.id === b.dataset.reject
      );

      const order = orders.find(
        o => o.id === receipt?.order_id
      );

      if (receipt && order) {
        reviewPaymentReceipt(order, receipt, "rejected", b);
      }
    };
  });

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

  // DELETE ORDERS
  document.querySelectorAll("[data-order-delete]").forEach(b => {
    b.onclick = () => deleteOrder(b.dataset.orderDelete, b);
  });
}

// ------------------------------
// RESTORE EXISTING LOGIN SESSION
// ------------------------------

(async () => {
  if (!sb) return;

  const { data: { user } } = await sb.auth.getUser();

  if (user) await showDashboard();
})();
    

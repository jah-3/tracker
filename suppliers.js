document.addEventListener("DOMContentLoaded", async function () {
    const client = window.supabaseClient;
    const supplierBody = document.getElementById("supplier-table");
    const requestsBody = document.getElementById("supplier-orders-table");

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function formatDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
    }

    function addActionButton(parent, label, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.addEventListener("click", action);
        parent.appendChild(button);
    }

    async function loadSuppliers() {
        const { data, error } = await client
            .from("user_roles")
            .select("user_id, email")
            .eq("role", "supplier")
            .order("email");
        if (error) throw error;

        supplierBody.replaceChildren();
        setText("total-suppliers", (data || []).length);
        if (!data?.length) {
            const row = supplierBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 2;
            cell.textContent = "No supplier accounts registered yet.";
            return;
        }

        data.forEach(supplier => {
            const row = supplierBody.insertRow();
            row.insertCell().textContent = supplier.user_id;
            row.insertCell().textContent = supplier.email;
        });
    }

    async function loadRequests() {
        const { data: requestData, error: requestError } = await client
            .from("supplier_order_requests")
            .select("id, supplier_id, product_id, quantity, notes, status, created_at")
            .order("created_at", { ascending: false });
        if (requestError) throw requestError;

        const { data: suppliers, error: supplierError } = await client
            .from("user_roles")
            .select("user_id, email")
            .eq("role", "supplier");
        if (supplierError) throw supplierError;

        const { data: products, error: productError } = await client
            .from("products")
            .select("id, name");
        if (productError) throw productError;

        const requests = requestData || [];
        setText("total-orders", requests.length);
        setText(
            "pending-orders",
            requests.filter(request => request.status === "Requested").length
        );
        setText(
            "completed-orders",
            requests.filter(request => request.status === "Approved").length
        );

        requestsBody.replaceChildren();
        if (!requests.length) {
            const row = requestsBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 8;
            cell.textContent = "No supplier product requests yet.";
            return;
        }

        requests.forEach(request => {
            const supplier = suppliers.find(
                item => item.user_id === request.supplier_id
            );
            const product = products.find(
                item => item.id === request.product_id
            );
            const row = requestsBody.insertRow();
            [
                request.id,
                supplier?.email || "Supplier account unavailable",
                product?.name || "Product unavailable",
                request.quantity,
                request.notes || "—",
                formatDate(request.created_at),
                request.status
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });

            const actions = row.insertCell();
            if (request.status === "Requested") {
                addActionButton(actions, "Approve", () =>
                    updateRequest(request.id, "Approved")
                );
                addActionButton(actions, "Reject", () =>
                    updateRequest(request.id, "Rejected")
                );
            } else {
                actions.textContent = "—";
            }
        });
    }

    async function updateRequest(requestId, status) {
        const { error } = await client
            .from("supplier_order_requests")
            .update({ status })
            .eq("id", requestId);
        if (error) {
            console.error("Update supplier request error:", error);
            window.alert("Could not update request: " + error.message);
            return;
        }
        await loadRequests();
    }

    if (!client) {
        window.alert("Supabase is unavailable. Check supabase.js and reload.");
        return;
    }

    const { data: sessionData, error: sessionError } =
        await client.auth.getSession();
    if (sessionError || !sessionData.session) {
        window.alert("Please sign in again to load supplier accounts.");
        return;
    }

    try {
        await Promise.all([loadSuppliers(), loadRequests()]);
    } catch (error) {
        console.error("Load supplier administration data error:", error);
        window.alert("Could not load supplier data: " + error.message);
    }
});

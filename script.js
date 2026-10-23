
document.addEventListener("DOMContentLoaded", function () {
    const page = location.pathname.split("/").pop();
    if (
        [
            "ai-assistant.html",
            "warehouse.html",
            "inventory.html",
            "suppliers.html",
            "fleet.html",
            "shipment-tracking.html"
        ].includes(page)
    ) {
        return;
    }

    function load(key, defaults) {
        try {
            const data = localStorage.getItem(key);

            if (data === null) {
                localStorage.setItem(key, JSON.stringify(defaults));
                return defaults;
            }

            return JSON.parse(data);
        } catch {
            return defaults;
        }
    }

    function save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    }

    function nextId(items) {
        return items.length
            ? Math.max(...items.map(item => Number(item.id) || 0)) + 1
            : 1;
    }

    function setText(id, value) {
        const element = document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }

    // Products data for Dashboard
    let products = load("salamenceProducts", [
        { id: 1, name: "Product A", stock: 100, price: 50 },
        { id: 2, name: "Product B", stock: 75, price: 100 },
        { id: 3, name: "Product C", stock: 50, price: 150 }
    ]);

    // Read-only vehicle data for Dashboard
    // Vehicle management is handled by fleet.js
    const vehicles = load("salamenceVehicles", [
        {
            id: 1,
            plate: "ABC-1234",
            driver: "Juan Dela Cruz",
            status: "On Delivery"
        },
        {
            id: 2,
            plate: "XYZ-5678",
            driver: "Pedro Santos",
            status: "On Delivery"
        },
        {
            id: 3,
            plate: "DEF-9012",
            driver: "Maria Reyes",
            status: "Available"
        }
    ]);

    function persistProducts() {
        save("salamenceProducts", products);
    }

    function renderProducts() {
        setText("total-products", products.length);

        const body = document.getElementById("product-table");
        if (!body) return;

        body.innerHTML = "";

        products.forEach(product => {
            const row = body.insertRow();

            [
                product.name,
                product.stock,
                product.price
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });
        });
    }

    async function renderRecentShipments() {
        const body = document.getElementById("shipment-table");
        if (!body || !window.supabaseClient) return;

        const { data: sessionData, error: sessionError } =
            await window.supabaseClient.auth.getSession();

        if (sessionError) {
            console.error("Verify dashboard session error:", sessionError);
            showShipmentMessage("Could not verify sign-in.");
            return;
        }

        if (!sessionData.session) return;

        const { data, error } = await window.supabaseClient
            .from("shipments")
            .select("tracking_number, package_name, destination, status")
            .order("created_at", { ascending: false })
            .limit(5);

        if (error) {
            console.error("Load dashboard shipments error:", error);
            showShipmentMessage(
                error.code === "PGRST205"
                    ? "Supabase cannot find public.shipments. Run the updated supabase-inventory.sql in the SQL Editor for this project's Supabase database, then reload."
                    : "Could not load recent shipments: " + error.message
            );
            return;
        }

        body.replaceChildren();
        if (data.length === 0) {
            showShipmentMessage("No shipment records yet.");
            return;
        }

        data.forEach(shipment => {
            const row = body.insertRow();
            [
                shipment.tracking_number,
                shipment.package_name,
                shipment.destination,
                shipment.status
            ].forEach(value => {
                row.insertCell().textContent = value;
            });
        });

        function showShipmentMessage(text) {
            body.replaceChildren();
            const row = body.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 4;
            cell.textContent = text;
        }
    }

    function renderDashboard() {
        setText("total-products", products.length);

        setText(
            "active-vehicles",
            vehicles.filter(
                vehicle => vehicle.status === "On Delivery"
            ).length
        );

        setText(
            "available-vehicles",
            vehicles.filter(
                vehicle => vehicle.status === "Available"
            ).length
        );

        setText(
            "maintenance-vehicles",
            vehicles.filter(
                vehicle => vehicle.status === "Maintenance"
            ).length
        );

        renderProducts();
    }

    function refreshAll() {
        renderDashboard();
    }

    // Logout
    document.getElementById("logout-button")?.addEventListener(
        "click",
        async function (event) {
            event.preventDefault();

            if (confirm("Are you sure you want to log out?")) {
                const { error } = await window.supabaseClient.auth.signOut();
                if (error) {
                    console.error("Sign-out error:", error);
                    alert("Could not sign out: " + error.message);
                    return;
                }
                sessionStorage.removeItem("isLoggedIn");
                location.replace("login.html");
            }
        }
    );

    refreshAll();
    renderRecentShipments();
});

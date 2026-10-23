document.addEventListener("DOMContentLoaded", async function () {
    const supabaseClient = window.supabaseClient;
    const shipmentMessage = document.getElementById("shipment-message");
    const orderMessage = document.getElementById("order-message");
    const incomingMessage = document.getElementById("incoming-message");
    const shipmentBody = document.getElementById("supplier-shipments");
    const ordersBody = document.getElementById("supplier-orders");
    const productSelect = document.getElementById("order-product");
    const incomingForm = document.getElementById("incoming-shipment-form");
    const orderForm = document.getElementById("supplier-order-form");
    const logoutButton = document.getElementById("supplier-logout");

    let currentUser = null;
    let products = [];
    let map = null;
    let shipmentMarkers = [];
    let routeLayerGroup = null;
    let refreshTimer = null;
    let liveRefreshTimeout = null;
    let realtimeChannel = null;
    let lastGeocodeRequestAt = 0;

    function formatDate(value) {
        if (!value) return "Not estimated yet";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
    }

    async function loadProducts() {
        const { data, error } = await supabaseClient.rpc(
            "get_supplier_product_catalog"
        );
        if (error) {
            console.error("Load supplier product catalog error:", error);
            orderMessage.textContent = "Could not load products: " + error.message;
            productSelect.replaceChildren();
            return;
        }

        products = data || [];
        productSelect.replaceChildren();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = products.length
            ? "Select a product"
            : "No products available";
        productSelect.appendChild(placeholder);
        products.forEach(product => {
            const option = document.createElement("option");
            option.value = product.id;
            option.textContent = `${product.name} (${product.sku})`;
            productSelect.appendChild(option);
        });
        document.getElementById("order-submit").disabled = products.length === 0;
    }

    async function loadShipments() {
        const { data, error } = await supabaseClient
            .from("shipments")
            .select("id, tracking_number, package_name, quantity, destination, destination_latitude, destination_longitude, status, estimated_delivery_at, vehicle_id, created_at")
            .eq("supplier_id", currentUser.id)
            .order("created_at", { ascending: false });
        if (error) {
            console.error("Load supplier packages error:", error);
            shipmentMessage.textContent = "Could not load your packages: " + error.message;
            return;
        }

        const shipments = data || [];
        const vehicleIds = [...new Set(
            shipments.map(shipment => shipment.vehicle_id).filter(Boolean)
        )];
        let vehicles = [];
        let vehicleLoadError = null;
        if (vehicleIds.length) {
            const { data: vehicleData, error: vehicleError } =
                await supabaseClient
                    .from("vehicle_locations")
                    .select("vehicle_id, plate_number, latitude, longitude, status")
                    .in("vehicle_id", vehicleIds);
            if (vehicleError) {
                vehicleLoadError = vehicleError;
                console.error("Load supplier vehicle locations error:", vehicleError);
                shipmentMessage.textContent =
                    "Packages loaded, but vehicle locations could not be loaded: " +
                    vehicleError.message;
            } else {
                vehicles = vehicleData || [];
            }
        }

        renderShipments(shipments, vehicles);
        const routeSummary = await renderMap(shipments, vehicles);
        if (!vehicleIds.length) {
            shipmentMessage.textContent =
                "Your packages are registered. A vehicle location appears after the administrator assigns a vehicle.";
        } else if (vehicleLoadError) {
            shipmentMessage.textContent =
                "Packages loaded, but vehicle locations could not be loaded: " +
                vehicleLoadError.message;
        } else {
            shipmentMessage.textContent = routeSummary;
        }
    }

    function renderShipments(shipments, vehicles) {
        shipmentBody.replaceChildren();
        if (!shipments.length) {
            const row = shipmentBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 7;
            cell.textContent = "You have no registered packages yet.";
            return;
        }

        shipments.forEach(shipment => {
            const vehicle = vehicles.find(
                item => item.vehicle_id === shipment.vehicle_id
            );
            const location = vehicle?.latitude != null &&
                vehicle?.longitude != null
                ? `${Number(vehicle.latitude).toFixed(5)}, ${Number(vehicle.longitude).toFixed(5)}`
                : vehicle
                    ? "GPS not shared yet"
                    : "Not assigned";
            const row = shipmentBody.insertRow();
            [
                shipment.tracking_number,
                shipment.package_name,
                shipment.quantity,
                shipment.status,
                vehicle
                    ? `${vehicle.plate_number} (${vehicle.status})`
                    : "Not assigned",
                location,
                formatDate(shipment.estimated_delivery_at)
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });
        });
    }

    async function renderMap(shipments, vehicles) {
        if (!map) return "Map unavailable.";
        shipmentMarkers.forEach(marker => map.removeLayer(marker));
        shipmentMarkers = [];

        const shownVehicles = new Set();
        shipments.forEach(shipment => {
            const vehicle = vehicles.find(
                item => item.vehicle_id === shipment.vehicle_id
            );
            if (
                !vehicle ||
                vehicle.latitude == null ||
                vehicle.longitude == null ||
                shownVehicles.has(vehicle.vehicle_id)
            ) return;

            shownVehicles.add(vehicle.vehicle_id);
            const marker = L.marker([
                Number(vehicle.latitude),
                Number(vehicle.longitude)
            ]).addTo(map);
            const popup = document.createElement("div");
            [
                `Vehicle ${vehicle.plate_number}`,
                `Package ${shipment.tracking_number}`,
                shipment.status
            ].forEach((line, index) => {
                if (index > 0) popup.appendChild(document.createElement("br"));
                popup.appendChild(document.createTextNode(line));
            });
            marker.bindPopup(popup);
            shipmentMarkers.push(marker);
        });

        const routeGroups = vehicles.map(vehicle => ({
            vehicle,
            shipments: shipments.filter(shipment =>
                shipment.vehicle_id === vehicle.vehicle_id &&
                shipment.status !== "Delivered"
            )
        }));
        const routeResult = window.SalamenceRouteMap
            ? await window.SalamenceRouteMap.render(map, routeLayerGroup, routeGroups)
            : { routes: 0, errors: ["Route map helper did not load."], layers: [] };
        const visibleLayers = [...shipmentMarkers, ...routeResult.layers];
        if (visibleLayers.length === 1) {
            map.setView(visibleLayers[0].getLatLng(), 14);
        } else if (visibleLayers.length > 1) {
            map.fitBounds(L.featureGroup(visibleLayers).getBounds(), {
                padding: [24, 24],
                maxZoom: 14
            });
        }
        const routingWarning = routeResult.errors.length
            ? ` Route service errors: ${routeResult.errors.join("; ")}`
            : "";
        return routeResult.routes
            ? `${routeResult.routes} road route(s) shown from live truck GPS to your active delivery stops. Refreshes automatically.${routingWarning}`
            : `No route line yet. A truck must be assigned, share GPS, and have an active delivery with map coordinates.${routingWarning}`;
    }

    async function loadOrderRequests() {
        const { data, error } = await supabaseClient
            .from("supplier_order_requests")
            .select("id, product_id, quantity, notes, status, created_at")
            .eq("supplier_id", currentUser.id)
            .order("created_at", { ascending: false });
        if (error) {
            console.error("Load supplier order requests error:", error);
            orderMessage.textContent =
                "Could not load your product requests: " + error.message;
            return;
        }

        ordersBody.replaceChildren();
        const requests = data || [];
        if (!requests.length) {
            const row = ordersBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 5;
            cell.textContent = "No product requests submitted yet.";
            return;
        }

        requests.forEach(request => {
            const product = products.find(item => item.id === request.product_id);
            const row = ordersBody.insertRow();
            [
                formatDate(request.created_at),
                product?.name || "Product unavailable",
                request.quantity,
                request.notes || "—",
                request.status
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });
        });
    }

    async function geocodeDestination(destination) {
        const delay = Math.max(
            0,
            1100 - (Date.now() - lastGeocodeRequestAt)
        );
        if (delay > 0) {
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        lastGeocodeRequestAt = Date.now();
        const params = new URLSearchParams({
            format: "jsonv2",
            limit: "1",
            q: destination
        });
        const response = await fetch(
            "https://nominatim.openstreetmap.org/search?" + params
        );
        if (!response.ok) {
            throw new Error("Address lookup failed (HTTP " + response.status + ").");
        }
        const results = await response.json();
        if (!results.length) {
            throw new Error("Address not found. Enter a more specific delivery address.");
        }
        return {
            latitude: Number(results[0].lat),
            longitude: Number(results[0].lon)
        };
    }

    function scheduleLiveRefresh() {
        if (liveRefreshTimeout !== null) {
            window.clearTimeout(liveRefreshTimeout);
        }
        liveRefreshTimeout = window.setTimeout(function () {
            liveRefreshTimeout = null;
            if (!document.hidden) loadShipments();
        }, 400);
    }

    incomingForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const trackingNumber = document.getElementById("incoming-tracking").value.trim();
        const itemName = document.getElementById("incoming-item").value.trim();
        const quantity = Number(document.getElementById("incoming-quantity").value);
        const destination = document.getElementById("incoming-destination").value.trim();
        if (!trackingNumber || !itemName || !destination ||
            !Number.isSafeInteger(quantity) || quantity <= 0) {
            incomingMessage.textContent = "Enter a tracking number, package contents, address, and positive whole-number quantity.";
            return;
        }

        const submitButton = document.getElementById("incoming-submit");
        submitButton.disabled = true;
        incomingMessage.textContent = "Looking up delivery address...";
        try {
            const coordinates = await geocodeDestination(destination);
            const { error } = await supabaseClient.from("shipments").insert({
                tracking_number: trackingNumber,
                package_name: itemName,
                quantity,
                destination,
                destination_latitude: coordinates.latitude,
                destination_longitude: coordinates.longitude,
                status: "Preparing",
                supplier_id: currentUser.id
            });
            if (error) throw error;
            incomingForm.reset();
            document.getElementById("incoming-quantity").value = "1";
            incomingMessage.textContent =
                "Package registered. The administrator can now assign a vehicle.";
            await loadShipments();
        } catch (error) {
            console.error("Register incoming supplier package error:", error);
            incomingMessage.textContent =
                "Could not register package: " + error.message;
        } finally {
            submitButton.disabled = false;
        }
    });

    orderForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const productId = Number(productSelect.value);
        const quantity = Number(document.getElementById("order-quantity").value);
        const notes = document.getElementById("order-notes").value.trim();
        if (!Number.isSafeInteger(productId) || productId <= 0 ||
            !Number.isSafeInteger(quantity) || quantity <= 0) {
            orderMessage.textContent = "Choose a product and enter a positive whole-number quantity.";
            return;
        }

        const submitButton = document.getElementById("order-submit");
        submitButton.disabled = true;
        const { error } = await supabaseClient
            .from("supplier_order_requests")
            .insert({
                supplier_id: currentUser.id,
                product_id: productId,
                quantity,
                notes
            });
        submitButton.disabled = false;
        if (error) {
            console.error("Submit supplier product request error:", error);
            orderMessage.textContent = "Could not submit request: " + error.message;
            return;
        }
        orderForm.reset();
        orderMessage.textContent = "Product request submitted for administrator review.";
        await loadOrderRequests();
    });

    logoutButton.addEventListener("click", async function () {
        logoutButton.disabled = true;
        if (refreshTimer !== null) {
            window.clearInterval(refreshTimer);
            refreshTimer = null;
        }
        if (liveRefreshTimeout !== null) {
            window.clearTimeout(liveRefreshTimeout);
            liveRefreshTimeout = null;
        }
        if (realtimeChannel) {
            await supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            logoutButton.disabled = false;
            refreshTimer = window.setInterval(loadShipments, 30000);
            shipmentMessage.textContent = "Could not sign out: " + error.message;
            return;
        }
        sessionStorage.removeItem("isLoggedIn");
        window.location.reload();
    });

    if (!supabaseClient) {
        shipmentMessage.textContent = "Supabase is unavailable. Check supabase.js and reload.";
        return;
    }

    const { data: sessionData, error: sessionError } =
        await supabaseClient.auth.getSession();
    if (sessionError) {
        shipmentMessage.textContent = "Could not verify sign-in: " + sessionError.message;
        return;
    }
    if (!sessionData.session) {
        window.location.replace("supplier.html");
        return;
    }

    currentUser = sessionData.session.user;
    const { data: roleData, error: roleError } = await supabaseClient
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle();
    if (roleError) {
        shipmentMessage.textContent = "Could not verify account role: " + roleError.message;
        return;
    }
    if (roleData?.role !== "supplier") {
        const rolePages = {
            admin: "index.html",
            driver: "driver-dashboard.html"
        };
        window.location.replace(rolePages[roleData?.role] || "supplier.html");
        return;
    }

    sessionStorage.setItem("isLoggedIn", "true");
    document.getElementById("supplier-account-email").textContent =
        currentUser.email || "";
    if (window.L) {
        map = L.map("supplier-map").setView([12.8797, 121.7740], 6);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }).addTo(map);
        routeLayerGroup = L.layerGroup().addTo(map);
    }
    await loadProducts();
    await Promise.all([loadShipments(), loadOrderRequests()]);
    if (map) map.invalidateSize();
    if (refreshTimer === null) {
        refreshTimer = window.setInterval(loadShipments, 30000);
    }
    realtimeChannel = supabaseClient
        .channel("supplier-delivery-live-updates")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "shipments" },
            scheduleLiveRefresh
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "vehicle_locations" },
            scheduleLiveRefresh
        )
        .subscribe((status, error) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.error("Supplier live updates unavailable:", error || status);
                shipmentMessage.textContent =
                    "Live updates are unavailable; data will refresh every 30 seconds.";
            }
        });
    window.addEventListener("beforeunload", function () {
        if (refreshTimer !== null) window.clearInterval(refreshTimer);
        if (liveRefreshTimeout !== null) window.clearTimeout(liveRefreshTimeout);
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    });
});

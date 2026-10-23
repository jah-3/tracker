document.addEventListener("DOMContentLoaded", async function () {
    const supabaseClient = window.supabaseClient;
    const form = document.getElementById("shipment-form");
    const tableBody = document.getElementById("shipment-table");
    const searchInput = document.getElementById("shipment-search");
    const message = document.getElementById("shipment-message");
    const vehicleSelect = document.getElementById("shipment-vehicle");
    const supplierSelect = document.getElementById("shipment-supplier");
    const submitButton = document.getElementById("shipment-submit");
    const cancelEditButton = document.getElementById("shipment-cancel-edit");
    const trackingNumberInput = document.getElementById("tracking-number");
    const statuses = [
        "Preparing",
        "In Transit",
        "Out for Delivery",
        "Delivered",
        "Delayed"
    ];
    let shipments = [];
    let vehicles = [];
    let suppliers = [];
    let lastGeocodeRequestAt = 0;
    let editingShipment = null;
    let refreshTimer = null;
    let realtimeChannel = null;

    function setMessage(text) {
        message.textContent = text;
    }

    function renderSummary() {
        document.getElementById("total-shipments").textContent = shipments.length;
        document.getElementById("in-transit-shipments").textContent =
            shipments.filter(shipment => shipment.status === "In Transit").length;
        document.getElementById("delivered-shipments").textContent =
            shipments.filter(shipment => shipment.status === "Delivered").length;
        document.getElementById("delayed-shipments").textContent =
            shipments.filter(shipment => shipment.status === "Delayed").length;
    }

    function getVehicleName(vehicleId) {
        return vehicles.find(vehicle => vehicle.vehicle_id === vehicleId)?.plate_number
            || "Unassigned";
    }

    function getSupplierEmail(supplierId) {
        return suppliers.find(supplier => supplier.user_id === supplierId)?.email
            || "Unassigned";
    }

    function formatEta(value) {
        if (!value) return "Waiting for driver GPS";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
    }

    function toLocalDateTimeInput(value) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        const offset = date.getTimezoneOffset() * 60000;
        return new Date(date.getTime() - offset).toISOString().slice(0, 16);
    }

    async function loadVehicles() {
        const { data, error } = await supabaseClient
            .from("vehicle_locations")
            .select("vehicle_id, plate_number, latitude, longitude")
            .order("plate_number");

        if (error) {
            console.error("Load shipment vehicles error:", error);
            setMessage("Could not load vehicles: " + error.message);
            return false;
        }

        vehicles = data || [];
        vehicleSelect.replaceChildren();
        const unassignedOption = document.createElement("option");
        unassignedOption.value = "";
        unassignedOption.textContent = "No vehicle assigned";
        vehicleSelect.appendChild(unassignedOption);

        vehicles.forEach(vehicle => {
            const option = document.createElement("option");
            option.value = vehicle.vehicle_id;
            option.textContent = vehicle.plate_number;
            vehicleSelect.appendChild(option);
        });

        return true;
    }

    async function loadSuppliers() {
        const { data, error } = await supabaseClient
            .from("user_roles")
            .select("user_id, email")
            .eq("role", "supplier")
            .order("email");
        if (error) {
            console.error("Load supplier accounts error:", error);
            setMessage("Could not load supplier accounts: " + error.message);
            return false;
        }

        suppliers = data || [];
        supplierSelect.replaceChildren();
        const unassignedOption = document.createElement("option");
        unassignedOption.value = "";
        unassignedOption.textContent = "No supplier assigned";
        supplierSelect.appendChild(unassignedOption);
        suppliers.forEach(supplier => {
            const option = document.createElement("option");
            option.value = supplier.user_id;
            option.textContent = supplier.email;
            supplierSelect.appendChild(option);
        });
        return true;
    }

    async function geocodeDestination(destination) {
        const waitForRateLimit = Math.max(
            0,
            1100 - (Date.now() - lastGeocodeRequestAt)
        );
        if (waitForRateLimit > 0) {
            await new Promise(resolve => setTimeout(resolve, waitForRateLimit));
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
            throw new Error("Could not find that destination address. Please enter a more specific address.");
        }

        const latitude = Number(results[0].lat);
        const longitude = Number(results[0].lon);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
            throw new Error("The address lookup returned invalid coordinates.");
        }

        return { latitude, longitude };
    }

    async function estimateEta(
        startLatitude,
        startLongitude,
        destinationLatitude,
        destinationLongitude
    ) {
        const url =
            "https://router.project-osrm.org/route/v1/driving/" +
            `${startLongitude},${startLatitude};` +
            `${destinationLongitude},${destinationLatitude}` +
            "?overview=false&steps=false";
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error("Route lookup failed (HTTP " + response.status + ").");
        }

        const result = await response.json();
        const duration = result.routes?.[0]?.duration;
        if (!Number.isFinite(duration) || duration < 0) {
            throw new Error("No driving route was found for this package.");
        }

        return new Date(Date.now() + duration * 1000).toISOString();
    }

    function renderShipments() {
        tableBody.replaceChildren();
        const query = searchInput.value.trim().toLowerCase();
        const visibleShipments = shipments.filter(shipment =>
            [
                shipment.tracking_number,
                shipment.package_name,
                shipment.destination,
                getVehicleName(shipment.vehicle_id),
                getSupplierEmail(shipment.supplier_id)
            ]
                .some(value => String(value).toLowerCase().includes(query))
        );

        if (visibleShipments.length === 0) {
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 12;
            cell.textContent = shipments.length
                ? "No packages match your search."
                : "No packages yet. Add a package above to start tracking.";
            return;
        }

        visibleShipments.forEach(shipment => {
            const row = tableBody.insertRow();
            [
                shipment.tracking_number,
                shipment.package_name,
                shipment.destination,
                shipment.quantity,
                shipment.scheduled_delivery_at
                    ? new Date(shipment.scheduled_delivery_at).toLocaleString()
                    : "Not scheduled",
                getVehicleName(shipment.vehicle_id),
                getSupplierEmail(shipment.supplier_id),
                shipment.status,
                formatEta(shipment.estimated_delivery_at),
                new Date(shipment.created_at).toLocaleDateString()
            ].forEach(value => {
                row.insertCell().textContent = value;
            });

            const proofCell = row.insertCell();
            if (shipment.delivery_proof_path) {
                proofCell.textContent = "Loading proof...";
                supabaseClient.storage
                    .from("delivery-proofs")
                    .createSignedUrl(shipment.delivery_proof_path, 300)
                    .then(({ data, error }) => {
                        proofCell.replaceChildren();
                        if (error) {
                            console.error("Create delivery proof link error:", error);
                            proofCell.textContent = "Unavailable";
                            return;
                        }
                        const link = document.createElement("a");
                        link.href = data.signedUrl;
                        link.target = "_blank";
                        link.rel = "noopener";
                        link.textContent = "View proof";
                        proofCell.appendChild(link);
                    });
            } else {
                proofCell.textContent = "—";
            }

            const actions = row.insertCell();
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.textContent = "Edit";
            editButton.addEventListener("click", () => editShipment(shipment));

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.textContent = "Delete";
            deleteButton.style.backgroundColor = "#dc2626";
            deleteButton.style.marginLeft = "6px";
            deleteButton.addEventListener("click", () => deleteShipment(shipment));
            actions.append(editButton, deleteButton);
        });
    }

    async function loadShipments() {
        setMessage("Loading packages...");
        const { data, error } = await supabaseClient
            .from("shipments")
            .select("id, tracking_number, package_name, destination, quantity, vehicle_id, supplier_id, destination_latitude, destination_longitude, scheduled_delivery_at, estimated_delivery_at, delivery_proof_path, status, created_at")
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Load shipments error:", error);
            setMessage("Could not load packages: " + error.message);
            tableBody.replaceChildren();
            const row = tableBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 10;
            cell.textContent = "Could not load packages. Check the Supabase setup and try reloading.";
            return;
        }

        shipments = data || [];
        renderSummary();
        renderShipments();
        setMessage("");
    }

    function scheduleLiveRefresh() {
        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
        }
        refreshTimer = window.setTimeout(async function () {
            refreshTimer = null;
            const [vehiclesLoaded, suppliersLoaded] = await Promise.all([
                loadVehicles(),
                loadSuppliers()
            ]);
            if (vehiclesLoaded && suppliersLoaded) {
                await loadShipments();
            }
        }, 300);
    }

    function editShipment(shipment) {
        editingShipment = shipment;
        trackingNumberInput.value = shipment.tracking_number;
        trackingNumberInput.readOnly = true;
        document.getElementById("package-name").value = shipment.package_name;
        document.getElementById("destination").value = shipment.destination;
        document.getElementById("shipment-quantity").value = shipment.quantity;
        document.getElementById("scheduled-delivery").value =
            toLocalDateTimeInput(shipment.scheduled_delivery_at);
        vehicleSelect.value = shipment.vehicle_id || "";
        supplierSelect.value = shipment.supplier_id || "";
        document.getElementById("shipment-status").value = shipment.status;
        submitButton.textContent = "Save Changes";
        cancelEditButton.hidden = false;
        setMessage("Editing package " + shipment.tracking_number + ".");
        form.scrollIntoView({ behavior: "smooth", block: "center" });
        document.getElementById("package-name").focus({ preventScroll: true });
    }

    function cancelShipmentEdit() {
        editingShipment = null;
        form.reset();
        trackingNumberInput.readOnly = false;
        submitButton.textContent = "Add Package";
        cancelEditButton.hidden = true;
        setMessage("Edit cancelled.");
    }

    async function deleteShipment(shipment) {
        if (!confirm("Delete package " + shipment.tracking_number + "?")) return;

        const { error } = await supabaseClient
            .from("shipments")
            .delete()
            .eq("id", shipment.id);

        if (error) {
            console.error("Delete shipment error:", error);
            alert("Could not delete package: " + error.message);
            return;
        }

        setMessage("Package deleted.");
        await loadShipments();
    }

    document.getElementById("logout-button").addEventListener(
        "click",
        function (event) {
            event.preventDefault();
            if (confirm("Are you sure you want to log out?")) {
                sessionStorage.removeItem("isLoggedIn");
                location.replace("login.html");
            }
        }
    );

    searchInput.addEventListener("input", renderShipments);
    cancelEditButton.addEventListener("click", cancelShipmentEdit);

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        const formData = new FormData(form);
        const quantity = Number(String(formData.get("quantity")).trim());
        const shipment = {
            tracking_number: editingShipment
                ? editingShipment.tracking_number
                : String(formData.get("tracking_number")).trim(),
            package_name: String(formData.get("package_name")).trim(),
            destination: String(formData.get("destination")).trim(),
            quantity,
            scheduled_delivery_at: String(
                formData.get("scheduled_delivery_at") || ""
            ).trim()
                ? new Date(String(formData.get("scheduled_delivery_at"))).toISOString()
                : null,
            vehicle_id: String(formData.get("vehicle_id")) || null,
            supplier_id: String(formData.get("supplier_id")) || null,
            status: String(formData.get("status"))
        };

        if (
            !shipment.tracking_number ||
            !shipment.package_name ||
            !shipment.destination ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0
        ) {
            setMessage("Fill in all package details before saving.");
            return;
        }

        submitButton.disabled = true;
        cancelEditButton.disabled = true;
        setMessage(editingShipment
            ? "Updating package..."
            : "Looking up destination address...");
        let destinationCoordinates;
        if (
            editingShipment &&
            shipment.destination === editingShipment.destination &&
            editingShipment.destination_latitude != null &&
            editingShipment.destination_longitude != null
        ) {
            destinationCoordinates = {
                latitude: editingShipment.destination_latitude,
                longitude: editingShipment.destination_longitude
            };
        } else {
            try {
                setMessage("Looking up destination address...");
                destinationCoordinates = await geocodeDestination(shipment.destination);
            } catch (error) {
                console.error("Geocode package destination error:", error);
                setMessage(
                    (editingShipment ? "Could not update package: " : "Could not add package: ") +
                    error.message
                );
                submitButton.disabled = false;
                cancelEditButton.disabled = false;
                return;
            }
        }

        let estimatedDeliveryAt = null;
        const assignedVehicle = vehicles.find(
            vehicle => vehicle.vehicle_id === shipment.vehicle_id
        );
        if (
            assignedVehicle?.latitude != null &&
            assignedVehicle?.longitude != null
        ) {
            try {
                estimatedDeliveryAt = await estimateEta(
                    Number(assignedVehicle.latitude),
                    Number(assignedVehicle.longitude),
                    destinationCoordinates.latitude,
                    destinationCoordinates.longitude
                );
            } catch (error) {
                console.error("Calculate initial package ETA error:", error);
                setMessage("Package can be saved, but its route estimate could not be calculated: " + error.message);
            }
        }

        const shipmentData = {
                ...shipment,
                destination_latitude: destinationCoordinates.latitude,
                destination_longitude: destinationCoordinates.longitude,
                estimated_delivery_at: estimatedDeliveryAt
        };
        const query = editingShipment
            ? supabaseClient
                .from("shipments")
                .update(shipmentData)
                .eq("id", editingShipment.id)
            : supabaseClient
                .from("shipments")
                .insert(shipmentData);
        const { error } = await query;

        if (error) {
            console.error(editingShipment ? "Update shipment error:" : "Add shipment error:", error);
            setMessage(
                (editingShipment ? "Could not update package: " : "Could not add package: ") +
                error.message
            );
            submitButton.disabled = false;
            cancelEditButton.disabled = false;
            return;
        }

        const wasEditing = Boolean(editingShipment);
        const savedTrackingNumber = shipment.tracking_number;
        editingShipment = null;
        form.reset();
        trackingNumberInput.readOnly = false;
        submitButton.textContent = "Add Package";
        submitButton.disabled = false;
        cancelEditButton.disabled = false;
        cancelEditButton.hidden = true;
        await loadShipments();
        if (wasEditing) {
            setMessage("Package updated successfully.");
        } else {
            const savedShipment = shipments.find(
                item => item.tracking_number === savedTrackingNumber
            );
            const assignedVehicle = vehicles.find(
                vehicle => vehicle.vehicle_id === savedShipment?.vehicle_id
            );
            setMessage(assignedVehicle
                ? "Package added and assigned to truck " + assignedVehicle.plate_number + "."
                : "Package added. It will be assigned automatically when an available driver has shared GPS.");
        }
    });

    if (!supabaseClient) {
        setMessage("Supabase connection is unavailable. Check supabase.js.");
        return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        setMessage("Could not verify sign-in: " + error.message);
        return;
    }
    if (!data.session) {
        sessionStorage.removeItem("isLoggedIn");
        location.replace("login.html");
        return;
    }

    if (!(await loadVehicles())) return;
    if (!(await loadSuppliers())) return;
    await loadShipments();

    realtimeChannel = supabaseClient
        .channel("admin-package-live-updates")
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
                console.error("Package live updates unavailable:", error || status);
                setMessage("Live sync unavailable; package data refreshes every 30 seconds.");
            }
        });

    window.setInterval(function () {
        if (!document.hidden && refreshTimer === null) {
            scheduleLiveRefresh();
        }
    }, 30000);

    window.addEventListener("beforeunload", function () {
        if (refreshTimer !== null) {
            window.clearTimeout(refreshTimer);
        }
        if (realtimeChannel) {
            supabaseClient.removeChannel(realtimeChannel);
        }
    });
});

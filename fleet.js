
document.addEventListener("DOMContentLoaded", async function () {
    console.log("FLEET.JS IS RUNNING");

    if (!location.pathname.endsWith("fleet.html")) return;

    const body = document.getElementById("fleet-table");
    const mapElement = document.getElementById("fleet-map");
    const reportsBody = document.getElementById("driver-reports");

    let vehicles = [];
    let shipments = [];
    let drivers = [];
    let driverReports = [];
    let markers = [];
    const locationWatchIds = new Map();
    const lastLocationSavedAt = new Map();
    const lastEtaUpdatedAt = new Map();
    let map = null;
    let routeLayerGroup = null;
    let mapRenderVersion = 0;
    let isLoading = false;
    let liveRefreshTimer = null;
    let realtimeChannel = null;

    // SHOW STATUS MESSAGE
    function showMessage(message) {
        console.log(message);

        const element = document.getElementById("gps-status");
        if (element) element.textContent = message;
    }

    // UPDATE TEXT
    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    // PREVENT HTML INJECTION
    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        })[char]);
    }

    // VALIDATE VEHICLE STATUS
    function validStatus(value) {
        if (typeof value !== "string") return null;

        return ["Available", "On Delivery", "Maintenance"].find(
            status => status.toLowerCase() === value.trim().toLowerCase()
        );
    }

    function formatEstimatedDelivery(value) {
        if (!value) return "—";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
    }

    // INITIALIZE MAP
    if (!mapElement) {
        showMessage("Map container not found in fleet.html.");
    } else if (!window.L) {
        showMessage("Leaflet failed to load. Check fleet.html scripts.");
    } else {
        map = L.map(mapElement).setView([12.8797, 121.7740], 6);

        // OPENSTREETMAP TILES - NO CARTO API KEY
        const streetLayer = L.tileLayer(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
                attribution: "&copy; OpenStreetMap contributors",
                maxZoom: 19
            }
        );

        let tileErrorShown = false;

        streetLayer.on("tileerror", function (event) {
            console.error("OpenStreetMap tile error:", event);

            if (!tileErrorShown) {
                tileErrorShown = true;
                showMessage(
                    "Map tiles failed to load. Check your internet connection or browser blocking."
                );
            }
        });

        streetLayer.addTo(map);
        routeLayerGroup = L.layerGroup().addTo(map);

        map.whenReady(function () {
            setTimeout(function () {
                map.invalidateSize();
            }, 500);
        });
    }

    // LOAD VEHICLES FROM SUPABASE
    async function loadVehicles() {
        if (isLoading) return;

        if (!window.supabaseClient) {
            showMessage("Supabase connection not found. Check supabase.js.");
            return;
        }

        isLoading = true;

        try {
            const { data, error } = await window.supabaseClient
                .from("vehicle_locations")
                .select("*")
                .order("id");

            if (error) {
                console.error("Supabase error:", error.message);
                showMessage("Unable to load vehicles: " + error.message);
                return;
            }

            const { data: shipmentData, error: shipmentError } =
                await window.supabaseClient
                    .from("shipments")
                    .select("id, tracking_number, package_name, destination, quantity, vehicle_id, destination_latitude, destination_longitude, estimated_delivery_at, status, created_at")
                    .order("created_at");

            if (shipmentError) {
                console.error("Load vehicle shipments error:", shipmentError);
                shipments = [];
            } else {
                shipments = shipmentData || [];
            }

            const { data: driverData, error: driverError } =
                await window.supabaseClient
                    .from("user_roles")
                    .select("user_id, email")
                    .eq("role", "driver")
                    .order("email");

            if (driverError) {
                console.error("Load driver accounts error:", driverError);
                drivers = [];
            } else {
                drivers = driverData || [];
            }

            const { data: reportData, error: reportError } =
                await window.supabaseClient
                    .from("driver_incident_reports")
                    .select("id, driver_id, vehicle_id, shipment_id, report_type, details, created_at")
                    .order("created_at", { ascending: false })
                    .limit(100);
            if (reportError) {
                console.error("Load driver incident reports error:", reportError);
                driverReports = [];
            } else {
                driverReports = reportData || [];
            }

            vehicles = (data || []).map(item => ({
                id: item.id,
                vehicleId: item.vehicle_id,
                plate: item.plate_number || "",
                driver: item.driver || "",
                assignedDriverId: item.assigned_driver_id || "",
                status: item.status || "Available",
                latitude: item.latitude,
                longitude: item.longitude
            }));

            renderFleet();
            await renderMap();
            if (shipmentError) {
                showMessage(
                    "Vehicle list loaded, but assigned packages are unavailable: " +
                    shipmentError.message
                );
            }
            if (driverError) {
                showMessage("Could not load driver accounts: " + driverError.message);
            }
            if (reportError) {
                showMessage("Could not load driver reports: " + reportError.message);
            }
            renderDriverReports();

        } catch (error) {
            console.error("Vehicle loading error:", error);
            showMessage("Unable to load vehicle data.");
        } finally {
            isLoading = false;
        }
    }

    function renderDriverReports() {
        if (!reportsBody) return;
        reportsBody.replaceChildren();
        if (!driverReports.length) {
            const row = reportsBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 6;
            cell.textContent = "No driver reports yet.";
            return;
        }

        driverReports.forEach(report => {
            const vehicle = vehicles.find(item => item.vehicleId === report.vehicle_id);
            const shipment = shipments.find(item => item.id === report.shipment_id);
            const driver = drivers.find(item => item.user_id === report.driver_id);
            const row = reportsBody.insertRow();
            [
                formatEstimatedDelivery(report.created_at),
                driver?.email || report.driver_id,
                vehicle?.plate || "Vehicle unavailable",
                shipment?.tracking_number || "Vehicle / general",
                report.report_type,
                report.details
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });
        });
    }

    function scheduleLiveRefresh() {
        if (liveRefreshTimer !== null) {
            window.clearTimeout(liveRefreshTimer);
        }
        liveRefreshTimer = window.setTimeout(function () {
            liveRefreshTimer = null;
            loadVehicles();
        }, 300);
    }

    // DISPLAY VEHICLE MARKERS
    async function renderMap() {
        if (!map) return;
        const renderVersion = ++mapRenderVersion;

        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        vehicles.forEach(vehicle => {
            if (
                vehicle.latitude == null ||
                vehicle.longitude == null
            ) {
                return;
            }

            const lat = Number(vehicle.latitude);
            const lng = Number(vehicle.longitude);

            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng) ||
                lat < -90 || lat > 90 ||
                lng < -180 || lng > 180
            ) {
                return;
            }

            const marker = L.marker([lat, lng]).addTo(map);

            const assignedShipments = getVehicleShipments(vehicle.vehicleId);
            const shipmentDetails = assignedShipments.length
                ? assignedShipments.map(shipment =>
                    `${escapeHTML(shipment.package_name)} (${escapeHTML(shipment.quantity)}) — ${escapeHTML(shipment.destination)}`
                ).join("<br>")
                : "No packages assigned";

            marker.bindPopup(`
                <strong>Vehicle:</strong> ${escapeHTML(vehicle.vehicleId)}<br>
                <strong>Plate:</strong> ${escapeHTML(vehicle.plate)}<br>
                <strong>Driver:</strong> ${escapeHTML(vehicle.driver)}<br>
                <strong>Status:</strong> ${escapeHTML(vehicle.status)}<br>
                <strong>Packages:</strong><br>${shipmentDetails}
            `);

            markers.push(marker);
        });

        const routeGroups = vehicles.map(vehicle => ({
            vehicle,
            shipments: getVehicleShipments(vehicle.vehicleId)
        }));
        const routeResult = window.SalamenceRouteMap
            ? await window.SalamenceRouteMap.render(map, routeLayerGroup, routeGroups)
            : { routes: 0, errors: ["Route map helper did not load."], layers: [] };
        if (renderVersion !== mapRenderVersion) return;

        const visibleLayers = [...markers, ...routeResult.layers];
        if (visibleLayers.length === 1) {
            map.setView(visibleLayers[0].getLatLng(), 15);
        } else if (visibleLayers.length > 1) {
            map.fitBounds(
                L.featureGroup(visibleLayers).getBounds(),
                { padding: [30, 30], maxZoom: 15 }
            );
        }

        const routeStatus = routeResult.routes
            ? `${routeResult.routes} active road route(s) shown from truck GPS to delivery stops.`
            : "No active delivery routes can be drawn yet. Assign a truck, share its GPS, and ensure delivery addresses have map coordinates.";
        const routingWarning = routeResult.errors.length
            ? ` Some routes could not load: ${routeResult.errors.join("; ")}`
            : "";
        showMessage(
            `${markers.length} vehicle location(s) displayed. ${routeStatus}${routingWarning}`
        );

        setTimeout(function () {
            if (map) map.invalidateSize();
        }, 200);
    }

    function getVehicleShipments(vehicleId) {
        return shipments.filter(
            shipment => shipment.vehicle_id === vehicleId &&
                shipment.status !== "Delivered"
        );
    }

    async function refreshShipmentEtas(vehicle, latitude, longitude) {
        const now = Date.now();
        if (now - (lastEtaUpdatedAt.get(vehicle.id) || 0) < 5 * 60 * 1000) {
            return;
        }

        const assigned = getVehicleShipments(vehicle.vehicleId).filter(
            shipment =>
                shipment.destination_latitude != null &&
                shipment.destination_longitude != null
        );
        if (assigned.length === 0) return;

        lastEtaUpdatedAt.set(vehicle.id, now);
        let updatedCount = 0;

        for (const shipment of assigned) {
            try {
                const routeUrl =
                    "https://router.project-osrm.org/route/v1/driving/" +
                    `${longitude},${latitude};` +
                    `${shipment.destination_longitude},${shipment.destination_latitude}` +
                    "?overview=false&steps=false";
                const response = await fetch(routeUrl);
                if (!response.ok) {
                    throw new Error("Routing service returned HTTP " + response.status);
                }

                const routeData = await response.json();
                const durationSeconds = routeData.routes?.[0]?.duration;
                if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
                    throw new Error("No driving route was found.");
                }

                const estimatedDeliveryAt = new Date(
                    Date.now() + durationSeconds * 1000
                ).toISOString();
                const { error } = await window.supabaseClient
                    .from("shipments")
                    .update({ estimated_delivery_at: estimatedDeliveryAt })
                    .eq("id", shipment.id);

                if (error) throw error;
                shipment.estimated_delivery_at = estimatedDeliveryAt;
                updatedCount += 1;
            } catch (error) {
                console.error(
                    "Could not calculate delivery estimate for package:",
                    shipment.tracking_number,
                    error
                );
            }
        }

        renderFleet();
        if (updatedCount > 0) {
            showMessage(
                `GPS updated; refreshed ${updatedCount} package delivery estimate(s).`
            );
        } else {
            showMessage("GPS updated; route estimates could not be refreshed.");
        }
    }

    async function saveVehicleLocation(vehicle, position) {
        const now = Date.now();
        if (now - (lastLocationSavedAt.get(vehicle.id) || 0) < 30000) {
            return;
        }

        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        lastLocationSavedAt.set(vehicle.id, now);
        const { error } = await window.supabaseClient
            .from("vehicle_locations")
            .update({ latitude, longitude })
            .eq("id", vehicle.id);

        if (error) {
            lastLocationSavedAt.set(vehicle.id, now - 30000);
            console.error("Save live vehicle location error:", error);
            showMessage("Could not save GPS location: " + error.message);
            return;
        }

        vehicle.latitude = latitude;
        vehicle.longitude = longitude;
        renderFleet();
        await renderMap();
        await refreshShipmentEtas(vehicle, latitude, longitude);
    }

    function toggleLiveLocation(vehicle) {
        if (locationWatchIds.has(vehicle.id)) {
            navigator.geolocation.clearWatch(locationWatchIds.get(vehicle.id));
            locationWatchIds.delete(vehicle.id);
            renderFleet();
            showMessage("Live GPS sharing stopped for " + vehicle.plate + ".");
            return;
        }

        if (!navigator.geolocation) {
            showMessage("This device or browser does not support GPS location.");
            return;
        }

        if (!window.isSecureContext) {
            showMessage("Live GPS requires HTTPS or localhost. Open the app's secure HTTPS address on the driver's phone.");
            return;
        }

        showMessage("Requesting GPS permission for " + vehicle.plate + "...");
        const watchId = navigator.geolocation.watchPosition(
            position => {
                saveVehicleLocation(vehicle, position).catch(error => {
                    console.error("Live GPS update error:", error);
                    showMessage("Could not update GPS: " + error.message);
                });
            },
            error => {
                console.error("Driver GPS error:", error);
                showMessage(
                    error.code === error.PERMISSION_DENIED
                        ? "Location permission was denied. Allow location access in the browser and try again."
                        : "Could not read GPS location: " + error.message
                );
                if (locationWatchIds.has(vehicle.id)) {
                    navigator.geolocation.clearWatch(locationWatchIds.get(vehicle.id));
                    locationWatchIds.delete(vehicle.id);
                    renderFleet();
                }
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 20000
            }
        );

        locationWatchIds.set(vehicle.id, watchId);
        renderFleet();
    }

    // DISPLAY VEHICLE TABLE AND COUNTS
    function renderFleet() {
        setText("total-vehicles", vehicles.length);

        setText(
            "active-vehicles",
            vehicles.filter(v => v.status === "On Delivery").length
        );

        setText(
            "available-vehicles",
            vehicles.filter(v => v.status === "Available").length
        );

        setText(
            "maintenance-vehicles",
            vehicles.filter(v => v.status === "Maintenance").length
        );

        if (!body) return;

        body.innerHTML = "";

        if (vehicles.length === 0) {
            const row = body.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 9;
            cell.textContent = "No vehicles found.";
            return;
        }

        vehicles.forEach(vehicle => {
            const row = body.insertRow();

            const assignedShipments = getVehicleShipments(vehicle.vehicleId);
            const itemSummary = assignedShipments.length
                ? assignedShipments.map(shipment =>
                    `${shipment.package_name} (${shipment.quantity})`
                ).join(", ")
                : "No packages assigned";
            const etaSummary = assignedShipments.length
                ? assignedShipments.map(shipment =>
                    `${shipment.tracking_number}: ${formatEstimatedDelivery(shipment.estimated_delivery_at)}`
                ).join("; ")
                : "—";

            [
                vehicle.vehicleId,
                vehicle.plate,
                vehicle.driver,
                drivers.find(driver =>
                    driver.user_id === vehicle.assignedDriverId
                )?.email || "Not assigned",
                itemSummary,
                etaSummary,
                vehicle.latitude == null || vehicle.longitude == null
                    ? "Not set"
                    : `${vehicle.latitude}, ${vehicle.longitude}`,
                vehicle.status
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });

            const actions = row.insertCell();

            actions.append(
                makeButton("Edit", () => editVehicle(vehicle.id)),
                document.createTextNode(" "),
                makeButton(
                    locationWatchIds.has(vehicle.id) ? "Stop GPS" : "Share GPS",
                    () => toggleLiveLocation(vehicle)
                ),
                document.createTextNode(" "),
                makeButton(
                    "Delete",
                    () => deleteVehicle(vehicle.id),
                    true
                )
            );
        });
    }

    // CREATE BUTTON
    function makeButton(label, action, danger = false) {
        const button = document.createElement("button");
        button.textContent = label;

        if (danger) {
            button.style.backgroundColor = "#dc2626";
            button.style.color = "white";
        }

        button.addEventListener("click", action);
        return button;
    }

    function promptDriverAssignment(currentDriverId = "") {
        const currentEmail = drivers.find(
            driver => driver.user_id === currentDriverId
        )?.email || "";
        const email = prompt(
            "Driver account email (create the account in Driver Portal first; leave blank to unassign):",
            currentEmail
        );
        if (email === null) return null;
        const normalizedEmail = email.trim().toLowerCase();
        if (!normalizedEmail) return "";

        const driver = drivers.find(
            account => account.email.toLowerCase() === normalizedEmail
        );
        if (!driver) {
            alert("No driver account was found for that email. Have the driver create an account first, then reload Fleet Tracking.");
            return null;
        }
        return driver.user_id;
    }

    // ADD VEHICLE
    async function addVehicle() {
        const plate = prompt("Vehicle plate number:");
        if (!plate?.trim()) return;

        if (vehicles.some(v =>
            v.plate.toLowerCase() === plate.trim().toLowerCase()
        )) {
            alert("That plate number already exists.");
            return;
        }

        const driver = prompt("Driver name:");
        if (!driver?.trim()) return;

        const input = prompt(
            "Status: Available, On Delivery, or Maintenance",
            "Available"
        );

        if (input === null) return;

        const status = validStatus(input);

        if (!status) {
            alert("Enter Available, On Delivery, or Maintenance.");
            return;
        }

        const assignedDriverId = promptDriverAssignment();
        if (assignedDriverId === null) return;

        const { error } = await window.supabaseClient
            .from("vehicle_locations")
            .insert({
                vehicle_id: crypto.randomUUID(),
                plate_number: plate.trim(),
                driver: driver.trim(),
                assigned_driver_id: assignedDriverId || null,
                status
            });

        if (error) {
            console.error(error);
            alert("Unable to save vehicle: " + error.message);
            return;
        }

        await loadVehicles();
        showMessage("Vehicle saved successfully.");
    }

    // EDIT VEHICLE
    async function editVehicle(id) {
        const vehicle = vehicles.find(v => v.id === id);
        if (!vehicle) return;

        const plate = prompt("Vehicle plate:", vehicle.plate);
        if (!plate?.trim()) return;

        if (vehicles.some(v =>
            v.id !== id &&
            v.plate.toLowerCase() === plate.trim().toLowerCase()
        )) {
            alert("That plate number already exists.");
            return;
        }

        const driver = prompt("Driver name:", vehicle.driver);
        if (!driver?.trim()) return;

        const input = prompt(
            "Status: Available, On Delivery, or Maintenance",
            vehicle.status
        );

        if (input === null) return;

        const status = validStatus(input);

        if (!status) {
            alert("Enter Available, On Delivery, or Maintenance.");
            return;
        }

        const assignedDriverId = promptDriverAssignment(
            vehicle.assignedDriverId
        );
        if (assignedDriverId === null) return;

        const { error } = await window.supabaseClient
            .from("vehicle_locations")
            .update({
                plate_number: plate.trim(),
                driver: driver.trim(),
                assigned_driver_id: assignedDriverId || null,
                status
            })
            .eq("id", id);

        if (error) {
            alert("Unable to update vehicle: " + error.message);
            return;
        }

        await loadVehicles();
        showMessage("Vehicle updated successfully.");
    }

    // DELETE VEHICLE
    async function deleteVehicle(id) {
        const vehicle = vehicles.find(v => v.id === id);
        if (!vehicle) return;

        if (!confirm("Delete vehicle " + vehicle.plate + "?")) return;

        const { error } = await window.supabaseClient
            .from("vehicle_locations")
            .delete()
            .eq("id", id);

        if (error) {
            alert("Unable to delete vehicle: " + error.message);
            return;
        }

        await loadVehicles();
        showMessage("Vehicle deleted successfully.");
    }

    // ADD VEHICLE BUTTON TO PAGE
    function addButton() {
        if (!body) return;

        const container = body.closest(".content-card");
        if (!container) return;

        if (container.querySelector('[data-auto-button="fleet-table"]')) {
            return;
        }

        const button = document.createElement("button");
        button.textContent = "+ Add Vehicle";
        button.dataset.autoButton = "fleet-table";
        button.style.marginBottom = "15px";
        button.addEventListener("click", addVehicle);

        const tableContainer = body.closest(".table-container");

        if (tableContainer) {
            container.insertBefore(button, tableContainer);
        }
    }

    // LOGOUT
    document.getElementById("logout-button")?.addEventListener(
        "click",
        function (event) {
            event.preventDefault();

            if (confirm("Are you sure you want to log out?")) {
                sessionStorage.removeItem("isLoggedIn");
                location.replace("login.html");
            }
        }
    );

    // START
    addButton();
    await loadVehicles();

    if (window.supabaseClient) {
        realtimeChannel = window.supabaseClient
            .channel("admin-fleet-live-updates")
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "vehicle_locations" },
                scheduleLiveRefresh
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "shipments" },
                scheduleLiveRefresh
            )
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "driver_incident_reports" },
                scheduleLiveRefresh
            )
            .subscribe((status, error) => {
                if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                    console.error("Fleet live updates unavailable:", error || status);
                    showMessage("Live sync unavailable; vehicle and delivery data refresh every 30 seconds.");
                }
            });
    }

    setInterval(function () {
        if (!document.hidden) {
            loadVehicles();
        }
    }, 30000);

    window.addEventListener("beforeunload", function () {
        if (liveRefreshTimer !== null) {
            window.clearTimeout(liveRefreshTimer);
        }
        if (realtimeChannel) {
            window.supabaseClient.removeChannel(realtimeChannel);
        }
    });
});

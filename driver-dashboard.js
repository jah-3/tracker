document.addEventListener("DOMContentLoaded", async function () {
    const supabaseClient = window.supabaseClient;
    const appSection = document.getElementById("driver-app");
    const appMessage = document.getElementById("driver-status-message");
    const packageBody = document.getElementById("driver-packages");
    const logoutButton = document.getElementById("driver-logout");
    const locationButton = document.getElementById("share-driver-gps");
    const routeButton = document.getElementById("optimize-route-button");
    const routeMessage = document.getElementById("driver-route-message");
    const routeStops = document.getElementById("driver-route-stops");
    const reportForm = document.getElementById("driver-report-form");
    const reportMessage = document.getElementById("driver-report-message");
    const reportSubmitButton = document.getElementById("driver-report-submit");
    const reportVehicleSelect = document.getElementById("driver-report-vehicle");
    const reportShipmentSelect = document.getElementById("driver-report-shipment");
    const statusOptions = [
        "Preparing",
        "In Transit",
        "Out for Delivery",
        "Delivered",
        "Delayed"
    ];

    let currentUser = null;
    let assignedVehicles = [];
    let assignedShipments = [];
    let watchId = null;
    let map = null;
    let markers = [];
    let routeMap = null;
    let routeLayers = [];
    let liveRefreshTimeout = null;
    let refreshFallbackTimer = null;
    let realtimeChannel = null;
    const lastSavedAt = new Map();

    function showAppMessage(text) {
        appMessage.textContent = text;
    }

    function scheduleAssignedRefresh() {
        if (liveRefreshTimeout !== null) {
            window.clearTimeout(liveRefreshTimeout);
        }
        liveRefreshTimeout = window.setTimeout(async function () {
            liveRefreshTimeout = null;
            if (!document.hidden) await loadAssignedVehicles();
        }, 400);
    }

    function formatEta(value) {
        if (!value) return "Waiting for live GPS";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
    }

    function toLocalDateTime(value) {
        if (!value) return "Not scheduled";
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? "Not scheduled" : date.toLocaleString();
    }

    function refreshReportOptions() {
        const selectedVehicle = reportVehicleSelect.value;
        reportVehicleSelect.replaceChildren();
        assignedVehicles.forEach(vehicle => {
            const option = document.createElement("option");
            option.value = vehicle.vehicle_id;
            option.textContent = `${vehicle.plate_number} — ${vehicle.driver || "Driver"}`;
            reportVehicleSelect.appendChild(option);
        });
        if (assignedVehicles.some(vehicle => vehicle.vehicle_id === selectedVehicle)) {
            reportVehicleSelect.value = selectedVehicle;
        }
        reportVehicleSelect.disabled = assignedVehicles.length === 0;
        reportSubmitButton.disabled = assignedVehicles.length === 0;

        const selectedShipment = reportShipmentSelect.value;
        reportShipmentSelect.replaceChildren();
        const generalOption = document.createElement("option");
        generalOption.value = "";
        generalOption.textContent = "Vehicle / general report";
        reportShipmentSelect.appendChild(generalOption);
        assignedShipments.forEach(shipment => {
            const option = document.createElement("option");
            option.value = shipment.id;
            option.textContent = `${shipment.tracking_number} — ${shipment.destination}`;
            reportShipmentSelect.appendChild(option);
        });
        if (assignedShipments.some(
            shipment => String(shipment.id) === selectedShipment
        )) {
            reportShipmentSelect.value = selectedShipment;
        }
    }

    function renderMap() {
        if (!map) return;
        markers.forEach(marker => map.removeLayer(marker));
        markers = [];

        assignedVehicles.forEach(vehicle => {
            if (vehicle.latitude == null || vehicle.longitude == null) return;
            const marker = L.marker([
                Number(vehicle.latitude),
                Number(vehicle.longitude)
            ]).addTo(map);
            marker.bindPopup(
                "Vehicle " + vehicle.plate_number +
                "<br>Driver: " + (vehicle.driver || "")
            );
            markers.push(marker);
        });

        if (markers.length === 1) {
            map.setView(markers[0].getLatLng(), 15);
        } else if (markers.length > 1) {
            map.fitBounds(L.featureGroup(markers).getBounds(), {
                padding: [30, 30],
                maxZoom: 15
            });
        }
    }

    async function loadAssignedVehicles() {
        const { data, error } = await supabaseClient
            .from("vehicle_locations")
            .select("id, vehicle_id, plate_number, driver, status, latitude, longitude")
            .eq("assigned_driver_id", currentUser.id)
            .order("plate_number");
        if (error) {
            console.error("Load assigned vehicles error:", error);
            showAppMessage("Could not load your vehicle: " + error.message);
            return;
        }

        assignedVehicles = data || [];
        const details = document.getElementById("assigned-vehicle-details");
        refreshReportOptions();
        if (assignedVehicles.length === 0) {
            details.textContent = "No vehicle is assigned to your account yet. Contact your administrator.";
            locationButton.disabled = true;
            routeButton.disabled = true;
            renderMap();
            routeLayers.forEach(layer => routeMap?.removeLayer(layer));
            routeLayers = [];
            routeStops.replaceChildren();
            renderPackages([]);
            return;
        }

        details.textContent = assignedVehicles
            .map(vehicle =>
                `Plate ${vehicle.plate_number} · Driver ${vehicle.driver || "Name not set"} · ${vehicle.status}`
            )
            .join(" | ");
        locationButton.disabled = false;
        renderMap();
        await loadPackages();
    }

    async function loadPackages() {
        const vehicleIds = assignedVehicles.map(vehicle => vehicle.vehicle_id);
        if (vehicleIds.length === 0) {
            renderPackages([]);
            return;
        }

        const { data, error } = await supabaseClient
            .from("shipments")
            .select("id, tracking_number, package_name, quantity, destination, destination_latitude, destination_longitude, scheduled_delivery_at, estimated_delivery_at, delivery_proof_path, status, vehicle_id")
            .in("vehicle_id", vehicleIds)
            .order("created_at", { ascending: false });
        if (error) {
            console.error("Load driver packages error:", error);
            showAppMessage("Could not load assigned packages: " + error.message);
            return;
        }

        assignedShipments = data || [];
        refreshReportOptions();
        routeButton.disabled = !assignedVehicles.some(vehicle =>
            vehicle.latitude != null && vehicle.longitude != null
        ) || !assignedShipments.some(shipment =>
            shipment.status !== "Delivered" &&
            shipment.destination_latitude != null &&
            shipment.destination_longitude != null
        );
        renderPackages(assignedShipments);
    }

    function renderPackages(packages) {
        packageBody.replaceChildren();
        if (packages.length === 0) {
            const row = packageBody.insertRow();
            const cell = row.insertCell();
            cell.colSpan = 9;
            cell.textContent = "No packages are assigned to your vehicle.";
            return;
        }

        packages.forEach(shipment => {
            const row = packageBody.insertRow();
            [
                shipment.tracking_number,
                shipment.package_name,
                shipment.quantity,
                shipment.destination,
                toLocalDateTime(shipment.scheduled_delivery_at),
                formatEta(shipment.estimated_delivery_at)
            ].forEach(value => {
                row.insertCell().textContent = value ?? "";
            });

            const statusCell = row.insertCell();
            const statusSelect = document.createElement("select");
            statusSelect.setAttribute(
                "aria-label",
                "Status for package " + shipment.tracking_number
            );
            statusOptions.forEach(status => {
                const option = document.createElement("option");
                option.value = status;
                option.textContent = status;
                option.selected = status === shipment.status;
                statusSelect.appendChild(option);
            });
            statusCell.appendChild(statusSelect);

            const proofCell = row.insertCell();
            const proofInput = document.createElement("input");
            proofInput.type = "file";
            proofInput.accept = "image/jpeg,image/png,image/webp,image/gif,image/heic";
            proofInput.setAttribute(
                "aria-label",
                "Proof photo for delivery " + shipment.tracking_number
            );
            proofCell.appendChild(proofInput);
            if (shipment.delivery_proof_path) {
                const proofLink = document.createElement("a");
                proofLink.textContent = "Loading proof...";
                proofCell.appendChild(document.createElement("br"));
                proofCell.appendChild(proofLink);
                supabaseClient.storage
                    .from("delivery-proofs")
                    .createSignedUrl(shipment.delivery_proof_path, 300)
                    .then(({ data, error }) => {
                        if (error) {
                            console.error("Load delivery proof link error:", error);
                            proofLink.textContent = "Proof unavailable";
                            return;
                        }
                        proofLink.href = data.signedUrl;
                        proofLink.target = "_blank";
                        proofLink.rel = "noopener";
                        proofLink.textContent = "View proof";
                    });
            }

            const actionCell = row.insertCell();
            const saveButton = document.createElement("button");
            saveButton.type = "button";
            saveButton.textContent = "Update";
            saveButton.addEventListener("click", async () => {
                const nextStatus = statusSelect.value;
                const proofFile = proofInput.files[0];
                if (nextStatus === "Delivered" && !proofFile &&
                    !shipment.delivery_proof_path) {
                    showAppMessage(
                        "Select a delivery proof photo before marking " +
                        shipment.tracking_number + " as delivered."
                    );
                    return;
                }
                if (proofFile && ![
                    "image/jpeg",
                    "image/png",
                    "image/webp",
                    "image/gif",
                    "image/heic"
                ].includes(proofFile.type)) {
                    showAppMessage("Choose a JPG, PNG, WebP, GIF, or HEIC photo for delivery proof.");
                    return;
                }
                if (proofFile && nextStatus !== "Delivered") {
                    showAppMessage("Set the delivery status to Delivered to attach its proof photo.");
                    return;
                }
                if (proofFile && proofFile.size > 10 * 1024 * 1024) {
                    showAppMessage("Delivery proof photos must be 10 MB or smaller.");
                    return;
                }

                saveButton.disabled = true;
                statusSelect.disabled = true;
                proofInput.disabled = true;
                let proofPath = shipment.delivery_proof_path;
                if (proofFile) {
                    const extension = proofFile.name.split(".").pop()
                        .toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
                    proofPath = `${currentUser.id}/${shipment.id}/${crypto.randomUUID()}.${extension}`;
                    const { error: uploadError } = await supabaseClient.storage
                        .from("delivery-proofs")
                        .upload(proofPath, proofFile, {
                            contentType: proofFile.type,
                            upsert: false
                        });
                    if (uploadError) {
                        saveButton.disabled = false;
                        statusSelect.disabled = false;
                        proofInput.disabled = false;
                        showAppMessage("Could not upload delivery proof: " + uploadError.message);
                        return;
                    }
                }

                const { error } = await supabaseClient
                    .from("shipments")
                    .update({
                        status: nextStatus,
                        ...(proofFile ? { delivery_proof_path: proofPath } : {})
                    })
                    .eq("id", shipment.id);
                saveButton.disabled = false;
                statusSelect.disabled = false;
                proofInput.disabled = false;
                if (error) {
                    console.error("Update driver shipment status error:", error);
                    showAppMessage(
                        "Could not update " + shipment.tracking_number +
                        ": " + error.message
                    );
                    return;
                }
                shipment.status = nextStatus;
                shipment.delivery_proof_path = proofPath;
                showAppMessage("Updated " + shipment.tracking_number + ".");
                await loadPackages();
            });
            actionCell.appendChild(saveButton);
        });
    }

    async function saveDriverLocation(vehicle, position) {
        const now = Date.now();
        if (now - (lastSavedAt.get(vehicle.id) || 0) < 30000) return;
        lastSavedAt.set(vehicle.id, now);

        const { error } = await supabaseClient
            .from("vehicle_locations")
            .update({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude
            })
            .eq("id", vehicle.id);
        if (error) {
            lastSavedAt.set(vehicle.id, now - 30000);
            console.error("Save driver GPS error:", error);
            showAppMessage("Could not share GPS: " + error.message);
            return;
        }

        vehicle.latitude = position.coords.latitude;
        vehicle.longitude = position.coords.longitude;
        routeButton.disabled = !assignedShipments.some(shipment =>
            shipment.status !== "Delivered" &&
            shipment.destination_latitude != null &&
            shipment.destination_longitude != null
        );
        renderMap();
        showAppMessage("Live location updated at " + new Date().toLocaleTimeString() + ".");
        await updateAssignedPackageEtas(vehicle, position);
    }

    function renderOptimizedRoute(route, orderedStops, startPoint) {
        if (!routeMap || !route.geometry?.coordinates) return;
        routeLayers.forEach(layer => routeMap.removeLayer(layer));
        routeLayers = [];

        const coordinates = route.geometry.coordinates.map(
            ([longitude, latitude]) => [latitude, longitude]
        );
        const line = L.polyline(coordinates, {
            color: "#2563eb",
            weight: 5,
            opacity: 0.8
        }).addTo(routeMap);
        routeLayers.push(line);

        const startMarker = L.marker([startPoint.latitude, startPoint.longitude])
            .bindPopup("Current truck location")
            .addTo(routeMap);
        routeLayers.push(startMarker);

        orderedStops.forEach((stop, index) => {
            const marker = L.marker([
                stop.destination_latitude,
                stop.destination_longitude
            ]).bindPopup(
                `Stop ${index + 1}: ${stop.tracking_number}<br>${stop.destination}`
            ).addTo(routeMap);
            routeLayers.push(marker);
        });

        routeMap.fitBounds(line.getBounds(), { padding: [24, 24] });
        routeStops.replaceChildren();
        orderedStops.forEach((stop, index) => {
            const item = document.createElement("li");
            item.textContent =
                `${index + 1}. ${stop.tracking_number} — ${stop.destination}` +
                (stop.scheduled_delivery_at
                    ? ` · Scheduled ${toLocalDateTime(stop.scheduled_delivery_at)}`
                    : "");
            routeStops.appendChild(item);
        });
    }

    async function optimizeDeliveryRoute() {
        const vehicle = assignedVehicles.find(item =>
            item.latitude != null && item.longitude != null
        );
        if (!vehicle) {
            routeMessage.textContent =
                "Share live GPS first so the route can start from your truck's location.";
            return;
        }
        const stops = assignedShipments.filter(shipment =>
            shipment.status !== "Delivered" &&
            shipment.destination_latitude != null &&
            shipment.destination_longitude != null
        );
        if (!stops.length) {
            routeMessage.textContent =
                "There are no active deliveries with destination coordinates to route.";
            return;
        }

        routeButton.disabled = true;
        routeMessage.textContent = "Calculating the best road route for your active stops...";
        const points = [
            `${vehicle.longitude},${vehicle.latitude}`,
            ...stops.map(shipment =>
                `${shipment.destination_longitude},${shipment.destination_latitude}`
            )
        ];
        const url =
            "https://router.project-osrm.org/trip/v1/driving/" +
            points.join(";") +
            "?source=first&roundtrip=false&overview=full&geometries=geojson";
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error("Route service returned HTTP " + response.status + ".");
            }
            const result = await response.json();
            const route = result.trips?.[0];
            if (!route || !Array.isArray(result.waypoints)) {
                throw new Error("Could not create a road route for these deliveries.");
            }
            const orderedStops = result.waypoints
                .slice(1)
                .map((waypoint, index) => ({
                    shipment: stops[index],
                    waypointIndex: waypoint.waypoint_index
                }))
                .sort((left, right) => left.waypointIndex - right.waypointIndex)
                .map(item => item.shipment);
            renderOptimizedRoute(route, orderedStops, {
                latitude: Number(vehicle.latitude),
                longitude: Number(vehicle.longitude)
            });
            const distanceKm = (route.distance / 1000).toFixed(1);
            const durationMinutes = Math.round(route.duration / 60);
            routeMessage.textContent =
                `Suggested road route for ${vehicle.plate_number}: ${distanceKm} km, about ${durationMinutes} minutes without live traffic. Verify stop times and road conditions before departure.`;
        } catch (error) {
            console.error("Optimize driver delivery route error:", error);
            routeMessage.textContent = "Could not optimize route: " + error.message;
        } finally {
            routeButton.disabled = false;
        }
    }

    async function updateAssignedPackageEtas(vehicle, position) {
        const vehicleShipments = assignedShipments.filter(shipment =>
            shipment.vehicle_id === vehicle.vehicle_id &&
            shipment.status !== "Delivered"
        );

        for (const shipment of vehicleShipments) {
            if (
                shipment.destination_latitude == null ||
                shipment.destination_longitude == null
            ) {
                showAppMessage(
                    "Could not estimate " + shipment.tracking_number +
                    ": its destination has no coordinates. Ask an administrator to update the address."
                );
                continue;
            }

            try {
                const routeUrl =
                    "https://router.project-osrm.org/route/v1/driving/" +
                    `${position.coords.longitude},${position.coords.latitude};` +
                    `${shipment.destination_longitude},${shipment.destination_latitude}` +
                    "?overview=false&steps=false";
                const response = await fetch(routeUrl);
                if (!response.ok) {
                    throw new Error("Route lookup failed (HTTP " + response.status + ").");
                }
                const route = await response.json();
                const duration = route.routes?.[0]?.duration;
                if (!Number.isFinite(duration) || duration < 0) {
                    throw new Error("No driving route was found.");
                }

                const estimatedDeliveryAt =
                    new Date(Date.now() + duration * 1000).toISOString();
                const { error } = await supabaseClient
                    .from("shipments")
                    .update({ estimated_delivery_at: estimatedDeliveryAt })
                    .eq("id", shipment.id);
                if (error) throw error;

                shipment.estimated_delivery_at = estimatedDeliveryAt;
            } catch (error) {
                console.error(
                    "Update driver package ETA error for " + shipment.tracking_number + ":",
                    error
                );
                showAppMessage(
                    "Could not update ETA for " + shipment.tracking_number +
                    ": " + error.message
                );
            }
        }

        renderPackages(assignedShipments);
    }

    locationButton.addEventListener("click", function () {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
            locationButton.textContent = "Share Live GPS";
            showAppMessage("Live GPS sharing stopped.");
            return;
        }
        if (!navigator.geolocation) {
            showAppMessage("This device does not support GPS location.");
            return;
        }
        if (!window.isSecureContext) {
            showAppMessage("Live GPS requires HTTPS. Open the secure website on your phone.");
            return;
        }

        locationButton.disabled = true;
        showAppMessage("Requesting location permission...");
        watchId = navigator.geolocation.watchPosition(
            position => {
                locationButton.disabled = false;
                locationButton.textContent = "Stop GPS Sharing";
                assignedVehicles.forEach(vehicle => {
                    saveDriverLocation(vehicle, position).catch(error => {
                        console.error("Driver location update failed:", error);
                        showAppMessage("Could not update GPS: " + error.message);
                    });
                });
            },
            error => {
                console.error("Driver GPS permission/error:", error);
                watchId = null;
                locationButton.disabled = false;
                locationButton.textContent = "Share Live GPS";
                showAppMessage(
                    error.code === error.PERMISSION_DENIED
                        ? "Location access denied. Allow location permission in your browser, then try again."
                        : "Could not get your location: " + error.message
                );
            },
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        );
    });

    routeButton.addEventListener("click", optimizeDeliveryRoute);

    reportForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const vehicleId = reportVehicleSelect.value;
        const selectedShipment = assignedShipments.find(
            shipment => String(shipment.id) === reportShipmentSelect.value
        );
        const reportType = document.getElementById("driver-report-type").value;
        const details = document.getElementById("driver-report-details").value.trim();
        if (!vehicleId || !details) {
            reportMessage.textContent = "Choose your vehicle and enter report details.";
            return;
        }
        if (selectedShipment && selectedShipment.vehicle_id !== vehicleId) {
            reportMessage.textContent =
                "Choose the vehicle assigned to the selected delivery.";
            return;
        }

        reportSubmitButton.disabled = true;
        reportMessage.textContent = "Sending report to administrator...";
        const { error } = await supabaseClient
            .from("driver_incident_reports")
            .insert({
                driver_id: currentUser.id,
                vehicle_id: vehicleId,
                shipment_id: selectedShipment?.id ?? null,
                report_type: reportType,
                details
            });
        reportSubmitButton.disabled = assignedVehicles.length === 0;
        if (error) {
            console.error("Submit driver report error:", error);
            reportMessage.textContent = "Could not send report: " + error.message;
            return;
        }
        reportForm.reset();
        refreshReportOptions();
        reportMessage.textContent = "Report sent to the administrator.";
    });

    logoutButton.addEventListener("click", async function () {
        if (watchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
        if (liveRefreshTimeout !== null) {
            window.clearTimeout(liveRefreshTimeout);
            liveRefreshTimeout = null;
        }
        if (refreshFallbackTimer !== null) {
            window.clearInterval(refreshFallbackTimer);
            refreshFallbackTimer = null;
        }
        if (realtimeChannel) {
            await supabaseClient.removeChannel(realtimeChannel);
            realtimeChannel = null;
        }
        const { error } = await supabaseClient.auth.signOut();
        if (error) {
            console.error("Driver sign-out error:", error);
            showAppMessage("Could not sign out: " + error.message);
            return;
        }
        sessionStorage.removeItem("isLoggedIn");
        window.location.replace("driver.html");
    });

    if (!supabaseClient) {
        showAppMessage("Supabase is unavailable. Check supabase.js and reload.");
        return;
    }

    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        showAppMessage("Could not check your session: " + error.message);
        return;
    }
    if (!data.session) {
        window.location.replace("driver.html");
        return;
    }

    currentUser = data.session.user;
    const { data: roleData, error: roleError } = await supabaseClient
        .from("user_roles")
        .select("role")
        .eq("user_id", currentUser.id)
        .maybeSingle();
    if (roleError) {
        showAppMessage("Could not verify your account role: " + roleError.message);
        return;
    }

    if (roleData?.role !== "driver") {
        const rolePages = {
            admin: "index.html",
            supplier: "supplier-dashboard.html"
        };
        window.location.replace(rolePages[roleData?.role] || "driver.html");
        return;
    }

    sessionStorage.setItem("isLoggedIn", "true");
    appSection.hidden = false;
    logoutButton.hidden = false;
    document.getElementById("driver-account-email").textContent =
        currentUser.email || "Signed in";

    if (window.L) {
        map = L.map("driver-map").setView([12.8797, 121.7740], 6);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }).addTo(map);
        routeMap = L.map("driver-route-map").setView([12.8797, 121.7740], 6);
        L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
            maxZoom: 19
        }).addTo(routeMap);
    }

    if (map) setTimeout(() => map.invalidateSize(), 100);
    if (routeMap) setTimeout(() => routeMap.invalidateSize(), 100);
    await loadAssignedVehicles();
    realtimeChannel = supabaseClient
        .channel("driver-assignment-live-updates")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "vehicle_locations" },
            scheduleAssignedRefresh
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "shipments" },
            scheduleAssignedRefresh
        )
        .subscribe((status, subscriptionError) => {
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
                console.error(
                    "Driver live updates unavailable:",
                    subscriptionError || status
                );
                showAppMessage(
                    "Live updates are unavailable; assignments refresh every 30 seconds."
                );
            }
        });
    refreshFallbackTimer = window.setInterval(function () {
        if (!document.hidden) loadAssignedVehicles();
    }, 30000);
    window.addEventListener("beforeunload", function () {
        if (liveRefreshTimeout !== null) window.clearTimeout(liveRefreshTimeout);
        if (refreshFallbackTimer !== null) window.clearInterval(refreshFallbackTimer);
        if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    });
});

(function () {
    const renderVersions = new WeakMap();
    const routeColors = ["#2563eb", "#dc2626", "#059669", "#7c3aed", "#ea580c"];

    function isValidCoordinate(latitude, longitude) {
        return latitude != null &&
            longitude != null &&
            Number.isFinite(Number(latitude)) &&
            Number.isFinite(Number(longitude)) &&
            Number(latitude) >= -90 &&
            Number(latitude) <= 90 &&
            Number(longitude) >= -180 &&
            Number(longitude) <= 180;
    }

    async function render(map, layerGroup, routeGroups) {
        if (!map || !layerGroup) {
            return { routes: 0, errors: [], layers: [] };
        }

        const version = (renderVersions.get(layerGroup) || 0) + 1;
        renderVersions.set(layerGroup, version);
        layerGroup.clearLayers();

        const errors = [];
        const eligibleGroups = routeGroups
            .map(group => ({
                vehicle: group.vehicle,
                shipments: group.shipments.filter(shipment =>
                    shipment.status !== "Delivered" &&
                    isValidCoordinate(
                        shipment.destination_latitude,
                        shipment.destination_longitude
                    )
                )
            }))
            .filter(group =>
                isValidCoordinate(group.vehicle.latitude, group.vehicle.longitude) &&
                group.shipments.length > 0
            );

        const results = await Promise.all(eligibleGroups.map(async group => {
            const shipments = group.shipments.slice(0, 99);
            const points = [
                `${Number(group.vehicle.longitude)},${Number(group.vehicle.latitude)}`,
                ...shipments.map(shipment =>
                    `${Number(shipment.destination_longitude)},${Number(shipment.destination_latitude)}`
                )
            ];
            const url =
                "https://router.project-osrm.org/trip/v1/driving/" +
                points.join(";") +
                "?source=first&roundtrip=false&overview=full&geometries=geojson";

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    throw new Error("Routing service returned HTTP " + response.status);
                }

                const routeData = await response.json();
                const route = routeData.trips?.[0];
                if (
                    routeData.code !== "Ok" ||
                    !route?.geometry?.coordinates?.length
                ) {
                    throw new Error("No road route was returned.");
                }

                return {
                    vehicle: group.vehicle,
                    shipments,
                    route,
                    waypoints: routeData.waypoints || []
                };
            } catch (error) {
                console.error(
                    "Could not map delivery route for vehicle:",
                    group.vehicle.plate_number || group.vehicle.plate || group.vehicle.vehicle_id,
                    error
                );
                errors.push(
                    `${group.vehicle.plate_number || group.vehicle.plate || "Vehicle"}: ${error.message}`
                );
                return null;
            }
        }));

        if (renderVersions.get(layerGroup) !== version) {
            return { routes: 0, errors: [], layers: [] };
        }

        const layers = [];
        let routeCount = 0;
        results.forEach((result, groupIndex) => {
            if (!result) return;

            const color = routeColors[groupIndex % routeColors.length];
            const coordinates = result.route.geometry.coordinates.map(
                ([longitude, latitude]) => [latitude, longitude]
            );
            const line = L.polyline(coordinates, {
                color,
                weight: 5,
                opacity: 0.82
            }).addTo(layerGroup);

            const routePopup = document.createElement("div");
            routePopup.textContent =
                `${result.vehicle.plate_number || result.vehicle.plate || "Vehicle"} road route`;
            line.bindPopup(routePopup);
            layers.push(line);

            result.shipments.forEach((shipment, shipmentIndex) => {
                const waypoint = result.waypoints[shipmentIndex + 1];
                const stopNumber = Number.isInteger(waypoint?.waypoint_index)
                    ? waypoint.waypoint_index
                    : shipmentIndex + 1;
                const stop = L.circleMarker([
                    Number(shipment.destination_latitude),
                    Number(shipment.destination_longitude)
                ], {
                    radius: 7,
                    color,
                    weight: 2,
                    fillColor: "#ffffff",
                    fillOpacity: 1
                }).addTo(layerGroup);

                const popup = document.createElement("div");
                const title = document.createElement("strong");
                title.textContent = `Stop ${stopNumber}: ${shipment.tracking_number}`;
                const address = document.createElement("div");
                address.textContent = shipment.destination || "";
                popup.append(title, address);
                stop.bindPopup(popup);
                layers.push(stop);
            });

            routeCount += 1;
        });

        return { routes: routeCount, errors, layers };
    }

    window.SalamenceRouteMap = { render };
})();

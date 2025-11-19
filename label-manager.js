/**
 * Force-directed label positioning to prevent overlaps
 * Labels repel each other and are connected to their vertices with lines
 */

import L from 'leaflet';

export class LabelManager {
    constructor(map) {
        this.map = map;
        this.labels = []; // { vertexLatLng, labelLatLng, text, polygonId, vertexIndex }
        this.labelMarkers = new Map(); // key -> marker
        this.leaderLines = new Map(); // key -> { outline, line } polyline pair
        this.isSimulating = false;
        this.simulationInterval = null;
    }

    /**
     * Set labels for a polygon
     */
    setLabels(polygonId, vertices) {
        // Remove existing labels for this polygon
        this.removeLabels(polygonId);

        if (!vertices || vertices.length === 0) {
            return;
        }

        // Get current map bounds
        const bounds = this.map.getBounds();

        // Calculate pixels to degrees
        const zoom = this.map.getZoom();
        const centerLat = bounds.getCenter().lat;
        const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
        const pixelsToDegrees = (pixels) => (metersPerPixel * pixels) / 111320;

        // Minimum distance between vertices to show separate labels (30px)
        const minVertexDistance = pixelsToDegrees(30);

        // Start labels at preferred anchor position (right side)
        const initialOffset = pixelsToDegrees(15);

        // Track which vertices we've already labeled
        const labeledVertices = [];

        // Add labels for visible vertices
        vertices.forEach((vertex, index) => {
            const vertexLatLng = L.latLng(vertex.lat, vertex.lon);

            // Only add label if vertex is in current view
            if (!bounds.contains(vertexLatLng)) {
                return;
            }

            // Check if this vertex is too close to an already labeled vertex
            const tooClose = labeledVertices.some(labeled => {
                const dist = Math.sqrt(
                    Math.pow(vertex.lat - labeled.lat, 2) +
                    Math.pow(vertex.lon - labeled.lon, 2)
                );
                return dist < minVertexDistance;
            });

            // Skip this vertex if it's too close to another labeled vertex
            if (tooClose) {
                return;
            }

            // Mark this vertex as labeled
            labeledVertices.push({ lat: vertex.lat, lon: vertex.lon });

            const key = `${polygonId}-${index}`;
            const text = `${vertex.lat.toFixed(6)}, ${vertex.lon.toFixed(6)}`;
            const labelWidth = this.estimateLabelWidth(text);

            // Initial position: slightly to the right of vertex
            const labelLat = vertex.lat;
            const labelLon = vertex.lon + initialOffset;

            this.labels.push({
                key,
                polygonId,
                vertexIndex: index,
                vertexLatLng: vertexLatLng,
                labelLatLng: L.latLng(labelLat, labelLon),
                text,
                width: labelWidth,
                height: 30
            });
        });

        // Render initial positions
        this.renderLabels();

        // Run simulation to adjust positions and avoid collisions
        this.startSimulation();
    }

    /**
     * Remove labels for a polygon
     */
    removeLabels(polygonId) {
        // Remove from labels array
        this.labels = this.labels.filter(label => {
            if (label.polygonId === polygonId) {
                this.removeLabelMarker(label.key);
                return false;
            }
            return true;
        });

        if (this.labels.length === 0) {
            this.stopSimulation();
        }
    }

    /**
     * Clear all labels
     */
    clear() {
        this.labels = [];
        this.labelMarkers.forEach((marker, key) => {
            this.removeLabelMarker(key);
        });
        this.stopSimulation();
    }

    /**
     * Remove a label marker and its leader line
     */
    removeLabelMarker(key) {
        const marker = this.labelMarkers.get(key);
        if (marker) {
            this.map.removeLayer(marker);
            this.labelMarkers.delete(key);
        }

        const lines = this.leaderLines.get(key);
        if (lines) {
            if (lines.outline) this.map.removeLayer(lines.outline);
            if (lines.line) this.map.removeLayer(lines.line);
            this.leaderLines.delete(key);
        }
    }

    /**
     * Start force-directed simulation
     */
    startSimulation() {
        if (this.isSimulating) {
            return;
        }

        this.isSimulating = true;

        // Run simulation synchronously without animation
        const maxIterations = 200;
        for (let i = 0; i < maxIterations; i++) {
            this.simulateStep();
        }

        // Render final positions
        this.renderLabels();
        this.isSimulating = false;
    }

    /**
     * Stop simulation
     */
    stopSimulation() {
        if (this.simulationInterval) {
            clearInterval(this.simulationInterval);
            this.simulationInterval = null;
        }
        this.isSimulating = false;
    }

    /**
     * Simulate one step of force-directed positioning
     */
    simulateStep() {
        const forces = this.labels.map(() => ({ lat: 0, lon: 0 }));

        // Calculate pixels to degrees conversion at current zoom
        const zoom = this.map.getZoom();
        const metersPerPixel = 156543.03392 * Math.cos(0) / Math.pow(2, zoom);
        const pixelsToDegrees = (pixels) => (metersPerPixel * pixels) / 111320;

        // Apply repulsion forces between labels using AABB collision detection
        for (let i = 0; i < this.labels.length; i++) {
            for (let j = i + 1; j < this.labels.length; j++) {
                const label1 = this.labels[i];
                const label2 = this.labels[j];

                // Convert label dimensions to degrees
                const w1 = pixelsToDegrees(label1.width) / 2;
                const h1 = pixelsToDegrees(label1.height) / 2;
                const w2 = pixelsToDegrees(label2.width) / 2;
                const h2 = pixelsToDegrees(label2.height) / 2;
                const buffer = pixelsToDegrees(5); // 5px buffer

                // Calculate bounding boxes (AABB - Axis-Aligned Bounding Box)
                const box1 = {
                    left: label1.labelLatLng.lng - w1 - buffer,
                    right: label1.labelLatLng.lng + w1 + buffer,
                    bottom: label1.labelLatLng.lat - h1 - buffer,
                    top: label1.labelLatLng.lat + h1 + buffer
                };

                const box2 = {
                    left: label2.labelLatLng.lng - w2 - buffer,
                    right: label2.labelLatLng.lng + w2 + buffer,
                    bottom: label2.labelLatLng.lat - h2 - buffer,
                    top: label2.labelLatLng.lat + h2 + buffer
                };

                // Check for AABB collision
                const overlapping = !(box1.right < box2.left ||
                                     box1.left > box2.right ||
                                     box1.top < box2.bottom ||
                                     box1.bottom > box2.top);

                if (overlapping) {
                    // Calculate overlap amount in each direction
                    const dx = label2.labelLatLng.lng - label1.labelLatLng.lng;
                    const dy = label2.labelLatLng.lat - label1.labelLatLng.lat;

                    const overlapX = (w1 + w2 + buffer * 2) - Math.abs(dx);
                    const overlapY = (h1 + h2 + buffer * 2) - Math.abs(dy);

                    // Push apart along the axis with less overlap (shortest separation)
                    let fx = 0, fy = 0;
                    if (overlapX < overlapY) {
                        // Separate horizontally
                        fx = (dx > 0 ? overlapX : -overlapX) * 0.5;
                    } else {
                        // Separate vertically
                        fy = (dy > 0 ? overlapY : -overlapY) * 0.5;
                    }

                    forces[i].lon -= fx;
                    forces[i].lat -= fy;
                    forces[j].lon += fx;
                    forces[j].lat += fy;
                }
            }

            // Elastic spring force towards vertex (weak to allow stretching)
            const label = this.labels[i];
            const dx = label.vertexLatLng.lng - label.labelLatLng.lng;
            const dy = label.vertexLatLng.lat - label.labelLatLng.lat;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 0.00001) {
                // Weak spring - labels can stretch far when avoiding collisions
                const springStrength = 0.1;
                forces[i].lon += dx * springStrength;
                forces[i].lat += dy * springStrength;
            }
        }

        // Check for leader line intersections with labels
        for (let i = 0; i < this.labels.length; i++) {
            for (let j = 0; j < this.labels.length; j++) {
                if (i === j) continue;

                const label = this.labels[i];
                const otherLabel = this.labels[j];

                // Check if other label's leader line intersects with this label's bounding box
                const w = pixelsToDegrees(label.width) / 2;
                const h = pixelsToDegrees(label.height) / 2;
                const buffer = pixelsToDegrees(2); // Small buffer

                const labelBox = {
                    left: label.labelLatLng.lng - w - buffer,
                    right: label.labelLatLng.lng + w + buffer,
                    bottom: label.labelLatLng.lat - h - buffer,
                    top: label.labelLatLng.lat + h + buffer
                };

                // Check if the other label's leader line intersects this label's box
                if (this.lineIntersectsBox(
                    otherLabel.vertexLatLng.lat, otherLabel.vertexLatLng.lng,
                    otherLabel.labelLatLng.lat, otherLabel.labelLatLng.lng,
                    labelBox
                ) && i !== j) {
                    // Push label away from the leader line
                    const lineMidLat = (otherLabel.vertexLatLng.lat + otherLabel.labelLatLng.lat) / 2;
                    const lineMidLng = (otherLabel.vertexLatLng.lng + otherLabel.labelLatLng.lng) / 2;

                    const pushDx = label.labelLatLng.lng - lineMidLng;
                    const pushDy = label.labelLatLng.lat - lineMidLat;
                    const pushDist = Math.sqrt(pushDx * pushDx + pushDy * pushDy);

                    if (pushDist > 0.00001) {
                        const pushStrength = pixelsToDegrees(3);
                        forces[i].lon += (pushDx / pushDist) * pushStrength;
                        forces[i].lat += (pushDy / pushDist) * pushStrength;
                    }
                }
            }
        }

        // Apply forces with damping and clamp to map bounds
        const damping = 0.6;
        const bounds = this.map.getBounds();

        this.labels.forEach((label, i) => {
            // Apply force
            let newLat = label.labelLatLng.lat + forces[i].lat * damping;
            let newLng = label.labelLatLng.lng + forces[i].lon * damping;

            // Clamp label to stay within map bounds with padding
            const padding = pixelsToDegrees(label.width / 2 + 10); // Half label width + 10px padding
            const paddingHeight = pixelsToDegrees(label.height / 2 + 10);

            newLat = Math.max(bounds.getSouth() + paddingHeight, Math.min(bounds.getNorth() - paddingHeight, newLat));
            newLng = Math.max(bounds.getWest() + padding, Math.min(bounds.getEast() - padding, newLng));

            label.labelLatLng = L.latLng(newLat, newLng);
        });
    }

    /**
     * Render labels and leader lines on the map
     */
    renderLabels() {
        this.labels.forEach(label => {
            const key = label.key;

            // Create or update leader lines (white outline + black line)
            let lines = this.leaderLines.get(key);
            const lineCoords = [
                [label.vertexLatLng.lat, label.vertexLatLng.lng],
                [label.labelLatLng.lat, label.labelLatLng.lng]
            ];

            if (!lines) {
                // Create white outline (thicker, below)
                const outline = L.polyline(lineCoords, {
                    color: '#ffffff',
                    weight: 3,
                    opacity: 1,
                    interactive: false
                }).addTo(this.map);

                // Create black line (thinner, above)
                const line = L.polyline(lineCoords, {
                    color: '#000000',
                    weight: 1.5,
                    opacity: 1,
                    interactive: false
                }).addTo(this.map);

                this.leaderLines.set(key, { outline, line });
            } else {
                lines.outline.setLatLngs(lineCoords);
                lines.line.setLatLngs(lineCoords);
            }

            // Create or update label marker
            let marker = this.labelMarkers.get(key);

            if (!marker) {
                marker = L.marker([label.labelLatLng.lat, label.labelLatLng.lng], {
                    icon: L.divIcon({
                        className: 'vertex-label',
                        html: `<div class="label-content">${label.text}</div>`,
                        iconSize: null,
                        iconAnchor: [0, 0]
                    }),
                    interactive: false
                }).addTo(this.map);
                this.labelMarkers.set(key, marker);
            } else {
                marker.setLatLng([label.labelLatLng.lat, label.labelLatLng.lng]);
            }
        });
    }

    /**
     * Estimate label width in pixels (approximate)
     */
    estimateLabelWidth(text) {
        // Approximate: 7 pixels per character for small monospace font
        return text.length * 7 + 16; // 16px padding
    }

    /**
     * Check if a line segment intersects with a bounding box
     * Using Liang-Barsky algorithm
     */
    lineIntersectsBox(y1, x1, y2, x2, box) {
        // Line from (x1, y1) to (x2, y2)
        // Box with left, right, bottom, top

        const dx = x2 - x1;
        const dy = y2 - y1;

        // Check if line is completely outside the box (quick reject)
        if ((x1 < box.left && x2 < box.left) ||
            (x1 > box.right && x2 > box.right) ||
            (y1 < box.bottom && y2 < box.bottom) ||
            (y1 > box.top && y2 > box.top)) {
            return false;
        }

        // Check if either endpoint is inside the box
        if ((x1 >= box.left && x1 <= box.right && y1 >= box.bottom && y1 <= box.top) ||
            (x2 >= box.left && x2 <= box.right && y2 >= box.bottom && y2 <= box.top)) {
            return true;
        }

        // Check intersection with each edge of the box
        let t0 = 0, t1 = 1;

        // Left edge
        if (dx !== 0) {
            const t = (box.left - x1) / dx;
            if (dx < 0) {
                if (t < t1) t1 = t;
            } else {
                if (t > t0) t0 = t;
            }
        } else if (x1 < box.left || x1 > box.right) {
            return false;
        }

        // Right edge
        if (dx !== 0) {
            const t = (box.right - x1) / dx;
            if (dx < 0) {
                if (t > t0) t0 = t;
            } else {
                if (t < t1) t1 = t;
            }
        }

        // Bottom edge
        if (dy !== 0) {
            const t = (box.bottom - y1) / dy;
            if (dy < 0) {
                if (t < t1) t1 = t;
            } else {
                if (t > t0) t0 = t;
            }
        } else if (y1 < box.bottom || y1 > box.top) {
            return false;
        }

        // Top edge
        if (dy !== 0) {
            const t = (box.top - y1) / dy;
            if (dy < 0) {
                if (t > t0) t0 = t;
            } else {
                if (t < t1) t1 = t;
            }
        }

        return t0 <= t1;
    }

    /**
     * Trigger re-simulation when map is zoomed/panned
     * This needs to be called by the map manager with polygon data
     */
    refreshLabels() {
        // This method is kept for compatibility
        // The map manager will call updateAllLabels instead
    }

    /**
     * Update all labels for all polygons (called by map manager)
     */
    updateAllLabels(polygons) {
        // Clear all existing labels
        this.labels = [];
        this.labelMarkers.forEach((marker, key) => {
            this.removeLabelMarker(key);
        });

        // Get current map bounds
        const bounds = this.map.getBounds();

        // Calculate pixels to degrees
        const zoom = this.map.getZoom();
        const centerLat = bounds.getCenter().lat;
        const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
        const pixelsToDegrees = (pixels) => (metersPerPixel * pixels) / 111320;

        // Minimum distance between vertices to show separate labels (30px)
        const minVertexDistance = pixelsToDegrees(30);

        // Start labels at preferred anchor position (right side)
        const initialOffset = pixelsToDegrees(15);

        // Track which vertices we've already labeled (across all polygons)
        const labeledVertices = [];

        // Process each polygon
        polygons.forEach(polygon => {
            if (!polygon.hull || polygon.hull.length === 0) {
                return;
            }

            polygon.hull.forEach((vertex, index) => {
                const vertexLatLng = L.latLng(vertex.lat, vertex.lon);

                // Only add label if vertex is in current view
                if (!bounds.contains(vertexLatLng)) {
                    return;
                }

                // Check if this vertex is too close to an already labeled vertex
                const tooClose = labeledVertices.some(labeled => {
                    const dist = Math.sqrt(
                        Math.pow(vertex.lat - labeled.lat, 2) +
                        Math.pow(vertex.lon - labeled.lon, 2)
                    );
                    return dist < minVertexDistance;
                });

                // Skip this vertex if it's too close to another labeled vertex
                if (tooClose) {
                    return;
                }

                // Mark this vertex as labeled
                labeledVertices.push({ lat: vertex.lat, lon: vertex.lon });

                const key = `${polygon.id}-${index}`;
                const text = `${vertex.lat.toFixed(6)}, ${vertex.lon.toFixed(6)}`;
                const labelWidth = this.estimateLabelWidth(text);

                // Initial position: slightly to the right of vertex
                const labelLat = vertex.lat;
                const labelLon = vertex.lon + initialOffset;

                this.labels.push({
                    key,
                    polygonId: polygon.id,
                    vertexIndex: index,
                    vertexLatLng: vertexLatLng,
                    labelLatLng: L.latLng(labelLat, labelLon),
                    text,
                    width: labelWidth,
                    height: 30
                });
            });
        });

        // Render all labels
        if (this.labels.length > 0) {
            this.renderLabels();
            this.startSimulation();
        }
    }
}

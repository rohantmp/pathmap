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
        this.polygonNameMarkers = new Map(); // polygonId -> marker for polygon name
        this.debugLayers = []; // Array to hold debug visualization layers
        this.showDebugFields = false; // Toggle for debug visualization
        this.isSimulating = false;
        this.simulationInterval = null;
        this.manuallyPositioned = new Set(); // Track labels that have been manually dragged

        // Tunable settings
        this.settings = {
            initialOffset: 15,        // px - initial distance from vertex
            minVertexDistance: 30,    // px - min distance between vertices to show separate labels
            springStrength: 0.1,      // strength of elastic pull toward vertex
            minLabelSpacing: 40,      // px - minimum spacing between labels
            iterations: 200,          // number of simulation iterations
            damping: 0.6,             // velocity damping factor
            maxLabelDistance: 80,     // px - maximum distance a label can be from its vertex
            minVertexAngle: 10,       // degrees - minimum angle at vertex to show label (filters out shallow angles)
            // Equalizer settings for repulsion curves
            eqVertex: 20,             // vertex repulsion strength
            eqLabel: 30,              // label-to-label repulsion strength
            eqCenter: 100,            // center repulsion strength
            eqFalloff: 3              // falloff exponent (higher = faster dropoff)
        };
    }

    /**
     * Update label settings
     */
    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    /**
     * Toggle debug field visualization
     */
    toggleDebugFields(show) {
        this.showDebugFields = show;
        if (show) {
            this.renderDebugFields();
        } else {
            this.clearDebugFields();
        }
    }

    /**
     * Clear debug visualization layers
     */
    clearDebugFields() {
        this.debugLayers.forEach(layer => {
            this.map.removeLayer(layer);
        });
        this.debugLayers = [];
    }

    /**
     * Render debug visualization of repulsion fields
     */
    renderDebugFields() {
        this.clearDebugFields();

        if (!this.showDebugFields) return;

        const zoom = this.map.getZoom();
        const metersPerPixel = 156543.03392 * Math.cos(0) / Math.pow(2, zoom);
        const pixelsToDegrees = (pixels) => (metersPerPixel * pixels) / 111320;

        // Collect all vertices
        const allVertices = [];
        this.labels.forEach(label => {
            if (label.polygonVertices) {
                label.polygonVertices.forEach(v => {
                    allVertices.push({ lat: v.lat, lon: v.lon });
                });
            }
        });

        // Draw vertex repulsion fields (15px radius, cubic falloff)
        const vertexRepulsionRadius = pixelsToDegrees(15);
        allVertices.forEach(vertex => {
            const circle = L.circle([vertex.lat, vertex.lon], {
                radius: 15 * metersPerPixel, // Convert to meters
                color: '#ff0000',
                fillColor: '#ff0000',
                fillOpacity: 0.15,
                weight: 1,
                opacity: 0.5,
                interactive: false
            }).addTo(this.map);
            this.debugLayers.push(circle);
        });

        // Draw label bounding boxes and close-range repulsion zones
        this.labels.forEach(label => {
            const w = pixelsToDegrees(label.width) / 2;
            const h = pixelsToDegrees(label.height) / 2;
            const buffer = pixelsToDegrees(5);

            // Label bounding box (AABB collision zone)
            const bounds = [
                [label.labelLatLng.lat - h - buffer, label.labelLatLng.lng - w - buffer],
                [label.labelLatLng.lat + h + buffer, label.labelLatLng.lng + w + buffer]
            ];
            const rect = L.rectangle(bounds, {
                color: '#0088ff',
                fillColor: '#0088ff',
                fillOpacity: 0.1,
                weight: 1,
                opacity: 0.5,
                interactive: false
            }).addTo(this.map);
            this.debugLayers.push(rect);

            // Close-range extreme repulsion zone (5px)
            const closeRange = L.circle([label.labelLatLng.lat, label.labelLatLng.lng], {
                radius: 5 * metersPerPixel,
                color: '#ff00ff',
                fillColor: '#ff00ff',
                fillOpacity: 0.2,
                weight: 1,
                opacity: 0.6,
                interactive: false
            }).addTo(this.map);
            this.debugLayers.push(closeRange);
        });

        // Draw polygon center repulsion (inverse-square, shown as gradient circle)
        const polygonCenters = new Map();
        this.labels.forEach(label => {
            if (label.polygonVertices && label.polygonVertices.length > 0) {
                const key = label.polygonId;
                if (!polygonCenters.has(key)) {
                    const centerLat = label.polygonVertices.reduce((sum, v) => sum + v.lat, 0) / label.polygonVertices.length;
                    const centerLon = label.polygonVertices.reduce((sum, v) => sum + v.lon, 0) / label.polygonVertices.length;
                    polygonCenters.set(key, { lat: centerLat, lon: centerLon });
                }
            }
        });

        polygonCenters.forEach(center => {
            // Outer influence zone
            const outerCircle = L.circle([center.lat, center.lon], {
                radius: 100 * metersPerPixel,
                color: '#00ff00',
                fillColor: '#00ff00',
                fillOpacity: 0.05,
                weight: 1,
                opacity: 0.3,
                interactive: false
            }).addTo(this.map);
            this.debugLayers.push(outerCircle);

            // Center point
            const centerDot = L.circleMarker([center.lat, center.lon], {
                radius: 4,
                color: '#00ff00',
                fillColor: '#00ff00',
                fillOpacity: 1,
                weight: 0,
                interactive: false
            }).addTo(this.map);
            this.debugLayers.push(centerDot);
        });
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

        // Minimum distance between vertices to show separate labels
        const minVertexDistance = pixelsToDegrees(this.settings.minVertexDistance);

        // Start labels at preferred anchor position (outside polygon)
        const initialOffset = pixelsToDegrees(this.settings.initialOffset);

        // Calculate polygon center
        const visibleVertices = vertices.filter(v => bounds.contains(L.latLng(v.lat, v.lon)));
        if (visibleVertices.length === 0) return;

        const polyCenterLat = visibleVertices.reduce((sum, v) => sum + v.lat, 0) / visibleVertices.length;
        const polyCenterLon = visibleVertices.reduce((sum, v) => sum + v.lon, 0) / visibleVertices.length;

        // Track which vertices we've already labeled
        const labeledVertices = [];

        // Store polygon vertices for inside/outside test
        const polygonVertices = vertices;

        // First pass: calculate angles and find groups of close vertices
        const vertexData = vertices.map((vertex, index) => ({
            vertex,
            index,
            angle: this.calculateVertexAngle(vertices, index),
            inBounds: bounds.contains(L.latLng(vertex.lat, vertex.lon))
        }));

        // Add labels for visible vertices, preferring sharpest angles in groups
        vertexData.forEach(({ vertex, index, angle, inBounds }) => {
            const vertexLatLng = L.latLng(vertex.lat, vertex.lon);

            // Only add label if vertex is in current view
            if (!inBounds) {
                return;
            }

            // Check vertex angle - skip if too shallow
            if (angle > 180 - this.settings.minVertexAngle) {
                // Angle is too shallow (close to 180 degrees = straight line)
                return;
            }

            // Check if this vertex is too close to an already labeled vertex
            const closeLabeled = labeledVertices.find(labeled => {
                const dist = Math.sqrt(
                    Math.pow(vertex.lat - labeled.lat, 2) +
                    Math.pow(vertex.lon - labeled.lon, 2)
                );
                return dist < minVertexDistance;
            });

            if (closeLabeled) {
                // This vertex is close to an already labeled one
                // Only replace if this vertex has a sharper angle
                if (angle < closeLabeled.angle) {
                    // Remove the old labeled vertex and use this sharper one
                    const oldIndex = labeledVertices.indexOf(closeLabeled);
                    labeledVertices.splice(oldIndex, 1);
                    // Also remove the old label from the array
                    const oldLabelIndex = this.labels.findIndex(l =>
                        l.polygonId === polygonId &&
                        Math.abs(l.vertexLatLng.lat - closeLabeled.lat) < 0.000001 &&
                        Math.abs(l.vertexLatLng.lng - closeLabeled.lon) < 0.000001
                    );
                    if (oldLabelIndex !== -1) {
                        this.labels.splice(oldLabelIndex, 1);
                    }
                } else {
                    // Existing label has sharper or equal angle, skip this one
                    return;
                }
            }

            // Mark this vertex as labeled with its angle for comparison
            labeledVertices.push({ lat: vertex.lat, lon: vertex.lon, angle });

            const key = `${polygonId}-${index}`;
            const text = `${vertex.lat.toFixed(6)}, ${vertex.lon.toFixed(6)}`;
            const labelWidth = this.estimateLabelWidth(text);

            // Alternate up and down for visual jitter (every other vertex)
            const isAlternate = index % 2 === 1;
            const verticalOffset = pixelsToDegrees(isAlternate ? -45 : 45); // Alternate up/down by label height + padding (45px)

            // Calculate direction away from polygon center
            const dx = vertex.lon - polyCenterLon;
            const dy = vertex.lat - polyCenterLat;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Position label outward from polygon center with vertical jitter
            let labelLat, labelLon;
            if (dist > 0.00001) {
                // Push label away from center
                labelLat = vertex.lat + (dy / dist) * initialOffset + verticalOffset;
                labelLon = vertex.lon + (dx / dist) * initialOffset;
            } else {
                // Default to right if vertex is at center
                labelLat = vertex.lat + verticalOffset;
                labelLon = vertex.lon + initialOffset;
            }

            this.labels.push({
                key,
                polygonId,
                vertexIndex: index,
                vertexLatLng: vertexLatLng,
                labelLatLng: L.latLng(labelLat, labelLon),
                text,
                width: labelWidth,
                height: 30,
                polygonVertices: polygonVertices  // Store for inside/outside check
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
        // Clear polygon name markers
        this.polygonNameMarkers.forEach((marker, id) => {
            this.map.removeLayer(marker);
        });
        this.polygonNameMarkers.clear();
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
    startSimulation(polygonsForNames = null) {
        if (this.isSimulating) {
            return;
        }

        this.isSimulating = true;
        let iterationCount = 0;

        // Run simulation with animation
        const animate = () => {
            if (iterationCount < this.settings.iterations) {
                // Run a few steps per frame for smoother animation
                const stepsPerFrame = 5;
                for (let i = 0; i < stepsPerFrame && iterationCount < this.settings.iterations; i++) {
                    this.simulateStep();
                    iterationCount++;
                }

                // Render current positions
                this.renderLabels();

                // Continue animation
                requestAnimationFrame(animate);
            } else {
                // Simulation complete
                this.isSimulating = false;
                this.renderLabels();

                // Update polygon names at the end of simulation
                if (polygonsForNames) {
                    this.renderPolygonNames(polygonsForNames);
                }

                // Update debug fields at end of simulation
                if (this.showDebugFields) {
                    this.renderDebugFields();
                }
            }
        };

        // Start animation
        requestAnimationFrame(animate);
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

        // Collect all vertices from all polygons
        const allVertices = [];
        this.labels.forEach(label => {
            if (label.polygonVertices) {
                label.polygonVertices.forEach(v => {
                    allVertices.push({ lat: v.lat, lon: v.lon });
                });
            }
        });

        // Apply repulsion from all vertices to all labels (for padding)
        // This includes vertices from other polygons too
        const falloffExp = this.settings.eqFalloff;

        this.labels.forEach((label, i) => {
            allVertices.forEach(vertex => {
                const dx = label.labelLatLng.lng - vertex.lon;
                const dy = label.labelLatLng.lat - vertex.lat;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Check if this is the label's own vertex (skip the attached vertex only)
                const isOwnVertex = Math.abs(label.vertexLatLng.lat - vertex.lat) < 0.000001 &&
                                   Math.abs(label.vertexLatLng.lng - vertex.lon) < 0.000001;

                if (isOwnVertex) {
                    // Skip repulsion from the label's own attached vertex
                    return;
                }

                // Very short-range repulsion with configurable falloff
                const minDist = pixelsToDegrees(15); // Start repelling at 15px
                if (dist < minDist && dist > 0.00001) {
                    // Repulsion with configurable falloff exponent
                    const repulsionStrength = pixelsToDegrees(this.settings.eqVertex);
                    const forceMagnitude = repulsionStrength / Math.pow(dist, falloffExp);

                    forces[i].lon += (dx / dist) * forceMagnitude;
                    forces[i].lat += (dy / dist) * forceMagnitude;
                }
            });
        });

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
                    // Calculate distance between centers
                    const dx = label2.labelLatLng.lng - label1.labelLatLng.lng;
                    const dy = label2.labelLatLng.lat - label1.labelLatLng.lat;
                    const centerDist = Math.sqrt(dx * dx + dy * dy);

                    const overlapX = (w1 + w2 + buffer * 2) - Math.abs(dx);
                    const overlapY = (h1 + h2 + buffer * 2) - Math.abs(dy);

                    // Strong repulsion proportional to overlap - must separate completely
                    let fx = 0, fy = 0;

                    // Push apart along BOTH axes proportional to overlap
                    const forceMultiplier = this.settings.eqLabel / 30; // Normalize to default

                    if (Math.abs(dx) > 0.00001) {
                        fx = (dx > 0 ? 1 : -1) * overlapX * 0.5 * forceMultiplier;
                    } else {
                        fx = overlapX * 0.5 * forceMultiplier;
                    }

                    if (Math.abs(dy) > 0.00001) {
                        fy = (dy > 0 ? 1 : -1) * overlapY * 0.5 * forceMultiplier;
                    } else {
                        fy = overlapY * 0.5 * forceMultiplier;
                    }

                    // Add additional repulsion for deeply overlapping labels
                    if (centerDist > 0.00001) {
                        const combinedSize = (w1 + w2 + h1 + h2) / 4;
                        // Always apply some radial repulsion when overlapping
                        const penetrationForce = pixelsToDegrees(this.settings.eqLabel) / (centerDist + pixelsToDegrees(2));
                        fx += (dx / centerDist) * penetrationForce;
                        fy += (dy / centerDist) * penetrationForce;
                    } else {
                        // Centers exactly on top of each other - push apart strongly
                        fx += pixelsToDegrees(10);
                        fy += pixelsToDegrees(10);
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
                // Elastic spring - labels can stretch when avoiding collisions
                forces[i].lon += dx * this.settings.springStrength;
                forces[i].lat += dy * this.settings.springStrength;
            }

            // Repulsion from polygon center to push labels outward (configurable falloff)
            if (label.polygonVertices && label.polygonVertices.length > 0) {
                // Calculate polygon center
                const centerLat = label.polygonVertices.reduce((sum, v) => sum + v.lat, 0) / label.polygonVertices.length;
                const centerLon = label.polygonVertices.reduce((sum, v) => sum + v.lon, 0) / label.polygonVertices.length;

                const centerDx = label.labelLatLng.lng - centerLon;
                const centerDy = label.labelLatLng.lat - centerLat;
                const centerDist = Math.sqrt(centerDx * centerDx + centerDy * centerDy);

                if (centerDist > 0.00001) {
                    // Configurable falloff: force = strength / distance^falloff
                    const repulsionStrength = pixelsToDegrees(this.settings.eqCenter);
                    const forceMagnitude = repulsionStrength / Math.pow(centerDist, falloffExp - 1);

                    // Apply force in direction away from center
                    forces[i].lon += (centerDx / centerDist) * forceMagnitude;
                    forces[i].lat += (centerDy / centerDist) * forceMagnitude;
                }
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
        const bounds = this.map.getBounds();

        this.labels.forEach((label, i) => {
            // Skip manually positioned labels - don't apply physics to them
            if (label.manuallyPositioned) {
                return;
            }

            // Apply force
            let newLat = label.labelLatLng.lat + forces[i].lat * this.settings.damping;
            let newLng = label.labelLatLng.lng + forces[i].lon * this.settings.damping;

            // Constrain to maximum distance from vertex
            const maxDist = pixelsToDegrees(this.settings.maxLabelDistance);
            const vertexDx = newLng - label.vertexLatLng.lng;
            const vertexDy = newLat - label.vertexLatLng.lat;
            const vertexDist = Math.sqrt(vertexDx * vertexDx + vertexDy * vertexDy);

            if (vertexDist > maxDist) {
                // Clamp to max distance from vertex
                const scale = maxDist / vertexDist;
                newLng = label.vertexLatLng.lng + vertexDx * scale;
                newLat = label.vertexLatLng.lat + vertexDy * scale;
            }

            // Clamp label to stay within map bounds with padding
            const padding = pixelsToDegrees(label.width / 2 + 10); // Half label width + 10px padding
            const paddingHeight = pixelsToDegrees(label.height / 2 + 10);

            newLat = Math.max(bounds.getSouth() + paddingHeight, Math.min(bounds.getNorth() - paddingHeight, newLat));
            newLng = Math.max(bounds.getWest() + padding, Math.min(bounds.getEast() - padding, newLng));

            label.labelLatLng = L.latLng(newLat, newLng);
        });
    }

    /**
     * Find best position for polygon name label (centroid with label avoidance)
     */
    findPolygonNamePosition(polygon, polygonLabels) {
        if (!polygon.hull || polygon.hull.length === 0) {
            return null;
        }

        // Calculate polygon centroid
        const centerLat = polygon.hull.reduce((sum, v) => sum + v.lat, 0) / polygon.hull.length;
        const centerLon = polygon.hull.reduce((sum, v) => sum + v.lon, 0) / polygon.hull.length;

        // Check if centroid is clear of vertex labels
        const bounds = this.map.getBounds();
        const zoom = this.map.getZoom();
        const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom);
        const pixelsToDegrees = (pixels) => (metersPerPixel * pixels) / 111320;

        // Check distance to all labels
        const minClearance = pixelsToDegrees(60); // 60px clearance from labels
        let bestPosition = { lat: centerLat, lon: centerLon };
        let maxClearance = 0;

        // Try multiple candidate positions around the centroid
        const candidates = [
            { lat: centerLat, lon: centerLon }, // Center
            { lat: centerLat + pixelsToDegrees(40), lon: centerLon }, // North
            { lat: centerLat - pixelsToDegrees(40), lon: centerLon }, // South
            { lat: centerLat, lon: centerLon + pixelsToDegrees(40) }, // East
            { lat: centerLat, lon: centerLon - pixelsToDegrees(40) }, // West
        ];

        candidates.forEach(candidate => {
            // Calculate minimum distance to any label
            let minDist = Infinity;
            this.labels.forEach(label => {
                const dx = candidate.lon - label.labelLatLng.lng;
                const dy = candidate.lat - label.labelLatLng.lat;
                const dist = Math.sqrt(dx * dx + dy * dy);
                minDist = Math.min(minDist, dist);
            });

            // Pick candidate with most clearance
            if (minDist > maxClearance) {
                maxClearance = minDist;
                bestPosition = candidate;
            }
        });

        return bestPosition;
    }

    /**
     * Render polygon name labels
     */
    renderPolygonNames(polygons) {
        // Remove old polygon name markers
        this.polygonNameMarkers.forEach((marker, id) => {
            this.map.removeLayer(marker);
        });
        this.polygonNameMarkers.clear();

        // Add polygon name labels
        polygons.forEach(polygon => {
            const position = this.findPolygonNamePosition(polygon, this.labels.filter(l => l.polygonId === polygon.id));

            if (position && polygon.name) {
                const marker = L.marker([position.lat, position.lon], {
                    icon: L.divIcon({
                        className: 'polygon-name-label',
                        html: `<div class="polygon-name-content" style="color: ${polygon.color}">${polygon.name}</div>`,
                        iconSize: null,
                        iconAnchor: [0, 0]
                    }),
                    interactive: false
                }).addTo(this.map);

                this.polygonNameMarkers.set(polygon.id, marker);
            }
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
                    draggable: true
                }).addTo(this.map);

                // Update label position when dragged
                marker.on('drag', (e) => {
                    const newLatLng = e.target.getLatLng();
                    label.labelLatLng = newLatLng;

                    // Update leader lines during drag
                    const lines = this.leaderLines.get(key);
                    if (lines) {
                        const lineCoords = [
                            [label.vertexLatLng.lat, label.vertexLatLng.lng],
                            [newLatLng.lat, newLatLng.lng]
                        ];
                        lines.outline.setLatLngs(lineCoords);
                        lines.line.setLatLngs(lineCoords);
                    }
                });

                // Mark as manually positioned when dragged
                marker.on('dragend', (e) => {
                    this.manuallyPositioned.add(key);
                });

                // Stop simulation when user starts dragging
                marker.on('dragstart', () => {
                    this.stopSimulation();
                });

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
     * Calculate the angle at a vertex (in degrees)
     * Returns the interior angle formed by prev-vertex-next
     */
    calculateVertexAngle(vertices, index) {
        const n = vertices.length;
        const prev = vertices[(index - 1 + n) % n];
        const curr = vertices[index];
        const next = vertices[(index + 1) % n];

        // Vector from curr to prev
        const v1x = prev.lon - curr.lon;
        const v1y = prev.lat - curr.lat;

        // Vector from curr to next
        const v2x = next.lon - curr.lon;
        const v2y = next.lat - curr.lat;

        // Calculate angle between vectors using dot product
        const dot = v1x * v2x + v1y * v2y;
        const mag1 = Math.sqrt(v1x * v1x + v1y * v1y);
        const mag2 = Math.sqrt(v2x * v2x + v2y * v2y);

        if (mag1 === 0 || mag2 === 0) {
            return 180; // Degenerate case, treat as straight line
        }

        // Angle in radians
        const angleRad = Math.acos(Math.max(-1, Math.min(1, dot / (mag1 * mag2))));

        // Convert to degrees
        const angleDeg = angleRad * (180 / Math.PI);

        return angleDeg;
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
        // Save manually positioned label coordinates before clearing
        const savedPositions = new Map();
        this.labels.forEach(label => {
            if (this.manuallyPositioned.has(label.key)) {
                savedPositions.set(label.key, {
                    lat: label.labelLatLng.lat,
                    lng: label.labelLatLng.lng
                });
            }
        });

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

        // Minimum distance between vertices to show separate labels
        const minVertexDistance = pixelsToDegrees(this.settings.minVertexDistance);

        // Start labels at preferred anchor position (outside polygon)
        const initialOffset = pixelsToDegrees(this.settings.initialOffset);

        // Track which vertices we've already labeled (across all polygons)
        const labeledVertices = [];

        // Process each polygon
        polygons.forEach(polygon => {
            if (!polygon.hull || polygon.hull.length === 0) {
                return;
            }

            // Calculate polygon center
            const visibleVertices = polygon.hull.filter(v => bounds.contains(L.latLng(v.lat, v.lon)));
            if (visibleVertices.length === 0) return;

            const polyCenterLat = visibleVertices.reduce((sum, v) => sum + v.lat, 0) / visibleVertices.length;
            const polyCenterLon = visibleVertices.reduce((sum, v) => sum + v.lon, 0) / visibleVertices.length;

            // Calculate angles for all vertices in this polygon
            const vertexData = polygon.hull.map((vertex, index) => ({
                vertex,
                index,
                angle: this.calculateVertexAngle(polygon.hull, index),
                inBounds: bounds.contains(L.latLng(vertex.lat, vertex.lon))
            }));

            vertexData.forEach(({ vertex, index, angle, inBounds }) => {
                const vertexLatLng = L.latLng(vertex.lat, vertex.lon);

                // Only add label if vertex is in current view
                if (!inBounds) {
                    return;
                }

                // Check vertex angle - skip if too shallow
                if (angle > 180 - this.settings.minVertexAngle) {
                    // Angle is too shallow (close to 180 degrees = straight line)
                    return;
                }

                // Check if this vertex is too close to an already labeled vertex
                const closeLabeled = labeledVertices.find(labeled => {
                    const dist = Math.sqrt(
                        Math.pow(vertex.lat - labeled.lat, 2) +
                        Math.pow(vertex.lon - labeled.lon, 2)
                    );
                    return dist < minVertexDistance;
                });

                if (closeLabeled) {
                    // This vertex is close to an already labeled one
                    // Only replace if this vertex has a sharper angle
                    if (angle < closeLabeled.angle) {
                        // Remove the old labeled vertex and use this sharper one
                        const oldIndex = labeledVertices.indexOf(closeLabeled);
                        labeledVertices.splice(oldIndex, 1);
                        // Also remove the old label from the array
                        const oldLabelIndex = this.labels.findIndex(l =>
                            Math.abs(l.vertexLatLng.lat - closeLabeled.lat) < 0.000001 &&
                            Math.abs(l.vertexLatLng.lng - closeLabeled.lon) < 0.000001
                        );
                        if (oldLabelIndex !== -1) {
                            this.labels.splice(oldLabelIndex, 1);
                        }
                    } else {
                        // Existing label has sharper or equal angle, skip this one
                        return;
                    }
                }

                // Mark this vertex as labeled with its angle for comparison
                labeledVertices.push({ lat: vertex.lat, lon: vertex.lon, angle });

                const key = `${polygon.id}-${index}`;
                const text = `${vertex.lat.toFixed(6)}, ${vertex.lon.toFixed(6)}`;
                const labelWidth = this.estimateLabelWidth(text);

                // Alternate up and down for visual jitter (every other vertex)
                const isAlternate = index % 2 === 1;
                const verticalOffset = pixelsToDegrees(isAlternate ? -45 : 45); // Alternate up/down by label height + padding (45px)

                // Check if this label was manually positioned
                let labelLat, labelLon;
                const savedPos = savedPositions.get(key);

                if (savedPos) {
                    // Restore manually positioned label
                    labelLat = savedPos.lat;
                    labelLon = savedPos.lng;
                } else {
                    // Calculate direction away from polygon center
                    const dx = vertex.lon - polyCenterLon;
                    const dy = vertex.lat - polyCenterLat;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    // Position label outward from polygon center with vertical jitter
                    if (dist > 0.00001) {
                        // Push label away from center
                        labelLat = vertex.lat + (dy / dist) * initialOffset + verticalOffset;
                        labelLon = vertex.lon + (dx / dist) * initialOffset;
                    } else {
                        // Default to right if vertex is at center
                        labelLat = vertex.lat + verticalOffset;
                        labelLon = vertex.lon + initialOffset;
                    }
                }

                this.labels.push({
                    key,
                    polygonId: polygon.id,
                    vertexIndex: index,
                    vertexLatLng: vertexLatLng,
                    labelLatLng: L.latLng(labelLat, labelLon),
                    text,
                    width: labelWidth,
                    height: 30,
                    polygonVertices: polygon.hull,  // Store for inside/outside check
                    manuallyPositioned: savedPos !== undefined  // Mark if manually positioned
                });
            });
        });

        // Render all labels
        if (this.labels.length > 0) {
            this.renderLabels();
            this.startSimulation(polygons);
        } else {
            // No vertex labels, but still render polygon names
            this.renderPolygonNames(polygons);
        }
    }
}

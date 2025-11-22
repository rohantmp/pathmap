import L from 'leaflet';
import { LabelManager } from './label-manager.js';

export class MapManager {
    constructor(elementId) {
        // Initialize Leaflet map (centered on India)
        this.map = L.map(elementId, {
            center: [22.5, 78.5],  // Center of India
            zoom: 5,  // Good zoom level to see most of India
            zoomControl: false,  // We'll add it manually with custom position
            maxZoom: 22
        });

        // Add zoom control with position based on screen size
        const zoomPosition = window.innerWidth <= 768 ? 'topright' : 'topleft';
        L.control.zoom({
            position: zoomPosition
        }).addTo(this.map);

        // Add Esri satellite layer with tile scaling beyond native zoom
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
            maxZoom: 22,
            maxNativeZoom: 18
        }).addTo(this.map);

        // Add labels overlay (place names, roads, etc.)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 22,
            pane: 'overlayPane'
        }).addTo(this.map);

        // Add scale control
        L.control.scale({
            position: 'bottomleft',
            imperial: true,
            metric: true
        }).addTo(this.map);

        // Add compass rose
        const CompassControl = L.Control.extend({
            options: { position: 'topright' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'compass-rose');
                container.innerHTML = `
                    <svg width="50" height="50" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="45" fill="rgba(255,255,255,0.9)" stroke="#333" stroke-width="2"/>
                        <polygon points="50,10 45,40 50,35 55,40" fill="#e74c3c"/>
                        <polygon points="50,90 45,60 50,65 55,60" fill="#333"/>
                        <polygon points="10,50 40,45 35,50 40,55" fill="#333"/>
                        <polygon points="90,50 60,45 65,50 60,55" fill="#333"/>
                        <text x="50" y="8" text-anchor="middle" font-size="10" font-weight="bold" fill="#e74c3c">N</text>
                    </svg>
                `;
                return container;
            }
        });
        new CompassControl().addTo(this.map);

        this.polygonLayers = new Map(); // polygonId -> layer group
        this.areaUnit = 'acres'; // Default area unit
        this.trackLayers = new Map(); // polygonId -> array of track layers
        this.polygonData = new Map(); // polygonId -> { id, hull, color }
        this.groupBoundaryLayers = new Map(); // groupId -> layer
        this.showTracks = false;
        this.showGroupBounds = false;
        this.editMode = false;
        this.editingPolygonId = null;
        this.vertexMarkers = [];
        this.midpointMarkers = [];
        this.editingPolygonLayer = null;

        // Initialize label manager
        this.labelManager = new LabelManager(this.map);

        // Refresh labels when map moves
        this.map.on('moveend', () => {
            this.refreshAllLabels();
        });
    }

    /**
     * Refresh all labels based on current view
     */
    refreshAllLabels() {
        const polygons = Array.from(this.polygonData.values());
        this.labelManager.updateAllLabels(polygons);
    }

    /**
     * Add or update a polygon on the map
     * @param {number} polygonId - Unique polygon identifier
     * @param {Array} hull - Array of {lat, lon} points
     * @param {string} color - Hex color string
     * @param {string} name - Polygon name
     * @param {boolean} skipFitBounds - If true, don't adjust map view
     */
    addPolygon(polygonId, hull, color, name = '', skipFitBounds = false) {
        // Remove existing layers for this polygon
        this.removePolygon(polygonId);

        if (!hull || hull.length < 3) {
            return;
        }

        // Store polygon data for label refresh
        this.polygonData.set(polygonId, {
            id: polygonId,
            hull: hull,
            color: color,
            name: name
        });

        // Create layer group for this polygon
        const layerGroup = L.layerGroup().addTo(this.map);

        // Convert hull points to Leaflet LatLng
        const latLngs = hull.map(p => [p.lat, p.lon]);

        // Create polygon
        const polygon = L.polygon(latLngs, {
            color: color,
            fillColor: color,
            fillOpacity: 0.2,
            weight: 2
        }).addTo(layerGroup);

        // Calculate area and bind tooltip
        const area = this.calculateArea(hull);
        const areaText = this.formatArea(area);
        polygon.bindTooltip(() => `${name ? name + '<br>' : ''}${this.formatArea(area)}`, {
            sticky: true,
            className: 'area-tooltip'
        });

        this.polygonLayers.set(polygonId, layerGroup);

        // Refresh all labels
        this.refreshAllLabels();

        // Fit map to show all polygons (but not during edit mode)
        if (!this.editMode && !skipFitBounds) {
            this.fitBounds();
        }
    }

    /**
     * Add track lines to the map
     */
    addTracks(polygonId, tracks, color) {
        // Remove existing tracks
        this.removeTracks(polygonId);

        if (!this.showTracks || !tracks || tracks.length === 0) {
            return;
        }

        const trackLayers = [];

        tracks.forEach(track => {
            if (track.points && track.points.length > 0) {
                const latLngs = track.points.map(p => [p.lat, p.lon]);

                const polyline = L.polyline(latLngs, {
                    color: color,
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '5, 5'
                }).addTo(this.map);

                trackLayers.push(polyline);
            }
        });

        this.trackLayers.set(polygonId, trackLayers);
    }

    /**
     * Remove tracks for a polygon
     */
    removeTracks(polygonId) {
        const tracks = this.trackLayers.get(polygonId);
        if (tracks) {
            tracks.forEach(layer => this.map.removeLayer(layer));
            this.trackLayers.delete(polygonId);
        }
    }

    /**
     * Remove a polygon from the map
     */
    removePolygon(polygonId) {
        const layerGroup = this.polygonLayers.get(polygonId);
        if (layerGroup) {
            this.map.removeLayer(layerGroup);
            this.polygonLayers.delete(polygonId);
        }

        this.polygonData.delete(polygonId);
        this.removeTracks(polygonId);

        // Refresh all labels after removal
        this.refreshAllLabels();
    }

    /**
     * Toggle track visibility
     */
    setShowTracks(show) {
        this.showTracks = show;
    }

    /**
     * Toggle group boundary visibility
     */
    setShowGroupBounds(show) {
        this.showGroupBounds = show;
    }

    /**
     * Toggle label visibility
     */
    setShowLabels(show) {
        this.labelManager.setShowLabels(show);
        // Refresh to ensure visibility changes are applied
        this.refreshAllLabels();
    }

    /**
     * Toggle showing area on map labels
     */
    setShowAreaOnMap(show) {
        this.labelManager.setShowAreaOnMap(show, (hull) => {
            const area = this.calculateArea(hull);
            return this.formatArea(area);
        });
        this.refreshAllLabels();
    }

    /**
     * Set the area unit for display
     */
    setAreaUnit(unit) {
        this.areaUnit = unit;
    }

    /**
     * Calculate area of a polygon in square meters using the Shoelace formula
     * with geodesic correction
     */
    calculateArea(hull) {
        if (!hull || hull.length < 3) return 0;

        // Use the Shoelace formula with lat/lng converted to approximate meters
        // This provides a reasonable approximation for most polygon sizes
        let area = 0;
        const n = hull.length;

        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const lat1 = hull[i].lat * Math.PI / 180;
            const lat2 = hull[j].lat * Math.PI / 180;
            const lon1 = hull[i].lon * Math.PI / 180;
            const lon2 = hull[j].lon * Math.PI / 180;

            // Spherical excess formula for geodesic area
            area += (lon2 - lon1) * (2 + Math.sin(lat1) + Math.sin(lat2));
        }

        // Earth's radius in meters
        const R = 6371000;
        area = Math.abs(area * R * R / 2);

        return area; // Returns square meters
    }

    /**
     * Format area in the selected unit
     */
    formatArea(sqMeters) {
        const conversions = {
            'sqm': { factor: 1, label: 'm²' },
            'sqkm': { factor: 0.000001, label: 'km²' },
            'sqmi': { factor: 3.861e-7, label: 'mi²' },
            'sqft': { factor: 10.7639, label: 'ft²' },
            'acres': { factor: 0.000247105, label: 'acres' },
            'hectares': { factor: 0.0001, label: 'ha' }
        };

        const conv = conversions[this.areaUnit] || conversions.acres;
        const value = sqMeters * conv.factor;

        // Format based on size
        if (value >= 1000) {
            return `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${conv.label}`;
        } else if (value >= 10) {
            return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${conv.label}`;
        } else {
            return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${conv.label}`;
        }
    }

    /**
     * Add a group boundary polygon to the map
     */
    addGroupBoundary(groupId, hull, name) {
        // Remove existing boundary for this group
        this.removeGroupBoundary(groupId);

        if (!hull || hull.length < 3) return;

        const latlngs = hull.map(p => [p.lat, p.lon]);

        // Create dashed polygon for group boundary
        const polygon = L.polygon(latlngs, {
            color: '#ff6600',
            weight: 3,
            dashArray: '10, 6',
            fill: false,
            opacity: 0.9
        });

        polygon.addTo(this.map);
        this.groupBoundaryLayers.set(groupId, polygon);
    }

    /**
     * Remove a group boundary from the map
     */
    removeGroupBoundary(groupId) {
        const layer = this.groupBoundaryLayers.get(groupId);
        if (layer) {
            this.map.removeLayer(layer);
            this.groupBoundaryLayers.delete(groupId);
        }
    }

    /**
     * Clear all group boundaries
     */
    clearGroupBoundaries() {
        this.groupBoundaryLayers.forEach(layer => {
            this.map.removeLayer(layer);
        });
        this.groupBoundaryLayers.clear();
    }

    /**
     * Fit map bounds to show all polygons
     */
    fitBounds() {
        if (this.polygonLayers.size === 0) {
            this.map.setView([22.5, 78.5], 5);  // Default to India view
            return;
        }

        const bounds = L.latLngBounds();
        let hasPoints = false;

        this.polygonLayers.forEach(layerGroup => {
            layerGroup.eachLayer(layer => {
                if (layer.getBounds) {
                    bounds.extend(layer.getBounds());
                    hasPoints = true;
                } else if (layer.getLatLng) {
                    bounds.extend(layer.getLatLng());
                    hasPoints = true;
                }
            });
        });

        if (hasPoints) {
            this.map.fitBounds(bounds, { padding: [50, 50] });
        }
    }

    /**
     * Clear all layers from the map
     */
    clear() {
        this.polygonLayers.forEach((layer, id) => this.removePolygon(id));
        this.polygonLayers.clear();
        this.trackLayers.clear();
        this.polygonData.clear();
        this.labelManager.clear();
    }

    /**
     * Get current map center and zoom
     */
    getMapState() {
        const center = this.map.getCenter();
        return {
            center: { lat: center.lat, lon: center.lng },
            zoom: this.map.getZoom()
        };
    }

    /**
     * Set map center and zoom
     */
    setMapState(state) {
        if (state && state.center) {
            this.map.setView([state.center.lat, state.center.lon], state.zoom || 2);
        }
    }

    /**
     * Enter vertex edit mode for a polygon
     */
    enterEditMode(polygonId, polygonData, onUpdate) {
        this.exitEditMode(); // Clear any existing edit session

        this.editMode = true;
        this.editingPolygonId = polygonId;
        this.onVertexUpdate = onUpdate;

        // Prevent context menu on the map while in edit mode
        this.contextMenuHandler = (e) => {
            L.DomEvent.preventDefault(e);
            L.DomEvent.stopPropagation(e);
            return false;
        };
        this.map._container.addEventListener('contextmenu', this.contextMenuHandler);

        const polygon = polygonData;
        if (!polygon || !polygon.hull || polygon.hull.length < 3) {
            return;
        }

        // Hide the regular polygon
        const regularLayerGroup = this.polygonLayers.get(polygonId);
        if (regularLayerGroup) {
            regularLayerGroup.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ opacity: 0.3, fillOpacity: 0.1 });
                }
            });
        }

        // Create editable polygon layer (non-interactive so it doesn't block vertex markers)
        const latLngs = polygon.hull.map(p => [p.lat, p.lon]);
        this.editingPolygonLayer = L.polygon(latLngs, {
            color: polygon.color,
            weight: 2,
            opacity: 0.8,
            fillOpacity: 0.2,
            dashArray: '5, 5',
            interactive: false  // Make non-interactive so it doesn't block vertex clicks
        }).addTo(this.map);

        // Create vertex markers (with higher z-index via markerPane)
        polygon.hull.forEach((vertex, index) => {
            const marker = L.circleMarker([vertex.lat, vertex.lon], {
                radius: 12,  // Increased from 8 for better clickability
                color: '#fff',
                weight: 3,
                fillColor: polygon.color,
                fillOpacity: 1,
                className: 'vertex-marker',
                pane: 'markerPane'  // Use markerPane for higher z-index
            }).addTo(this.map);

            // Prevent click from propagating to map
            marker.on('click', (e) => {
                L.DomEvent.stopPropagation(e);
            });

            // Make vertex draggable and handle right-click deletion
            marker.on('mousedown', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);

                // Check for right-click (button 2)
                if (e.originalEvent.button === 2) {
                    // Delete vertex on right-click
                    if (polygon.hull.length > 3) { // Keep at least 3 vertices
                        this.deleteVertex(index);
                    }
                    return;
                }

                // Left-click drag handling
                const map = this.map;
                const originalMapDragging = map.dragging.enabled();

                // Disable map dragging while dragging vertex
                if (originalMapDragging) {
                    map.dragging.disable();
                }

                const onMouseMove = (e) => {
                    marker.setLatLng(e.latlng);
                    this.updateEditingPolygon();
                };

                const onMouseUp = () => {
                    map.off('mousemove', onMouseMove);
                    map.off('mouseup', onMouseUp);

                    // Re-enable map dragging
                    if (originalMapDragging) {
                        map.dragging.enable();
                    }

                    this.updateVertexPosition(index, marker.getLatLng());
                };

                map.on('mousemove', onMouseMove);
                map.on('mouseup', onMouseUp);
            });

            // Also handle contextmenu for better compatibility
            marker.on('contextmenu', (e) => {
                L.DomEvent.stopPropagation(e);
                L.DomEvent.preventDefault(e);
                if (polygon.hull.length > 3) { // Keep at least 3 vertices
                    this.deleteVertex(index);
                }
                return false;
            });

            this.vertexMarkers.push(marker);
        });

        // Create midpoint markers for adding vertices
        this.createMidpointMarkers(polygon);
    }

    /**
     * Create midpoint markers between vertices
     */
    createMidpointMarkers(polygon) {
        // Clear existing midpoint markers
        this.midpointMarkers.forEach(m => this.map.removeLayer(m));
        this.midpointMarkers = [];

        const hull = polygon.hull;
        for (let i = 0; i < hull.length; i++) {
            const nextIndex = (i + 1) % hull.length;
            const midLat = (hull[i].lat + hull[nextIndex].lat) / 2;
            const midLon = (hull[i].lon + hull[nextIndex].lon) / 2;

            const marker = L.circleMarker([midLat, midLon], {
                radius: 9,  // Increased from 6 for better clickability
                color: '#fff',
                weight: 2,
                fillColor: '#3498db',
                fillOpacity: 0.7,
                className: 'midpoint-marker',
                pane: 'markerPane'  // Use markerPane for higher z-index
            }).addTo(this.map);

            // Add vertex on click
            marker.on('click', (e) => {
                L.DomEvent.stop(e);
                this.addVertex(i + 1, { lat: midLat, lon: midLon });
            });

            this.midpointMarkers.push(marker);
        }
    }

    /**
     * Update editing polygon shape
     */
    updateEditingPolygon() {
        if (this.editingPolygonLayer) {
            const latLngs = this.vertexMarkers.map(m => m.getLatLng());
            this.editingPolygonLayer.setLatLngs(latLngs);
        }
    }

    /**
     * Update vertex position
     */
    updateVertexPosition(index, latLng) {
        if (this.onVertexUpdate) {
            const vertices = this.vertexMarkers.map(m => {
                const ll = m.getLatLng();
                return { lat: ll.lat, lon: ll.lng };
            });
            this.onVertexUpdate(this.editingPolygonId, vertices);
        }
    }

    /**
     * Delete a vertex
     */
    deleteVertex(index) {
        if (this.vertexMarkers.length <= 3) return;

        this.map.removeLayer(this.vertexMarkers[index]);
        this.vertexMarkers.splice(index, 1);
        this.updateEditingPolygon();

        if (this.onVertexUpdate) {
            const vertices = this.vertexMarkers.map(m => {
                const ll = m.getLatLng();
                return { lat: ll.lat, lon: ll.lng };
            });
            this.onVertexUpdate(this.editingPolygonId, vertices);
        }
    }

    /**
     * Add a vertex
     */
    addVertex(index, vertex) {
        const marker = L.circleMarker([vertex.lat, vertex.lon], {
            radius: 12,  // Increased from 8 for better clickability
            color: '#fff',
            weight: 3,
            fillColor: '#3498db',
            fillOpacity: 1,
            className: 'vertex-marker',
            pane: 'markerPane'  // Use markerPane for higher z-index
        }).addTo(this.map);

        // Prevent click from propagating to map
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
        });

        // Add drag functionality and handle right-click deletion
        marker.on('mousedown', (e) => {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);

            // Check for right-click (button 2)
            if (e.originalEvent.button === 2) {
                // Delete vertex on right-click
                if (this.vertexMarkers.length > 3) {
                    this.deleteVertex(this.vertexMarkers.indexOf(marker));
                }
                return;
            }

            // Left-click drag handling
            const map = this.map;
            const originalMapDragging = map.dragging.enabled();

            // Disable map dragging while dragging vertex
            if (originalMapDragging) {
                map.dragging.disable();
            }

            const onMouseMove = (e) => {
                marker.setLatLng(e.latlng);
                this.updateEditingPolygon();
            };

            const onMouseUp = () => {
                map.off('mousemove', onMouseMove);
                map.off('mouseup', onMouseUp);

                // Re-enable map dragging
                if (originalMapDragging) {
                    map.dragging.enable();
                }

                this.updateVertexPosition(index, marker.getLatLng());
            };

            map.on('mousemove', onMouseMove);
            map.on('mouseup', onMouseUp);
        });

        // Also handle contextmenu for better compatibility
        marker.on('contextmenu', (e) => {
            L.DomEvent.stopPropagation(e);
            L.DomEvent.preventDefault(e);
            if (this.vertexMarkers.length > 3) {
                this.deleteVertex(this.vertexMarkers.indexOf(marker));
            }
            return false;
        });

        this.vertexMarkers.splice(index, 0, marker);
        this.updateEditingPolygon();

        if (this.onVertexUpdate) {
            const vertices = this.vertexMarkers.map(m => {
                const ll = m.getLatLng();
                return { lat: ll.lat, lon: ll.lng };
            });
            this.onVertexUpdate(this.editingPolygonId, vertices);
        }
    }

    /**
     * Exit vertex edit mode
     */
    exitEditMode() {
        this.editMode = false;
        this.editingPolygonId = null;

        // Remove context menu handler
        if (this.contextMenuHandler) {
            this.map._container.removeEventListener('contextmenu', this.contextMenuHandler);
            this.contextMenuHandler = null;
        }

        // Remove vertex markers
        this.vertexMarkers.forEach(m => this.map.removeLayer(m));
        this.vertexMarkers = [];

        // Remove midpoint markers
        this.midpointMarkers.forEach(m => this.map.removeLayer(m));
        this.midpointMarkers = [];

        // Remove editing polygon layer
        if (this.editingPolygonLayer) {
            this.map.removeLayer(this.editingPolygonLayer);
            this.editingPolygonLayer = null;
        }

        // Restore regular polygon opacity
        this.polygonLayers.forEach(layerGroup => {
            layerGroup.eachLayer(layer => {
                if (layer.setStyle) {
                    layer.setStyle({ opacity: 1, fillOpacity: 0.2 });
                }
            });
        });
    }
}

import L from 'leaflet';
import { LabelManager } from './label-manager.js';

export class MapManager {
    constructor(elementId) {
        // Initialize Leaflet map
        this.map = L.map(elementId, {
            center: [0, 0],
            zoom: 2,
            zoomControl: true,
            maxZoom: 22
        });

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
     */
    addPolygon(polygonId, hull, color, name = '') {
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

        // Fit map to show all polygons
        this.fitBounds();
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
            this.map.setView([0, 0], 2);
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
}

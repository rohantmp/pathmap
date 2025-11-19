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

        this.polygonLayers = new Map(); // polygonId -> layer group
        this.trackLayers = new Map(); // polygonId -> array of track layers
        this.polygonData = new Map(); // polygonId -> { id, hull, color }
        this.showTracks = false;

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

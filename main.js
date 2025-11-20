import 'leaflet/dist/leaflet.css';
import { MapManager } from './map-manager.js';
import { parseGPXFile, getGPXName } from './gpx-parser.js';
import { mergeConvexHulls } from './convex-hull.js';
import { saveToLocalStorage, loadFromLocalStorage, downloadSession, uploadSession } from './storage.js';
import { exportPNG, exportKML, exportGeoJSON, exportTracksGeoJSON } from './export.js';

// Application state
let state = {
    polygons: [], // { id, name, color, tracks: [{ name, points }], hull, group }
    groups: [], // { id, name, polygonIds: [] }
    nextPolygonId: 1,
    nextGroupId: 1,
    mapState: null,
    focusedPolygonId: null, // null = show all, id = show only this polygon
    focusedGroupId: null // null = show all, id = show only polygons in this group
};

let mapManager;

// Color palette for auto-assigning colors
const COLOR_PALETTE = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
    '#E76F51', '#2A9D8F', '#E9C46A', '#F4A261', '#264653'
];

let colorIndex = 0;

function getNextColor() {
    const color = COLOR_PALETTE[colorIndex % COLOR_PALETTE.length];
    colorIndex++;
    return color;
}

// Initialize the application
function init() {
    mapManager = new MapManager('map');

    // Sync label visibility with checkbox state
    const showLabelsCheckbox = document.getElementById('toggle-labels');
    if (showLabelsCheckbox) {
        mapManager.labelManager.setShowLabels(showLabelsCheckbox.checked);
    }

    // Sync area visibility with checkbox state
    const showAreaCheckbox = document.getElementById('toggle-area');
    if (showAreaCheckbox) {
        mapManager.setShowAreaOnMap(showAreaCheckbox.checked);
    }

    // Load saved session
    const savedState = loadFromLocalStorage();
    if (savedState) {
        state = savedState;
        // Ensure groups array exists for backwards compatibility
        if (!state.groups) {
            state.groups = [];
        }
        if (!state.nextGroupId) {
            state.nextGroupId = 1;
        }
        if (state.focusedPolygonId === undefined) {
            state.focusedPolygonId = null;
        }
        if (state.focusedGroupId === undefined) {
            state.focusedGroupId = null;
        }
        colorIndex = state.polygons.length;
        restoreState();
    }

    // Set up event listeners
    document.getElementById('create-polygon').addEventListener('click', createPolygon);
    document.getElementById('create-group').addEventListener('click', createGroup);
    document.getElementById('upload-zone-input').addEventListener('change', handleUploadZoneChange);
    document.getElementById('toggle-tracks').addEventListener('change', handleToggleTracks);
    document.getElementById('toggle-group-bounds').addEventListener('change', handleToggleGroupBounds);
    document.getElementById('toggle-labels').addEventListener('change', handleToggleLabels);
    document.getElementById('toggle-area').addEventListener('change', handleToggleArea);
    document.getElementById('toggle-debug-fields').addEventListener('change', handleToggleDebugFields);
    document.getElementById('clear-all').addEventListener('click', handleClearAll);
    document.getElementById('area-unit').addEventListener('change', handleAreaUnitChange);
    document.getElementById('download-session').addEventListener('click', handleDownloadSession);
    document.getElementById('upload-session').addEventListener('click', () => {
        document.getElementById('session-file-input').click();
    });
    document.getElementById('session-file-input').addEventListener('change', handleUploadSession);
    document.getElementById('toggle-vertex-edit').addEventListener('click', toggleVertexEdit);
    document.getElementById('polygon-select').addEventListener('change', handlePolygonSelect);
    document.getElementById('exit-edit-mode').addEventListener('click', exitEditMode);
    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);
    document.getElementById('toggle-export').addEventListener('click', toggleExport);
    document.getElementById('export-png').addEventListener('click', handleExportPNG);
    document.getElementById('export-kml').addEventListener('click', handleExportKML);
    document.getElementById('export-geojson').addEventListener('click', handleExportGeoJSON);
    document.getElementById('export-tracks-geojson').addEventListener('click', handleExportTracksGeoJSON);

    // Set up settings panel sliders
    setupSettingsSliders();

    renderPolygonList();
}

function toggleVertexEdit() {
    const panel = document.getElementById('vertex-edit-panel');
    const isVisible = panel.style.display !== 'none';

    if (isVisible) {
        // Close panel and exit edit mode
        panel.style.display = 'none';
        mapManager.exitEditMode();
    } else {
        // Open panel and populate polygon list
        panel.style.display = 'block';
        populatePolygonSelect();
    }
}

function populatePolygonSelect() {
    const select = document.getElementById('polygon-select');
    select.innerHTML = '<option value="">Select a polygon...</option>';

    state.polygons.forEach(polygon => {
        if (polygon.hull && polygon.hull.length >= 3) {
            const option = document.createElement('option');
            option.value = polygon.id;
            option.textContent = polygon.name;
            select.appendChild(option);
        }
    });
}

function handlePolygonSelect(event) {
    const polygonId = parseInt(event.target.value);
    if (!polygonId) {
        mapManager.exitEditMode();
        return;
    }

    const polygon = state.polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    // Enter edit mode
    mapManager.enterEditMode(polygonId, polygon, (id, newVertices) => {
        // Update polygon hull with new vertices
        const poly = state.polygons.find(p => p.id === id);
        if (poly) {
            poly.hull = newVertices;
            updatePolygonOnMap(poly);

            // Recreate midpoint markers
            mapManager.createMidpointMarkers(poly);

            // Save state
            saveState();
        }
    });

    // Zoom to polygon
    if (polygon.hull && polygon.hull.length > 0) {
        const bounds = L.latLngBounds(polygon.hull.map(v => [v.lat, v.lon]));
        mapManager.map.fitBounds(bounds, { padding: [50, 50] });
    }
}

function exitEditMode() {
    mapManager.exitEditMode();
    document.getElementById('polygon-select').value = '';
    document.getElementById('vertex-edit-panel').style.display = 'none';
}

function toggleExport() {
    const panel = document.getElementById('export-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

async function handleExportPNG() {
    try {
        const mapElement = document.getElementById('map');
        await exportPNG(mapElement);
    } catch (error) {
        alert(error.message);
    }
}

function handleExportKML() {
    const polygonsToExport = getPolygonsToExport();
    if (polygonsToExport.length === 0) {
        alert('No polygons to export.');
        return;
    }
    exportKML(polygonsToExport);
}

function handleExportGeoJSON() {
    const polygonsToExport = getPolygonsToExport();
    if (polygonsToExport.length === 0) {
        alert('No polygons to export.');
        return;
    }
    exportGeoJSON(polygonsToExport);
}

function handleExportTracksGeoJSON() {
    const polygonsToExport = getPolygonsToExport();
    if (polygonsToExport.length === 0) {
        alert('No polygons to export.');
        return;
    }
    exportTracksGeoJSON(polygonsToExport);
}

function getPolygonsToExport() {
    // If a polygon is focused, export only that one
    if (state.focusedPolygonId !== null) {
        return state.polygons.filter(p => p.id === state.focusedPolygonId);
    }
    // Otherwise export all
    return state.polygons;
}

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function setupSettingsSliders() {
    const sliders = [
        { id: 'min-vertex-dist', valueId: 'min-vertex-dist-value', format: v => v },
        { id: 'max-label-distance', valueId: 'max-label-distance-value', format: v => v },
        { id: 'min-vertex-angle', valueId: 'min-vertex-angle-value', format: v => v },
        { id: 'label-repulsion', valueId: 'label-repulsion-value', format: v => v },
        { id: 'center-repulsion', valueId: 'center-repulsion-value', format: v => v },
        { id: 'spring-strength', valueId: 'spring-strength-value', format: v => v.toFixed(2) }
    ];

    sliders.forEach(({ id, valueId, format }) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(valueId);
        slider.addEventListener('input', (e) => {
            valueDisplay.textContent = format(parseFloat(e.target.value));
            // Live update on any slider change
            applyLabelSettingsLive();
        });
    });

    // Reset button
    document.getElementById('reset-settings').addEventListener('click', resetSettings);
}

function applyLabelSettingsLive() {
    const settings = {
        minVertexDistance: parseFloat(document.getElementById('min-vertex-dist').value),
        maxLabelDistance: parseFloat(document.getElementById('max-label-distance').value),
        minVertexAngle: parseFloat(document.getElementById('min-vertex-angle').value),
        eqLabel: parseFloat(document.getElementById('label-repulsion').value),
        eqCenter: parseFloat(document.getElementById('center-repulsion').value),
        springStrength: parseFloat(document.getElementById('spring-strength').value)
    };

    mapManager.labelManager.updateSettings(settings);
    mapManager.refreshAllLabels();
}

function resetSettings() {
    // Reset to defaults
    document.getElementById('min-vertex-dist').value = 30;
    document.getElementById('min-vertex-dist-value').textContent = '30';
    document.getElementById('max-label-distance').value = 80;
    document.getElementById('max-label-distance-value').textContent = '80';
    document.getElementById('min-vertex-angle').value = 10;
    document.getElementById('min-vertex-angle-value').textContent = '10';
    document.getElementById('label-repulsion').value = 30;
    document.getElementById('label-repulsion-value').textContent = '30';
    document.getElementById('center-repulsion').value = 100;
    document.getElementById('center-repulsion-value').textContent = '100';
    document.getElementById('spring-strength').value = 0.1;
    document.getElementById('spring-strength-value').textContent = '0.10';

    applyLabelSettingsLive();
}

function applyLabelSettings() {
    applyLabelSettingsLive();
}

function createPolygon() {
    const polygon = {
        id: state.nextPolygonId++,
        name: `Polygon ${state.polygons.length + 1}`,
        color: getNextColor(),
        tracks: [],
        hull: null,
        groupId: null,
        hidden: false
    };

    state.polygons.push(polygon);
    renderPolygonList();
    saveState();
}

function createGroup() {
    const group = {
        id: state.nextGroupId++,
        name: `Group ${state.groups.length + 1}`,
        collapsed: false,
        hidden: false
    };

    state.groups.push(group);
    renderPolygonList();
    saveState();
}

async function processGPXFiles(files) {
    if (!files || files.length === 0) return;

    const errors = [];

    for (const file of files) {
        try {
            // Parse GPX file
            const points = await parseGPXFile(file);
            const name = await getGPXName(file);

            // Create new polygon for this file
            const polygon = {
                id: state.nextPolygonId++,
                name: name,
                color: getNextColor(),
                tracks: [{
                    id: Date.now() + Math.random(),
                    name: name,
                    points: points
                }],
                hull: null,
                groupId: null,
                hidden: false
            };

            // Compute hull and add to state
            updatePolygonHull(polygon);
            state.polygons.push(polygon);
            updatePolygonOnMap(polygon);

        } catch (error) {
            console.error(`Error processing ${file.name}:`, error);
            errors.push(`${file.name}: ${error.message}`);
        }
    }

    renderPolygonList();
    saveState();

    // Show errors if any
    if (errors.length > 0) {
        const successCount = files.length - errors.length;
        alert(`Created ${successCount} polygon(s).\n\nErrors:\n${errors.join('\n')}`);
    }
}

async function handleUploadZoneChange(event) {
    await processGPXFiles(Array.from(event.target.files));
    event.target.value = '';
}

function handleUploadZoneDragEnter(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes('Files')) {
        event.currentTarget.classList.add('file-drop-active');
    }
}

function handleUploadZoneDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    const zone = event.currentTarget;
    if (!zone.contains(event.relatedTarget)) {
        zone.classList.remove('file-drop-active');
    }
}

function handleUploadZoneDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes('Files')) {
        event.dataTransfer.dropEffect = 'copy';
    }
}

async function handleUploadZoneDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('file-drop-active');

    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Filter for GPX files
    const gpxFiles = Array.from(files).filter(file =>
        file.name.toLowerCase().endsWith('.gpx')
    );

    if (gpxFiles.length === 0) {
        alert('Please drop GPX files (.gpx)');
        return;
    }

    await processGPXFiles(gpxFiles);
}

function toggleHidePolygon(polygonId) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.hidden = !polygon.hidden;
        updateMapVisibility();
        renderPolygonList();
        saveState();
    }
}

function toggleHideGroup(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (group) {
        group.hidden = !group.hidden;
        updateMapVisibility();
        renderPolygonList();
        saveState();
    }
}

function deleteGroup(groupId) {
    if (!confirm('Delete this group? Polygons will be ungrouped but not deleted.')) {
        return;
    }

    // Ungroup all polygons in this group
    state.polygons.forEach(p => {
        if (p.groupId === groupId) {
            p.groupId = null;
        }
    });

    state.groups = state.groups.filter(g => g.id !== groupId);
    renderPolygonList();
    saveState();
}

function renameGroup(groupId, newName) {
    const group = state.groups.find(g => g.id === groupId);
    if (group) {
        group.name = newName;
        renderPolygonList();
        saveState();
    }
}

function toggleGroupCollapse(groupId) {
    const group = state.groups.find(g => g.id === groupId);
    if (group) {
        group.collapsed = !group.collapsed;
        renderPolygonList();
        saveState();
    }
}

function assignPolygonToGroup(polygonId, groupId) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.groupId = groupId || null;
        renderPolygonList();
        saveState();
    }
}

function toggleFocusGroup(groupId) {
    if (state.focusedGroupId === groupId) {
        // Unfocus - show all
        state.focusedGroupId = null;
    } else {
        // Focus on this group
        state.focusedGroupId = groupId;
        state.focusedPolygonId = null; // Clear polygon focus when focusing group
    }

    updateMapVisibility();
    renderPolygonList();
    saveState();
}

function deletePolygon(polygonId) {
    if (!confirm('Are you sure you want to delete this polygon?')) {
        return;
    }

    state.polygons = state.polygons.filter(p => p.id !== polygonId);
    if (state.focusedPolygonId === polygonId) {
        state.focusedPolygonId = null;
    }
    mapManager.removePolygon(polygonId);
    renderPolygonList();
    saveState();
}

function toggleFocusPolygon(polygonId) {
    if (state.focusedPolygonId === polygonId) {
        // Unfocus - show all polygons
        state.focusedPolygonId = null;
    } else {
        // Focus on this polygon
        state.focusedPolygonId = polygonId;
        state.focusedGroupId = null; // Clear group focus when focusing polygon
    }

    // Update map to show/hide polygons
    updateMapVisibility();
    renderPolygonList();
    saveState();
}

function updateMapVisibility() {
    state.polygons.forEach(polygon => {
        let shouldShow = true;

        // Check if polygon is hidden
        if (polygon.hidden) {
            shouldShow = false;
        }
        // Check if polygon's group is hidden
        else if (polygon.groupId) {
            const group = state.groups.find(g => g.id === polygon.groupId);
            if (group && group.hidden) {
                shouldShow = false;
            }
        }

        // Check polygon focus
        if (shouldShow && state.focusedPolygonId !== null) {
            shouldShow = state.focusedPolygonId === polygon.id;
        }
        // Check group focus
        else if (shouldShow && state.focusedGroupId !== null) {
            shouldShow = polygon.groupId === state.focusedGroupId;
        }

        if (shouldShow) {
            updatePolygonOnMap(polygon);
        } else {
            mapManager.removePolygon(polygon.id);
        }
    });
    mapManager.refreshAllLabels();
}

function updatePolygonColor(polygonId, color) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.color = color;
        updatePolygonOnMap(polygon);
        saveState();
    }
}

function renamePolygon(polygonId, newName) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.name = newName;
        renderPolygonList();
        saveState();
    }
}

async function handleGPXUpload(polygonId, files) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    for (const file of files) {
        try {
            const points = await parseGPXFile(file);
            const name = await getGPXName(file);

            polygon.tracks.push({
                id: Date.now() + Math.random(), // Unique ID for track
                name: name,
                points: points
            });
        } catch (error) {
            console.error('Error parsing GPX file:', error);
            alert(`Error parsing ${file.name}: ${error.message}`);
        }
    }

    updatePolygonHull(polygon);
    updatePolygonOnMap(polygon);
    renderPolygonList();
    saveState();
}

function deleteTrack(polygonId, trackId) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    polygon.tracks = polygon.tracks.filter(t => t.id !== trackId);
    updatePolygonHull(polygon);
    updatePolygonOnMap(polygon);
    renderPolygonList();
    saveState();
}

function moveTrack(trackId, fromPolygonId, toPolygonId) {
    const fromPolygon = state.polygons.find(p => p.id === fromPolygonId);
    const toPolygon = state.polygons.find(p => p.id === toPolygonId);

    if (!fromPolygon || !toPolygon) return;

    const trackIndex = fromPolygon.tracks.findIndex(t => t.id === trackId);
    if (trackIndex === -1) return;

    const track = fromPolygon.tracks.splice(trackIndex, 1)[0];
    toPolygon.tracks.push(track);

    updatePolygonHull(fromPolygon);
    updatePolygonHull(toPolygon);
    updatePolygonOnMap(fromPolygon);
    updatePolygonOnMap(toPolygon);
    renderPolygonList();
    saveState();
}

function updatePolygonHull(polygon) {
    if (polygon.tracks.length === 0) {
        polygon.hull = null;
        return;
    }

    const allPointArrays = polygon.tracks.map(t => t.points);
    polygon.hull = mergeConvexHulls(allPointArrays);
}

function updatePolygonOnMap(polygon) {
    if (polygon.hull && polygon.hull.length >= 3) {
        mapManager.addPolygon(polygon.id, polygon.hull, polygon.color, polygon.name);

        if (mapManager.showTracks) {
            mapManager.addTracks(polygon.id, polygon.tracks, polygon.color);
        }
    } else {
        mapManager.removePolygon(polygon.id);
    }
}

function handleToggleTracks(event) {
    const showTracks = event.target.checked;
    mapManager.setShowTracks(showTracks);

    // Update all polygons
    state.polygons.forEach(polygon => {
        if (showTracks) {
            mapManager.addTracks(polygon.id, polygon.tracks, polygon.color);
        } else {
            mapManager.removeTracks(polygon.id);
        }
    });
}

function handleToggleGroupBounds(event) {
    const showGroupBounds = event.target.checked;
    mapManager.setShowGroupBounds(showGroupBounds);
    renderGroupBoundaries();
}

function renderGroupBoundaries() {
    // Clear existing group boundaries
    mapManager.clearGroupBoundaries();

    if (!mapManager.showGroupBounds) return;

    // For each group, compute convex hull of all polygon hulls
    state.groups.forEach(group => {
        if (group.hidden) return;

        const groupPolygons = state.polygons.filter(p => p.groupId === group.id && p.hull && !p.hidden);
        if (groupPolygons.length === 0) return;

        // Collect all points from all polygons in the group
        const allPoints = [];
        groupPolygons.forEach(polygon => {
            polygon.hull.forEach(point => {
                allPoints.push([point.lat, point.lon]);
            });
        });

        if (allPoints.length < 3) return;

        // Compute convex hull of all points
        const groupHull = computeConvexHull(allPoints);

        // Add the group boundary to the map
        mapManager.addGroupBoundary(group.id, groupHull, group.name);
    });
}

// Convex hull using Graham scan algorithm
function computeConvexHull(points) {
    if (points.length < 3) return points;

    // Find the point with lowest y (and leftmost if tie)
    let start = 0;
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < points[start][0] ||
            (points[i][0] === points[start][0] && points[i][1] < points[start][1])) {
            start = i;
        }
    }

    // Swap start point to beginning
    [points[0], points[start]] = [points[start], points[0]];
    const pivot = points[0];

    // Sort points by polar angle with respect to pivot
    const sorted = points.slice(1).sort((a, b) => {
        const angleA = Math.atan2(a[0] - pivot[0], a[1] - pivot[1]);
        const angleB = Math.atan2(b[0] - pivot[0], b[1] - pivot[1]);
        if (angleA !== angleB) return angleA - angleB;
        // If same angle, sort by distance
        const distA = (a[0] - pivot[0]) ** 2 + (a[1] - pivot[1]) ** 2;
        const distB = (b[0] - pivot[0]) ** 2 + (b[1] - pivot[1]) ** 2;
        return distA - distB;
    });

    // Build hull using stack
    const hull = [pivot];

    for (const point of sorted) {
        while (hull.length > 1) {
            const top = hull[hull.length - 1];
            const second = hull[hull.length - 2];
            // Cross product to check turn direction
            const cross = (top[1] - second[1]) * (point[0] - top[0]) -
                         (top[0] - second[0]) * (point[1] - top[1]);
            if (cross <= 0) {
                hull.pop();
            } else {
                break;
            }
        }
        hull.push(point);
    }

    return hull.map(p => ({ lat: p[0], lon: p[1] }));
}

function handleToggleDebugFields(event) {
    const showDebug = event.target.checked;
    mapManager.labelManager.toggleDebugFields(showDebug);
}

function handleToggleLabels(event) {
    const showLabels = event.target.checked;
    mapManager.setShowLabels(showLabels);
}

function handleToggleArea(event) {
    const showArea = event.target.checked;
    mapManager.setShowAreaOnMap(showArea);
}

function handleClearAll() {
    if (state.polygons.length === 0 && state.groups.length === 0) {
        return;
    }

    if (!confirm('Are you sure you want to clear all polygons and groups?')) {
        return;
    }

    // Clear all polygons from map
    state.polygons.forEach(polygon => {
        mapManager.removePolygon(polygon.id);
    });

    // Clear all group boundaries
    mapManager.clearGroupBoundaries();

    // Reset state
    state.polygons = [];
    state.groups = [];
    state.focusedPolygonId = null;
    state.focusedGroupId = null;

    renderPolygonList();
    saveState();
}

function handleAreaUnitChange(event) {
    const unit = event.target.value;
    mapManager.setAreaUnit(unit);
    // Refresh all polygons to update tooltips
    updateMapVisibility();
}

function renderPolygonList() {
    const container = document.getElementById('polygons-list');

    if (state.polygons.length === 0 && state.groups.length === 0) {
        container.innerHTML = '<p class="empty-state">No polygons yet. Create one to get started!</p>';
        return;
    }

    let html = '';

    // Render groups first
    state.groups.forEach(group => {
        const groupPolygons = state.polygons.filter(p => p.groupId === group.id);
        const isGroupFocused = state.focusedGroupId === group.id;
        const isGroupDimmed = (state.focusedGroupId !== null && state.focusedGroupId !== group.id) || group.hidden;
        html += `
        <div class="group-card ${isGroupDimmed ? 'group-hidden' : ''}" data-group-id="${group.id}" draggable="true"
             ondragstart="window.handleDragStart(event, 'group', ${group.id})"
             ondragend="window.handleDragEnd(event)"
             ondragover="window.handleDragOver(event)"
             ondrop="window.handleDrop(event, 'group', ${group.id})">
            <div class="group-header">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                <button class="btn-icon btn-collapse" onclick="window.toggleGroupCollapse(${group.id})" title="${group.collapsed ? 'Expand' : 'Collapse'}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style="transform: rotate(${group.collapsed ? '-90deg' : '0'})">
                        <path d="M4.5 5.5L8 9l3.5-3.5"/>
                    </svg>
                </button>
                <input type="text" class="group-name" value="${group.name}"
                       onchange="window.renameGroup(${group.id}, this.value)">
                <span class="group-count">(${groupPolygons.length})</span>
                <button class="btn-icon ${group.hidden ? 'btn-hidden-active' : ''}" onclick="window.toggleHideGroup(${group.id})" title="${group.hidden ? 'Show' : 'Hide'}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        ${group.hidden ?
                            '<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299l.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709z"/><path d="M13.646 14.354l-12-12 .708-.708 12 12-.708.708z"/>'
                            : '<path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>'}
                    </svg>
                </button>
                <button class="btn-icon ${isGroupFocused ? 'btn-focused' : ''}" onclick="window.toggleFocusGroup(${group.id})" title="${isGroupFocused ? 'Show All' : 'Focus Group'}">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <circle cx="8" cy="8" r="3"/>
                        <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z"/>
                    </svg>
                </button>
                <button class="btn-icon btn-delete" onclick="window.deleteGroup(${group.id})" title="Delete Group">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
            ${!group.collapsed ? `
                <div class="group-polygons">
                    ${groupPolygons.map(polygon => renderPolygonCard(polygon, true)).join('')}
                </div>
            ` : ''}
        </div>
        `;
    });

    // Render ungrouped polygons
    const ungroupedPolygons = state.polygons.filter(p => !p.groupId);
    html += ungroupedPolygons.map(polygon => renderPolygonCard(polygon, false)).join('');

    container.innerHTML = html;
}

function renderPolygonCard(polygon, inGroup) {
    const isFocused = state.focusedPolygonId === polygon.id;
    const isDimmed = (state.focusedPolygonId !== null && state.focusedPolygonId !== polygon.id) || polygon.hidden;

    return `
    <div class="polygon-card ${isDimmed ? 'polygon-hidden' : ''} ${inGroup ? 'in-group' : ''}" data-polygon-id="${polygon.id}" draggable="true"
         ondragstart="window.handleDragStart(event, 'polygon', ${polygon.id})"
         ondragend="window.handleDragEnd(event)"
         ondragover="window.handleDragOver(event)"
         ondrop="window.handleDrop(event, 'polygon', ${polygon.id})">
        <div class="polygon-header">
            <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
            <input type="text" class="polygon-name" value="${polygon.name}"
                   onchange="window.renamePolygon(${polygon.id}, this.value)">
            <input type="color" class="polygon-color" value="${polygon.color}"
                   onchange="window.updatePolygonColor(${polygon.id}, this.value)">
            <select class="polygon-group-select" onchange="window.assignPolygonToGroup(${polygon.id}, this.value ? parseInt(this.value) : null)">
                <option value="">No group</option>
                ${state.groups.map(g =>
                    `<option value="${g.id}" ${polygon.groupId === g.id ? 'selected' : ''}>${g.name}</option>`
                ).join('')}
            </select>
            <button class="btn-icon ${polygon.hidden ? 'btn-hidden-active' : ''}" onclick="window.toggleHidePolygon(${polygon.id})" title="${polygon.hidden ? 'Show' : 'Hide'}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    ${polygon.hidden ?
                        '<path d="M13.359 11.238C15.06 9.72 16 8 16 8s-3-5.5-8-5.5a7.028 7.028 0 0 0-2.79.588l.77.771A5.944 5.944 0 0 1 8 3.5c2.12 0 3.879 1.168 5.168 2.457A13.134 13.134 0 0 1 14.828 8c-.058.087-.122.183-.195.288-.335.48-.83 1.12-1.465 1.755-.165.165-.337.328-.517.486l.708.709z"/><path d="M11.297 9.176a3.5 3.5 0 0 0-4.474-4.474l.823.823a2.5 2.5 0 0 1 2.829 2.829l.822.822zm-2.943 1.299l.822.822a3.5 3.5 0 0 1-4.474-4.474l.823.823a2.5 2.5 0 0 0 2.829 2.829z"/><path d="M3.35 5.47c-.18.16-.353.322-.518.487A13.134 13.134 0 0 0 1.172 8l.195.288c.335.48.83 1.12 1.465 1.755C4.121 11.332 5.881 12.5 8 12.5c.716 0 1.39-.133 2.02-.36l.77.772A7.029 7.029 0 0 1 8 13.5C3 13.5 0 8 0 8s.939-1.721 2.641-3.238l.708.709z"/><path d="M13.646 14.354l-12-12 .708-.708 12 12-.708.708z"/>'
                        : '<path d="M10.5 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z"/><path d="M0 8s3-5.5 8-5.5S16 8 16 8s-3 5.5-8 5.5S0 8 0 8zm8 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/>'}
                </svg>
            </button>
            <button class="btn-icon ${isFocused ? 'btn-focused' : ''}" onclick="window.toggleFocusPolygon(${polygon.id})" title="${isFocused ? 'Show All' : 'Focus'}">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="8" cy="8" r="3"/>
                    <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z"/>
                </svg>
            </button>
            <button class="btn-icon btn-delete" onclick="window.deletePolygon(${polygon.id})" title="Delete Polygon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                    <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                </svg>
            </button>
        </div>
        <div class="polygon-body"
             ondragenter="window.handleFileDragEnter(event, ${polygon.id})"
             ondragleave="window.handleFileDragLeave(event)"
             ondragover="window.handleFileDragOver(event)"
             ondrop="window.handleFileDrop(event, ${polygon.id})">
            <div class="tracks-list">
                ${polygon.tracks.length === 0 ? '<p class="empty-state-small">No tracks yet</p>' : ''}
                ${polygon.tracks.map(track => `
                    <div class="track-item">
                        <span class="track-name" title="${track.name}">${track.name}</span>
                        <div class="track-actions">
                            <select class="track-move-select" onchange="window.handleMoveTrack(${track.id}, ${polygon.id}, this)">
                                <option value="">Move to...</option>
                                ${state.polygons.filter(p => p.id !== polygon.id).map(p =>
                                    `<option value="${p.id}">${p.name}</option>`
                                ).join('')}
                            </select>
                            <button class="btn-icon btn-delete-small" onclick="window.deleteTrack(${polygon.id}, ${track.id})" title="Delete Track">
                                ×
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="upload-area">
                <input type="file" id="gpx-upload-${polygon.id}" accept=".gpx" multiple style="display: none;"
                       onchange="window.handleGPXUploadEvent(${polygon.id}, this.files)">
                <button class="btn btn-secondary btn-small" onclick="document.getElementById('gpx-upload-${polygon.id}').click()">
                    + Add GPX Files
                </button>
            </div>
        </div>
    </div>
    `;
}

function handleMoveTrack(trackId, fromPolygonId, selectElement) {
    const toPolygonId = parseInt(selectElement.value);
    if (toPolygonId) {
        moveTrack(trackId, fromPolygonId, toPolygonId);
    }
    selectElement.value = '';
}

function handleGPXUploadEvent(polygonId, files) {
    handleGPXUpload(polygonId, Array.from(files));
}

function saveState() {
    state.mapState = mapManager.getMapState();
    saveToLocalStorage(state);
}

function restoreState() {
    // Restore polygons on map
    state.polygons.forEach(polygon => {
        updatePolygonOnMap(polygon);
    });

    // Restore map state
    if (state.mapState) {
        mapManager.setMapState(state.mapState);
    } else {
        mapManager.fitBounds();
    }

    renderPolygonList();
}

function handleDownloadSession() {
    state.mapState = mapManager.getMapState();
    downloadSession(state);
}

async function handleUploadSession(event) {
    const file = event.target.files[0];
    if (!file) return;

    try {
        const newState = await uploadSession(file);

        // Validate state structure
        if (!newState.polygons || !Array.isArray(newState.polygons)) {
            throw new Error('Invalid session file format');
        }

        // Clear current state
        mapManager.clear();

        // Load new state
        state = newState;

        // Ensure backwards compatibility
        if (!state.groups) {
            state.groups = [];
        }
        if (!state.nextGroupId) {
            state.nextGroupId = 1;
        }
        if (state.focusedPolygonId === undefined) {
            state.focusedPolygonId = null;
        }
        if (state.focusedGroupId === undefined) {
            state.focusedGroupId = null;
        }
        colorIndex = state.polygons.length;
        restoreState();
        saveState();

        alert('Session loaded successfully!');
    } catch (error) {
        console.error('Error loading session:', error);
        alert(`Error loading session: ${error.message}`);
    }

    // Reset file input
    event.target.value = '';
}

// Drag and drop state
let dragData = null;

// File drag and drop handlers
function handleFileDragEnter(event, polygonId) {
    event.preventDefault();
    event.stopPropagation();

    // Only show feedback if files are being dragged
    if (event.dataTransfer.types.includes('Files')) {
        const polygonBody = event.currentTarget;
        polygonBody.classList.add('file-drop-active');
    }
}

function handleFileDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();

    // Only remove if we're leaving the actual element, not entering a child
    const polygonBody = event.currentTarget;
    const relatedTarget = event.relatedTarget;

    if (!polygonBody.contains(relatedTarget)) {
        polygonBody.classList.remove('file-drop-active');
    }
}

function handleFileDragOver(event) {
    event.preventDefault();
    event.stopPropagation();

    // Set the drop effect for files
    if (event.dataTransfer.types.includes('Files')) {
        event.dataTransfer.dropEffect = 'copy';
    }
}

async function handleFileDrop(event, polygonId) {
    event.preventDefault();
    event.stopPropagation();

    // Remove visual feedback
    const polygonBody = event.currentTarget;
    polygonBody.classList.remove('file-drop-active');

    // Get dropped files
    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Filter for GPX files
    const gpxFiles = Array.from(files).filter(file =>
        file.name.toLowerCase().endsWith('.gpx')
    );

    if (gpxFiles.length === 0) {
        alert('Please drop GPX files (.gpx)');
        return;
    }

    // Use existing upload handler
    await handleGPXUpload(polygonId, gpxFiles);
}

function handleDragStart(event, type, id) {
    event.stopPropagation(); // Prevent polygon drag from triggering group drag
    dragData = { type, id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', JSON.stringify({ type, id }));
    event.target.closest(type === 'group' ? '.group-card' : '.polygon-card').classList.add('dragging');
}

function handleDragEnd(event) {
    dragData = null;
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation(); // Prevent bubbling
    event.dataTransfer.dropEffect = 'move';

    // Find the closest card, but prefer polygon-card over group-card
    const polygonCard = event.target.closest('.polygon-card');
    const groupCard = event.target.closest('.group-card');

    let targetCard = polygonCard || groupCard;

    if (targetCard && !targetCard.classList.contains('dragging')) {
        document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        targetCard.classList.add('drag-over');
    }
}

function handleDrop(event, targetType, targetId) {
    event.preventDefault();
    event.stopPropagation(); // Prevent bubbling to parent (e.g., group when dropping on polygon)

    if (!dragData) return;

    const { type: sourceType, id: sourceId } = dragData;

    if (sourceId === targetId) return;

    if (sourceType === 'group' && targetType === 'group') {
        // Reorder groups
        const sourceIndex = state.groups.findIndex(g => g.id === sourceId);
        const targetIndex = state.groups.findIndex(g => g.id === targetId);

        if (sourceIndex !== -1 && targetIndex !== -1) {
            const [removed] = state.groups.splice(sourceIndex, 1);
            state.groups.splice(targetIndex, 0, removed);
        }
    } else if (sourceType === 'polygon' && targetType === 'polygon') {
        // Reorder polygons and move to target's group
        const sourcePolygon = state.polygons.find(p => p.id === sourceId);
        const targetPolygon = state.polygons.find(p => p.id === targetId);

        if (sourcePolygon && targetPolygon) {
            // Move source polygon to target's group
            sourcePolygon.groupId = targetPolygon.groupId;

            // Reorder within the array
            const sourceIndex = state.polygons.findIndex(p => p.id === sourceId);
            const targetIndex = state.polygons.findIndex(p => p.id === targetId);

            if (sourceIndex !== -1 && targetIndex !== -1) {
                const [removed] = state.polygons.splice(sourceIndex, 1);
                state.polygons.splice(targetIndex, 0, removed);
            }
        }
    } else if (sourceType === 'polygon' && targetType === 'group') {
        // Move polygon into a group
        const sourcePolygon = state.polygons.find(p => p.id === sourceId);
        if (sourcePolygon) {
            sourcePolygon.groupId = targetId;
        }
    }

    renderPolygonList();
    updateMapVisibility();
    saveState();

    // Clean up
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
}

// Expose functions to window for inline event handlers
window.createPolygon = createPolygon;
window.deletePolygon = deletePolygon;
window.updatePolygonColor = updatePolygonColor;
window.renamePolygon = renamePolygon;
window.deleteTrack = deleteTrack;
window.handleMoveTrack = handleMoveTrack;
window.handleGPXUploadEvent = handleGPXUploadEvent;
window.toggleFocusPolygon = toggleFocusPolygon;
window.createGroup = createGroup;
window.deleteGroup = deleteGroup;
window.renameGroup = renameGroup;
window.toggleGroupCollapse = toggleGroupCollapse;
window.assignPolygonToGroup = assignPolygonToGroup;
window.toggleFocusGroup = toggleFocusGroup;
window.toggleHidePolygon = toggleHidePolygon;
window.toggleHideGroup = toggleHideGroup;
window.handleDragStart = handleDragStart;
window.handleDragEnd = handleDragEnd;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.handleFileDragEnter = handleFileDragEnter;
window.handleFileDragLeave = handleFileDragLeave;
window.handleFileDragOver = handleFileDragOver;
window.handleFileDrop = handleFileDrop;
window.handleUploadZoneDragEnter = handleUploadZoneDragEnter;
window.handleUploadZoneDragLeave = handleUploadZoneDragLeave;
window.handleUploadZoneDragOver = handleUploadZoneDragOver;
window.handleUploadZoneDrop = handleUploadZoneDrop;

// Sidebar resize functionality
function initSidebarResize() {
    const sidebar = document.getElementById('sidebar');
    const resizeHandle = document.getElementById('sidebar-resize-handle');
    const mapContainer = document.querySelector('.map-container');

    if (!resizeHandle || !sidebar) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const newWidth = startWidth + (e.clientX - startX);
        const minWidth = 280;
        const maxWidth = 600;

        if (newWidth >= minWidth && newWidth <= maxWidth) {
            sidebar.style.width = newWidth + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        }
    });
}

// Mobile menu toggle functionality
function initMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const overlay = document.getElementById('mobile-overlay');

    if (!menuToggle || !sidebar || !overlay) return;

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    });

    overlay.addEventListener('click', () => {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    });

    // Close sidebar when selecting a polygon or performing actions on mobile
    if (window.innerWidth <= 768) {
        // Add click handlers to important actions that should close the sidebar
        const closeOnClick = [
            'create-polygon',
            'create-group',
            'polygon-select',
            'exit-edit-mode'
        ];

        closeOnClick.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('click', () => {
                    setTimeout(() => {
                        sidebar.classList.remove('active');
                        overlay.classList.remove('active');
                    }, 100);
                });
            }
        });
    }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        init();
        initSidebarResize();
        initMobileMenu();
    });
} else {
    init();
    initSidebarResize();
    initMobileMenu();
}

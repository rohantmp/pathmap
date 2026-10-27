import 'leaflet/dist/leaflet.css';
import { Editor } from './editor.js';
import { migrateSession, cleanAnnotations } from './editor-state.js';
import { clone } from './geometry.js';
import { MapManager } from './map-manager.js';
import { parseGPXFile, getGPXName } from './gpx-parser.js';
import { mergeConvexHulls } from './convex-hull.js';
import { saveToLocalStorage, loadFromLocalStorage, downloadSession, uploadSession } from './storage.js';
import { renderComposite, exportComposite, exportKML, exportGeoJSON, exportTracksGeoJSON } from './export.js';
import { transliterateSimplified } from './transliteration.js';
import { EXAMPLE_CATALOG, createExample } from './example-sessions.js';

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
let editor;
let storageRecovery = false;

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
    let savedState;
    try {
        savedState = loadFromLocalStorage();
        if (savedState) savedState = migrateSession(savedState);
    } catch (error) {
        alert(`Stored session could not be opened: ${error.message} The stored copy is unchanged; autosave is paused until you Load a valid session or Clear All.`);
        savedState = null;
        storageRecovery = true;
    }
    if (savedState) {
        state = migrateSession(savedState);
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
    document.getElementById('load-example-session').addEventListener('click', () => loadExampleSession());
    setupExampleMenu();
    // Editor installs the polygon selection and draft controls.

    // Collapsible upload section
    const uploadToggle = document.getElementById('toggle-upload-section');
    const uploadSection = document.getElementById('upload-section');

    if (uploadToggle && uploadSection) {
        uploadToggle.addEventListener('click', () => {
            const isOpen = uploadSection.style.display !== 'none';
            uploadSection.style.display = isOpen ? 'none' : 'block';
            uploadToggle.classList.toggle('active', !isOpen);
        });
    }

    // New collapsible settings panel
    const settingsToggle = document.getElementById('toggle-settings-panel');
    const settingsContainer = document.getElementById('settings-container');

    if (settingsToggle && settingsContainer) {
        settingsToggle.addEventListener('click', () => {
            const isOpen = settingsContainer.style.display !== 'none';
            settingsContainer.style.display = isOpen ? 'none' : 'block';
            settingsToggle.classList.toggle('active', !isOpen);
        });
    }

    // Tab navigation
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;

            // Update active tab button
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Show corresponding content
            tabContents.forEach(content => {
                content.style.display = content.id === `${targetTab}-tab` ? 'block' : 'none';
            });

            // Handle special tab actions
            if (targetTab === 'edit') {
                populatePolygonSelect();
            }
        });
    });
    document.getElementById('export-png').addEventListener('click', () => openExportDialog('png'));
    document.getElementById('export-pdf').addEventListener('click', () => openExportDialog('pdf'));
    document.getElementById('export-kml').addEventListener('click', handleExportKML);
    document.getElementById('export-geojson').addEventListener('click', handleExportGeoJSON);
    document.getElementById('export-tracks-geojson').addEventListener('click', handleExportTracksGeoJSON);

    // Set up settings panel sliders
    setupSettingsSliders();

    // Set up the export dialog
    setupExportDialog();

    // When served as the /v2/ preview beside the deployed v1, offer a way back
    setupVersionLink();

    // Persist the map position when the user pans/zooms (debounced)
    let mapStateSaveTimer = null;
    mapManager.map.on('moveend', () => {
        clearTimeout(mapStateSaveTimer);
        mapStateSaveTimer = setTimeout(saveState, 500);
    });

    state = migrateSession(state);
    window.pathmapBroadOutline = tracks => mergeConvexHulls(tracks.map(t => t.points));
    window.pathmapCloseSidebar = closeSidebarOnMobile;
    editor = new Editor({
        map: mapManager,
        getState: () => state,
        replace: next => { state = migrateSession(next); },
        save: saveState,
        render: () => { updateMapVisibility(); renderPolygonList(); }
    });
    window.selectPolygonForEdit = id => editor.select(id);
    renderPolygonList();
}

/**
 * The dual deploy serves the released v1 at the parent path and this build at /v2/.
 */
function setupVersionLink() {
    // Decided from the URL, not the build: the single-file build uses a relative base ("./")
    const link = document.getElementById('version-link');
    const match = window.location.pathname.match(/^(.*\/)v2\/(?:index\.html)?$/);
    if (!link || !match) return;
    link.href = match[1];
    link.hidden = false;
}

/**
 * Escape a string for safe interpolation into HTML markup/attributes
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function populatePolygonSelect() {
    if (editor?.draft) return;
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

function exitEditMode() {
    if (editor?.draft) editor.cancel();
    else mapManager.exitEditMode();
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

function getPolygonsToExport() { return state.polygons.filter(isPolygonVisible); }

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
    if(editor?.draft){editor.status('Apply or cancel the draft before adding source data.');return;}
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
                    points: points,
                segments: points.sourceSegments
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
    if (files.length > errors.length) {
        closeSidebarOnMobile();
    }

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

    if (state.focusedGroupId === groupId) {
        state.focusedGroupId = null;
    }
    state.groups = state.groups.filter(g => g.id !== groupId);
    updateMapVisibility();
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
        updateMapVisibility();
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

    if (mapManager.editingPolygonId === polygonId) {
        exitEditMode();
    }

    state.polygons = state.polygons.filter(p => p.id !== polygonId);
    if (state.focusedPolygonId === polygonId) {
        state.focusedPolygonId = null;
    }
    mapManager.removePolygon(polygonId);
    updateMapVisibility();
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

/**
 * Whether a polygon should currently be drawn on the map, taking
 * hidden flags and polygon/group focus into account.
 */
function isPolygonVisible(polygon) {
    if (polygon.hidden) return false;

    if (polygon.groupId) {
        const group = state.groups.find(g => g.id === polygon.groupId);
        if (group && group.hidden) return false;
    }

    if (state.focusedPolygonId !== null) {
        return state.focusedPolygonId === polygon.id;
    }
    if (state.focusedGroupId !== null) {
        return polygon.groupId === state.focusedGroupId;
    }
    return true;
}

function updateMapVisibility() {
    state.polygons.forEach(polygon => updatePolygonOnMap(polygon, true));
    mapManager.refreshAllLabels();
    renderGroupBoundaries();
}

function updatePolygonColor(polygonId, color) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.color = color;
        updatePolygonOnMap(polygon, true); // Skip fitBounds for color-only changes
        saveState();
    }
}

function renamePolygon(polygonId, newName) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        polygon.name = newName;
        updatePolygonOnMap(polygon, true); // Refresh the map label without moving the view
        renderPolygonList();
        saveState();
    }
}

function transliteratePolygonName(polygonId) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (polygon) {
        const { result } = transliterateSimplified(polygon.name);
        // Only update if we get a valid result
        if (result && result.trim()) {
            polygon.name = result;
            updatePolygonOnMap(polygon, true); // Skip fitBounds for name-only changes
            renderPolygonList();
            saveState();
        }
    }
}

function transliterateTrackName(polygonId, trackId) {
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    const track = polygon.tracks.find(t => t.id === trackId);
    if (track) {
        const { result } = transliterateSimplified(track.name);
        if (result && result.trim()) {
            track.name = result;
            renderPolygonList();
            saveState();
        }
    }
}

async function handleGPXUpload(polygonId, files) {
    if(editor?.draft){editor.status('Apply or cancel the draft before adding source data.');return;}
    const polygon = state.polygons.find(p => p.id === polygonId);
    if (!polygon) return;

    for (const file of files) {
        try {
            const points = await parseGPXFile(file);
            const name = await getGPXName(file);

            polygon.tracks.push({
                id: Date.now() + Math.random(), // Unique ID for track
                name: name,
                points: points,
                segments: points.sourceSegments
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
    const nodeIds = new Set((polygon.hull || []).map(v => v.id));
    const hasSharedNodes = state.polygons.some(p => p.id !== polygon.id &&
        (p.hull || []).some(v => v.id && nodeIds.has(v.id)));
    if (polygon.boundary?.manual || polygon.boundary?.follow || hasSharedNodes) {
        polygon.boundary.sourceChanged = true;
        return; // Source changes must never silently replace a committed or shared boundary.
    }
    if (polygon.tracks.length === 0) {
        polygon.hull = null;
        return;
    }

    const allPointArrays = polygon.tracks.map(t => t.points);
    polygon.hull = mergeConvexHulls(allPointArrays);
    Object.assign(polygon, migrateSession({polygons:[polygon]}).polygons[0]);
}

function updatePolygonOnMap(polygon, skipFitBounds = false) {
    if (polygon.hull && polygon.hull.length >= 3 && isPolygonVisible(polygon)) {
        mapManager.addPolygon(polygon.id, polygon.hull, polygon.color, polygon.name, skipFitBounds);

        if (mapManager.showTracks) {
            mapManager.addTracks(polygon.id, polygon.tracks, polygon.color);
        }
    } else {
        mapManager.removePolygon(polygon.id);
    }
}

function handleToggleTracks(event) {
    mapManager.setShowTracks(event.target.checked);
    // Re-sync every polygon so tracks only appear for polygons that are actually shown
    updateMapVisibility();
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

        const groupPolygons = state.polygons.filter(p => p.groupId === group.id && p.hull && isPolygonVisible(p));
        if (groupPolygons.length === 0) return;

        // Convex hull of all member polygon hulls
        const groupHull = mergeConvexHulls(groupPolygons.map(p => p.hull));
        if (groupHull.length < 3) return;

        mapManager.addGroupBoundary(group.id, groupHull, group.name);
    });
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
    if (state.polygons.length === 0 && state.groups.length === 0 && !state.annotations.custom.length && !storageRecovery) {
        return;
    }

    if (!confirm('Are you sure you want to clear all polygons, groups and custom labels?')) {
        return;
    }

    exitEditMode();
    mapManager.clear();

    // Reset state
    storageRecovery=false;
    state.polygons = [];
    state.groups = [];
    state.annotations = {names:{},coordinates:{},custom:[]};
    state.noOverlap = false;
    delete state.exampleId;
    state.focusedPolygonId = null;
    state.focusedGroupId = null;
    colorIndex = 0;

    renderPolygonList();
    saveState();
    editor?.setLabelEditing(false);
}

function handleAreaUnitChange(event) {
    const unit = event.target.value;
    mapManager.setAreaUnit(unit);
    // Refresh all polygons to update tooltips
    updateMapVisibility();
}

function renderPolygonList() {
    renderExampleGuide();
    const container = document.getElementById('polygons-list');

    if (state.polygons.length === 0 && state.groups.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <p>No polygons yet. Drop GPX files above to get started.</p>
                <button type="button" class="btn btn-secondary" onclick="window.loadExampleSession()">Load example session</button>
                <small>Six farm plots near Kanchipuram with tracks, groups and export text.</small>
            </div>`;
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
                <input type="text" class="group-name" value="${escapeHtml(group.name)}"
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
    <div class="polygon-card ${isDimmed ? 'polygon-hidden' : ''} ${inGroup ? 'in-group' : ''} ${editor?.selected===polygon.id?'editor-selected':''}" data-polygon-id="${polygon.id}" draggable="true"
         ondragstart="window.handleDragStart(event, 'polygon', ${polygon.id})"
         ondragend="window.handleDragEnd(event)"
         ondragover="window.handleDragOver(event)"
         ondrop="window.handleDrop(event, 'polygon', ${polygon.id})">
        <div class="polygon-header">
            <div class="editor-card-actions"><button class="btn btn-secondary btn-small edit-polygon" onclick="window.selectPolygonForEdit(${polygon.id})">Edit boundary</button><small>${polygon.boundary?.sourceChanged ? 'Source changed · boundary preserved' : polygon.boundary?.manual ? 'Manual boundary' : polygon.boundary?.follow ? 'Following path' : 'Broad outline'}${polygon.locked?' · Locked':''}</small></div>
            <div class="polygon-header-row">
                <span class="drag-handle" title="Drag to reorder">⋮⋮</span>
                <input type="text" class="polygon-name" value="${escapeHtml(polygon.name)}"
                       onchange="window.renamePolygon(${polygon.id}, this.value)">
                <button class="btn-icon btn-transliterate" onclick="window.transliteratePolygonName(${polygon.id})" title="Transliterate (Tamil ↔ Latin)">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M4.545 6.714L4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z"/>
                        <path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h3V7a2 2 0 0 1 2-2h3V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14V8h-3v1.047h.765c-.318.844-.74 1.546-1.272 2.13a6.066 6.066 0 0 1-.415-.492 1.988 1.988 0 0 1-.94.31z"/>
                    </svg>
                </button>
            </div>
            <div class="polygon-header-row">
                <input type="color" class="polygon-color" value="${polygon.color}"
                       onchange="window.updatePolygonColor(${polygon.id}, this.value)">
                <select class="polygon-group-select" onchange="window.assignPolygonToGroup(${polygon.id}, this.value ? parseInt(this.value) : null)">
                    <option value="">No group</option>
                    ${state.groups.map(g =>
                        `<option value="${g.id}" ${polygon.groupId === g.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`
                    ).join('')}
                </select>
                <div class="polygon-actions">
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
            </div>
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
                        <div class="track-row">
                            <span class="track-name" title="${escapeHtml(track.name)}">${escapeHtml(track.name)}</span>
                            <button class="btn-icon btn-transliterate-small" onclick="window.transliterateTrackName(${polygon.id}, ${track.id})" title="Transliterate (Tamil ↔ Latin)">
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M4.545 6.714L4.11 8H3l1.862-5h1.284L8 8H6.833l-.435-1.286H4.545zm1.634-.736L5.5 3.956h-.049l-.679 2.022H6.18z"/>
                                    <path d="M0 2a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-3H2a2 2 0 0 1-2-2V2zm2-1a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h3V7a2 2 0 0 1 2-2h3V2a1 1 0 0 0-1-1H2zm7.138 9.995c.193.301.402.583.63.846-.748.575-1.673 1.001-2.768 1.292.178.217.451.635.555.867 1.125-.359 2.08-.844 2.886-1.494.777.665 1.739 1.165 2.93 1.472.133-.254.414-.673.629-.89-1.125-.253-2.057-.694-2.82-1.284.681-.747 1.222-1.651 1.621-2.757H14V8h-3v1.047h.765c-.318.844-.74 1.546-1.272 2.13a6.066 6.066 0 0 1-.415-.492 1.988 1.988 0 0 1-.94.31z"/>
                                </svg>
                            </button>
                            <button class="btn-icon btn-delete-small" onclick="window.deleteTrack(${polygon.id}, ${track.id})" title="Delete Track">
                                ×
                            </button>
                        </div>
                        <div class="track-row">
                            <select class="track-move-select" onchange="window.handleMoveTrack(${track.id}, ${polygon.id}, this)">
                                <option value="">Move to...</option>
                                ${state.polygons.filter(p => p.id !== polygon.id).map(p =>
                                    `<option value="${p.id}">${escapeHtml(p.name)}</option>`
                                ).join('')}
                            </select>
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

function saveState(record = true) {
    if (storageRecovery) {
        editor?.status("Autosave paused to protect the unreadable stored session. Load a valid file or Clear All to replace it.");
        return false;
    }
    try {
        state = migrateSession(state);
    } catch (error) {
        if (editor) {
            state = clone(editor.history.current);
            updateMapVisibility();
            renderPolygonList();
            editor.status(error.message);
        } else console.error(error);
        return false;
    }
    cleanAnnotations(state);
    state.mapState = mapManager.getMapState();
    const persisted=saveToLocalStorage(state);
    if(record) editor?.changed();
    if(!persisted)editor?.status('Could not auto-save. Use Save to download a backup.');
    return persisted;
}

function restoreState() {
    state = migrateSession(state);
    mapManager.labelManager.placements = state.annotations;
    // Restore polygons on map (respecting hidden/focus flags)
    updateMapVisibility();

    // Restore map state
    if (state.mapState) {
        mapManager.setMapState(state.mapState);
    } else {
        mapManager.fitBounds();
    }

    renderPolygonList();
}

function handleDownloadSession() {
    if(editor?.draft) { editor.status("Apply or cancel the draft before saving a session."); return; }
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

        const checkedState = migrateSession(newState);

        // Clear current state
        exitEditMode();
        mapManager.clear();

        // Load new state
        const validated = checkedState;
        state = validated;
        storageRecovery=false;

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
        editor?.reset();
        closeSidebarOnMobile();

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

    if (sourceType === targetType && sourceId === targetId) return;

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

// ---------------------------------------------------------------------------
// Bundled example session
// ---------------------------------------------------------------------------

function loadExampleSession(id = 'farm') {
    const prepared = createExample(id);
    if (state.polygons.length > 0 || state.groups.length > 0 || state.annotations.custom.length || editor?.draft || storageRecovery) {
        if (!confirm('Loading the example replaces your current session (save it first if you want to keep it). Continue?')) {
            return;
        }
    }

    // Deep copy so the bundled data is never mutated
    const example = prepared.state;
    example.polygons.forEach(polygon => { if (!polygon.hull) updatePolygonHull(polygon); });

    exitEditMode();
    mapManager.clear();
    state = migrateSession(example);
    storageRecovery = false;
    colorIndex = state.polygons.length;
    exportRenames = {};

    // Turn on the display options the example is meant to show off
    // Coordinate labels crowd a phone screen, so only switch them on for larger layouts
    setCheckbox('toggle-labels', !!prepared.definition.coordinates && !isMobileLayout(), (checked) => mapManager.setShowLabels(checked));
    setCheckbox('toggle-area', true, (checked) => mapManager.setShowAreaOnMap(checked));
    setCheckbox('toggle-group-bounds', !!prepared.definition.groups, (checked) => mapManager.setShowGroupBounds(checked));

    restoreState();
    saveState();

    editor?.reset();
    closeExampleMenu();
    renderExampleGuide();

    // Pre-fill the export dialog with front matter that suits the example
    applyExportPrefs(prepared.prefs);
    try {
        localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prepared.prefs));
    } catch (error) {
        console.warn('Could not save export preferences:', error);
    }

    closeSidebarOnMobile();
}

let exampleMenuReturnFocus;
function openExampleMenu() {
    exampleMenuReturnFocus = document.activeElement;
    document.getElementById('examples-modal').hidden = false;
    document.getElementById('example-cards').innerHTML = EXAMPLE_CATALOG.map(example => `
        <button type="button" class="example-card ${state.exampleId === example.id ? 'is-loaded' : ''}" data-example-id="${example.id}">
            <strong>${escapeHtml(example.title)}${state.exampleId === example.id ? ' · loaded' : ''}</strong>
            <span>${escapeHtml(example.description)}</span>
        </button>`).join('');
    document.getElementById('examples-close').focus();
}
function closeExampleMenu() {
    const modal=document.getElementById('examples-modal');
    if(modal.hidden)return;
    modal.hidden=true;
    exampleMenuReturnFocus?.focus({preventScroll:true});
}
function setupExampleMenu() {
    document.getElementById('open-examples').onclick=openExampleMenu;
    document.getElementById('browse-examples').onclick=openExampleMenu;
    document.getElementById('examples-close').onclick=closeExampleMenu;
    document.getElementById('examples-modal').onclick=e=>{if(e.target===e.currentTarget)closeExampleMenu();};
    document.getElementById('example-cards').onclick=e=>{const button=e.target.closest('[data-example-id]');if(button)loadExampleSession(button.dataset.exampleId);};
    document.getElementById('example-try').onclick=()=>{
        const example=EXAMPLE_CATALOG.find(e=>e.id===state.exampleId);if(!example)return;
        if(example.action==='export'){if(editor.leaveDraft())openExportDialog('png');}
        else if(example.action==='labels'){if(editor.leaveDraft()){editor.setLabelEditing(true);editor.openLabels();}}
        else {editor.select(example.target);if(example.vertex!==undefined){mapManager.onVertexSelect?.(example.vertex);mapManager.vertexMarkers[example.vertex]?.getElement()?.focus({preventScroll:true});}}
    };
    document.addEventListener('keydown',e=>{
        const modal=document.getElementById('examples-modal');if(modal.hidden)return;
        if(e.key==='Escape'){e.preventDefault();closeExampleMenu();}
        else if(e.key==='Tab'){
            const buttons=[...modal.querySelectorAll('button')],first=buttons[0],last=buttons.at(-1);
            if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
            else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
        }
    });
}
function renderExampleGuide() {
    const guide=document.getElementById('example-guide');
    const example=EXAMPLE_CATALOG.find(e=>e.id===state.exampleId);
    guide.hidden=!example;if(!example)return;
    document.getElementById('example-guide-title').textContent=example.title;
    document.getElementById('example-guide-hint').textContent=example.hint;
    document.getElementById('example-try').textContent=example.action==='export'?'Open grayscale export':example.action==='labels'?'Edit labels and key':'Try boundary editing';
}

function setCheckbox(id, checked, apply) {
    const checkbox = document.getElementById(id);
    if (!checkbox) return;
    checkbox.checked = checked;
    apply(checked);
}

// ---------------------------------------------------------------------------
// Export dialog (PNG / PDF with front matter and export-only polygon renames)
// ---------------------------------------------------------------------------

const EXPORT_PREFS_KEY = 'pathmap_export_prefs';

// Export-only names, kept in memory for the page lifetime; never written to the session
let exportRenames = {};

function setupExportDialog() {
    const modal = document.getElementById('export-modal');
    if (!modal) return;

    document.getElementById('export-modal-close').addEventListener('click', closeExportDialog);
    document.getElementById('export-cancel').addEventListener('click', closeExportDialog);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeExportDialog();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !modal.hidden && !modal.querySelector('.modal').classList.contains('is-busy')) {
            closeExportDialog();
        }
    });
    document.getElementById('export-form').addEventListener('submit', (event) => event.preventDefault());
    document.getElementById('export-run-png').addEventListener('click', () => runCompositeExport('png'));
    document.getElementById('export-run-pdf').addEventListener('click', () => runCompositeExport('pdf'));

    document.getElementById('export-preview-button').addEventListener('click',()=>runCompositeExport('png',true));
    // Restore the last-used front matter and options
    try {
        applyExportPrefs(JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || 'null'));
    } catch (error) {
        console.warn('Could not restore export preferences:', error);
    }
}

function applyExportPrefs(prefs) {
    if (!prefs || typeof prefs !== 'object') return;
    if (typeof prefs.title === 'string') document.getElementById('export-title').value = prefs.title;
    if (typeof prefs.notes === 'string') document.getElementById('export-notes').value = prefs.notes;
    if (prefs.placement) document.getElementById('export-placement').value = prefs.placement;
    if (typeof prefs.legend === 'boolean') document.getElementById('export-legend').checked = prefs.legend;
    if (prefs.pageSize) document.getElementById('export-page-size').value = prefs.pageSize;
    if (prefs.orientation) document.getElementById('export-orientation').value = prefs.orientation;
    if (prefs.appearance) document.getElementById('export-appearance').value = prefs.appearance;
}

/**
 * Polygons that are currently drawn on the map, in sidebar order
 */
function getPolygonsForCompositeExport() {
    const onMap = new Set(mapManager.getPolygonsOnMap().map(p => p.id));
    return state.polygons.filter(p => onMap.has(p.id));
}

function openExportDialog(format) {
    const modal = document.getElementById('export-modal');
    const list = document.getElementById('export-rename-list');
    const polygons = getPolygonsForCompositeExport();

    if (polygons.length === 0) {
        list.innerHTML = '<p class="empty-state-small">No polygons are shown on the map. The export will contain the map view only.</p>';
    } else {
        list.innerHTML = polygons.map(polygon => {
            const current = exportRenames[polygon.id] !== undefined ? exportRenames[polygon.id] : polygon.name;
            return `
            <div class="export-rename-row" data-polygon-id="${polygon.id}">
                <span class="export-rename-swatch" style="background: ${escapeHtml(polygon.color)}"></span>
                <span class="export-rename-original" title="${escapeHtml(polygon.name)}">${escapeHtml(polygon.name)}</span>
                <input type="text" value="${escapeHtml(current)}" data-original="${escapeHtml(polygon.name)}" aria-label="Export name for ${escapeHtml(polygon.name)}">
            </div>`;
        }).join('');
    }

    // Make the button matching the entry point the primary action
    const pngButton = document.getElementById('export-run-png');
    const pdfButton = document.getElementById('export-run-pdf');
    pngButton.classList.toggle('btn-primary', format === 'png');
    pngButton.classList.toggle('btn-secondary', format !== 'png');
    pdfButton.classList.toggle('btn-primary', format === 'pdf');
    pdfButton.classList.toggle('btn-secondary', format !== 'pdf');

    document.getElementById('export-status').textContent = '';
    if (state.exportPrefs) applyExportPrefs(state.exportPrefs);
    document.getElementById('export-preview-wrap').hidden = true;
    modal.hidden = false;
    document.getElementById('export-title').focus();
}

function closeExportDialog() {
    rememberExportRenames();
    document.getElementById('export-modal').hidden = true;
}

function rememberExportRenames() {
    document.querySelectorAll('#export-rename-list .export-rename-row').forEach(row => {
        const id = parseInt(row.dataset.polygonId, 10);
        const input = row.querySelector('input');
        if (!input) return;
        const value = input.value.trim();
        if (value && value !== input.dataset.original) {
            exportRenames[id] = value;
        } else {
            delete exportRenames[id];
        }
    });
}

function readExportForm() {
    return {
        title: document.getElementById('export-title').value,
        notes: document.getElementById('export-notes').value,
        placement: document.getElementById('export-placement').value,
        legend: document.getElementById('export-legend').checked,
        pageSize: document.getElementById('export-page-size').value,
        orientation: document.getElementById('export-orientation').value,
        appearance: document.getElementById('export-appearance').value
    };
}

async function runCompositeExport(format, preview = false) {
    if (editor?.draft) { editor.status("Apply or cancel the draft before export."); return; }
    const modalCard = document.querySelector('#export-modal .modal');
    const status = document.getElementById('export-status');
    if (modalCard.classList.contains('is-busy')) return;

    rememberExportRenames();
    const form = readExportForm();
    try {
        localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(form));
    } catch (error) {
        console.warn('Could not save export preferences:', error);
    }

    const polygons = getPolygonsForCompositeExport();
    const overrides = {};
    polygons.forEach(polygon => {
        if (exportRenames[polygon.id] !== undefined) {
            overrides[polygon.id] = exportRenames[polygon.id];
        }
    });

    const legend = form.legend && !state.layout.legend.onMap
        ? polygons.map((polygon,index) => ({
            name: `${form.appearance==='grayscale'?(index+1)+' · ':''}${overrides[polygon.id] !== undefined ? overrides[polygon.id] : polygon.name}`,
            color: polygon.color,
            area: mapManager.formatArea(mapManager.calculateArea(polygon.hull))
        }))
        : null;

    modalCard.classList.add('is-busy');
    status.textContent = `Rendering ${format.toUpperCase()}…`;

    if(form.appearance==='grayscale')polygons.forEach((p,i)=>{overrides[p.id]=`${i+1} · ${overrides[p.id]??p.name}`});
    const key=document.getElementById('map-key'),wasHidden=key.hidden,keyHtml=key.innerHTML;
    if(!form.legend)key.hidden=true;
    else key.querySelectorAll(':scope > div > span').forEach((span,i)=>{if(polygons[i])span.textContent=`${i+1} · ${exportRenames[polygons[i].id]??polygons[i].name}`});
    // Relabel the map for the duration of the capture only
    const restoreNames = mapManager.applyNameOverrides(overrides);
    try {
        const page = await (preview ? renderComposite : exportComposite)({
            format,
            mapElement: document.getElementById('map'),
            frontMatter: { title: form.title, body: form.notes },
            placement: form.placement,
            legend,
            pageSize: form.pageSize,
            orientation: form.orientation,
            appearance: form.appearance,
            filenameBase: form.title && form.title.trim() ? form.title : 'pathmap-export'
        });
        state.exportPrefs = form;
        saveState();
        status.textContent = preview ? 'Preview matches the export page. Refresh after changing options.' : '';
        if(preview){document.getElementById('export-preview-image').src=page.dataUrl;document.getElementById('export-preview-wrap').hidden=false;}
        else closeExportDialog();
    } catch (error) {
        console.error('Export failed:', error);
        status.textContent = '';
        alert(error.message);
    } finally {
        restoreNames();
        key.hidden=wasHidden;key.innerHTML=keyHtml;
        modalCard.classList.remove('is-busy');
    }
}

// Expose functions to window for inline event handlers
window.loadExampleSession = loadExampleSession;
window.deletePolygon = deletePolygon;
window.updatePolygonColor = updatePolygonColor;
window.renamePolygon = renamePolygon;
window.transliteratePolygonName = transliteratePolygonName;
window.transliterateTrackName = transliterateTrackName;
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
function isMobileLayout() {
    return window.matchMedia('(max-width: 768px)').matches;
}

function closeSidebarOnMobile() {
    if (!isMobileLayout()) return;
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (sidebar) sidebar.classList.remove('active');
    if (overlay) overlay.classList.remove('active');
}

function initMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('mobile-menu-toggle');
    const closeButton = document.getElementById('sidebar-close');
    const overlay = document.getElementById('mobile-overlay');

    if (!menuToggle || !sidebar || !overlay) return;

    menuToggle.addEventListener('click', () => {
        sidebar.classList.toggle('active');
        overlay.classList.toggle('active');
    });

    const close = () => {
        sidebar.classList.remove('active');
        overlay.classList.remove('active');
    };
    overlay.addEventListener('click', close);
    if (closeButton) {
        closeButton.addEventListener('click', close);
    }

    // Actions whose result is on the map: close the sidebar so it is visible on phones.
    // (Checked at click time, so rotating or resizing the window is handled.)
    ['polygon-select', 'exit-edit-mode'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', () => setTimeout(closeSidebarOnMobile, 100));
            element.addEventListener('click', () => setTimeout(closeSidebarOnMobile, 100));
        }
    });
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

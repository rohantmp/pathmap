import { MapManager } from './map-manager.js';
import { parseGPXFile, getGPXName } from './gpx-parser.js';
import { mergeConvexHulls } from './convex-hull.js';
import { saveToLocalStorage, loadFromLocalStorage, downloadSession, uploadSession } from './storage.js';

// Application state
let state = {
    polygons: [], // { id, name, color, tracks: [{ name, points }], hull }
    nextPolygonId: 1,
    mapState: null
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

    // Load saved session
    const savedState = loadFromLocalStorage();
    if (savedState) {
        state = savedState;
        colorIndex = state.polygons.length;
        restoreState();
    }

    // Set up event listeners
    document.getElementById('create-polygon').addEventListener('click', createPolygon);
    document.getElementById('toggle-tracks').addEventListener('change', handleToggleTracks);
    document.getElementById('toggle-debug-fields').addEventListener('change', handleToggleDebugFields);
    document.getElementById('download-session').addEventListener('click', handleDownloadSession);
    document.getElementById('upload-session').addEventListener('click', () => {
        document.getElementById('session-file-input').click();
    });
    document.getElementById('session-file-input').addEventListener('change', handleUploadSession);
    document.getElementById('toggle-settings').addEventListener('click', toggleSettings);

    // Set up settings panel sliders
    setupSettingsSliders();

    renderPolygonList();
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
        { id: 'iterations', valueId: 'iterations-value', format: v => v }
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
        iterations: parseInt(document.getElementById('iterations').value)
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
    document.getElementById('iterations').value = 200;
    document.getElementById('iterations-value').textContent = '200';

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
        hull: null
    };

    state.polygons.push(polygon);
    renderPolygonList();
    saveState();
}

function deletePolygon(polygonId) {
    if (!confirm('Are you sure you want to delete this polygon?')) {
        return;
    }

    state.polygons = state.polygons.filter(p => p.id !== polygonId);
    mapManager.removePolygon(polygonId);
    renderPolygonList();
    saveState();
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

function handleToggleDebugFields(event) {
    const showDebug = event.target.checked;
    mapManager.labelManager.toggleDebugFields(showDebug);
}

function renderPolygonList() {
    const container = document.getElementById('polygons-list');

    if (state.polygons.length === 0) {
        container.innerHTML = '<p class="empty-state">No polygons yet. Create one to get started!</p>';
        return;
    }

    container.innerHTML = state.polygons.map(polygon => `
        <div class="polygon-card" data-polygon-id="${polygon.id}">
            <div class="polygon-header">
                <input type="text" class="polygon-name" value="${polygon.name}"
                       onchange="window.renamePolygon(${polygon.id}, this.value)">
                <input type="color" class="polygon-color" value="${polygon.color}"
                       onchange="window.updatePolygonColor(${polygon.id}, this.value)">
                <button class="btn-icon btn-delete" onclick="window.deletePolygon(${polygon.id})" title="Delete Polygon">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
            <div class="polygon-body">
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
    `).join('');
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

// Expose functions to window for inline event handlers
window.createPolygon = createPolygon;
window.deletePolygon = deletePolygon;
window.updatePolygonColor = updatePolygonColor;
window.renamePolygon = renamePolygon;
window.deleteTrack = deleteTrack;
window.handleMoveTrack = handleMoveTrack;
window.handleGPXUploadEvent = handleGPXUploadEvent;

// Initialize on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

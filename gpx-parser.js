/**
 * Parse GPX file and extract all track points
 * @param {File} file - GPX file
 * @returns {Promise<Array<{lat: number, lon: number}>>} Array of coordinates
 */
export async function parseGPXFile(file) {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'text/xml');

    const points = [];

    // Parse track points (trkpt)
    const trackPoints = xmlDoc.getElementsByTagName('trkpt');
    for (let i = 0; i < trackPoints.length; i++) {
        const point = trackPoints[i];
        const lat = parseFloat(point.getAttribute('lat'));
        const lon = parseFloat(point.getAttribute('lon'));

        if (!isNaN(lat) && !isNaN(lon)) {
            points.push({ lat, lon });
        }
    }

    // Also parse waypoints (wpt) if present
    const waypoints = xmlDoc.getElementsByTagName('wpt');
    for (let i = 0; i < waypoints.length; i++) {
        const point = waypoints[i];
        const lat = parseFloat(point.getAttribute('lat'));
        const lon = parseFloat(point.getAttribute('lon'));

        if (!isNaN(lat) && !isNaN(lon)) {
            points.push({ lat, lon });
        }
    }

    // Parse route points (rtept) if present
    const routePoints = xmlDoc.getElementsByTagName('rtept');
    for (let i = 0; i < routePoints.length; i++) {
        const point = routePoints[i];
        const lat = parseFloat(point.getAttribute('lat'));
        const lon = parseFloat(point.getAttribute('lon'));

        if (!isNaN(lat) && !isNaN(lon)) {
            points.push({ lat, lon });
        }
    }

    return points;
}

/**
 * Get the name from GPX file metadata
 * @param {File} file - GPX file
 * @returns {Promise<string>} Track name or filename
 */
export async function getGPXName(file) {
    try {
        const text = await file.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Try to get name from metadata
        const nameElement = xmlDoc.querySelector('trk > name, metadata > name');
        if (nameElement && nameElement.textContent) {
            return nameElement.textContent.trim();
        }
    } catch (error) {
        console.warn('Could not parse GPX name:', error);
    }

    // Fallback to filename without extension
    return file.name.replace(/\.gpx$/i, '');
}

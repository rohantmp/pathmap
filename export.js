import domtoimage from 'dom-to-image-more';

/**
 * Export the current map view as a PNG image
 */
export async function exportPNG(mapElement) {
    try {
        // Use dom-to-image-more which handles SVG and canvas elements better
        const dataUrl = await domtoimage.toPng(mapElement, {
            quality: 1,
            bgcolor: '#ffffff',
            style: {
                // Ensure all elements are visible
                'transform': 'none'
            }
        });

        const link = document.createElement('a');
        link.download = `pathmap-export-${Date.now()}.png`;
        link.href = dataUrl;
        link.click();
    } catch (error) {
        console.error('Error exporting PNG:', error);
        throw new Error('Failed to export PNG. Make sure the map is fully loaded.');
    }
}

/**
 * Export polygons as KML format
 */
export function exportKML(polygons) {
    const kmlHeader = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>PathMap Export</name>
    <description>Exported from PathMap</description>`;

    const kmlFooter = `
  </Document>
</kml>`;

    const placemarks = polygons.map(polygon => {
        if (!polygon.hull || polygon.hull.length < 3) return '';

        // Convert color from hex to KML format (aabbggrr)
        const hexColor = polygon.color.replace('#', '');
        const r = hexColor.substring(0, 2);
        const g = hexColor.substring(2, 4);
        const b = hexColor.substring(4, 6);
        const kmlColor = `7f${b}${g}${r}`; // 50% opacity
        const kmlLineColor = `ff${b}${g}${r}`; // Full opacity for outline

        // Create coordinate string (lon,lat,altitude)
        const coordinates = polygon.hull
            .map(p => `${p.lon},${p.lat},0`)
            .join(' ');

        // Close the polygon by repeating first point
        const firstPoint = polygon.hull[0];
        const closedCoordinates = `${coordinates} ${firstPoint.lon},${firstPoint.lat},0`;

        return `
    <Placemark>
      <name>${escapeXml(polygon.name)}</name>
      <Style>
        <LineStyle>
          <color>${kmlLineColor}</color>
          <width>2</width>
        </LineStyle>
        <PolyStyle>
          <color>${kmlColor}</color>
        </PolyStyle>
      </Style>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${closedCoordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
    }).join('');

    const kml = kmlHeader + placemarks + kmlFooter;
    downloadFile(kml, `pathmap-export-${Date.now()}.kml`, 'application/vnd.google-earth.kml+xml');
}

/**
 * Export polygons as GeoJSON format
 */
export function exportGeoJSON(polygons) {
    const features = polygons
        .filter(polygon => polygon.hull && polygon.hull.length >= 3)
        .map(polygon => {
            // GeoJSON uses [lon, lat] order
            const coordinates = polygon.hull.map(p => [p.lon, p.lat]);
            // Close the polygon
            coordinates.push([polygon.hull[0].lon, polygon.hull[0].lat]);

            return {
                type: 'Feature',
                properties: {
                    name: polygon.name,
                    color: polygon.color,
                    id: polygon.id
                },
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates]
                }
            };
        });

    const geojson = {
        type: 'FeatureCollection',
        features: features
    };

    const json = JSON.stringify(geojson, null, 2);
    downloadFile(json, `pathmap-export-${Date.now()}.geojson`, 'application/geo+json');
}

/**
 * Export tracks as GeoJSON LineStrings
 */
export function exportTracksGeoJSON(polygons) {
    const features = [];

    polygons.forEach(polygon => {
        polygon.tracks.forEach(track => {
            if (track.points && track.points.length > 0) {
                const coordinates = track.points.map(p => [p.lon, p.lat]);

                features.push({
                    type: 'Feature',
                    properties: {
                        name: track.name,
                        polygonName: polygon.name,
                        color: polygon.color
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: coordinates
                    }
                });
            }
        });
    });

    const geojson = {
        type: 'FeatureCollection',
        features: features
    };

    const json = JSON.stringify(geojson, null, 2);
    downloadFile(json, `pathmap-tracks-${Date.now()}.geojson`, 'application/geo+json');
}

function escapeXml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

import domtoimage from 'dom-to-image-more';
import { jsPDF } from 'jspdf';

/**
 * Composite map export (PNG or PDF).
 *
 * The export is assembled from up to three independently rendered blocks:
 *   1. an optional front-matter block (title + formatted notes),
 *   2. the live map (captured with dom-to-image-more),
 *   3. an optional legend table (polygon name + area).
 * The blocks are stacked onto a canvas for PNG, or laid out page by page for PDF.
 * Rendering the text blocks through the DOM (rather than canvas/PDF text APIs)
 * means any script the browser can display — Tamil included — exports correctly
 * and looks identical in PNG and PDF.
 */

const EXPORT_SCALE = 2; // device pixels per CSS pixel in the output
const PDF_MARGIN_MM = 12;
const PDF_BLOCK_GAP_MM = 6;

/**
 * @param {Object} options
 * @param {'png'|'pdf'} options.format
 * @param {HTMLElement} options.mapElement
 * @param {{title: string, body: string}} options.frontMatter
 * @param {'above'|'below'} options.placement - where the text block goes relative to the map
 * @param {Array<{name: string, color: string, area: string}>|null} options.legend - rows, or null to omit
 * @param {'a4'|'letter'} options.pageSize - PDF only
 * @param {'auto'|'portrait'|'landscape'} options.orientation - PDF only
 * @param {string} options.filenameBase
 */
export async function exportComposite(options) {
    const {
        format,
        mapElement,
        frontMatter = { title: '', body: '' },
        placement = 'above',
        legend = null,
        pageSize = 'a4',
        orientation = 'auto',
        filenameBase = 'pathmap-export'
    } = options;

    const width = mapElement.clientWidth;
    if (!width || !mapElement.clientHeight) {
        throw new Error('The map is not visible, so there is nothing to export.');
    }

    let mapImage;
    try {
        mapImage = await captureMap(mapElement);
        mapImage.isMap = true;
    } catch (error) {
        console.error('Error capturing map:', error);
        throw new Error('Failed to capture the map. Make sure the map tiles have finished loading.');
    }

    const blocks = [];
    const hasFrontMatter = (frontMatter.title && frontMatter.title.trim()) || (frontMatter.body && frontMatter.body.trim());
    const frontMatterImage = hasFrontMatter
        ? await renderBlock(buildFrontMatterHtml(frontMatter), width)
        : null;
    const legendImage = legend && legend.length > 0
        ? await renderBlock(buildLegendHtml(legend), width)
        : null;

    if (frontMatterImage && placement === 'above') blocks.push(frontMatterImage);
    blocks.push(mapImage);
    if (frontMatterImage && placement === 'below') blocks.push(frontMatterImage);
    if (legendImage) blocks.push(legendImage);

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${slugify(filenameBase) || 'pathmap-export'}-${stamp}`;

    if (format === 'pdf') {
        composePDF(blocks, { pageSize, orientation, title: frontMatter.title, filename: `${filename}.pdf` });
    } else {
        composePNG(blocks, `${filename}.png`);
    }
}

/**
 * Capture the live map element to a PNG image. Zoom buttons are left out of the picture.
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function captureMap(mapElement) {
    const dataUrl = await domtoimage.toPng(mapElement, {
        quality: 1,
        bgcolor: '#ffffff',
        scale: EXPORT_SCALE,
        filter: (node) => !(node.classList && node.classList.contains('leaflet-control-zoom')),
        style: {
            'transform': 'none'
        }
    });
    return loadImage(dataUrl);
}

/**
 * Render an HTML fragment at the given CSS width (off-screen) and capture it as an image.
 */
async function renderBlock(innerHtml, width) {
    const host = document.createElement('div');
    host.className = 'export-block';
    host.style.width = `${width}px`;
    host.innerHTML = innerHtml;
    document.body.appendChild(host);
    try {
        const dataUrl = await domtoimage.toPng(host, {
            quality: 1,
            bgcolor: '#ffffff',
            scale: EXPORT_SCALE
        });
        return await loadImage(dataUrl);
    } finally {
        host.remove();
    }
}

function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight, img });
        img.onerror = () => reject(new Error('Could not decode rendered image'));
        img.src = dataUrl;
    });
}

/**
 * Stack the block images vertically on a white canvas and download as PNG.
 */
function composePNG(blocks, filename) {
    const gap = 8 * EXPORT_SCALE;
    const width = Math.max(...blocks.map(b => b.width));
    const height = blocks.reduce((sum, b) => sum + b.height, 0) + gap * (blocks.length - 1);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    let y = 0;
    blocks.forEach(block => {
        ctx.drawImage(block.img, 0, y, block.width, block.height);
        y += block.height + gap;
    });

    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

/**
 * Lay the block images out on PDF pages, top to bottom, breaking pages between blocks.
 * A block taller than a page is scaled down to fit one page.
 */
function composePDF(blocks, { pageSize, orientation, title, filename }) {
    let resolvedOrientation = orientation;
    if (orientation === 'auto') {
        // Landscape when the map is clearly wider than tall and there is little text to stack
        const totalHeight = blocks.reduce((sum, b) => sum + b.height, 0);
        const totalWidth = Math.max(...blocks.map(b => b.width));
        resolvedOrientation = totalWidth / totalHeight > 1.2 ? 'landscape' : 'portrait';
    }

    const doc = new jsPDF({ orientation: resolvedOrientation, unit: 'mm', format: pageSize, compress: true });
    doc.setProperties({ title: title && title.trim() ? title.trim() : 'PathMap export', creator: 'PathMap' });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const contentWidth = pageWidth - PDF_MARGIN_MM * 2;
    const contentHeight = pageHeight - PDF_MARGIN_MM * 2;

    let y = PDF_MARGIN_MM;
    let firstOnPage = true;

    blocks.forEach(block => {
        let w = contentWidth;
        let h = block.height * (w / block.width);
        if (h > contentHeight) {
            // Too tall for a page: shrink to fit
            h = contentHeight;
            w = block.width * (h / block.height);
        }

        if (!firstOnPage && y + h > pageHeight - PDF_MARGIN_MM) {
            doc.addPage();
            y = PDF_MARGIN_MM;
            firstOnPage = true;
        }

        const x = PDF_MARGIN_MM + (contentWidth - w) / 2;
        if (block.isMap) {
            // Satellite imagery compresses far better as JPEG; text blocks stay PNG for crisp edges
            doc.addImage(toJpeg(block), 'JPEG', x, y, w, h, undefined, 'FAST');
        } else {
            doc.addImage(block.dataUrl, 'PNG', x, y, w, h, undefined, 'FAST');
        }
        y += h + PDF_BLOCK_GAP_MM;
        firstOnPage = false;
    });

    doc.save(filename);
}

function toJpeg(block, quality = 0.92) {
    const canvas = document.createElement('canvas');
    canvas.width = block.width;
    canvas.height = block.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(block.img, 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Front-matter block: title plus notes written in a small markdown subset
 * (# headings, **bold**, *italic*, "- " bullets, blank line = new paragraph).
 */
export function buildFrontMatterHtml({ title = '', body = '' }) {
    const parts = [];
    if (title && title.trim()) {
        parts.push(`<h1 class="export-title">${escapeHtml(title.trim())}</h1>`);
    }
    if (body && body.trim()) {
        parts.push(`<div class="export-notes">${markdownLite(body)}</div>`);
    }
    return parts.join('');
}

/**
 * Legend block: colour swatch, polygon name and area, one row per polygon.
 */
export function buildLegendHtml(rows) {
    const body = rows.map(row => `
        <tr>
            <td class="export-legend-swatch"><span style="background:${escapeHtml(row.color)}"></span></td>
            <td class="export-legend-name">${escapeHtml(row.name)}</td>
            <td class="export-legend-area">${escapeHtml(row.area)}</td>
        </tr>`).join('');
    return `<table class="export-legend"><tbody>${body}</tbody></table>`;
}

/**
 * Convert a markdown subset to HTML. Input is escaped first, so the only tags that
 * come out are the ones generated here.
 */
export function markdownLite(text) {
    const lines = escapeHtml(text).split(/\r?\n/);
    let html = '';
    let paragraph = [];
    let inList = false;

    const flushParagraph = () => {
        if (paragraph.length) {
            html += `<p>${paragraph.join('<br>')}</p>`;
            paragraph = [];
        }
    };
    const closeList = () => {
        if (inList) {
            html += '</ul>';
            inList = false;
        }
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            flushParagraph();
            closeList();
            continue;
        }

        const heading = line.match(/^(#{1,3})\s+(.*)$/);
        if (heading) {
            flushParagraph();
            closeList();
            const level = heading[1].length + 1; // # -> h2 (h1 is the title)
            html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
            continue;
        }

        const bullet = line.match(/^[-*•]\s+(.*)$/);
        if (bullet) {
            flushParagraph();
            if (!inList) {
                html += '<ul>';
                inList = true;
            }
            html += `<li>${inlineMarkdown(bullet[1])}</li>`;
            continue;
        }

        closeList();
        paragraph.push(inlineMarkdown(line));
    }

    flushParagraph();
    closeList();
    return html;
}

function inlineMarkdown(text) {
    return text
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/__(.+?)__/g, '<u>$1</u>');
}

function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
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

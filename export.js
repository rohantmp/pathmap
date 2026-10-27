import { markdownLite } from './notes-format.js';
export { markdownLite } from './notes-format.js';
import domtoimage from "dom-to-image-more";
import { jsPDF } from "jspdf";

/**
 * Composite map export (PNG or PDF).
 *
 * The export is assembled from up to three independently rendered blocks:
 *   1. an optional front-matter block (title + formatted notes),
 *   2. the live map (captured with dom-to-image-more),
 *   3. an optional legend table (polygon name + area).
 * The blocks are composed onto the same page canvas for preview, PNG and PDF.
 * Rendering the text blocks through the DOM (rather than canvas/PDF text APIs)
 * means any script the browser can display — Tamil included — exports correctly
 * and looks identical in PNG and PDF.
 */

const EXPORT_SCALE = 2; // device pixels per CSS pixel in the output
const PDF_MARGIN_MM = 12;

/**
 * @param {Object} options
 * @param {'png'|'pdf'} options.format
 * @param {HTMLElement} options.mapElement
 * @param {{title: string, body: string}} options.frontMatter
 * @param {'above'|'below'} options.placement - where the text block goes relative to the map
 * @param {Array<{name: string, color: string, area: string}>|null} options.legend - rows, or null to omit
 * @param {'a4'|'letter'} options.pageSize
 * @param {'auto'|'portrait'|'landscape'} options.orientation
 * @param {string} options.filenameBase
 */
// Preview and downloads share one page raster and one layout calculation.
export async function renderComposite(options) {
  const {
    mapElement,
    frontMatter = { title: "", body: "" },
    placement = "above",
    legend = null,
    appearance = "color",
    pageSize = "a4",
    orientation = "auto",
  } = options;
  const width = mapElement.clientWidth;
  if (!width || !mapElement.clientHeight)
    throw Error("The map is not visible.");
  mapElement.classList.add("export-capturing");
  const restore = prepareMapAppearance(mapElement, appearance);
  let mapImage;
  try {
    mapImage = await captureMap(mapElement);
  } finally {
    restore();
    mapElement.classList.remove("export-capturing");
  }
  const blocks = [];
  const text =
    frontMatter.title?.trim() || frontMatter.body?.trim()
      ? await renderBlock(buildFrontMatterHtml(frontMatter), width)
      : null;
  const legendImage = legend?.length
    ? await renderBlock(buildLegendHtml(legend, appearance), width)
    : null;
  if (text && placement === "above") blocks.push(text);
  blocks.push(mapImage);
  if (text && placement === "below") blocks.push(text);
  if (legendImage) blocks.push(legendImage);
  const gap = 8 * EXPORT_SCALE,
    contentWidth = Math.max(...blocks.map((b) => b.width)),
    contentHeight =
      blocks.reduce((v, b) => v + b.height, 0) + gap * (blocks.length - 1);
  const landscape =
    orientation === "landscape" ||
    (orientation === "auto" && contentWidth / contentHeight > 1.2);
  const mm = pageSize === "letter" ? [215.9, 279.4] : [210, 297];
  if (landscape) mm.reverse();
  const canvas = document.createElement("canvas");
  // Preserve current viewport resolution. Page fitting is identical for PNG, PDF and preview.
  canvas.width = Math.ceil(
    Math.max(contentWidth, (contentHeight * mm[0]) / mm[1]) + 48,
  );
  canvas.height = Math.ceil((canvas.width * mm[1]) / mm[0]);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const margin = (canvas.width * PDF_MARGIN_MM) / mm[0],
    scale = Math.min(
      (canvas.width - margin * 2) / contentWidth,
      (canvas.height - margin * 2) / contentHeight,
    );
  let y = margin;
  for (const block of blocks) {
    ctx.drawImage(
      block.img,
      (canvas.width - block.width * scale) / 2,
      y,
      block.width * scale,
      block.height * scale,
    );
    y += (block.height + gap) * scale;
  }
  if (appearance === "grayscale") {
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const gray = Math.round(
        0.2126 * pixels.data[i] +
          0.7152 * pixels.data[i + 1] +
          0.0722 * pixels.data[i + 2],
      );
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
    }
    ctx.putImageData(pixels, 0, 0);
  }
  return {
    canvas,
    dataUrl: canvas.toDataURL("image/png"),
    pageWidth: mm[0],
    pageHeight: mm[1],
    landscape,
  };
}
export async function exportComposite(options) {
  const page = await renderComposite(options),
    stamp = new Date().toISOString().slice(0, 10),
    filename = `${slugify(options.filenameBase) || "pathmap-export"}-${stamp}`;
  if (options.format === "pdf") {
    const doc = new jsPDF({
      orientation: page.landscape ? "landscape" : "portrait",
      unit: "mm",
      format: [page.pageWidth, page.pageHeight],
      compress: true,
    });
    doc.setProperties({
      title: options.frontMatter?.title || "PathMap export",
      creator: "PathMap",
    });
    doc.addImage(
      page.canvas.toDataURL("image/jpeg", 0.92),
      "JPEG",
      0,
      0,
      page.pageWidth,
      page.pageHeight,
    );
    doc.save(filename + ".pdf");
  } else {
    const link = document.createElement("a");
    link.download = filename + ".png";
    link.href = page.dataUrl;
    link.click();
  }
  return page;
}
function prepareMapAppearance(map, appearance) {
  if (appearance !== "grayscale") return () => {};
  map.classList.add("export-mono");
  const paths = [
    ...map.querySelectorAll(".leaflet-overlay-pane svg path"),
  ].filter((p) => p.getAttribute("fill") && p.getAttribute("fill") !== "none");
  const originals = paths.map((path) => [
    path,
    path.getAttribute("fill"),
    path.getAttribute("stroke"),
    path.getAttribute("fill-opacity"),
  ]);
  const ns = "http://www.w3.org/2000/svg",
    defs = [];
  paths.forEach((path, i) => {
    const svg = path.ownerSVGElement,
      d = document.createElementNS(ns, "defs"),
      pattern = document.createElementNS(ns, "pattern"),
      mark = document.createElementNS(ns, i % 4 === 1 ? "circle" : "path"),
      id = `export-pattern-${i}`;
    pattern.setAttribute("id", id);
    pattern.setAttribute("width", "10");
    pattern.setAttribute("height", "10");
    pattern.setAttribute("patternUnits", "userSpaceOnUse");
    if (i % 4 === 1) {
      mark.setAttribute("cx", "4");
      mark.setAttribute("cy", "4");
      mark.setAttribute("r", "1.5");
      mark.setAttribute("fill", "#111");
    } else {
      mark.setAttribute(
        "d",
        i % 4 === 2 ? "M0 5H10" : i % 4 === 3 ? "M5 0V10" : "M0 10L10 0",
      );
      mark.setAttribute("stroke", "#111");
      mark.setAttribute("stroke-width", "1.3");
    }
    pattern.append(mark);
    d.append(pattern);
    svg.prepend(d);
    defs.push(d);
    path.setAttribute("fill", `url(#${id})`);
    path.setAttribute("fill-opacity", ".65");
    path.setAttribute("stroke", "#111");
  });
  return () => {
    map.classList.remove("export-mono");
    originals.forEach(([p, fill, stroke, opacity]) => {
      for (const [key, value] of [
        ["fill", fill],
        ["stroke", stroke],
        ["fill-opacity", opacity],
      ])
        value === null ? p.removeAttribute(key) : p.setAttribute(key, value);
    });
    defs.forEach((d) => d.remove());
  };
}

/**
 * Capture the live map element to a PNG image. Zoom buttons are left out of the picture.
 * @returns {Promise<{dataUrl: string, width: number, height: number}>}
 */
async function captureMap(mapElement) {
  const dataUrl = await domtoimage.toPng(mapElement, {
    quality: 1,
    bgcolor: "#ffffff",
    scale: EXPORT_SCALE,
    filter: (node) =>
      !(node.classList && node.classList.contains("leaflet-control-zoom")),
    style: {
      transform: "none",
    },
  });
  return loadImage(dataUrl);
}

/**
 * Render an HTML fragment at the given CSS width (off-screen) and capture it as an image.
 */
async function renderBlock(innerHtml, width) {
  const host = document.createElement("div");
  host.className = "export-block";
  host.style.width = `${width}px`;
  host.innerHTML = innerHtml;
  document.body.appendChild(host);
  try {
    const dataUrl = await domtoimage.toPng(host, {
      quality: 1,
      bgcolor: "#ffffff",
      scale: EXPORT_SCALE,
    });
    return await loadImage(dataUrl);
  } finally {
    host.remove();
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({
        dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        img,
      });
    img.onerror = () => reject(new Error("Could not decode rendered image"));
    img.src = dataUrl;
  });
}

/**
 * Front-matter block: title plus notes written in a small markdown subset
 * (# headings, **bold**, *italic*, "- " bullets, blank line = new paragraph).
 */
export function buildFrontMatterHtml({ title = "", body = "" }) {
  const parts = [];
  if (title && title.trim()) {
    parts.push(`<h1 class="export-title">${escapeHtml(title.trim())}</h1>`);
  }
  if (body && body.trim()) {
    parts.push(`<div class="export-notes">${markdownLite(body)}</div>`);
  }
  return parts.join("");
}

/**
 * Legend block: colour swatch, polygon name and area, one row per polygon.
 */
export function buildLegendHtml(rows, appearance = "color") {
  const patterns = [
    "repeating-linear-gradient(135deg,white 0 3px,#222 3px 4px)",
    "radial-gradient(#111 22%,white 26%) 0 0/5px 5px",
    "repeating-linear-gradient(0deg,white 0 4px,#333 4px 5px)",
    "repeating-linear-gradient(90deg,white 0 4px,#333 4px 5px)",
  ];
  const body = rows
    .map(
      (row, i) => `
        <tr>
            <td class="export-legend-swatch"><span style="background:${appearance === "grayscale" ? patterns[i % 4] : escapeHtml(row.color)};border:1px solid #333"></span></td>
            <td class="export-legend-name">${escapeHtml(row.name)}</td>
            <td class="export-legend-area">${escapeHtml(row.area)}</td>
        </tr>`,
    )
    .join("");
  return `<table class="export-legend"><tbody>${body}</tbody></table>`;
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

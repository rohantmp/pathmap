// Stub for jsPDF's optional dependencies (html2canvas, canvg, dompurify).
// They are only needed by jsPDF.html() / SVG rendering, which PathMap does not use,
// so aliasing them here keeps ~800 KB out of the single-file build.
export default null;

import { projectedPathData, projectedQuadIsUsable } from "./geometry.mjs";

const thumbLayer = document.querySelector("#thumb-layer");
const footprintSvg = document.querySelector("#footprint-svg");
const preview = document.querySelector("#preview");
const imageCount = document.querySelector("#image-count");
const libraryPill = document.querySelector("#library-pill");
const observerPill = document.querySelector("#observer-pill");
const accountTitle = document.querySelector("#account-title");
const homeButton = document.querySelector("#home-button");
const rotationControls = document.querySelector("#rotation-controls");
const scaleControls = document.querySelector("#scale-controls");
const overlayControls = document.querySelector("#overlay-controls");
const unresolvedPanel = document.querySelector("#unresolved-panel");
const unresolvedList = document.querySelector("#unresolved-list");
const unresolvedToggle = document.querySelector("#unresolved-toggle");
const unresolvedCount = document.querySelector("#unresolved-count");
const previousPageButton = document.querySelector("#previous-page");
const nextPageButton = document.querySelector("#next-page");
const pageStatus = document.querySelector("#page-status");
const pageSizeSelect = document.querySelector("#page-size");

let aladin;
let images = [];
let markers = [];
let renderPending = false;
let settleTimer = null;
let viewRefreshTimers = [];
let interactionSettled = true;
let lastViewportSignature = "";
let displayConfig = { orientationOffsetDeg: 90, scaleSource: "pixel", overlayMode: "outline", survey: "P/DSS2/color" };
let activeImage = null;
let imageAdjustments = {};
let footprintGeometryCache = new WeakMap();
let currentPage = 0;
let pageSize = 30;
const A = window.A;

const DEFAULT_PAGE_SIZE = 30;
const PAGE_SIZE_STORAGE_KEY = "astrobinSkyPageSize";
const UNRESOLVED_COLLAPSED_STORAGE_KEY = "astrobinSkyUnresolvedCollapsed";
const IMAGE_FILL_MAX_FOV_DEG = 18;
const MAX_IMAGE_FILLS = 12;
const OVERVIEW_FOV_DEG = 360;

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function formatValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "object" && value !== null) return Object.values(value).filter(Boolean).join(", ");
  return value || "";
}

function compactDescription(value) {
  const text = String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 260 ? `${text.slice(0, 260)}...` : text;
}

function imageKey(image) {
  return image.id || image.pageUrl || image.title;
}

function loadImageAdjustments() {
  try {
    imageAdjustments = JSON.parse(localStorage.getItem("astrobinSkyImageAdjustments") || "{}");
  } catch {
    imageAdjustments = {};
  }
}

function saveImageAdjustments() {
  localStorage.setItem("astrobinSkyImageAdjustments", JSON.stringify(imageAdjustments));
}

function getImageAdjustment(image) {
  return imageAdjustments[imageKey(image)] || { rotationDeg: 0, scaleFactor: 1 };
}

function setImageRotationDelta(image, deltaDeg) {
  const key = imageKey(image);
  const current = getImageAdjustment(image);
  imageAdjustments[key] = { ...current, rotationDeg: Number(current.rotationDeg || 0) + deltaDeg };
  footprintGeometryCache.delete(image);
  saveImageAdjustments();
  showPreview(image);
  scheduleRender();
}

function setImageScaleDelta(image, deltaFactor) {
  const key = imageKey(image);
  const current = getImageAdjustment(image);
  const nextScale = clamp(Number(current.scaleFactor || 1) * deltaFactor, 0.25, 4);
  imageAdjustments[key] = { ...current, scaleFactor: nextScale };
  footprintGeometryCache.delete(image);
  saveImageAdjustments();
  showPreview(image);
  scheduleRender();
}

function resetImageAdjustment(image) {
  delete imageAdjustments[imageKey(image)];
  footprintGeometryCache.delete(image);
  saveImageAdjustments();
  showPreview(image);
  scheduleRender();
}

function showPreview(image) {
  activeImage = image;
  const imageAdjustment = getImageAdjustment(image);
  const fp = image.footprint || {};
  const equipmentRows = [
    ["RA / Dec", `${Number(image.ra).toFixed(4)} / ${Number(image.dec).toFixed(4)}`],
    ["Footprint", footprintLabel(image)],
    ["API pixels", fp.widthPx && fp.heightPx ? `${Number(fp.widthPx).toFixed(0)} x ${Number(fp.heightPx).toFixed(0)}` : ""],
    ["Pixel scale", fp.pixelScaleArcsec ? `${Number(fp.pixelScaleArcsec).toFixed(3)} arcsec/px` : ""],
    ["Field radius", fp.fieldRadiusDeg ? `${Number(fp.fieldRadiusDeg).toFixed(3)} deg` : ""],
    ["Solution URL", image.solution?.urlSolution ? "available" : ""],
    ["WCS", image.solution?.wcs || image.solution?.wcsFile ? "available" : ""],
    ["Geometry", image.geometrySource || "astrobin-field"],
    ["WCS cache", image.wcsCache?.hasPolygon ? `${image.wcsCache.source} (${image.wcsCache.cacheKey})` : ""],
    ["Orientation", `${Number(image.footprint?.orientationDeg || 0).toFixed(2)} deg + global ${Number(displayConfig.orientationOffsetDeg || 0).toFixed(0)} deg + image ${Number(imageAdjustment.rotationDeg || 0).toFixed(1)} deg`],
    ["Scale", `${displayConfig.scaleSource} x ${Number(imageAdjustment.scaleFactor || 1).toFixed(3)}`],
    ["Overlay", displayConfig.overlayMode],
    ["Camera", formatValue(image.equipment.camera)],
    ["Telescope", formatValue(image.equipment.telescope)],
    ["Mount", formatValue(image.equipment.mount)],
    ["Filter", formatValue(image.equipment.filters)],
    ["Integration", formatValue(image.equipment.integration)],
    ["Objects", formatValue(image.subjects)],
    ["Date", formatValue(image.published)]
  ].filter(([, value]) => value);

  preview.innerHTML = `
    ${image.preview ? `<img src="${escapeHtml(image.preview)}" alt="${escapeHtml(image.title)}">` : ""}
    <div class="preview-content">
      <h2>${escapeHtml(image.title)}</h2>
      <dl class="meta-grid">
        ${equipmentRows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}
      </dl>
      <div class="image-calibration">
        <button type="button" data-image-rotate="-90">-90 deg</button>
        <button type="button" data-image-rotate="-1">-1 deg</button>
        <button type="button" data-image-rotate="1">+1 deg</button>
        <button type="button" data-image-rotate="90">+90 deg</button>
        <button type="button" data-image-scale="0.99">-1%</button>
        <button type="button" data-image-scale="1.01">+1%</button>
        <button type="button" data-image-scale="0.9">-10%</button>
        <button type="button" data-image-scale="1.1">+10%</button>
        <button type="button" data-image-reset="true">Reset</button>
      </div>
      <p class="calibration-note">Outline uses AstroBin astrometry. Image fill uses the retrieved preview and may not match if AstroBin served a rotated, cropped, or resampled derivative.</p>
      ${image.description ? `<p class="preview-description">${escapeHtml(compactDescription(image.description))}</p>` : ""}
      ${image.pageUrl ? `<a href="${escapeHtml(image.pageUrl)}" target="_blank" rel="noreferrer">Open on AstroBin</a>` : ""}
    </div>
  `;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function imageAspect(image) {
  const naturalAspect = Number(image.naturalAspect);
  if (Number.isFinite(naturalAspect) && naturalAspect > 0) return naturalAspect;
  const fp = image.footprint || {};
  const pixelAspect = Number(fp.widthPx) / Number(fp.heightPx);
  if (Number.isFinite(pixelAspect) && pixelAspect > 0) return pixelAspect;
  const angularAspect = Number(fp.angularWidthDeg) / Number(fp.angularHeightDeg);
  if (Number.isFinite(angularAspect) && angularAspect > 0) return angularAspect;
  return 1;
}

function angularFootprintSize(image) {
  const fp = image.footprint || {};
  const adjustment = getImageAdjustment(image);
  const scale = Number(adjustment.scaleFactor || 1);
  let width = Number(fp.angularWidthDeg);
  let height = Number(fp.angularHeightDeg);

  if (displayConfig.scaleSource === "field" && Number(fp.fieldRadiusDeg) > 0) {
    const aspect = imageAspect(image);
    const diagonal = 2 * Number(fp.fieldRadiusDeg);
    height = diagonal / Math.sqrt(aspect * aspect + 1);
    width = aspect * height;
  }

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: width * scale, height: height * scale };
}

function footprintLabel(image) {
  const fp = image.footprint || {};
  const size = angularFootprintSize(image);
  if (!size) return "";
  return `${Number(size.width).toFixed(2)} deg x ${Number(size.height).toFixed(2)} deg · ${Number(fp.orientationDeg || 0).toFixed(1)} deg`;
}

function directionalOffsetRaDec(raDeg, decDeg, eastDeg, northDeg) {
  const sepDeg = Math.hypot(eastDeg, northDeg);
  if (!sepDeg) return [raDeg, decDeg];

  const ra1 = raDeg * Math.PI / 180;
  const dec1 = decDeg * Math.PI / 180;
  const sep = sepDeg * Math.PI / 180;
  const pa = Math.atan2(eastDeg, northDeg);

  const sinDec2 = Math.sin(dec1) * Math.cos(sep) + Math.cos(dec1) * Math.sin(sep) * Math.cos(pa);
  const dec2 = Math.asin(clamp(sinDec2, -1, 1));
  const y = Math.sin(pa) * Math.sin(sep) * Math.cos(dec1);
  const x = Math.cos(sep) - Math.sin(dec1) * Math.sin(dec2);
  const ra2 = ra1 + Math.atan2(y, x);

  return [
    ((ra2 * 180 / Math.PI) % 360 + 360) % 360,
    clamp(dec2 * 180 / Math.PI, -89.999, 89.999)
  ];
}

function loadPageSize() {
  try {
    const saved = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    if (saved === "all") pageSize = "all";
    else if ([30, 60, 100].includes(Number(saved))) pageSize = Number(saved);
  } catch {
    pageSize = DEFAULT_PAGE_SIZE;
  }
  pageSizeSelect.value = String(pageSize);
}

function savePageSize() {
  try {
    localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(pageSize));
  } catch {
    /* The selection still works when browser storage is unavailable. */
  }
}

function effectivePageSize() {
  return pageSize === "all" ? Math.max(1, images.length) : pageSize;
}

function footprintCornerRaDec(image, uDeg, vDeg) {
  const fp = image.footprint || {};
  const imageAdjustment = getImageAdjustment(image);
  const alpha = ((Number(fp.orientationDeg || 0) + Number(displayConfig.orientationOffsetDeg || 0) + Number(imageAdjustment.rotationDeg || 0)) * Math.PI) / 180;
  const east = uDeg * Math.sin(alpha) + vDeg * Math.cos(alpha);
  const north = uDeg * Math.cos(alpha) - vDeg * Math.sin(alpha);
  return directionalOffsetRaDec(image.ra, image.dec, east, north);
}

function footprintEdgeOffsets(angularWidth, angularHeight, samplesPerEdge = 18) {
  const corners = footprintCornerOffsets(angularWidth, angularHeight);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const edges = [
    [corners.topLeft, corners.topRight],
    [corners.topRight, corners.bottomRight],
    [corners.bottomRight, corners.bottomLeft],
    [corners.bottomLeft, corners.topLeft]
  ];
  const points = [];
  for (const [from, to] of edges) {
    for (let i = 0; i < samplesPerEdge; i += 1) {
      points.push(lerp(from, to, i / samplesPerEdge));
    }
  }
  points.push(corners.topLeft);
  return points;
}

function footprintSkyPolygon(image, angularWidth, angularHeight) {
  return footprintEdgeOffsets(angularWidth, angularHeight).map(([uDeg, vDeg]) => footprintCornerRaDec(image, uDeg, vDeg));
}

function densifySkyPolygon(points, samplesPerEdge = 18) {
  const vertices = points.length > 1
    && points[0][0] === points.at(-1)[0]
    && points[0][1] === points.at(-1)[1]
    ? points.slice(0, -1)
    : points;
  const coordinates = [];
  for (let edgeIndex = 0; edgeIndex < vertices.length; edgeIndex += 1) {
    const from = vertices[edgeIndex];
    const to = vertices[(edgeIndex + 1) % vertices.length];
    const raDelta = ((Number(to[0]) - Number(from[0]) + 540) % 360) - 180;
    for (let sampleIndex = 0; sampleIndex < samplesPerEdge; sampleIndex += 1) {
      const fraction = sampleIndex / samplesPerEdge;
      coordinates.push([
        wrappedRa(Number(from[0]) + raDelta * fraction),
        Number(from[1]) + (Number(to[1]) - Number(from[1])) * fraction
      ]);
    }
  }
  if (coordinates.length) coordinates.push(coordinates[0]);
  return coordinates;
}

function footprintCornerOffsets(angularWidth, angularHeight) {
  const halfW = angularWidth / 2;
  const halfH = angularHeight / 2;
  return {
    topLeft: [-halfW, halfH],
    topRight: [halfW, halfH],
    bottomRight: [halfW, -halfH],
    bottomLeft: [-halfW, -halfH]
  };
}

function wrappedRa(ra) {
  return ((ra % 360) + 360) % 360;
}

function screenPoint(ra, dec) {
  // The viewer is configured in ICRS, so coordinates use its active frame.
  // Avoid the defective string-frame overload in bundled Aladin Lite 3.8.2.
  const xy = aladin.world2pix(ra, dec);
  if (!xy || !Number.isFinite(xy[0]) || !Number.isFinite(xy[1])) return null;
  return { x: xy[0], y: xy[1] };
}

function adjustedScreenPolygon(points, image) {
  const adjustment = getImageAdjustment(image);
  const scale = Number(adjustment.scaleFactor || 1);
  const rotationDeg = Number(adjustment.rotationDeg || 0);
  if ((!Number.isFinite(scale) || Math.abs(scale - 1) < 0.0001) && !rotationDeg) return points;

  const uniquePoints = points.length > 1 && points[0].x === points.at(-1).x && points[0].y === points.at(-1).y
    ? points.slice(0, -1)
    : points;
  const center = uniquePoints.reduce((acc, point) => ({
    x: acc.x + point.x / uniquePoints.length,
    y: acc.y + point.y / uniquePoints.length
  }), { x: 0, y: 0 });
  const angle = rotationDeg * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;

  return points.map((point) => {
    const dx = (point.x - center.x) * safeScale;
    const dy = (point.y - center.y) * safeScale;
    return {
      x: center.x + dx * cos - dy * sin,
      y: center.y + dx * sin + dy * cos
    };
  });
}

function cachedFootprintGeometry(image) {
  const cached = footprintGeometryCache.get(image);
  if (cached) return cached;

  let geometry;
  if (image.preciseFootprint?.polygon?.length >= 3) {
    geometry = {
      kind: "precise",
      corners: image.preciseFootprint.polygon,
      polygon: densifySkyPolygon(image.preciseFootprint.polygon)
    };
  } else {
    const size = angularFootprintSize(image);
    const width = Number(size?.width);
    const height = Number(size?.height);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const offsets = footprintCornerOffsets(width, height);
      geometry = {
        kind: "metadata",
        width,
        height,
        corners: [offsets.topLeft, offsets.topRight, offsets.bottomRight, offsets.bottomLeft]
          .map(([uDeg, vDeg]) => footprintCornerRaDec(image, uDeg, vDeg)),
        polygon: footprintSkyPolygon(image, width, height)
      };
    } else {
      geometry = { kind: "point" };
    }
  }

  footprintGeometryCache.set(image, geometry);
  return geometry;
}

function footprintMayBeVisible(image, fov, rect) {
  if (fov >= 120) return true;
  const center = screenPoint(image.ra, image.dec);
  if (!center) return true;
  const size = angularFootprintSize(image);
  const radiusDeg = size ? Math.hypot(size.width, size.height) / 2 : 0;
  const padding = 120 + Math.min(Math.max(rect.width, rect.height), radiusDeg * rect.width / Math.max(fov, 0.01) * 2);
  return center.x >= -padding && center.x <= rect.width + padding
    && center.y >= -padding && center.y <= rect.height + padding;
}

function projectedFootprint(image) {
  const geometry = cachedFootprintGeometry(image);
  if (geometry.kind === "point") {
    const center = screenPoint(image.ra, image.dec);
    if (!center) return null;
    const polygon = [
      { x: center.x - 29, y: center.y - 29 },
      { x: center.x + 29, y: center.y - 29 },
      { x: center.x + 29, y: center.y + 29 },
      { x: center.x - 29, y: center.y + 29 }
    ];
    polygon.push(polygon[0]);
    return { matrix: [58, 0, 0, 58, center.x - 29, center.y - 29], baseWidth: 1, baseHeight: 1, points: polygon, polygon, exact: false };
  }

  const cornerPolygon = geometry.corners.map(([ra, dec]) => screenPoint(ra, dec)).filter(Boolean);
  const polygon = geometry.polygon.map(([ra, dec]) => screenPoint(ra, dec)).filter(Boolean);
  if (cornerPolygon.length < 4 || polygon.length < 4) return null;

  const screenCorners = geometry.kind === "precise" ? adjustedScreenPolygon(cornerPolygon, image) : cornerPolygon;
  const screenPolygon = geometry.kind === "precise" ? adjustedScreenPolygon(polygon, image) : polygon;
  const [topLeft, topRight, , bottomLeft] = screenCorners;
  const baseWidth = 100;
  const heightRatio = geometry.kind === "precise"
    ? (Number(image.footprint?.heightPx) || 100) / (Number(image.footprint?.widthPx) || 100)
    : geometry.height / geometry.width;
  const baseHeight = clamp(100 * heightRatio, 8, 600);
  const matrix = [
    (topRight.x - topLeft.x) / baseWidth,
    (topRight.y - topLeft.y) / baseWidth,
    (bottomLeft.x - topLeft.x) / baseHeight,
    (bottomLeft.y - topLeft.y) / baseHeight,
    topLeft.x,
    topLeft.y
  ];
  const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  return {
    matrix: projectedQuadIsUsable(screenCorners, footprintSvg.clientWidth, footprintSvg.clientHeight) ? matrix : null,
    baseWidth,
    baseHeight,
    points: screenPolygon,
    polygon: screenPolygon,
    exact: geometry.kind === "precise" || (width >= 8 && height >= 8)
  };
}

function scheduleRender() {
  if (renderPending) return;
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderMarkers();
  });
}

function refreshViewAfterNavigation() {
  viewRefreshTimers.forEach(clearTimeout);
  viewRefreshTimers = [];
  lastViewportSignature = "";
  scheduleInteractiveRender();
  requestAnimationFrame(() => {
    lastViewportSignature = "";
    scheduleRender();
  });
  [80, 240, 500].forEach((delay) => {
    viewRefreshTimers.push(setTimeout(() => {
      lastViewportSignature = "";
      scheduleRender();
    }, delay));
  });
}

function viewportSignature() {
  if (!aladin) return "";
  const fov = aladin.getFov?.() || [];
  const center = aladin.getRaDec?.() || aladin.getCenter?.() || [];
  const centerRa = Array.isArray(center) ? center[0] : center.ra ?? center.RA;
  const centerDec = Array.isArray(center) ? center[1] : center.dec ?? center.DE;
  const rotation = Number(aladin.getRotation?.() || 0);
  const projection = String(aladin.getProjectionName?.() || "");
  return [
    Number(fov[0] || 0).toFixed(4),
    Number(centerRa || 0).toFixed(4),
    Number(centerDec || 0).toFixed(4),
    rotation.toFixed(3),
    projection,
    thumbLayer.clientWidth,
    thumbLayer.clientHeight
  ].join("|");
}

function scheduleRenderIfViewportChanged() {
  const signature = viewportSignature();
  if (!signature || signature === lastViewportSignature) return;
  lastViewportSignature = signature;
  scheduleInteractiveRender();
}

function scheduleInteractiveRender() {
  interactionSettled = false;
  scheduleRender();
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    interactionSettled = true;
    scheduleRender();
  }, 180);
}

function saveDisplayConfig() {
  localStorage.setItem("astrobinSkyDisplayConfig", JSON.stringify(displayConfig));
}

function loadDisplayConfig(defaultConfig) {
  displayConfig = { ...displayConfig, ...defaultConfig };
  try {
    const saved = JSON.parse(localStorage.getItem("astrobinSkyDisplayConfig") || "{}");
    displayConfig = { ...displayConfig, ...saved };
  } catch {
    /* Ignore invalid local calibration state. */
  }
  delete displayConfig.footprintAnchor;
}

function updateCalibrationButtons() {
  rotationControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.rotation) === Number(displayConfig.orientationOffsetDeg));
  });
  scaleControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scaleSource === displayConfig.scaleSource);
  });
  overlayControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.overlayMode === displayConfig.overlayMode);
  });
}

function applySurvey(surveyId) {
  if (!aladin || !surveyId) return;
  try {
    if (typeof aladin.setImageSurvey === "function") {
      aladin.setImageSurvey(surveyId);
    } else if (typeof aladin.setBaseImageLayer === "function") {
      aladin.setBaseImageLayer(surveyId);
    }
  } catch {
    /* Keep the previous survey if this Aladin build cannot load the selected HiPS. */
  }
}

function wireCalibrationControls() {
  rotationControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-rotation]");
    if (!button) return;
    displayConfig.orientationOffsetDeg = Number(button.dataset.rotation);
    footprintGeometryCache = new WeakMap();
    saveDisplayConfig();
    updateCalibrationButtons();
    scheduleRender();
  });

  scaleControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scale-source]");
    if (!button) return;
    displayConfig.scaleSource = button.dataset.scaleSource;
    footprintGeometryCache = new WeakMap();
    saveDisplayConfig();
    updateCalibrationButtons();
    if (activeImage) showPreview(activeImage);
    scheduleRender();
  });

  overlayControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-overlay-mode]");
    if (!button) return;
    displayConfig.overlayMode = button.dataset.overlayMode;
    saveDisplayConfig();
    updateCalibrationButtons();
    if (activeImage) showPreview(activeImage);
    scheduleRender();
  });
}

function wireImageCalibrationControls() {
  preview.addEventListener("click", (event) => {
    const rotateButton = event.target.closest("button[data-image-rotate]");
    if (rotateButton && activeImage) {
      setImageRotationDelta(activeImage, Number(rotateButton.dataset.imageRotate));
      return;
    }

    const scaleButton = event.target.closest("button[data-image-scale]");
    if (scaleButton && activeImage) {
      setImageScaleDelta(activeImage, Number(scaleButton.dataset.imageScale));
      return;
    }

    const resetButton = event.target.closest("button[data-image-reset]");
    if (resetButton && activeImage) {
      resetImageAdjustment(activeImage);
    }
  });
}

function renderMarkers() {
  if (!aladin) return;
  lastViewportSignature = viewportSignature();
  const rect = thumbLayer.getBoundingClientRect();
  const fov = Number(aladin.getFov?.()[0] || 90);
  const imageMode = displayConfig.overlayMode === "image";
  const allowImageFill = imageMode && (interactionSettled || activeImage) && fov <= IMAGE_FILL_MAX_FOV_DEG;
  let imageFillCount = 0;

  for (const marker of markers) {
    marker.node.hidden = true;
    marker.outline.hidden = true;
    marker.outline.removeAttribute("d");
    if (!footprintMayBeVisible(marker.image, fov, rect)) continue;

    let footprint = null;
    try {
      footprint = projectedFootprint(marker.image);
    } catch {
      footprint = null;
    }

    if (!footprint) {
      marker.node.hidden = true;
      marker.outline.hidden = true;
      continue;
    }

    const outlinePath = projectedPathData(footprint.polygon, footprintSvg.clientWidth, footprintSvg.clientHeight);
    const nodeVisible = Boolean(outlinePath && footprint.matrix);
    marker.node.hidden = !nodeVisible;
    if (outlinePath) {
      marker.outline.setAttribute("d", outlinePath);
      marker.outline.hidden = false;
      marker.outline.classList.toggle("is-active", activeImage && imageKey(activeImage) === imageKey(marker.image));
      if (nodeVisible) {
        const [a, b, c, d, e, f] = footprint.matrix;
        marker.node.style.left = "0";
        marker.node.style.top = "0";
        marker.node.style.width = `${footprint.baseWidth}px`;
        marker.node.style.height = `${footprint.baseHeight}px`;
        marker.node.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
        const isActive = activeImage && imageKey(activeImage) === imageKey(marker.image);
        const showImageFill = imageMode && marker.image.overlayUrl && (isActive || (allowImageFill && imageFillCount < MAX_IMAGE_FILLS));
        if (showImageFill) imageFillCount += 1;
        marker.node.style.backgroundImage = showImageFill ? `url("${marker.image.overlayUrl}")` : "none";
        marker.node.classList.toggle("is-image-fill", Boolean(showImageFill));
        marker.node.classList.toggle("is-outline-only", !imageMode);
        marker.node.classList.toggle("is-image-waiting", imageMode && !showImageFill);
        marker.node.classList.toggle("is-minified", !footprint.exact);
      }
    } else {
      marker.outline.hidden = true;
    }
  }
}

function createMarkers(resolvedImages) {
  for (const marker of markers) {
    marker.outline?.remove();
  }
  thumbLayer.replaceChildren();
  footprintSvg.replaceChildren();
  markers = resolvedImages.map((image) => {
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "path");
    outline.classList.add("footprint-outline");
    outline.addEventListener("mouseenter", () => showPreview(image));
    outline.addEventListener("click", () => {
      aladin.gotoRaDec(image.ra, image.dec);
      aladin.setFoV(Math.min(aladin.getFov()[0], 4));
      showPreview(image);
    });
    footprintSvg.appendChild(outline);

    const node = document.createElement("button");
    node.type = "button";
    node.className = "astro-thumb";
    node.title = image.title;
    image.overlayUrl = image.localSolveImageUrl || image.preview || image.thumb || "";
    node.style.backgroundImage = "none";
    node.addEventListener("mouseenter", () => showPreview(image));
    node.addEventListener("focus", () => showPreview(image));
    node.addEventListener("click", () => {
      aladin.gotoRaDec(image.ra, image.dec);
      aladin.setFoV(Math.min(aladin.getFov()[0], 4));
      showPreview(image);
    });
    thumbLayer.appendChild(node);
    return { image, node, outline };
  });
  renderMarkers();
}

function showUnresolved(unresolvedImages) {
  if (!unresolvedImages.length) {
    unresolvedPanel.hidden = true;
    return;
  }
  unresolvedPanel.hidden = false;
  unresolvedCount.textContent = String(unresolvedImages.length);
  unresolvedList.replaceChildren(...unresolvedImages.map((image) => {
    const link = document.createElement("a");
    link.href = image.pageUrl || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = image.title;
    return link;
  }));
}

function unresolvedPanelIsCollapsed() {
  try {
    return sessionStorage.getItem(UNRESOLVED_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setUnresolvedPanelCollapsed(collapsed) {
  unresolvedPanel.classList.toggle("is-collapsed", collapsed);
  unresolvedToggle.setAttribute("aria-expanded", String(!collapsed));
  unresolvedToggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} images without sky coordinates`);
  try {
    sessionStorage.setItem(UNRESOLVED_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    /* The panel remains usable when browser storage is unavailable. */
  }
}

function renderCurrentPage() {
  const itemsPerPage = effectivePageSize();
  const pageCount = Math.max(1, Math.ceil(images.length / itemsPerPage));
  currentPage = clamp(currentPage, 0, pageCount - 1);
  const pageStart = currentPage * itemsPerPage;
  const pageImages = images.slice(pageStart, pageStart + itemsPerPage);
  const resolved = pageImages.filter((image) => image.ra !== null && image.dec !== null);
  const unresolved = pageImages.filter((image) => image.ra === null || image.dec === null);

  createMarkers(resolved);
  showUnresolved(unresolved);
  previousPageButton.disabled = currentPage === 0;
  nextPageButton.disabled = currentPage >= pageCount - 1;
  pageStatus.textContent = `Page ${currentPage + 1} of ${pageCount}`;
  const rangeStart = pageImages.length ? pageStart + 1 : 0;
  imageCount.textContent = `${images.length} total · showing ${rangeStart}-${pageStart + pageImages.length}`;

  if (resolved.length) {
    const first = resolved[0];
    aladin.gotoRaDec(first.ra, first.dec);
    aladin.setFoV(60);
    showPreview(first);
  } else {
    activeImage = null;
    preview.innerHTML = `
      <div class="preview-empty">
        <strong>No projected images on this page</strong>
        <span>These entries do not include usable sky coordinates.</span>
      </div>
    `;
  }
}

async function loadImages() {
  imageCount.textContent = "Connecting to AstroBin...";
  let response;
  try {
    response = await fetch("/api/images");
  } catch {
    throw new Error("The local mapper server is not reachable. Keep the launcher window open, then reload this page.");
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(problem.error || response.statusText);
  }
  const payload = await response.json();
  images = payload.images || [];
  currentPage = 0;

  observerPill.textContent = `${payload.observer.lat}, ${payload.observer.lon} · ${payload.observer.elev} m`;
  if (accountTitle) accountTitle.textContent = payload.username || "AstroBin account";
  libraryPill.textContent = `Library: ${payload.library || "not configured"}`;
  renderCurrentPage();
}

async function boot() {
  if (!window.A) {
    throw new Error("The Aladin Lite sky viewer could not be loaded. Check the launcher window and server.log, then reload this page.");
  }
  if (window.A.init?.then) {
    try {
      await window.A.init;
    } catch {
      throw new Error("The Aladin Lite sky viewer could not start. Check the launcher window and server.log, then reload this page.");
    }
  }
  loadImageAdjustments();
  loadDisplayConfig({});
  loadPageSize();
  setUnresolvedPanelCollapsed(unresolvedPanelIsCollapsed());

  unresolvedToggle.addEventListener("click", () => {
    setUnresolvedPanelCollapsed(!unresolvedPanel.classList.contains("is-collapsed"));
  });

  aladin = A.aladin("#aladin", {
    survey: displayConfig.survey || "P/DSS2/color",
    fov: 90,
    target: "M 31",
    cooFrame: "ICRS",
    showCooGrid: true,
    gridOptions: {
      enabled: true,
      color: "rgb(205, 218, 238)",
      opacity: 0.22,
      thickness: 1,
      labelSize: 11,
      showLabels: true
    },
    showReticle: false,
    showSimbadPointerControl: true,
    showCooGridControl: true,
    showLayersControl: true,
    showProjectionControl: true,
    showSettingsControl: true,
    showFullscreenControl: true,
    showZoomControl: true
  });

  ["positionChanged", "zoomChanged", "rotationChanged", "projectionChanged"].forEach((eventName) => {
    try {
      aladin.on(eventName, scheduleInteractiveRender);
    } catch {
      /* Aladin versions expose slightly different event sets. */
    }
  });
  ["objectHovered", "resize", "resizeChanged"].forEach((eventName) => {
    try {
      aladin.on(eventName, scheduleRender);
    } catch {
      /* Aladin versions expose slightly different event sets. */
    }
  });

  const config = await fetch("/api/config").then((res) => res.json()).catch(() => null);
  if (config?.display) {
    loadDisplayConfig(config.display);
    updateCalibrationButtons();
    applySurvey(displayConfig.survey);
  }
  if (config?.observer) {
    observerPill.textContent = `${config.observer.lat}, ${config.observer.lon} · ${config.observer.elev} m`;
  }

  homeButton.addEventListener("click", () => {
    aladin.setProjection("AIT");
    aladin.gotoRaDec(180, 0);
    aladin.setRotation(0);
    aladin.setFoV(OVERVIEW_FOV_DEG);
    refreshViewAfterNavigation();
  });
  previousPageButton.addEventListener("click", () => {
    currentPage -= 1;
    renderCurrentPage();
  });
  nextPageButton.addEventListener("click", () => {
    currentPage += 1;
    renderCurrentPage();
  });
  pageSizeSelect.addEventListener("change", () => {
    const previousPageSize = effectivePageSize();
    const firstVisibleIndex = currentPage * previousPageSize;
    pageSize = pageSizeSelect.value === "all" ? "all" : Number(pageSizeSelect.value);
    savePageSize();
    currentPage = pageSize === "all" ? 0 : Math.floor(firstVisibleIndex / pageSize);
    renderCurrentPage();
  });
  wireCalibrationControls();
  wireImageCalibrationControls();

  window.addEventListener("resize", scheduleRender);
  setInterval(() => {
    if (!document.hidden) scheduleRenderIfViewportChanged();
  }, 500);
  await loadImages();
}

boot().catch((error) => {
  imageCount.textContent = "AstroBin could not be loaded";
  preview.innerHTML = `
    <div class="preview-empty">
      <strong>Loading error</strong>
      <span>${escapeHtml(error.message)}</span>
    </div>
  `;
});

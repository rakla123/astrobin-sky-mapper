const thumbLayer = document.querySelector("#thumb-layer");
const footprintSvg = document.querySelector("#footprint-svg");
const preview = document.querySelector("#preview");
const imageCount = document.querySelector("#image-count");
const libraryPill = document.querySelector("#library-pill");
const observerPill = document.querySelector("#observer-pill");
const accountTitle = document.querySelector("#account-title");
const homeButton = document.querySelector("#home-button");
const anchorControls = document.querySelector("#anchor-controls");
const rotationControls = document.querySelector("#rotation-controls");
const scaleControls = document.querySelector("#scale-controls");
const overlayControls = document.querySelector("#overlay-controls");
const surveySelect = document.querySelector("#survey-select");
const unresolvedPanel = document.querySelector("#unresolved-panel");
const unresolvedList = document.querySelector("#unresolved-list");
const previousPageButton = document.querySelector("#previous-page");
const nextPageButton = document.querySelector("#next-page");
const pageStatus = document.querySelector("#page-status");

let aladin;
let images = [];
let markers = [];
let renderPending = false;
let settleTimer = null;
let interactionSettled = true;
let lastViewportSignature = "";
let displayConfig = { orientationOffsetDeg: 90, footprintAnchor: "center", scaleSource: "pixel", overlayMode: "outline", survey: "P/DSS2/color" };
let activeImage = null;
let imageAdjustments = {};
let currentPage = 0;
const PAGE_SIZE = 30;
const IMAGE_FILL_MAX_FOV_DEG = 18;
const MAX_IMAGE_FILLS = 12;

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
  saveImageAdjustments();
  showPreview(image);
  scheduleRender();
}

function setImageScaleDelta(image, deltaFactor) {
  const key = imageKey(image);
  const current = getImageAdjustment(image);
  const nextScale = clamp(Number(current.scaleFactor || 1) * deltaFactor, 0.25, 4);
  imageAdjustments[key] = { ...current, scaleFactor: nextScale };
  saveImageAdjustments();
  showPreview(image);
  scheduleRender();
}

function resetImageAdjustment(image) {
  delete imageAdjustments[imageKey(image)];
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
      ${image.solution?.availableFields?.length ? `<p class="calibration-note">Astrometry fields: ${escapeHtml(image.solution.availableFields.join(", "))}</p>` : ""}
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

function footprintCornerOffsets(angularWidth, angularHeight) {
  if (displayConfig.footprintAnchor === "center") {
    const halfW = angularWidth / 2;
    const halfH = angularHeight / 2;
    return {
      topLeft: [-halfW, halfH],
      topRight: [halfW, halfH],
      bottomRight: [halfW, -halfH],
      bottomLeft: [-halfW, -halfH]
    };
  }

  return {
    topLeft: [0, 0],
    topRight: [angularWidth, 0],
    bottomRight: [angularWidth, -angularHeight],
    bottomLeft: [0, -angularHeight]
  };
}

function screenPoint(ra, dec) {
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

function projectedFootprint(image) {
  if (image.preciseFootprint?.polygon?.length >= 3) {
    const polygon = adjustedScreenPolygon(image.preciseFootprint.polygon
      .map(([ra, dec]) => screenPoint(ra, dec))
      .filter(Boolean), image);
    if (polygon.length >= 4) {
      const topLeft = polygon[0];
      const topRight = polygon[1];
      const bottomLeft = polygon[3];
      const widthPx = Number(image.footprint?.widthPx) || 100;
      const heightPx = Number(image.footprint?.heightPx) || 100;
      const baseWidth = 100;
      const baseHeight = clamp(100 * (heightPx / widthPx), 8, 600);
      const a = (topRight.x - topLeft.x) / baseWidth;
      const b = (topRight.y - topLeft.y) / baseWidth;
      const c = (bottomLeft.x - topLeft.x) / baseHeight;
      const d = (bottomLeft.y - topLeft.y) / baseHeight;
      return {
        matrix: [a, b, c, d, topLeft.x, topLeft.y],
        baseWidth,
        baseHeight,
        points: polygon,
        polygon,
        exact: true
      };
    }
  }

  const angularSize = angularFootprintSize(image);
  const angularWidth = Number(angularSize?.width);
  const angularHeight = Number(angularSize?.height);
  if (!Number.isFinite(angularWidth) || !Number.isFinite(angularHeight) || angularWidth <= 0 || angularHeight <= 0) {
    const center = screenPoint(image.ra, image.dec);
    if (!center) return null;
    return {
      matrix: [58, 0, 0, 58, center.x - 29, center.y - 29],
      baseWidth: 1,
      baseHeight: 1,
      points: [
        { x: center.x - 29, y: center.y - 29 },
        { x: center.x + 29, y: center.y - 29 },
        { x: center.x + 29, y: center.y + 29 },
        { x: center.x - 29, y: center.y + 29 }
      ],
      polygon: [
        { x: center.x - 29, y: center.y - 29 },
        { x: center.x + 29, y: center.y - 29 },
        { x: center.x + 29, y: center.y + 29 },
        { x: center.x - 29, y: center.y + 29 }
      ],
      exact: false
    };
  }

  const offsets = footprintCornerOffsets(angularWidth, angularHeight);
  const polygon = footprintSkyPolygon(image, angularWidth, angularHeight)
    .map(([ra, dec]) => screenPoint(ra, dec))
    .filter(Boolean);
  const topLeftRaDec = footprintCornerRaDec(image, ...offsets.topLeft);
  const topRightRaDec = footprintCornerRaDec(image, ...offsets.topRight);
  const bottomRightRaDec = footprintCornerRaDec(image, ...offsets.bottomRight);
  const bottomLeftRaDec = footprintCornerRaDec(image, ...offsets.bottomLeft);
  const topLeft = screenPoint(topLeftRaDec[0], topLeftRaDec[1]);
  const topRight = screenPoint(topRightRaDec[0], topRightRaDec[1]);
  const bottomRight = screenPoint(bottomRightRaDec[0], bottomRightRaDec[1]);
  const bottomLeft = screenPoint(bottomLeftRaDec[0], bottomLeftRaDec[1]);

  if (!topLeft || !topRight || !bottomRight || !bottomLeft) return null;

  const baseWidth = 100;
  const baseHeight = clamp(100 * (angularHeight / angularWidth), 8, 600);
  const a = (topRight.x - topLeft.x) / baseWidth;
  const b = (topRight.y - topLeft.y) / baseWidth;
  const c = (bottomLeft.x - topLeft.x) / baseHeight;
  const d = (bottomLeft.y - topLeft.y) / baseHeight;
  const width = Math.hypot(topRight.x - topLeft.x, topRight.y - topLeft.y);
  const height = Math.hypot(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y);
  return {
    matrix: [a, b, c, d, topLeft.x, topLeft.y],
    baseWidth,
    baseHeight,
    points: [topLeft, topRight, bottomRight, bottomLeft],
    polygon: polygon.length >= 4 ? polygon : [topLeft, topRight, bottomRight, bottomLeft],
    exact: width >= 8 && height >= 8
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

function viewportSignature() {
  if (!aladin) return "";
  const fov = aladin.getFov?.() || [];
  const center = aladin.getRaDec?.() || aladin.getCenter?.() || [];
  const centerRa = Array.isArray(center) ? center[0] : center.ra ?? center.RA;
  const centerDec = Array.isArray(center) ? center[1] : center.dec ?? center.DE;
  return [
    Number(fov[0] || 0).toFixed(4),
    Number(centerRa || 0).toFixed(4),
    Number(centerDec || 0).toFixed(4),
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
}

function updateCalibrationButtons() {
  anchorControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.anchor === displayConfig.footprintAnchor);
  });
  rotationControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.rotation) === Number(displayConfig.orientationOffsetDeg));
  });
  scaleControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.scaleSource === displayConfig.scaleSource);
  });
  overlayControls?.querySelectorAll("button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.overlayMode === displayConfig.overlayMode);
  });
  if (surveySelect) {
    surveySelect.value = displayConfig.survey || "P/DSS2/color";
  }
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
  surveySelect?.addEventListener("change", () => {
    displayConfig.survey = surveySelect.value;
    saveDisplayConfig();
    applySurvey(displayConfig.survey);
    scheduleRender();
  });

  anchorControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-anchor]");
    if (!button) return;
    displayConfig.footprintAnchor = button.dataset.anchor;
    saveDisplayConfig();
    updateCalibrationButtons();
    scheduleRender();
  });

  rotationControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-rotation]");
    if (!button) return;
    displayConfig.orientationOffsetDeg = Number(button.dataset.rotation);
    saveDisplayConfig();
    updateCalibrationButtons();
    scheduleRender();
  });

  scaleControls?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-scale-source]");
    if (!button) return;
    displayConfig.scaleSource = button.dataset.scaleSource;
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
    marker.outline.hidden = true;
    marker.outline.removeAttribute("points");
  }

  for (const marker of markers) {
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

    const xs = footprint.points.map((point) => point.x);
    const ys = footprint.points.map((point) => point.y);
    const visible = Math.max(...xs) > -100 && Math.min(...xs) < rect.width + 100 && Math.max(...ys) > -100 && Math.min(...ys) < rect.height + 100;
    marker.node.hidden = !visible;
    if (visible) {
      const [a, b, c, d, e, f] = footprint.matrix;
      marker.outline.setAttribute("points", footprint.polygon.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" "));
      marker.outline.hidden = false;
      marker.outline.classList.toggle("is-active", activeImage && imageKey(activeImage) === imageKey(marker.image));
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
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
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
    if (image.overlayUrl) {
      const probe = new Image();
      probe.onload = () => {
        if (probe.naturalWidth && probe.naturalHeight) {
          image.naturalAspect = probe.naturalWidth / probe.naturalHeight;
          scheduleRender();
        }
      };
      probe.src = image.overlayUrl;
    }
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
  unresolvedList.replaceChildren(...unresolvedImages.map((image) => {
    const link = document.createElement("a");
    link.href = image.pageUrl || "#";
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = image.title;
    return link;
  }));
}

function renderCurrentPage() {
  const pageCount = Math.max(1, Math.ceil(images.length / PAGE_SIZE));
  currentPage = clamp(currentPage, 0, pageCount - 1);
  const pageStart = currentPage * PAGE_SIZE;
  const pageImages = images.slice(pageStart, pageStart + PAGE_SIZE);
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
  const response = await fetch("/api/images");
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
  if (window.A?.init?.then) {
    await window.A.init;
  }
  loadImageAdjustments();
  loadDisplayConfig({});

  aladin = A.aladin("#aladin", {
    survey: displayConfig.survey || "P/DSS2/color",
    fov: 90,
    target: "M 31",
    showReticle: false,
    showSimbadPointerControl: true,
    showCooGridControl: true,
    showSettingsControl: true,
    showFullscreenControl: true,
    showZoomControl: true
  });

  ["positionChanged", "zoomChanged"].forEach((eventName) => {
    try {
      aladin.on(eventName, scheduleInteractiveRender);
    } catch {
      /* Aladin versions expose slightly different event sets. */
    }
  });
  ["objectHovered", "resize"].forEach((eventName) => {
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
    aladin.setFoV(90);
    if (markers[0]) aladin.gotoRaDec(markers[0].image.ra, markers[0].image.dec);
  });
  previousPageButton.addEventListener("click", () => {
    currentPage -= 1;
    renderCurrentPage();
  });
  nextPageButton.addEventListener("click", () => {
    currentPage += 1;
    renderCurrentPage();
  });
  wireCalibrationControls();
  wireImageCalibrationControls();

  window.addEventListener("resize", scheduleRender);
  setInterval(scheduleRenderIfViewportChanged, 900);
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

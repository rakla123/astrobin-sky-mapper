const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { after, before, test } = require("node:test");

const {
  coordinateOrNull,
  createAppServer,
  normalizeWcsPolygon,
  partitionImagesByCoordinates,
  reportImagesWithoutCoordinates,
  safeFileStem,
  validateAstrobinUrl
} = require("../server");

let server;
let baseUrl;

before(async () => {
  server = createAppServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test("parses numeric and sexagesimal coordinates", () => {
  assert.equal(coordinateOrNull("12:00:00", "ra"), 180);
  assert.equal(coordinateOrNull("-30 30 00", "dec"), -30.5);
  assert.equal(coordinateOrNull(42.25, "ra"), 42.25);
  assert.equal(coordinateOrNull(370, "ra"), 10);
  assert.equal(coordinateOrNull(91, "dec"), null);
  assert.equal(coordinateOrNull("invalid", "dec"), null);
});

test("normalizes cached WCS polygons", () => {
  assert.deepEqual(normalizeWcsPolygon({ footprint: [[1, 2], [3, 4], [5, 6]] }), [[1, 2], [3, 4], [5, 6]]);
  assert.equal(normalizeWcsPolygon({ footprint: [[1, 2], ["x", 4]] }), null);
});

test("sanitizes cache file stems and restricts downloads to AstroBin", () => {
  assert.equal(safeFileStem("../M 31<>"), "M_31");
  assert.equal(safeFileStem(".."), "image");
  assert.equal(safeFileStem("CON"), "_CON");
  assert.equal(validateAstrobinUrl("https://cdn.astrobin.com/image.jpg").hostname, "cdn.astrobin.com");
  assert.throws(() => validateAstrobinUrl("https://example.com/image.jpg"), /Refusing non-AstroBin URL/);
  assert.throws(() => validateAstrobinUrl("http://www.astrobin.com/image.jpg"), /Refusing non-AstroBin URL/);
});

test("serves the application with security headers", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(response.headers.get("content-security-policy"), /connect-src 'self' data: https:/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(html, /uses the AstroBin API but is not endorsed or certified by AstroBin/);
  assert.match(html, /id="previous-page"/);
  assert.match(html, /id="next-page"/);
  assert.match(html, /id="page-size"/);
  assert.match(html, /<option value="all">All<\/option>/);
  assert.doesNotMatch(html, /id="celestial-reference-svg"/);
  assert.doesNotMatch(html, /id="survey-select"/);
  assert.doesNotMatch(html, /id="anchor-controls"/);
  assert.match(html, /type="module" src="bootstrap\.js"/);
  assert.doesNotMatch(html, /<script[^>]+https:\/\/aladin\.cds\.unistra\.fr/);
});

test("serves the bundled Aladin Lite runtime locally", async () => {
  const [runtimeResponse, bootstrapResponse] = await Promise.all([
    fetch(`${baseUrl}/vendor/aladin/aladin.js`, { method: "HEAD" }),
    fetch(`${baseUrl}/bootstrap.js`)
  ]);
  assert.equal(runtimeResponse.status, 200);
  assert.match(runtimeResponse.headers.get("content-type"), /^application\/javascript/);
  assert.equal(bootstrapResponse.status, 200);
  assert.match(await bootstrapResponse.text(), /import A from "\.\/vendor\/aladin\/aladin\.js"/);
});

test("supports selectable image page sizes", async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  const script = await response.text();
  assert.match(script, /const DEFAULT_PAGE_SIZE = 30/);
  assert.match(script, /\[30, 60, 100\]/);
  assert.match(script, /pageSize === "all"/);
  assert.match(script, /images\.slice\(pageStart, pageStart \+ itemsPerPage\)/);
});

test("caches footprint geometry and avoids eager preview downloads", async () => {
  const script = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
  assert.match(script, /footprintGeometryCache = new WeakMap\(\)/);
  assert.match(script, /function cachedFootprintGeometry/);
  assert.match(script, /function footprintMayBeVisible/);
  assert.doesNotMatch(script, /const probe = new Image\(\)/);
  assert.doesNotMatch(script, /setInterval\(scheduleRender, 60000\)/);
});

test("uses native Aladin sky, grid, and projection controls", async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  const script = await response.text();
  assert.match(script, /showCooGrid: true/);
  assert.match(script, /opacity: 0\.22/);
  assert.match(script, /showLayersControl: true/);
  assert.match(script, /showProjectionControl: true/);
  assert.match(script, /showCooGridControl: true/);
  assert.doesNotMatch(script, /renderCelestialReferences/);
  assert.doesNotMatch(script, /renderNorthIndicator/);
  assert.doesNotMatch(script, /surveySelect/);
  assert.match(script, /world2pix\(ra, dec\)/);
  assert.match(script, /getRotation/);
  assert.match(script, /rotationChanged/);
  assert.match(script, /projectionChanged/);
  assert.match(script, /getProjectionName/);
  assert.match(script, /refreshViewAfterNavigation/);
});

test("splits footprint outlines at projection discontinuities", async () => {
  const geometryUrl = pathToFileURL(path.join(__dirname, "..", "public", "geometry.mjs")).href;
  const { projectedPathData, projectedQuadIsUsable, skyRoundTripIsValid } = await import(geometryUrl);
  const seamCrossing = [
    { x: 985, y: 240 },
    { x: 995, y: 245 },
    { x: 5, y: 250 },
    { x: 15, y: 255 },
    { x: 985, y: 240 }
  ];
  const regularQuad = [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 180 },
    { x: 100, y: 180 },
    { x: 100, y: 100 }
  ];
  const projectionBoundary = [
    { x: 100, y: 100 },
    { x: 120, y: 110 },
    null,
    { x: 180, y: 140 },
    { x: 200, y: 150 }
  ];
  const polarProjectionSeam = [
    { x: 530, y: 45 },
    { x: 531, y: 45 },
    { x: 532, y: 45 },
    { x: 745, y: 45 },
    { x: 744, y: 45 },
    { x: 743, y: 45 }
  ];

  assert.equal((projectedPathData(seamCrossing, 1000, 500).match(/M/g) || []).length, 2);
  assert.equal(projectedQuadIsUsable(seamCrossing, 1000, 500), false);
  assert.equal((projectedPathData(regularQuad, 1000, 500).match(/M/g) || []).length, 1);
  assert.equal(projectedQuadIsUsable(regularQuad, 1000, 500), true);
  assert.equal((projectedPathData(projectionBoundary, 1000, 500).match(/M/g) || []).length, 2);
  assert.equal((projectedPathData(polarProjectionSeam, 1000, 500).match(/M/g) || []).length, 2);
  assert.equal(skyRoundTripIsValid(359.9, 20, [0.1, 20]), true);
  assert.equal(skyRoundTripIsValid(10, 20, [Number.NaN, 20]), false);
  assert.equal(skyRoundTripIsValid(10, 20, [40, 20]), false);
  assert.equal(projectedQuadIsUsable([regularQuad[0], null, regularQuad[2], regularQuad[3]], 1000, 500), false);

  const script = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
  assert.match(script, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "path"\)/);
  assert.match(script, /marker\.outline\.setAttribute\("d", outlinePath\)/);
  assert.match(script, /projectedQuadIsUsable/);
  assert.match(script, /skyRoundTripIsValid/);
  assert.match(script, /aladin\.pix2world/);
  assert.match(script, /outlineSegmentCount === 1/);
  assert.doesNotMatch(script, /marker\.outline\.setAttribute\("points"/);
});

test("starts and returns home with a north-up whole-sky Aitoff projection", async () => {
  const [html, script] = await Promise.all([
    fetch(`${baseUrl}/`).then((response) => response.text()),
    fetch(`${baseUrl}/app.js`).then((response) => response.text())
  ]);
  assert.doesNotMatch(script, /Astrometry fields:/);
  assert.match(html, /aria-label="Back to the north-up whole-sky overview"/);
  assert.match(script, /const WHOLE_SKY_FOV_DEG = 360/);
  assert.match(script, /projection: "AIT"/);
  assert.match(script, /fov: WHOLE_SKY_FOV_DEG/);
  assert.match(script, /target: "0 \+0"/);
  assert.match(script, /aladin\.setProjection\("AIT"\)/);
  assert.match(script, /aladin\.gotoRaDec\(0, 0\)/);
  assert.match(script, /aladin\.setRotation\(0\)/);
  assert.match(script, /aladin\.setFoV\(WHOLE_SKY_FOV_DEG\)/);
  assert.doesNotMatch(script, /aladin\.setFoV\(60\)/);
});

test("omits the obsolete unresolved-image panel", async () => {
  const [html, script, css] = await Promise.all([
    fetch(`${baseUrl}/`).then((response) => response.text()),
    fetch(`${baseUrl}/app.js`).then((response) => response.text()),
    fetch(`${baseUrl}/styles.css`).then((response) => response.text())
  ]);
  assert.doesNotMatch(html, /unresolved-(?:panel|toggle|list|count)/);
  assert.doesNotMatch(script, /UNRESOLVED_COLLAPSED_STORAGE_KEY|showUnresolved|setUnresolvedPanelCollapsed/);
  assert.doesNotMatch(css, /\.unresolved-/);
});

test("filters and logs images without usable coordinates", () => {
  const input = [
    { id: "ok", title: "M 31", ra: 10, dec: 20, pageUrl: "https://www.astrobin.com/ok/" },
    { id: "missing-ra", title: "No RA", ra: null, dec: 20, pageUrl: "https://www.astrobin.com/missing-ra/" },
    { id: "missing-dec", title: "No Dec\ncontinued", ra: 10, dec: null, pageUrl: "" }
  ];
  const { resolved, unresolved } = partitionImagesByCoordinates(input);
  const lines = [];
  reportImagesWithoutCoordinates(unresolved, (line) => lines.push(line));

  assert.deepEqual(resolved.map((image) => image.id), ["ok"]);
  assert.deepEqual(unresolved.map((image) => image.id), ["missing-ra", "missing-dec"]);
  assert.match(lines[0], /Excluding 2 image\(s\) without usable sky coordinates/);
  assert.match(lines[1], /id=missing-ra.*title="No RA".*astrobin\.com\/missing-ra/);
  assert.match(lines[2], /id=missing-dec.*title="No Dec continued"/);
});

test("keeps the sky survey visible beneath transparent overlays", async () => {
  const css = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
  assert.match(css, /#aladin\s*\{[^}]*z-index:\s*0/s);
  assert.doesNotMatch(css, /\.celestial-reference-svg/);
  assert.match(css, /\.footprint-svg\s*\{[^}]*z-index:\s*2[^}]*background:\s*transparent/s);
  assert.match(css, /\.thumb-layer\s*\{[^}]*z-index:\s*3/s);
});

test("keeps custom bottom controls clear of Aladin controls", async () => {
  const css = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
  assert.match(css, /\.home-button\s*\{[^}]*bottom:\s*70px/s);
  assert.match(css, /\.calibration-panel\s*\{[^}]*bottom:\s*70px/s);
  assert.match(css, /\.api-notice\s*\{[^}]*bottom:\s*18px/s);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.calibration-panel\s*\{[^}]*display:\s*none/s);
});

test("centers status controls between Aladin's top information groups", async () => {
  const css = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
  assert.match(css, /\.status-pills\s*\{[^}]*top:\s*4px[^}]*left:\s*50%[^}]*justify-content:\s*center[^}]*max-width:\s*min\(860px, calc\(100vw - 650px\)\)[^}]*translateX\(-50%\)/s);
  assert.match(css, /\.branding\s*\{[^}]*top:\s*54px[^}]*left:\s*74px/s);
});

test("does not expose private filesystem paths in client configuration", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.applicationId, "astrobin-sky-mapper");
  assert.equal(payload.version, "1.2.0-beta.6");
  assert.equal(payload.cache.wcsCachePath, undefined);
  assert.equal(payload.cache.solveRoot, undefined);
  assert.equal(payload.solver.astapExe, undefined);

  const cacheResponse = await fetch(`${baseUrl}/api/wcs-cache`);
  const cachePayload = await cacheResponse.json();
  assert.equal(cachePayload.path, undefined);
});

test("requires POST and same-origin requests for solver operations", async () => {
  const getResponse = await fetch(`${baseUrl}/api/solve?title=M31`);
  assert.equal(getResponse.status, 405);
  assert.equal(getResponse.headers.get("allow"), "POST");

  const crossOriginResponse = await fetch(`${baseUrl}/api/solve?title=M31`, {
    method: "POST",
    headers: { origin: "https://example.com" }
  });
  assert.equal(crossOriginResponse.status, 403);
});

test("blocks encoded path traversal", async () => {
  const response = await fetch(`${baseUrl}/%2e%2e%2fserver.js`);
  assert.equal(response.status, 403);
});

test("supports HEAD without returning a response body", async () => {
  const response = await fetch(`${baseUrl}/`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "");
});

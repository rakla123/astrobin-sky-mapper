const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { after, before, test } = require("node:test");

const {
  coordinateOrNull,
  createAppServer,
  normalizeWcsPolygon,
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
  assert.match(html, /id="celestial-reference-svg"/);
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

test("renders discreet celestial reference guides", async () => {
  const response = await fetch(`${baseUrl}/app.js`);
  const script = await response.text();
  assert.match(script, /showCooGrid: true/);
  assert.match(script, /opacity: 0\.22/);
  assert.match(script, /Celestial equator/);
  assert.match(script, /Central RA meridian/);
  assert.match(script, /central-meridian/);
  assert.match(script, /renderNorthIndicator/);
  assert.match(script, /world2pix\(ra, dec\)/);
  assert.match(script, /sampledRange/);
  assert.match(script, /getRotation/);
  assert.match(script, /rotationChanged/);
  assert.match(script, /projectionChanged/);
  assert.match(script, /getProjectionName/);
  assert.match(script, /refreshViewAfterNavigation/);
});

test("splits footprint outlines at projection discontinuities", async () => {
  const geometryUrl = pathToFileURL(path.join(__dirname, "..", "public", "geometry.mjs")).href;
  const { projectedPathData, projectedQuadIsUsable } = await import(geometryUrl);
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

  assert.equal((projectedPathData(seamCrossing, 1000, 500).match(/M/g) || []).length, 2);
  assert.equal(projectedQuadIsUsable(seamCrossing, 1000, 500), false);
  assert.equal((projectedPathData(regularQuad, 1000, 500).match(/M/g) || []).length, 1);
  assert.equal(projectedQuadIsUsable(regularQuad, 1000, 500), true);

  const script = await fetch(`${baseUrl}/app.js`).then((response) => response.text());
  assert.match(script, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "path"\)/);
  assert.match(script, /marker\.outline\.setAttribute\("d", outlinePath\)/);
  assert.match(script, /projectedQuadIsUsable/);
  assert.doesNotMatch(script, /marker\.outline\.setAttribute\("points"/);
});

test("hides raw astrometry field names and restores a whole-sky overview", async () => {
  const [html, script] = await Promise.all([
    fetch(`${baseUrl}/`).then((response) => response.text()),
    fetch(`${baseUrl}/app.js`).then((response) => response.text())
  ]);
  assert.doesNotMatch(script, /Astrometry fields:/);
  assert.match(html, /aria-label="Back to whole-sky overview"/);
  assert.match(script, /const OVERVIEW_FOV_DEG = 360/);
  assert.match(script, /aladin\.setProjection\("AIT"\)/);
  assert.match(script, /aladin\.gotoRaDec\(180, 0\)/);
  assert.match(script, /aladin\.setRotation\(0\)/);
  assert.match(script, /aladin\.setFoV\(OVERVIEW_FOV_DEG\)/);
});

test("provides a collapsible unresolved-image panel", async () => {
  const [html, script, css] = await Promise.all([
    fetch(`${baseUrl}/`).then((response) => response.text()),
    fetch(`${baseUrl}/app.js`).then((response) => response.text()),
    fetch(`${baseUrl}/styles.css`).then((response) => response.text())
  ]);
  assert.match(html, /id="unresolved-toggle"[^>]*aria-expanded="true"[^>]*aria-controls="unresolved-list"/);
  assert.match(html, /id="unresolved-count"/);
  assert.match(script, /UNRESOLVED_COLLAPSED_STORAGE_KEY/);
  assert.match(script, /setUnresolvedPanelCollapsed/);
  assert.match(css, /\.unresolved-panel\.is-collapsed/);
});

test("keeps the sky survey visible beneath transparent overlays", async () => {
  const css = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
  assert.match(css, /#aladin\s*\{[^}]*z-index:\s*0/s);
  assert.match(css, /\.celestial-reference-svg\s*\{[^}]*z-index:\s*1[^}]*background:\s*transparent/s);
  assert.match(css, /\.footprint-svg\s*\{[^}]*z-index:\s*2[^}]*background:\s*transparent/s);
  assert.match(css, /\.thumb-layer\s*\{[^}]*z-index:\s*3/s);
});

test("keeps custom bottom controls clear of Aladin controls", async () => {
  const css = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
  assert.match(css, /\.home-button\s*\{[^}]*bottom:\s*70px/s);
  assert.match(css, /\.calibration-panel\s*\{[^}]*bottom:\s*70px/s);
  assert.match(css, /\.unresolved-panel\s*\{[^}]*bottom:\s*118px/s);
  assert.match(css, /\.api-notice\s*\{[^}]*bottom:\s*18px/s);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.calibration-panel\s*\{[^}]*display:\s*none/s);
});

test("does not expose private filesystem paths in client configuration", async () => {
  const response = await fetch(`${baseUrl}/api/config`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.applicationId, "astrobin-sky-mapper");
  assert.equal(payload.version, "1.1.10");
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

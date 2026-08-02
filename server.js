const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { URL } = require("node:url");

const APP_ROOT = __dirname;
const DEFAULT_PORT = 8787;
const ROOT = path.join(APP_ROOT, "public");
const CONFIG_PATH = process.env.APP_CONFIG || path.join(__dirname, "config.json");
const PACKAGE = readJsonFile(path.join(APP_ROOT, "package.json"));
const APPLICATION_ID = "astrobin-sky-mapper";
const APP_VERSION = typeof PACKAGE.version === "string" ? PACKAGE.version : "unknown";

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

const APP_CONFIG = readJsonFile(CONFIG_PATH);
const APP_SETTINGS = APP_CONFIG.app || {};
const ASTROBIN_CONFIG = APP_CONFIG.astrobin || {};
const OBSERVER_CONFIG = APP_CONFIG.observer || {};
const DISPLAY_CONFIG = APP_CONFIG.display || {};
const CACHE_CONFIG = APP_CONFIG.cache || {};
const SOLVER_CONFIG = APP_CONFIG.solver || {};

function configValue(envName, value, fallback = "") {
  const envValue = process.env[envName];
  return envValue !== undefined && envValue !== "" ? envValue : value ?? fallback;
}

function numberConfig(envName, value, fallback) {
  const parsed = Number(configValue(envName, value, fallback));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveAppPath(value, fallback = "") {
  const raw = value || fallback;
  if (!raw) return "";
  return path.isAbsolute(raw) ? raw : path.resolve(APP_ROOT, raw);
}

const APP_NAME = configValue("APP_NAME", APP_SETTINGS.name, "AstroBin Sky Mapper");
const PORT = numberConfig("PORT", APP_SETTINGS.port, DEFAULT_PORT);
const HOST = "127.0.0.1";
const WCS_CACHE_PATH = resolveAppPath(configValue("WCS_CACHE_PATH", CACHE_CONFIG.wcsCachePath, path.join("data", "wcs-cache.json")));
const SOLVE_ROOT = resolveAppPath(configValue("SOLVE_ROOT", CACHE_CONFIG.solveRoot, path.join("data", "solves")));
const CACHE_MS = numberConfig("ASTROBIN_IMAGE_CACHE_MS", CACHE_CONFIG.imageCacheMs, 5 * 60 * 1000);
const REQUEST_TIMEOUT_MS = numberConfig("ASTROBIN_REQUEST_TIMEOUT_MS", CACHE_CONFIG.requestTimeoutMs, 30000);
const DOWNLOAD_TIMEOUT_MS = numberConfig("ASTROBIN_DOWNLOAD_TIMEOUT_MS", CACHE_CONFIG.downloadTimeoutMs, 120000);
const MAX_API_PAGES = Math.max(1, Math.min(50, numberConfig("ASTROBIN_MAX_API_PAGES", CACHE_CONFIG.maxApiPages, 10)));

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`Invalid app.port: ${PORT}. Expected an integer from 1 to 65535.`);
}

const ASTROBIN = {
  username: configValue("ASTROBIN_USERNAME", ASTROBIN_CONFIG.username),
  library: configValue("ASTROBIN_LIBRARY", ASTROBIN_CONFIG.library),
  apiKey: configValue("ASTROBIN_API_KEY", ASTROBIN_CONFIG.apiKey),
  apiSecret: configValue("ASTROBIN_API_SECRET", ASTROBIN_CONFIG.apiSecret)
};

const ASTROBIN_BASE = "https://www.astrobin.com";
const ASTROBIN_API_BASE = `${ASTROBIN_BASE}/api/v1`;
const ASTROBIN_FIELDS = [
  "id",
  "hash",
  "resource_uri",
  "title",
  "description",
  "subjects",
  "ra",
  "dec",
  "width",
  "height",
  "pixel_scale",
  "field_radius",
  "orientation",
  "url_regular",
  "url_gallery",
  "url_hd",
  "url_thumb",
  "url_real",
  "url_solution",
  "url_duckduckgo"
].join(",");

function astrobinConfigStatus() {
  const missing = [];
  if (!ASTROBIN.username) missing.push("astrobin.username");
  if (!ASTROBIN.apiKey) missing.push("astrobin.apiKey");
  if (!ASTROBIN.apiSecret) missing.push("astrobin.apiSecret");
  return {
    configured: missing.length === 0,
    missing
  };
}

const OBSERVER = {
  lat: Number(configValue("OBSERVER_LAT", OBSERVER_CONFIG.lat, 0)),
  lon: Number(configValue("OBSERVER_LON", OBSERVER_CONFIG.lon, 0)),
  elev: Number(configValue("OBSERVER_ELEV", OBSERVER_CONFIG.elev, 0))
};

const DISPLAY = {
  orientationOffsetDeg: Number(configValue("ORIENTATION_OFFSET_DEG", DISPLAY_CONFIG.orientationOffsetDeg, 90)),
  footprintAnchor: configValue("FOOTPRINT_ANCHOR", DISPLAY_CONFIG.footprintAnchor, "center"),
  scaleSource: configValue("FOOTPRINT_SCALE_SOURCE", DISPLAY_CONFIG.scaleSource, "pixel"),
  overlayMode: configValue("FOOTPRINT_OVERLAY_MODE", DISPLAY_CONFIG.overlayMode, "outline")
};

const SOLVER = {
  astapExe: configValue("ASTAP_EXE", SOLVER_CONFIG.astapExe, fs.existsSync("C:\\Program Files\\astap\\astap_cli.exe") ? "C:\\Program Files\\astap\\astap_cli.exe" : "C:\\Program Files\\astap\\astap.exe"),
  timeoutMs: Number(configValue("ASTAP_TIMEOUT_MS", SOLVER_CONFIG.timeoutMs, 180000)),
  searchRadiusDeg: Number(configValue("ASTAP_SEARCH_RADIUS_DEG", SOLVER_CONFIG.searchRadiusDeg, 10)),
  fallbackSearchRadiusDeg: Number(configValue("ASTAP_FALLBACK_SEARCH_RADIUS_DEG", SOLVER_CONFIG.fallbackSearchRadiusDeg, 30)),
  fallbackSpeed: configValue("ASTAP_FALLBACK_SPEED", SOLVER_CONFIG.fallbackSpeed, "slow"),
  fallbackTolerance: Number(configValue("ASTAP_FALLBACK_TOLERANCE", SOLVER_CONFIG.fallbackTolerance, 0.02)),
  fovRetryFactors: String(configValue("ASTAP_FOV_RETRY_FACTORS", SOLVER_CONFIG.fovRetryFactors, "1,0.5,2"))
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0),
  maxAcceptedOffsetDeg: Number(configValue("ASTAP_MAX_ACCEPTED_OFFSET_DEG", SOLVER_CONFIG.maxAcceptedOffsetDeg, 5)),
  // Override when your ASTAP install needs different options.
  // Tokens: {astap} {image} {fov} {ra} {raHours} {dec} {spd} {radius} {outDir}
  argsTemplate: configValue("ASTAP_ARGS_TEMPLATE", SOLVER_CONFIG.argsTemplate, '-f "{image}" -fov {fov} -ra {raHours} -spd {spd} -r {radius} -wcs -log')
};

const MIME = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"]
]);

let cache = { created: 0, payload: null };
let wcsFileCache = { signature: "", payload: null };
let lastAstrobinDebug = {
  checkedAt: "",
  library: ASTROBIN.library,
  images: [],
  attempts: []
};
function readWcsCache() {
  try {
    const stat = fs.statSync(WCS_CACHE_PATH);
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (wcsFileCache.payload && wcsFileCache.signature === signature) {
      return wcsFileCache.payload;
    }
    const payload = JSON.parse(fs.readFileSync(WCS_CACHE_PATH, "utf8"));
    wcsFileCache = { signature, payload };
    return payload;
  } catch {
    return { version: 1, images: {} };
  }
}

function writeWcsCache(wcsCache) {
  fs.mkdirSync(path.dirname(WCS_CACHE_PATH), { recursive: true });
  const temporaryPath = `${WCS_CACHE_PATH}.${process.pid}.${Date.now()}.tmp`;
  const backupPath = `${WCS_CACHE_PATH}.bak`;
  fs.writeFileSync(temporaryPath, JSON.stringify(wcsCache, null, 2), "utf8");
  try {
    fs.rmSync(backupPath, { force: true });
    if (fs.existsSync(WCS_CACHE_PATH)) fs.renameSync(WCS_CACHE_PATH, backupPath);
    fs.renameSync(temporaryPath, WCS_CACHE_PATH);
    fs.rmSync(backupPath, { force: true });
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* Best-effort cleanup. */ }
    if (!fs.existsSync(WCS_CACHE_PATH) && fs.existsSync(backupPath)) {
      try { fs.renameSync(backupPath, WCS_CACHE_PATH); } catch { /* Preserve the original error. */ }
    }
    throw error;
  }
  try {
    const stat = fs.statSync(WCS_CACHE_PATH);
    wcsFileCache = { signature: `${stat.mtimeMs}:${stat.size}`, payload: wcsCache };
  } catch {
    wcsFileCache = { signature: "", payload: null };
  }
}

function safeFileStem(value) {
  let stem = String(value || "image")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^[._-]+/, "")
    .replace(/[. ]+$/, "")
    .slice(0, 100) || "image";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
  return stem;
}

function cacheKeysForImage(image, normalized = {}) {
  return [
    normalized.id,
    image.hash,
    image.id,
    image.image_id,
    image.resource_uri,
    normalized.pageUrl,
    normalized.title
  ].filter(Boolean).map(String);
}

function numberPair(value) {
  if (!Array.isArray(value) || value.length < 2) return null;
  const ra = Number(value[0]);
  const dec = Number(value[1]);
  return Number.isFinite(ra) && Number.isFinite(dec) ? [ra, dec] : null;
}

function normalizeWcsPolygon(entry) {
  const direct = Array.isArray(entry?.footprint) ? entry.footprint : Array.isArray(entry?.polygon) ? entry.polygon : null;
  if (direct) {
    const polygon = direct.map(numberPair).filter(Boolean);
    if (polygon.length >= 3) return polygon;
  }

  const corners = entry?.corners;
  if (corners) {
    const ordered = [
      numberPair(corners.topLeft),
      numberPair(corners.topRight),
      numberPair(corners.bottomRight),
      numberPair(corners.bottomLeft)
    ].filter(Boolean);
    if (ordered.length === 4) return [...ordered, ordered[0]];
  }

  return null;
}

function parseFitsHeaderValue(raw) {
  const value = String(raw || "").split("/")[0].trim();
  if (!value) return null;
  if (value.startsWith("'")) return value.slice(1, value.lastIndexOf("'") > 0 ? value.lastIndexOf("'") : undefined).trim();
  if (value === "T") return true;
  if (value === "F") return false;
  const numeric = Number(value.replace(/D/i, "E"));
  return Number.isFinite(numeric) ? numeric : value;
}

function readFitsHeader(filePath) {
  const buffer = fs.readFileSync(filePath);
  const asciiSample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString("ascii");
  const looksLikeTextHeader = /^SIMPLE\s*=/.test(asciiSample) && /\r?\n/.test(asciiSample);
  const cards = looksLikeTextHeader
    ? buffer.toString("ascii").split(/\r?\n/).map((line) => line.slice(0, 80))
    : [];

  if (!looksLikeTextHeader) {
    for (let offset = 0; offset + 80 <= buffer.length; offset += 80) {
      const card = buffer.subarray(offset, offset + 80).toString("ascii");
      cards.push(card);
      if (card.startsWith("END")) break;
    }
  }

  const header = {};
  for (const card of cards) {
    const key = card.slice(0, 8).trim();
    if (!key || key === "END" || card[8] !== "=") continue;
    header[key] = parseFitsHeaderValue(card.slice(10));
  }
  return header;
}

function imageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      if (
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf)
      ) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        };
      }
      offset += 2 + length;
    }
  }

  return null;
}

function wcsMatrix(header) {
  if (Number.isFinite(header.CD1_1) && Number.isFinite(header.CD1_2) && Number.isFinite(header.CD2_1) && Number.isFinite(header.CD2_2)) {
    return {
      a: Number(header.CD1_1),
      b: Number(header.CD1_2),
      c: Number(header.CD2_1),
      d: Number(header.CD2_2)
    };
  }

  const cdelt1 = Number(header.CDELT1);
  const cdelt2 = Number(header.CDELT2);
  const crota = Number(header.CROTA2 || header.CROTA1 || 0) * Math.PI / 180;
  if (Number.isFinite(cdelt1) && Number.isFinite(cdelt2)) {
    return {
      a: cdelt1 * Math.cos(crota),
      b: -cdelt2 * Math.sin(crota),
      c: cdelt1 * Math.sin(crota),
      d: cdelt2 * Math.cos(crota)
    };
  }

  return null;
}

function pixelToRaDec(header, x, y) {
  const crval1 = Number(header.CRVAL1);
  const crval2 = Number(header.CRVAL2);
  const crpix1 = Number(header.CRPIX1);
  const crpix2 = Number(header.CRPIX2);
  const matrix = wcsMatrix(header);
  if (![crval1, crval2, crpix1, crpix2].every(Number.isFinite) || !matrix) return null;

  const dx = x - crpix1;
  const dy = y - crpix2;
  const xiDeg = matrix.a * dx + matrix.b * dy;
  const etaDeg = matrix.c * dx + matrix.d * dy;

  const ctype1 = String(header.CTYPE1 || "").toUpperCase();
  const ctype2 = String(header.CTYPE2 || "").toUpperCase();
  if (!ctype1.includes("TAN") && !ctype2.includes("TAN")) {
    const cosDec = Math.cos(crval2 * Math.PI / 180);
    return [
      ((crval1 + xiDeg / Math.max(0.01, Math.abs(cosDec))) % 360 + 360) % 360,
      clampNumber(crval2 + etaDeg, -90, 90)
    ];
  }

  const xi = xiDeg * Math.PI / 180;
  const eta = etaDeg * Math.PI / 180;
  const ra0 = crval1 * Math.PI / 180;
  const dec0 = crval2 * Math.PI / 180;
  const sinDec0 = Math.sin(dec0);
  const cosDec0 = Math.cos(dec0);
  const denominator = cosDec0 - eta * sinDec0;
  const ra = ra0 + Math.atan2(xi, denominator);
  const dec = Math.atan2(
    sinDec0 + eta * cosDec0,
    Math.hypot(denominator, xi)
  );

  return [
    ((ra * 180 / Math.PI) % 360 + 360) % 360,
    clampNumber(dec * 180 / Math.PI, -90, 90)
  ];
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function footprintFromWcsHeader(header, fallbackDimensions = null) {
  const width = Number(header.NAXIS1 || header.IMAGEW || header.WIDTH || fallbackDimensions?.width);
  const height = Number(header.NAXIS2 || header.IMAGEH || header.HEIGHT || fallbackDimensions?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;

  const corners = {
    topLeft: pixelToRaDec(header, 1, height),
    topRight: pixelToRaDec(header, width, height),
    bottomRight: pixelToRaDec(header, width, 1),
    bottomLeft: pixelToRaDec(header, 1, 1)
  };
  if (!corners.topLeft || !corners.topRight || !corners.bottomRight || !corners.bottomLeft) return null;

  return {
    center: pixelToRaDec(header, width / 2, height / 2),
    corners,
    polygon: [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft, corners.topLeft],
    pixelOrigin: "display-top-left-to-fits-bottom-left",
    widthPx: width,
    heightPx: height
  };
}

function splitCommandLine(commandLine) {
  const tokens = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < commandLine.length; i += 1) {
    const char = commandLine[i];
    if ((char === '"' || char === "'")) {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      else current += char;
      continue;
    }
    if (/\s/.test(char) && !quote) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function astapSolveParameters(image, dimensions = null) {
  const footprint = image.footprint || {};
  const widthPx = Number(footprint.widthPx || dimensions?.width);
  const heightPx = Number(footprint.heightPx || dimensions?.height);
  const pixelScaleArcsec = Number(footprint.pixelScaleArcsec);
  const angularHeightDeg = Number(footprint.angularHeightDeg);
  const fieldRadiusDeg = Number(footprint.fieldRadiusDeg);
  const hasDownloadedDimensions = Boolean(dimensions?.width && dimensions?.height);
  let fovDeg = null;
  let fovSource = "";

  if (Number.isFinite(heightPx) && heightPx > 0 && Number.isFinite(pixelScaleArcsec) && pixelScaleArcsec > 0) {
    fovDeg = heightPx * pixelScaleArcsec / 3600;
    fovSource = "height-pixel-scale";
  } else if (
    hasDownloadedDimensions &&
    Number.isFinite(fieldRadiusDeg) && fieldRadiusDeg > 0 &&
    Number.isFinite(widthPx) && widthPx > 0 &&
    Number.isFinite(heightPx) && heightPx > 0
  ) {
    fovDeg = 2 * fieldRadiusDeg * heightPx / Math.hypot(widthPx, heightPx);
    fovSource = "field-radius-image-height";
  } else if (Number.isFinite(angularHeightDeg) && angularHeightDeg > 0) {
    fovDeg = angularHeightDeg;
    fovSource = "angular-height";
  } else if (Number.isFinite(fieldRadiusDeg) && fieldRadiusDeg > 0) {
    fovDeg = 2 * fieldRadiusDeg;
    fovSource = "field-radius-diameter-estimate";
  }

  const raDeg = Number(image.ra);
  const decDeg = Number(image.dec);
  const raHours = Number.isFinite(raDeg) ? raDeg / 15 : null;
  const spdDeg = Number.isFinite(decDeg) ? 90 + decDeg : null;

  return {
    fovDeg,
    raDeg: Number.isFinite(raDeg) ? raDeg : null,
    raHours,
    decDeg: Number.isFinite(decDeg) ? decDeg : null,
    spdDeg,
    radiusDeg: Number.isFinite(SOLVER.searchRadiusDeg) && SOLVER.searchRadiusDeg > 0 ? SOLVER.searchRadiusDeg : 10,
    fovSource
  };
}

function validateAstapSolveParameters(solveParams) {
  const missing = [];
  if (!Number.isFinite(solveParams.fovDeg) || solveParams.fovDeg <= 0) missing.push("FOV");
  if (!Number.isFinite(solveParams.raHours)) missing.push("RA");
  if (!Number.isFinite(solveParams.decDeg)) missing.push("Dec");
  return missing;
}

function angularSeparationDeg(ra1Deg, dec1Deg, ra2Deg, dec2Deg) {
  const ra1 = Number(ra1Deg) * Math.PI / 180;
  const dec1 = Number(dec1Deg) * Math.PI / 180;
  const ra2 = Number(ra2Deg) * Math.PI / 180;
  const dec2 = Number(dec2Deg) * Math.PI / 180;
  if (![ra1, dec1, ra2, dec2].every(Number.isFinite)) return null;
  const cosSep = Math.sin(dec1) * Math.sin(dec2) + Math.cos(dec1) * Math.cos(dec2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.min(1, Math.max(-1, cosSep))) * 180 / Math.PI;
}

function acceptedSolveOffsetLimitDeg(solveParams) {
  const fov = Number(solveParams?.fovDeg);
  const configured = Number(SOLVER.maxAcceptedOffsetDeg);
  const fovBased = Number.isFinite(fov) && fov > 0 ? Math.max(0.25, fov * 0.5) : 0.5;
  const configuredCap = Number.isFinite(configured) && configured > 0 ? configured : 5;
  return Math.min(configuredCap, fovBased);
}

function hasScaleWarningText(text) {
  return /warning\s+scale\s+was\s+inaccurate|set\s+fov\s*=/i.test(String(text || ""));
}

function weakQuadMatch(text) {
  const match = String(text || "").match(/(\d+)\s+of\s+(\d+)\s+quads\s+selected\s+matching/i);
  if (!match) return null;
  const matched = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isFinite(matched) || !Number.isFinite(total) || total <= 0) return null;
  return {
    matched,
    total,
    ratio: matched / total,
    weak: matched < 4 || matched / total < 0.15
  };
}

function validateSolvedFootprint(footprint, solveParams, header = {}, astapText = "") {
  const warningText = [header.WARNING, astapText].filter(Boolean).join("\n");
  if (hasScaleWarningText(warningText)) {
    throw new Error(`Rejected ASTAP solve: scale warning in solver output.`);
  }
  const quadMatch = weakQuadMatch(astapText);
  if (quadMatch?.weak) {
    throw new Error(`Rejected ASTAP solve: weak quad match ${quadMatch.matched} of ${quadMatch.total}.`);
  }
  const center = footprint?.center;
  if (!center || !Number.isFinite(solveParams?.raDeg) || !Number.isFinite(solveParams?.decDeg)) return null;
  const offsetDeg = angularSeparationDeg(solveParams.raDeg, solveParams.decDeg, center[0], center[1]);
  const maxOffsetDeg = acceptedSolveOffsetLimitDeg(solveParams);
  if (offsetDeg !== null && offsetDeg > maxOffsetDeg) {
    throw new Error(`Rejected ASTAP false-positive solve: solved center is ${offsetDeg.toFixed(2)} deg from AstroBin hint; limit is ${maxOffsetDeg.toFixed(2)} deg.`);
  }
  return { offsetDeg, maxOffsetDeg };
}

function withSolveContext(error, context) {
  error.solveParameters = context.solveParameters;
  error.localFiles = context.localFiles;
  error.sidecarFiles = context.sidecarFiles;
  error.astapAttempts = context.astapAttempts;
  error.astap = context.astap;
  return error;
}

function sidecarFilesForSolve(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name))
    .filter((file) => [".ini", ".log", ".txt", ".lst"].includes(path.extname(file).toLowerCase()))
    .map((file) => {
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8").slice(0, 4000);
      } catch {
        text = "";
      }
      return {
        path: file,
        size: fs.statSync(file).size,
        text
      };
    });
}

function astapArgsForImage(imagePath, image, outDir, solveParams = astapSolveParameters(image)) {
  const fov = solveParams.fovDeg ? solveParams.fovDeg.toFixed(4) : "0";
  const raDeg = solveParams.raDeg !== null ? solveParams.raDeg.toFixed(6) : "";
  const raHours = solveParams.raHours !== null ? solveParams.raHours.toFixed(6) : "";
  const dec = solveParams.decDeg !== null ? solveParams.decDeg.toFixed(6) : "";
  const spd = solveParams.spdDeg !== null ? solveParams.spdDeg.toFixed(6) : "";
  const radius = solveParams.radiusDeg.toFixed(2);
  const templateHasAstap = SOLVER.argsTemplate.includes("{astap}");
  const rendered = SOLVER.argsTemplate
    .replaceAll("{astap}", SOLVER.astapExe)
    .replaceAll("{image}", imagePath)
    .replaceAll("{fov}", fov)
    .replaceAll("{raHours}", raHours)
    .replaceAll("{ra}", raDeg)
    .replaceAll("{dec}", dec)
    .replaceAll("{spd}", spd)
    .replaceAll("{radius}", radius)
    .replaceAll("{outDir}", outDir);
  const tokens = splitCommandLine(rendered);
  return templateHasAstap ? tokens : [SOLVER.astapExe, ...tokens];
}

function isAstrobinHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "astrobin.com" || host.endsWith(".astrobin.com");
}

function validateAstrobinUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !isAstrobinHost(url.hostname)) {
    throw new Error(`Refusing non-AstroBin URL: ${url.origin}`);
  }
  return url;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs} ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAstrobinResource(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  let currentUrl = validateAstrobinUrl(url);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchWithTimeout(currentUrl, { ...options, redirect: "manual" }, timeoutMs);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("AstroBin redirect did not include a location.");
    currentUrl = validateAstrobinUrl(new URL(location, currentUrl).toString());
  }
  throw new Error("Too many AstroBin redirects.");
}

async function downloadToFile(url, filePath) {
  const response = await fetchAstrobinResource(url, {}, DOWNLOAD_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const arrayBuffer = await response.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));
}

function removeOldWcsOutputFiles(dir, imagePath) {
  for (const file of findWcsOutputFiles(dir, imagePath)) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* Ignore cleanup failures; timestamp filtering still protects us. */
    }
  }
}

function removeOldAstapSidecars(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(dir, entry.name);
    if (![".ini", ".log", ".txt", ".lst"].includes(path.extname(file).toLowerCase())) continue;
    try {
      fs.unlinkSync(file);
    } catch {
      /* Ignore cleanup failures. */
    }
  }
}

function findWcsOutputFiles(dir, imagePath, sinceMs = 0) {
  const stem = path.basename(imagePath, path.extname(imagePath));
  const files = fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dir, entry.name));
  return files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file, ext);
    const modified = fs.statSync(file).mtimeMs;
    return modified >= sinceMs && [".wcs", ".fits", ".fit", ".fts"].includes(ext) && (base === stem || base.includes(stem));
  });
}

async function runAstap(imagePath, image, outDir, solveParams = astapSolveParameters(image), extraArgs = []) {
  const args = [...astapArgsForImage(imagePath, image, outDir, solveParams), ...extraArgs];
  const exe = args.shift() || SOLVER.astapExe;
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { cwd: outDir, windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`ASTAP timed out after ${SOLVER.timeoutMs} ms`));
    }, SOLVER.timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, command: [exe, ...args].join(" ") });
    });
  });
}

function astapFovRetryParameters(baseParams) {
  const seen = new Set();
  const factors = SOLVER.fovRetryFactors.length ? SOLVER.fovRetryFactors : [1];
  return factors.map((factor) => {
    const fovDeg = Number(baseParams.fovDeg) * factor;
    if (!Number.isFinite(fovDeg) || fovDeg <= 0) return null;
    const key = fovDeg.toFixed(6);
    if (seen.has(key)) return null;
    seen.add(key);
    return {
      ...baseParams,
      fovDeg,
      fovRetryFactor: factor,
      fovSource: factor === 1 ? baseParams.fovSource : `${baseParams.fovSource} x ${factor}`
    };
  }).filter(Boolean);
}

function astapAttemptPlans(baseParams) {
  const plans = [];
  for (const params of astapFovRetryParameters(baseParams)) {
    plans.push({
      label: `FOV x ${params.fovRetryFactor || 1}`,
      solveParameters: params,
      extraArgs: []
    });
    if (
      Number.isFinite(SOLVER.fallbackSearchRadiusDeg) &&
      SOLVER.fallbackSearchRadiusDeg > params.radiusDeg
    ) {
      const wideParams = { ...params, radiusDeg: SOLVER.fallbackSearchRadiusDeg };
      plans.push({
        label: `FOV x ${params.fovRetryFactor || 1}, wide search`,
        solveParameters: wideParams,
        extraArgs: ["-speed", SOLVER.fallbackSpeed],
        fallback: true
      });
      if (Number.isFinite(SOLVER.fallbackTolerance) && SOLVER.fallbackTolerance > 0) {
        plans.push({
          label: `FOV x ${params.fovRetryFactor || 1}, wide search, tolerance`,
          solveParameters: wideParams,
          extraArgs: ["-speed", SOLVER.fallbackSpeed, "-t", String(SOLVER.fallbackTolerance)],
          fallback: true,
          tolerance: SOLVER.fallbackTolerance
        });
      }
    } else if (Number.isFinite(SOLVER.fallbackTolerance) && SOLVER.fallbackTolerance > 0) {
      plans.push({
        label: `FOV x ${params.fovRetryFactor || 1}, tolerance`,
        solveParameters: params,
        extraArgs: ["-t", String(SOLVER.fallbackTolerance)],
        tolerance: SOLVER.fallbackTolerance
      });
    }
  }
  return plans;
}

function findLoadedImage(searchParams) {
  const id = searchParams.get("id");
  const title = searchParams.get("title");
  const hash = searchParams.get("hash");
  const images = lastAstrobinDebug.images || [];

  if (id) {
    return images.find((image) => String(image.id) === String(id) || String(image.raw?.id) === String(id));
  }
  if (hash) {
    return images.find((image) => String(image.raw?.hash) === String(hash) || String(image.id) === String(hash));
  }
  if (title) {
    const needle = title.toLowerCase();
    return images.find((image) => image.title.toLowerCase().includes(needle));
  }
  return null;
}

function imageCacheKey(image) {
  const normalized = image.raw ? image : normalizeImage(image);
  return String(normalized.raw?.hash || normalized.raw?.id || normalized.id || safeFileStem(normalized.title));
}

function cachedEntryForImage(image, wcsCache = readWcsCache()) {
  const normalized = image.raw ? image : normalizeImage(image);
  const raw = normalized.raw || image;
  return findCachedWcsEntry(raw, normalized, wcsCache);
}

function isValidSolvedCacheEntry(entry) {
  return Boolean(entry && !entry.solveFailed && normalizeWcsPolygon(entry));
}

function hasValidSolvedCacheForImage(image, wcsCache = readWcsCache()) {
  return isValidSolvedCacheEntry(cachedEntryForImage(image, wcsCache)?.entry);
}

function shouldSolveImageInBatch(image, wcsCache, retryFailed, retryBefore, retryBlocked = false) {
  const cached = cachedEntryForImage(image, wcsCache);
  if (isValidSolvedCacheEntry(cached?.entry)) return false;
  if (!cached) return true;
  if (cached.entry.solveBlocked) return retryBlocked && failedBeforeRun(cached.entry, retryBefore);
  if (cached.entry.solveFailed) return retryFailed && failedBeforeRun(cached.entry, retryBefore);
  return true;
}

function blockedSolveReason(message) {
  const text = String(message || "");
  if (/Missing ASTAP solve hints/i.test(text)) return "missing-solve-hints";
  if (/Rejected ASTAP solve/i.test(text)) return "rejected-unsafe-solve";
  if (/scale warning|Warning scale was inaccurate|Set FOV=/i.test(text)) return "rejected-unsafe-solve";
  if (/weak ASTAP quad match|weak quad match/i.test(text)) return "rejected-unsafe-solve";
  if (/Cached solve center is .* from AstroBin hint/i.test(text)) return "rejected-unsafe-solve";
  return "";
}

function failedBeforeRun(entry, retryBefore) {
  if (!entry?.solveFailed) return false;
  const updatedAt = Date.parse(entry.updatedAt || "");
  return !Number.isFinite(updatedAt) || updatedAt < retryBefore;
}

function wcsCacheStatusForImages(images, wcsCache = readWcsCache()) {
  const status = {
    total: images.length,
    solvedCached: 0,
    failedCached: 0,
    blockedCached: 0,
    metadataCached: 0,
    uncached: 0
  };

  for (const image of images) {
    const cached = findCachedWcsEntry(image.raw || image, image.raw ? image : normalizeImage(image), wcsCache);
    if (!cached) {
      status.uncached += 1;
    } else if (cached.entry.solveBlocked) {
      status.blockedCached += 1;
    } else if (cached.entry.solveFailed) {
      status.failedCached += 1;
    } else if (normalizeWcsPolygon(cached.entry)) {
      status.solvedCached += 1;
    } else {
      status.metadataCached += 1;
    }
  }

  return status;
}

function invalidateBadSolvedCacheEntries() {
  const wcsCache = readWcsCache();
  const images = wcsCache.images || {};
  const invalidated = [];
  const blocked = [];
  for (const [key, entry] of Object.entries(images)) {
    if (entry.solveFailed && !entry.solveBlocked) {
      const reason = blockedSolveReason(entry.error || entry.invalidReason || "");
      if (reason) {
        images[key] = {
          ...entry,
          solveBlocked: true,
          blockedReason: reason,
          blockedAt: new Date().toISOString()
        };
        blocked.push({
          key,
          title: entry.astrobin?.title || entry.title || key,
          reason
        });
      }
      continue;
    }
    if (!isValidSolvedCacheEntry(entry)) continue;
    const solveParams = entry.solveParameters || {};
    const center = numberPair(entry.center);
    const offsetDeg = center ? angularSeparationDeg(solveParams.raDeg, solveParams.decDeg, center[0], center[1]) : null;
    const maxOffsetDeg = acceptedSolveOffsetLimitDeg(solveParams);
    const scaleWarning = hasScaleWarningText(entry.astap?.stdout) ||
      hasScaleWarningText(entry.astap?.stderr) ||
      (entry.astapAttempts || []).some((attempt) => hasScaleWarningText(attempt.stdout) || hasScaleWarningText(attempt.stderr)) ||
      (entry.sidecarFiles || []).some((file) => hasScaleWarningText(file.text));
    const quadTexts = [
      entry.astap?.stdout,
      entry.astap?.stderr,
      ...(entry.astapAttempts || []).flatMap((attempt) => [attempt.stdout, attempt.stderr]),
      ...(entry.sidecarFiles || []).map((file) => file.text)
    ].filter(Boolean);
    const weakMatch = quadTexts.map(weakQuadMatch).find((match) => match?.weak);
    if ((offsetDeg !== null && offsetDeg > maxOffsetDeg) || scaleWarning || weakMatch) {
      const invalidReason = scaleWarning
        ? "Cached solve has ASTAP scale warning."
        : weakMatch
          ? `Cached solve has weak ASTAP quad match ${weakMatch.matched} of ${weakMatch.total}.`
        : `Cached solve center is ${offsetDeg.toFixed(2)} deg from AstroBin hint; limit is ${maxOffsetDeg.toFixed(2)} deg.`;
      images[key] = {
        ...entry,
        solveFailed: true,
        solveBlocked: true,
        blockedReason: "invalid-cached-solve",
        invalidatedAt: new Date().toISOString(),
        invalidReason,
        previousFootprint: entry.footprint,
        footprint: null,
        polygon: null,
        corners: null
      };
      invalidated.push({
        key,
        title: entry.astrobin?.title || entry.title || key,
        offsetDeg,
        maxOffsetDeg,
        scaleWarning,
        weakQuadMatch: weakMatch || null
      });
    }
  }
  if (invalidated.length || blocked.length) {
    wcsCache.images = images;
    writeWcsCache(wcsCache);
    cache = { created: 0, payload: null };
  }
  return { invalidated: invalidated.length, blocked: blocked.length, entries: invalidated, blockedEntries: blocked };
}

function imageDownloadExtension(url) {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    return ext && ext.length <= 6 ? ext : ".jpg";
  } catch {
    return ".jpg";
  }
}

function localSolveImageUrl(key) {
  return `/api/solve-image?key=${encodeURIComponent(key)}`;
}

function solveImagePathFor(image) {
  const normalized = image.raw ? image : normalizeImage(image);
  const solveUrl = normalized.solveUrl || normalized.preview || normalized.thumb || "";
  const key = imageCacheKey(normalized);
  return path.join(SOLVE_ROOT, safeFileStem(key), `${safeFileStem(key)}${imageDownloadExtension(solveUrl)}`);
}

function existingSolveImageDimensions(image) {
  const imagePath = solveImagePathFor(image);
  if (!fs.existsSync(imagePath)) return null;
  try {
    return imageDimensions(imagePath);
  } catch {
    return null;
  }
}

async function solveImageToCache(imageRecord) {
  const image = normalizeImage(imageRecord.raw);
  const solveUrl = image.solveUrl || image.preview || image.thumb;
  if (!solveUrl) throw new Error("No downloadable image URL available for this AstroBin image.");

  const key = imageCacheKey(image);
  const outDir = path.dirname(solveImagePathFor(image));
  fs.mkdirSync(outDir, { recursive: true });
  const imagePath = solveImagePathFor(image);
  removeOldAstapSidecars(outDir);
  removeOldWcsOutputFiles(outDir, imagePath);

  await downloadToFile(solveUrl, imagePath);
  const dimensions = imageDimensions(imagePath);
  const solveParams = astapSolveParameters(image, dimensions);
  const solveContext = {
    solveParameters: solveParams,
    localFiles: {
      image: imagePath,
      imageDimensions: dimensions
    },
    sidecarFiles: () => sidecarFilesForSolve(outDir)
  };
  const missingSolveParams = validateAstapSolveParameters(solveParams);
  if (missingSolveParams.length) {
    throw withSolveContext(new Error(`Missing ASTAP solve hints from AstroBin metadata: ${missingSolveParams.join(", ")}.`), solveContext);
  }
  let astap = null;
  const astapAttempts = [];
  let solved = null;
  let solvedPath = null;
  let validation = null;
  let lastSolveError = null;
  let unsafeSolveError = null;

  for (const plan of astapAttemptPlans(solveParams)) {
    removeOldAstapSidecars(outDir);
    removeOldWcsOutputFiles(outDir, imagePath);
    const attemptStartedAt = Date.now();
    try {
      astap = await runAstap(imagePath, image, outDir, plan.solveParameters, plan.extraArgs);
      astap.label = plan.label;
      astap.fallback = Boolean(plan.fallback);
      astap.solveParameters = plan.solveParameters;
      astap.tolerance = plan.tolerance || null;
      astapAttempts.push(astap);
    } catch (error) {
      astapAttempts.push({
        label: plan.label,
        fallback: Boolean(plan.fallback),
        tolerance: plan.tolerance || null,
        error: error.message,
        solveParameters: plan.solveParameters
      });
      lastSolveError = error;
      continue;
    }

    const wcsFiles = findWcsOutputFiles(outDir, imagePath, attemptStartedAt - 1000);
    if (!wcsFiles.length) {
      lastSolveError = new Error(`ASTAP did not produce a .wcs/.fits file. Command: ${astap.command}. Exit code: ${astap.code}. ${astap.stderr || astap.stdout}`.slice(0, 1200));
      continue;
    }

    for (const wcsPath of wcsFiles) {
      try {
        const header = readFitsHeader(wcsPath);
        const footprint = footprintFromWcsHeader(header, dimensions);
        if (!footprint) continue;
        const attemptValidation = validateSolvedFootprint(
          footprint,
          astap.solveParameters || plan.solveParameters,
          header,
          [astap.stdout, astap.stderr].filter(Boolean).join("\n")
        );
        solved = { header, footprint };
        solvedPath = wcsPath;
        validation = attemptValidation;
        break;
      } catch (error) {
        if (blockedSolveReason(error.message)) {
          unsafeSolveError = unsafeSolveError || error;
        }
        lastSolveError = error;
      }
    }
    if (solved) break;
  }

  if (!solved && (unsafeSolveError || lastSolveError)) {
    throw withSolveContext(unsafeSolveError || lastSolveError, {
      ...solveContext,
      astapAttempts,
      astap,
      sidecarFiles: () => sidecarFilesForSolve(outDir)
    });
  }
  if (!solved) {
    throw withSolveContext(new Error(`Could not parse a usable WCS header from ASTAP outputs.`), {
      ...solveContext,
      astapAttempts,
      astap,
      sidecarFiles: () => sidecarFilesForSolve(outDir)
    });
  }

  const wcsCache = readWcsCache();
  wcsCache.version = wcsCache.version || 1;
  wcsCache.images = wcsCache.images || {};
  wcsCache.images[key] = {
    source: "ASTAP",
    updatedAt: new Date().toISOString(),
    astrobin: {
      id: image.raw?.id || null,
      hash: image.raw?.hash || null,
      title: image.title,
      pageUrl: image.pageUrl
    },
    localFiles: {
      image: imagePath,
      wcs: solvedPath
    },
    solveParameters: solveParams,
    validation,
    center: solved.footprint.center,
    corners: solved.footprint.corners,
    footprint: solved.footprint.polygon,
    pixelOrigin: solved.footprint.pixelOrigin,
    widthPx: solved.footprint.widthPx,
    heightPx: solved.footprint.heightPx,
    wcs: {
      crval1: solved.header.CRVAL1,
      crval2: solved.header.CRVAL2,
      crpix1: solved.header.CRPIX1,
      crpix2: solved.header.CRPIX2,
      cd1_1: solved.header.CD1_1,
      cd1_2: solved.header.CD1_2,
      cd2_1: solved.header.CD2_1,
      cd2_2: solved.header.CD2_2,
      cdelt1: solved.header.CDELT1,
      cdelt2: solved.header.CDELT2,
      crota1: solved.header.CROTA1,
      crota2: solved.header.CROTA2
    },
    astap: {
      command: astap.command,
      fallback: Boolean(astap.fallback),
      exitCode: astap.code,
      stdout: astap.stdout.slice(-4000),
      stderr: astap.stderr.slice(-4000)
    },
    astapAttempts: astapAttempts.map((attempt) => ({
      label: attempt.label || "",
      command: attempt.command || "",
      fallback: Boolean(attempt.fallback),
      tolerance: attempt.tolerance || null,
      exitCode: attempt.code ?? null,
      solveParameters: attempt.solveParameters || null,
      stdout: (attempt.stdout || "").slice(-4000),
      stderr: (attempt.stderr || "").slice(-4000),
      error: attempt.error || null
    }))
  };

  writeWcsCache(wcsCache);
  cache = { created: 0, payload: null };
  return {
    key,
    title: image.title,
    footprint: wcsCache.images[key].footprint,
    astap: wcsCache.images[key].astap
  };
}

function writeFailedSolveToCache(imageRecord, error) {
  const image = normalizeImage(imageRecord.raw || imageRecord);
  const key = imageCacheKey(image);
  const wcsCache = readWcsCache();
  const sidecarFiles = typeof error?.sidecarFiles === "function" ? error.sidecarFiles() : (error?.sidecarFiles || []);
  const blockReason = blockedSolveReason(error?.message || error);
  wcsCache.version = wcsCache.version || 1;
  wcsCache.images = wcsCache.images || {};
  wcsCache.images[key] = {
    source: "ASTAP",
    updatedAt: new Date().toISOString(),
    solveFailed: true,
    astrobin: {
      id: image.raw?.id || null,
      hash: image.raw?.hash || null,
      title: image.title,
      pageUrl: image.pageUrl
    },
    solveBlocked: Boolean(blockReason),
    blockedReason: blockReason || null,
    localFiles: error?.localFiles || null,
    solveParameters: error?.solveParameters || astapSolveParameters(image),
    astapAttempts: error?.astapAttempts || [],
    astap: error?.astap || null,
    sidecarFiles,
    error: String(error?.message || error).slice(0, 2000)
  };
  writeWcsCache(wcsCache);
  return {
    key,
    title: image.title,
    error: wcsCache.images[key].error,
    solveBlocked: wcsCache.images[key].solveBlocked,
    blockedReason: wcsCache.images[key].blockedReason,
    solveParameters: wcsCache.images[key].solveParameters,
    astapAttempts: wcsCache.images[key].astapAttempts,
    astap: wcsCache.images[key].astap,
    sidecarFiles
  };
}

async function solveMissingImagesToCache(options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options.limit || 200)));
  const retryFailed = Boolean(options.retryFailed);
  const retryBlocked = Boolean(options.retryBlocked);
  const dryRun = Boolean(options.dryRun);
  const retryBefore = options.retryBefore ? Date.parse(options.retryBefore) : Date.now();
  await fetchAstrobinImages();

  const wcsCache = readWcsCache();
  const images = lastAstrobinDebug.images || [];
  const beforeStatus = wcsCacheStatusForImages(images, wcsCache);
  const bypassedValid = images.filter((image) => hasValidSolvedCacheForImage(image, wcsCache)).length;
  const missing = images.filter((image) => shouldSolveImageInBatch(image, wcsCache, retryFailed, retryBefore, retryBlocked));

  const selected = missing.slice(0, limit);
  if (dryRun) {
    return {
      checked: images.length,
      selected: selected.length,
      solved: 0,
      failed: 0,
      remaining: missing.length,
      bypassedValid,
      dryRun: true,
      cacheStatus: beforeStatus,
      next: selected.map((image) => ({
        key: imageCacheKey(image),
        title: image.title,
        ra: image.ra,
        dec: image.dec,
        solveParameters: astapSolveParameters(image, existingSolveImageDimensions(image)),
        missingSolveHints: validateAstapSolveParameters(astapSolveParameters(image, existingSolveImageDimensions(image)))
      }))
    };
  }

  const solved = [];
  const failed = [];
  for (const image of selected) {
    try {
      solved.push(await solveImageToCache(image));
    } catch (error) {
      failed.push(writeFailedSolveToCache(image, error));
      cache = { created: 0, payload: null };
    }
  }

  const refreshedCache = readWcsCache();
  const afterStatus = wcsCacheStatusForImages(lastAstrobinDebug.images || [], refreshedCache);
  const remaining = (lastAstrobinDebug.images || [])
    .filter((image) => shouldSolveImageInBatch(image, refreshedCache, retryFailed, retryBefore, retryBlocked))
    .length;

  return {
    checked: images.length,
    selected: selected.length,
    solved: solved.length,
    failed: failed.length,
    remaining,
    bypassedValid: afterStatus.solvedCached,
    cacheStatus: afterStatus,
    cacheStatusBefore: beforeStatus,
    results: solved.map((item) => ({
      key: item.key,
      title: item.title
    })),
    failures: failed
  };
}

function findCachedWcsEntry(image, normalized, wcsCache) {
  const images = wcsCache?.images || {};
  for (const key of cacheKeysForImage(image, normalized)) {
    if (images[key]) return { key, entry: images[key] };
  }
  return null;
}

function applyCachedWcs(image, normalized, wcsCache) {
  const cached = findCachedWcsEntry(image, normalized, wcsCache);
  if (!cached) {
    return {
      ...normalized,
      preciseFootprint: null,
      geometrySource: normalized.footprint?.angularWidthDeg ? "astrobin-field" : "point"
    };
  }

  const polygon = normalizeWcsPolygon(cached.entry);
  const center = numberPair(cached.entry.center) || numberPair(cached.entry.centerRaDec);
  const widthPx = numberOrNull(cached.entry.widthPx);
  const heightPx = numberOrNull(cached.entry.heightPx);
  const pixelScaleArcsec = numberOrNull(cached.entry.pixelScaleArcsec);
  const orientationDeg = numberOrNull(cached.entry.orientationDeg);

  const merged = {
    ...normalized,
    geometrySource: polygon ? "wcs-cache" : "wcs-cache-metadata",
    preciseFootprint: polygon ? {
      cacheKey: cached.key,
      source: cached.entry.source || "local-wcs-cache",
      polygon,
      corners: cached.entry.corners || null,
      updatedAt: cached.entry.updatedAt || null
    } : null,
    localSolveImageUrl: cached.entry.localFiles?.image ? localSolveImageUrl(cached.key) : "",
    wcsCache: {
      cacheKey: cached.key,
      source: cached.entry.source || "local-wcs-cache",
      hasPolygon: Boolean(polygon),
      hasWcs: Boolean(cached.entry.wcs)
    }
  };

  if (center) {
    merged.ra = center[0];
    merged.dec = center[1];
  }
  if (widthPx || heightPx || pixelScaleArcsec || orientationDeg !== null) {
    const nextFootprint = {
      ...merged.footprint,
      widthPx: widthPx || merged.footprint.widthPx,
      heightPx: heightPx || merged.footprint.heightPx,
      pixelScaleArcsec: pixelScaleArcsec || merged.footprint.pixelScaleArcsec,
      orientationDeg: orientationDeg ?? merged.footprint.orientationDeg
    };
    if (nextFootprint.widthPx && nextFootprint.heightPx && nextFootprint.pixelScaleArcsec) {
      nextFootprint.angularWidthDeg = nextFootprint.widthPx * nextFootprint.pixelScaleArcsec / 3600;
      nextFootprint.angularHeightDeg = nextFootprint.heightPx * nextFootprint.pixelScaleArcsec / 3600;
    }
    merged.footprint = nextFootprint;
  }

  return merged;
}

const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' data: https:; font-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-content-type-options": "nosniff"
};

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendFile(req, res, pathname) {
  const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^[/\\]+/, "");
  const filePath = path.resolve(ROOT, requestedPath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, body) => {
    if (err) {
      res.writeHead(404, SECURITY_HEADERS);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": MIME.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
      "cache-control": "no-cache"
    });
    res.end(req.method === "HEAD" ? undefined : body);
  });
}

function sendLocalSolveImage(res, key) {
  const wcsCache = readWcsCache();
  const entry = wcsCache.images?.[String(key || "")];
  const imagePath = entry?.localFiles?.image;
  if (!imagePath) {
    sendJson(res, 404, { error: "No local solved image found for this cache key." });
    return;
  }

  const resolvedRoot = path.resolve(SOLVE_ROOT);
  const resolvedImage = path.resolve(imagePath);
  if (!resolvedImage.startsWith(resolvedRoot + path.sep) || !fs.existsSync(resolvedImage)) {
    sendJson(res, 404, { error: "Local solved image is not available." });
    return;
  }

  fs.readFile(resolvedImage, (err, body) => {
    if (err) {
      sendJson(res, 404, { error: "Local solved image could not be read." });
      return;
    }
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "content-type": MIME.get(path.extname(resolvedImage).toLowerCase()) || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(body);
  });
}

function firstPresent(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function coordinateOrNull(value, kind) {
  const numeric = numberOrNull(value);
  if (numeric !== null) {
    if (kind === "ra") return ((numeric % 360) + 360) % 360;
    return Math.abs(numeric) <= 90 ? numeric : null;
  }
  if (value === undefined || value === null) return null;

  const text = String(value)
    .trim()
    .toLowerCase()
    .replace(/−/g, "-")
    .replace(/[°ºd]/g, " ")
    .replace(/[hms]/g, " ")
    .replace(/[′']/g, " ")
    .replace(/[″"]/g, " ")
    .replace(/:/g, " ");

  const normalizedText = text.trim();
  if (!normalizedText) return null;
  const parts = normalizedText.split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
  if (!parts.length) return null;

  const sign = text.startsWith("-") ? -1 : 1;
  const first = Math.abs(parts[0]);
  const second = parts[1] || 0;
  const third = parts[2] || 0;
  if (second >= 60 || third >= 60) return null;
  let degrees = first + second / 60 + third / 3600;

  if (kind === "ra") {
    const original = String(value).trim().toLowerCase();
    const looksLikeHours = original.includes("h") || original.includes(":") || (parts.length > 1 && first <= 24);
    if (looksLikeHours) degrees *= 15;
    return ((degrees % 360) + 360) % 360;
  }

  const declination = sign * degrees;
  return Math.abs(declination) <= 90 ? declination : null;
}

function absoluteUrl(value) {
  if (!value || typeof value !== "string") return "";
  try {
    return new URL(value, ASTROBIN_BASE).toString();
  } catch {
    return "";
  }
}

function flattenText(value) {
  if (value === undefined || value === null) return [];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(flattenText);
  }
  if (typeof value === "object") {
    return Object.values(value).flatMap(flattenText);
  }
  return [];
}

function imageLibraryText(image) {
  return [
    image.library,
    image.libraries,
    image.collection,
    image.collections,
    image.album,
    image.albums,
    image.gallery,
    image.galleries,
    image.category,
    image.categories,
    image.raw?.library,
    image.raw?.libraries,
    image.raw?.collection,
    image.raw?.collections,
    image.raw?.album,
    image.raw?.albums,
    image.raw?.gallery,
    image.raw?.galleries,
    image.raw?.category,
    image.raw?.categories
  ].flatMap(flattenText);
}

function belongsToLibrary(image, libraryName) {
  const wanted = libraryName.trim().toLowerCase();
  if (!wanted) return true;
  const candidates = imageLibraryText(image).map((value) => value.trim().toLowerCase());
  return candidates.some((value) => value === wanted || value.includes(wanted));
}

function normalizeImage(image, wcsCache = readWcsCache()) {
  const ra = coordinateOrNull(firstPresent(image, ["ra", "center_ra", "wcs_ra", "pixinsight_ra"]), "ra");
  const dec = coordinateOrNull(firstPresent(image, ["dec", "center_dec", "wcs_dec", "pixinsight_dec"]), "dec");
  const widthPx = numberOrNull(firstPresent(image, ["width", "image_width", "original_width"]));
  const heightPx = numberOrNull(firstPresent(image, ["height", "image_height", "original_height"]));
  const pixelScaleArcsec = numberOrNull(firstPresent(image, ["pixel_scale", "pixelscale", "pixel_scale_arcsec"]));
  const fieldRadiusDeg = numberOrNull(firstPresent(image, ["field_radius", "field_radius_degrees", "radius", "fov"]));
  const orientationDeg = numberOrNull(firstPresent(image, ["orientation", "rotation", "angle", "rot", "pa"])) || 0;
  const hash = firstPresent(image, ["hash", "image_id", "id"]) || "";
  const pageUrl = absoluteUrl(firstPresent(image, ["url", "page_url"]) || (hash ? `/${hash}/` : ""));
  const thumb = absoluteUrl(firstPresent(image, [
    "url_thumb",
    "url_thumbnail",
    "thumbnail",
    "thumbnail_url",
    "url_gallery",
    "url_regular",
    "url_real"
  ]));
  const preview = absoluteUrl(firstPresent(image, [
    "url_regular",
    "url_gallery",
    "url_hd",
    "url_real",
    "url_solution",
    "url_duckduckgo",
    "image_file",
    "image_file_url",
    "url_thumb"
  ]));
  const solveUrl = absoluteUrl(firstPresent(image, [
    "url_real",
    "url_hd",
    "url_regular",
    "url_gallery",
    "image_file",
    "image_file_url",
    "url_thumb"
  ]));
  let angularWidthDeg = null;
  let angularHeightDeg = null;
  if (pixelScaleArcsec && widthPx && heightPx) {
    angularWidthDeg = widthPx * pixelScaleArcsec / 3600;
    angularHeightDeg = heightPx * pixelScaleArcsec / 3600;
  } else if (fieldRadiusDeg && widthPx && heightPx) {
    const diagonalPx = Math.hypot(widthPx, heightPx);
    if (diagonalPx > 0) {
      angularWidthDeg = 2 * fieldRadiusDeg * widthPx / diagonalPx;
      angularHeightDeg = 2 * fieldRadiusDeg * heightPx / diagonalPx;
    }
  } else if (fieldRadiusDeg) {
    angularWidthDeg = 2 * fieldRadiusDeg;
    angularHeightDeg = 2 * fieldRadiusDeg;
  }

  const normalized = {
    id: String(hash || pageUrl || image.resource_uri || crypto.randomUUID()),
    title: firstPresent(image, ["title"]) || "Untitled AstroBin image",
    description: firstPresent(image, ["description"]) || "",
    published: firstPresent(image, ["published", "published_on", "uploaded", "updated"]) || "",
    subjects: firstPresent(image, ["subjects"]) || "",
    library: firstPresent(image, ["library", "libraries", "collection", "collections", "album", "albums", "gallery", "galleries"]) || "",
    ra,
    dec,
    thumb,
    preview,
    solveUrl,
    pageUrl,
    footprint: {
      widthPx,
      heightPx,
      pixelScaleArcsec,
      fieldRadiusDeg,
      orientationDeg,
      angularWidthDeg,
      angularHeightDeg
    },
    solution: {
      urlSolution: absoluteUrl(firstPresent(image, ["url_solution", "solution_url"])),
      solution: firstPresent(image, ["solution"]),
      solutionStatus: firstPresent(image, ["solution_status"]),
      wcs: firstPresent(image, ["wcs"]),
      wcsFile: absoluteUrl(firstPresent(image, ["wcs_file", "wcs_url", "url_wcs"])),
      availableFields: Object.keys(image).filter((key) => /wcs|solution|solve|astrom|pixinsight|orientation|rotation|pixel|field|ra|dec/i.test(key)).sort()
    },
    equipment: {
      camera: firstPresent(image, ["imaging_cameras", "camera"]),
      telescope: firstPresent(image, ["imaging_telescopes", "telescope"]),
      mount: firstPresent(image, ["mounts", "mount"]),
      filters: firstPresent(image, ["filters"]),
      integration: firstPresent(image, ["integration_time", "total_integration"])
    },
    raw: image
  };

  return applyCachedWcs(image, normalized, wcsCache);
}

function clientImage(image) {
  const { raw, ...rest } = image;
  return rest;
}

async function fetchImageDetail(image) {
  const candidates = [];
  if (image.raw?.resource_uri) candidates.push(image.raw.resource_uri);
  if (image.raw?.hash) candidates.push(`/api/v1/image/${image.raw.hash}/`);
  if (image.raw?.id) candidates.push(`/api/v1/image/${image.raw.id}/`);

  for (const candidate of candidates) {
    const detailUrl = new URL(candidate.startsWith("http") ? candidate : absoluteUrl(candidate));
    detailUrl.searchParams.set("format", "json");
    detailUrl.searchParams.set("api_key", ASTROBIN.apiKey);
    detailUrl.searchParams.set("api_secret", ASTROBIN.apiSecret);
    try {
      return await astrobinRequest(detailUrl.toString());
    } catch {
      continue;
    }
  }
  return null;
}

async function hydrateImageDetails(images) {
  const wcsCache = readWcsCache();
  const hydrated = [];
  for (const image of images) {
    const detail = await fetchImageDetail(image);
    hydrated.push(detail ? normalizeImage({ ...image.raw, ...detail }, wcsCache) : image);
  }
  return hydrated;
}

function footprintNeedsDetail(image) {
  const fp = image.footprint || {};
  return !(fp.widthPx && fp.heightPx && (fp.pixelScaleArcsec || fp.fieldRadiusDeg));
}

async function hydrateMissingFootprintDetails(images) {
  const wcsCache = readWcsCache();
  const hydrated = [];
  const stats = { attempted: 0, improved: 0, failed: 0 };

  for (const image of images) {
    if (!footprintNeedsDetail(image)) {
      hydrated.push(image);
      continue;
    }

    stats.attempted += 1;
    const before = image.footprint || {};
    const detail = await fetchImageDetail(image);
    if (!detail) {
      stats.failed += 1;
      hydrated.push(image);
      continue;
    }

    const merged = normalizeImage({ ...image.raw, ...detail }, wcsCache);
    const after = merged.footprint || {};
    if (
      (!before.widthPx && after.widthPx) ||
      (!before.heightPx && after.heightPx) ||
      (!before.pixelScaleArcsec && after.pixelScaleArcsec) ||
      (!before.fieldRadiusDeg && after.fieldRadiusDeg)
    ) {
      stats.improved += 1;
    }
    hydrated.push(merged);
  }

  return { images: hydrated, stats };
}

function astrobinListUrl(extraParams = {}) {
  const params = new URLSearchParams({
    user: ASTROBIN.username,
    format: "json",
    api_key: ASTROBIN.apiKey,
    api_secret: ASTROBIN.apiSecret,
    limit: "200",
    fields: ASTROBIN_FIELDS,
    ...extraParams
  });
  return `${ASTROBIN_API_BASE}/image/?${params.toString()}`;
}

async function astrobinRequest(url) {
  const headers = {
    "accept": "application/json",
    "user-agent": "astrobin-sky-mapper/1.1.6 (+https://github.com/rakla123/astrobin-sky-mapper)"
  };

  const response = await fetchAstrobinResource(url, { headers }, REQUEST_TIMEOUT_MS);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { detail: text };
  }

  if (!response.ok) {
    throw new Error(`AstroBin ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`);
  }
  return payload;
}

async function fetchImagePages(startUrl) {
  const images = [];
  const wcsCache = readWcsCache();
  let next = startUrl;
  let pages = 0;
  const visited = new Set();

  while (next && pages < MAX_API_PAGES) {
    const nextUrl = next.startsWith("http") ? next : absoluteUrl(next);
    if (visited.has(nextUrl)) throw new Error("AstroBin pagination loop detected.");
    visited.add(nextUrl);
    const payload = await astrobinRequest(nextUrl);
    const objects = Array.isArray(payload.objects) ? payload.objects : Array.isArray(payload) ? payload : [];
    images.push(...objects.map((image) => normalizeImage(image, wcsCache)));
    next = payload.meta?.next || null;
    pages += 1;
  }

  return images;
}

async function fetchAstrobinImages() {
  if (cache.payload && Date.now() - cache.created < CACHE_MS) return cache.payload;
  const configStatus = astrobinConfigStatus();
  if (!configStatus.configured) {
    throw new Error(`AstroBin configuration is incomplete. Edit config.json and fill: ${configStatus.missing.join(", ")}.`);
  }

  const candidates = [
    { url: astrobinListUrl({ library: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl({ library__name: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl({ collection: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl({ collection__name: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl({ album: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl({ gallery: ASTROBIN.library }), libraryScoped: true },
    { url: astrobinListUrl(), libraryScoped: false },
    { url: `${ASTROBIN_API_BASE}/image/?${new URLSearchParams({
      user__username: ASTROBIN.username,
      format: "json",
      api_key: ASTROBIN.apiKey,
      api_secret: ASTROBIN.apiSecret,
      limit: "200",
      fields: ASTROBIN_FIELDS
    }).toString()}`, libraryScoped: false },
    { url: `${ASTROBIN_API_BASE}/image/?${new URLSearchParams({
      username: ASTROBIN.username,
      format: "json",
      api_key: ASTROBIN.apiKey,
      api_secret: ASTROBIN.apiSecret,
      limit: "200",
      fields: ASTROBIN_FIELDS
    }).toString()}`, libraryScoped: false }
  ];

  const failures = [];
  let images = [];
  const attempts = [];
  let usedLibraryScopedQuery = false;
  for (const candidate of candidates) {
    try {
      const candidateImages = await fetchImagePages(candidate.url);
      attempts.push({
        url: candidate.url.replace(ASTROBIN.apiKey, "API_KEY").replace(ASTROBIN.apiSecret, "API_SECRET"),
        libraryScoped: candidate.libraryScoped,
        count: candidateImages.length
      });
      if (candidateImages.length) {
        images = candidateImages;
        usedLibraryScopedQuery = candidate.libraryScoped;
        break;
      }
    } catch (error) {
      attempts.push({
        url: candidate.url.replace(ASTROBIN.apiKey, "API_KEY").replace(ASTROBIN.apiSecret, "API_SECRET"),
        libraryScoped: candidate.libraryScoped,
        error: error.message
      });
      failures.push(error.message);
    }
  }

  lastAstrobinDebug = {
    checkedAt: new Date().toISOString(),
    username: ASTROBIN.username,
    library: ASTROBIN.library,
    display: DISPLAY,
    lastResult: null,
    attempts
  };

  if (!images.length && failures.length) {
    throw new Error(failures.join(" | "));
  }

  const hydration = { stats: { attempted: 0, improved: 0, failed: 0, skippedNormalLoad: true } };

  const beforeLibraryFilter = images.length;
  const libraryMatches = images.filter((image) => belongsToLibrary(image, ASTROBIN.library));
  const hasLibraryMetadata = images.some((image) => imageLibraryText(image).length > 0);
  if (!usedLibraryScopedQuery && hasLibraryMetadata && libraryMatches.length > 0) {
    images = libraryMatches;
  }

  const resolved = images.filter((image) => image.ra !== null && image.dec !== null);
  const unresolved = images.filter((image) => image.ra === null || image.dec === null);
  const payload = {
    observer: OBSERVER,
    username: ASTROBIN.username,
    library: ASTROBIN.library,
    fetchedAt: new Date().toISOString(),
    usedLibraryScopedQuery,
    libraryMatches: libraryMatches.length,
    hasLibraryMetadata,
    footprintHydration: hydration.stats,
    totalBeforeLibraryFilter: beforeLibraryFilter,
    total: images.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
    images: images.map(clientImage)
  };
  lastAstrobinDebug.lastResult = {
    usedLibraryScopedQuery,
    hasLibraryMetadata,
    totalBeforeLibraryFilter: beforeLibraryFilter,
    footprintHydration: hydration.stats,
    libraryMatches: libraryMatches.length,
    total: images.length,
    resolved: resolved.length,
    unresolved: unresolved.length,
      sample: images.slice(0, 3).map((image) => ({
        title: image.title,
        ra: image.ra,
        dec: image.dec,
        thumb: Boolean(image.thumb),
        preview: Boolean(image.preview),
        footprint: image.footprint,
        library: image.library
      }))
  };
  lastAstrobinDebug.images = images.map((image) => ({
    id: image.id,
    title: image.title,
    ra: image.ra,
    dec: image.dec,
    pageUrl: image.pageUrl,
    solveUrl: image.solveUrl,
    footprint: image.footprint,
    solution: image.solution,
    raw: image.raw
  }));
  cache = { created: Date.now(), payload };
  return payload;
}

let solveOperationActive = false;

function requireMethod(req, res, method) {
  if (req.method === method) return true;
  sendJson(res, 405, { error: `Method ${req.method} is not allowed. Use ${method}.` }, { allow: method });
  return false;
}

function hasAllowedOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    const host = String(req.headers.host || `${HOST}:${PORT}`).toLowerCase();
    return parsed.protocol === "http:" && parsed.host.toLowerCase() === host;
  } catch {
    return false;
  }
}

async function runExclusiveSolve(task) {
  if (solveOperationActive) {
    const error = new Error("Another solve or cache update is already running.");
    error.statusCode = 409;
    throw error;
  }
  solveOperationActive = true;
  try {
    return await task();
  } finally {
    solveOperationActive = false;
  }
}

async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === "/api/config") {
      if (!requireMethod(req, res, "GET")) return;
      sendJson(res, 200, {
        applicationId: APPLICATION_ID,
        version: APP_VERSION,
        appName: APP_NAME,
        port: PORT,
        observer: OBSERVER,
        display: DISPLAY,
        username: ASTROBIN.username,
        library: ASTROBIN.library,
        astrobin: astrobinConfigStatus(),
        cache: {
          imageCacheMs: CACHE_MS,
          requestTimeoutMs: REQUEST_TIMEOUT_MS,
          maxApiPages: MAX_API_PAGES
        },
        solver: {
          astapConfigured: Boolean(SOLVER.astapExe),
          fovRetryFactors: SOLVER.fovRetryFactors
        }
      });
      return;
    }
    if (url.pathname === "/api/wcs-cache") {
      if (!requireMethod(req, res, "GET")) return;
      const wcsCache = readWcsCache();
      const entries = Object.entries(wcsCache.images || {}).map(([key, entry]) => ({
        key,
        source: entry.source || "local-wcs-cache",
        solveFailed: Boolean(entry.solveFailed),
        solveBlocked: Boolean(entry.solveBlocked),
        blockedReason: entry.blockedReason || null,
        title: entry.astrobin?.title || entry.title || null,
        hasPolygon: Boolean(normalizeWcsPolygon(entry)),
        hasWcs: Boolean(entry.wcs),
        updatedAt: entry.updatedAt || null
      }));
      sendJson(res, 200, {
        version: wcsCache.version || 1,
        count: entries.length,
        solvedCached: entries.filter((entry) => entry.hasPolygon && !entry.solveFailed).length,
        failedCached: entries.filter((entry) => entry.solveFailed && !entry.solveBlocked).length,
        blockedCached: entries.filter((entry) => entry.solveBlocked).length,
        metadataCached: entries.filter((entry) => !entry.hasPolygon && !entry.solveFailed).length,
        entries
      });
      return;
    }
    if (url.pathname === "/api/solve-image") {
      if (!requireMethod(req, res, "GET")) return;
      sendLocalSolveImage(res, url.searchParams.get("key"));
      return;
    }
    if (url.pathname === "/api/wcs-cache/invalidate-bad") {
      if (!requireMethod(req, res, "POST")) return;
      if (!hasAllowedOrigin(req)) {
        sendJson(res, 403, { error: "Cross-origin state-changing requests are not allowed." });
        return;
      }
      sendJson(res, 200, await runExclusiveSolve(async () => invalidateBadSolvedCacheEntries()));
      return;
    }
    if (url.pathname === "/api/solve") {
      if (!requireMethod(req, res, "POST")) return;
      if (!hasAllowedOrigin(req)) {
        sendJson(res, 403, { error: "Cross-origin state-changing requests are not allowed." });
        return;
      }
      if (!lastAstrobinDebug.images?.length) {
        await fetchAstrobinImages();
      }
      const image = findLoadedImage(url.searchParams);
      if (!image) {
        sendJson(res, 404, {
          error: "No AstroBin image matched. Use ?title=..., ?id=..., or ?hash=...."
        });
        return;
      }
      sendJson(res, 200, await runExclusiveSolve(async () => solveImageToCache(image)));
      return;
    }
    if (url.pathname === "/api/solve-missing" || url.pathname === "/api/solve-all") {
      if (!requireMethod(req, res, "POST")) return;
      if (!hasAllowedOrigin(req)) {
        sendJson(res, 403, { error: "Cross-origin state-changing requests are not allowed." });
        return;
      }
      const limit = url.searchParams.get("limit") || "200";
      const retryFailed = url.searchParams.get("retry") === "1";
      const retryBlocked = url.searchParams.get("retryBlocked") === "1";
      const retryBefore = url.searchParams.get("retryBefore") || "";
      const dryRun = url.searchParams.get("dryRun") === "1";
      sendJson(res, 200, await runExclusiveSolve(async () => solveMissingImagesToCache({ limit, retryFailed, retryBlocked, retryBefore, dryRun })));
      return;
    }
    if (url.pathname === "/api/debug") {
      if (!requireMethod(req, res, "GET")) return;
      const title = url.searchParams.get("title");
      const includeHydrate = url.searchParams.get("hydrate") === "1";
      const hydrateLimit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 10)));
      if (!title && includeHydrate) {
        const normalized = lastAstrobinDebug.images.map((image) => normalizeImage(image.raw));
        const candidates = normalized.filter(footprintNeedsDetail).slice(0, hydrateLimit);
        const hydrated = await hydrateMissingFootprintDetails(candidates);
        sendJson(res, 200, {
          ...lastAstrobinDebug,
          hydration: hydrated.stats,
          hydratedCount: hydrated.images.length,
          hydrateLimit,
          images: hydrated.images.map((image) => ({
            id: image.id,
            title: image.title,
            ra: image.ra,
            dec: image.dec,
            pageUrl: image.pageUrl,
            footprint: image.footprint,
            solution: image.solution,
            raw: image.raw
          }))
        });
        return;
      }
      if (title) {
        const needle = title.toLowerCase();
        const matches = lastAstrobinDebug.images.filter((image) => image.title.toLowerCase().includes(needle));
        const includeDetail = url.searchParams.get("detail") === "1";
        if (includeHydrate) {
          const normalized = matches.map((image) => normalizeImage(image.raw));
          const hydrated = await hydrateMissingFootprintDetails(normalized.slice(0, hydrateLimit));
          sendJson(res, 200, {
            ...lastAstrobinDebug,
            hydration: hydrated.stats,
            hydratedCount: hydrated.images.length,
            hydrateLimit,
            images: hydrated.images.map((image) => ({
              id: image.id,
              title: image.title,
              ra: image.ra,
              dec: image.dec,
              pageUrl: image.pageUrl,
              footprint: image.footprint,
              solution: image.solution,
              raw: image.raw
            }))
          });
          return;
        }
        if (includeDetail) {
          const detailed = [];
          for (const image of matches.slice(0, 10)) {
            const detail = await fetchImageDetail({ raw: image.raw });
            detailed.push({
              ...image,
              detail,
              detailFields: detail ? Object.keys(detail).filter((key) => /wcs|solution|solve|astrom|pixinsight|orientation|rotation|pixel|field|ra|dec/i.test(key)).sort() : []
            });
          }
          sendJson(res, 200, { ...lastAstrobinDebug, images: detailed });
          return;
        }
        sendJson(res, 200, {
          ...lastAstrobinDebug,
          images: matches
        });
        return;
      }
      sendJson(res, 200, lastAstrobinDebug);
      return;
    }
    if (url.pathname === "/api/images") {
      if (!requireMethod(req, res, "GET")) return;
      sendJson(res, 200, await fetchAstrobinImages());
      return;
    }
    if (!requireMethod(req, res, req.method === "HEAD" ? "HEAD" : "GET")) return;
    sendFile(req, res, decodeURIComponent(url.pathname));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.url}: ${error.message}`);
    sendJson(res, error.statusCode || 500, { error: error.message });
  }
}

function createAppServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  const server = createAppServer();
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Cannot start ${APP_NAME}: port ${PORT} is already in use.`);
    } else {
      console.error(`Cannot start ${APP_NAME}: ${error.message}`);
    }
    process.exitCode = 1;
  });
  server.listen(PORT, HOST, () => {
    console.log(`${APP_NAME} running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  createAppServer,
  coordinateOrNull,
  normalizeWcsPolygon,
  safeFileStem,
  validateAstrobinUrl
};


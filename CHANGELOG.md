# Changelog

## 1.1.7 - 2026-08-02

- Keep the highlighted celestial equator, central RA meridian, and north indicator synchronized with Aladin rotation events.
- Adapt coordinate sampling to the current field of view for accurate paths at narrow zoom levels.
- Reproject all custom celestial references through the configured ICRS view and include rotation in viewport-change detection.

## 1.1.6 - 2026-08-02

- Make the images-without-coordinates panel collapsible with an accessible header control.
- Display the number of unresolved images and retain the collapsed state for the browser session.
- Keep the compact panel available on mobile instead of hiding it completely.

## 1.1.5 - 2026-08-01

- Preserve the Aladin sky-survey background beneath the celestial reference guides.
- Define explicit transparent overlay layers for the grid, footprints, and image thumbnails.

## 1.1.4 - 2026-08-01

- Enable a discreet semi-transparent ICRS right-ascension/declination grid.
- Highlight and label the celestial equator and the map's central right-ascension meridian.
- Add a projection-aware north-direction indicator that follows map movement and zoom.

## 1.1.3 - 2026-08-01

- Add a persistent 30, 60, 100, or All image page-size selector.
- Preserve the currently visible range when switching between numeric page sizes.

## 1.1.2 - 2026-08-01

- Reuse an already-running AstroBin Sky Mapper instance instead of failing with `EADDRINUSE`.
- Detect when another application owns the configured port and show a concise remediation message.
- Expose a non-secret application identifier and version through `/api/config` for safe launcher detection.

## 1.1.1 - 2026-07-31

- Bundle and serve Aladin Lite 3.8.2 locally to avoid browser-side CDN fetch failures during startup.
- Permit Aladin Lite's embedded WebAssembly data URL in the local content-security policy.
- Permit WebAssembly compilation with the narrow `wasm-unsafe-eval` policy source required by Aladin Lite.
- Add clear error messages when the local server or Aladin runtime is unavailable.
- Log failed local requests to `server.log` without exposing API credentials.

## 1.1.0 - 2026-07-31

- Bind the server exclusively to `127.0.0.1`.
- Require POST and same-origin browser requests for solver and cache mutations.
- Add network timeouts and restrict solver downloads to HTTPS AstroBin hosts.
- Add safer recoverable WCS cache writes and serialize solver/cache changes.
- Hide local filesystem and executable paths from client configuration responses.
- Add security response headers and robust static-file path validation.
- Add 30-entry UI pagination and the required AstroBin API attribution.
- Correct the missing AstroBin username in the client payload.
- Remove duplicate footprint-label code.
- Add automated tests, documentation, known limitations, licensing, checksums, and release automation.

## 1.0.0 - 2026-06-17

- Initial local AstroBin sky projection and optional ASTAP WCS workflow.

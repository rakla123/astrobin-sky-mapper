# Changelog

## 1.2.0-beta.6 - 2026-08-04

- Use a north-up, 360° Hammer–Aitoff whole-sky projection at startup and when Home is selected.
- Preserve the whole-sky startup view instead of automatically zooming to the first image.
- Center status and page controls in the available top space between Aladin's native information groups.

## 1.2.0-beta.5 - 2026-08-04

- Change the home view to a north-up SIN projection of the complete northern celestial hemisphere, centered on the North Celestial Pole.
- Use Aladin's native 180° hemispheric field of view so the circular projection fits the viewport consistently.
- Move the application header below Aladin's native top information and projection controls.

## 1.2.0-beta.4 - 2026-08-04

- Exclude images without usable RA/Dec coordinates from the browser response and report them individually in `server.log`.
- Remove the corresponding unresolved-image panel and its browser-session state.
- Keep footprint overlays synchronized during and after mouse-wheel zooming with a bounded animation-frame redraw cycle.

## 1.2.0-beta.3 - 2026-08-03

- Detect projection seams adaptively from each footprint's normal sample spacing instead of relying only on a viewport-sized threshold.
- Split high-declination footprints that cross the active right-ascension seam without drawing long horizontal chords near a celestial pole.
- Suppress preview-image fills whenever an outline is split into multiple projection-safe segments.
- Add a regression test for the observed `SH2-174`-style polar seam jump.

## 1.2.0-beta.2 - 2026-08-03

- Reject Aladin screen coordinates that do not map back to the requested sky position.
- Preserve invalid projection samples as explicit outline breaks instead of joining points across hidden map regions.
- Disable preview-image transforms unless all four footprint corners are valid in the active projection.
- Prevent whole-sky footprints from being drawn outside the visible projection boundary.

## 1.2.0-beta.1 - 2026-08-03

- Mark this release as beta while the streamlined interface and rendering optimizations receive wider testing.
- Replace the duplicate sky-survey selector and custom celestial-reference overlay with Aladin Lite's native layer, coordinate-grid, and projection controls.
- Remove the obsolete top-left footprint anchor; AstroBin coordinates now consistently represent image centers.
- Cache celestial footprint geometry, conservatively skip off-screen footprints at narrow fields of view, and reduce viewport polling frequency.
- Stop preloading every preview image in outline mode and remove the unconditional one-minute redraw.
- Add a complete user guide and include geometry-module validation in release packaging.

## 1.1.10 - 2026-08-03

- Split projected footprint outlines at sky-projection discontinuities instead of drawing lines across the full viewport.
- Suppress distorted image fills when a footprint crosses a projection boundary while retaining its correctly segmented outline.
- Refresh celestial reference guides after projection changes and staged whole-sky navigation updates.

## 1.1.9 - 2026-08-02

- Move the desktop calibration and overview controls above Aladin's lower-left zoom and field-of-view controls.
- Reposition the API notice and unresolved-image panel to keep the bottom overlays from colliding.

## 1.1.8 - 2026-08-02

- Remove the raw AstroBin astrometry-field inventory from the object information panel.
- Make the overview button restore an unrotated, full-sky Hammer-Aitoff view instead of a 90-degree field centered on the first image.

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

# AstroBin Sky Mapper

AstroBin Sky Mapper is a local, browser-based sky atlas that places the images from an AstroBin account or library on an interactive celestial projection. It combines AstroBin metadata with Aladin Lite and can optionally use locally solved WCS footprints from ASTAP for more accurate geometry.

The application runs only on the local computer and binds to `127.0.0.1`. AstroBin API credentials remain in the local `config.json` file and are never sent to the browser.

## Features

- Interactive high-resolution sky navigation with Aladin Lite.
- AstroBin images shown as sky footprints at their available RA/Dec coordinates.
- A maximum of 30 AstroBin entries per page, with Previous and Next controls.
- Outline and preview-image overlay modes.
- Image metadata, equipment, object, date, orientation, and scale display.
- Per-image rotation and scale calibration stored in browser local storage.
- Optional local ASTAP plate solving with a persistent WCS cache.
- Validation of ASTAP results against AstroBin position hints.
- Resumable batch solving with failed and blocked solve tracking.
- Local-only server, request timeouts, safer cache writes, and protected solver endpoints.
- No third-party Node.js packages or installation step.

## Requirements

- Windows 10 or Windows 11 for the supplied launcher and ASTAP helper scripts.
- Node.js 18 or newer.
- A modern browser with WebGL support.
- Internet access for AstroBin, Aladin Lite, and the selected HiPS survey.
- An AstroBin API key and secret.
- Optional: ASTAP and an appropriate ASTAP star database for local plate solving.

The Node.js server itself is portable, but the convenience and solver scripts are currently Windows PowerShell scripts.

## Download and start

1. Download the latest `AstroBin-Sky-Mapper-<version>.zip` from the repository's [Releases](https://github.com/rakla123/astrobin-sky-mapper/releases) page.
2. Optionally verify the adjacent `.sha256` checksum.
3. Extract the ZIP to a writable folder.
4. Double-click `Start-AstroBinSky.bat`.
5. On first use, the launcher creates `config.json` from `config.example.json` and opens it in Notepad.
6. Enter your own AstroBin username, API key, and API secret, save the file, and return to the launcher.
7. The application opens at `http://127.0.0.1:8787` unless another port is configured.
8. Keep the launcher window open while using the mapper. Closing it stops the local server.

If the mapper is already running, launching it again opens the existing instance instead of starting a second server. If another application is using the configured port, the launcher identifies the conflict and asks you to close that application or change `app.port` in `config.json`.

Use the **Show** selector beside the page controls to display 30, 60, 100, or all retrieved images at once. The selection is retained by the browser. Larger values can reduce responsiveness when many footprint overlays are visible.

The background includes a low-opacity ICRS coordinate grid. The celestial equator is highlighted in amber, the map's central right-ascension meridian in green, and a projection-aware **N** arrow indicates celestial north. Aladin's grid button can hide or show the underlying coordinate grid.

Alternatively, start it from a terminal:

```powershell
node server.js
```

## Configuration

Copy `config.example.json` to `config.json`. Never publish or share `config.json`.

```json
{
  "app": {
    "name": "AstroBin Sky Mapper",
    "port": 8787
  },
  "astrobin": {
    "username": "your-astrobin-username",
    "library": "optional-library-or-collection-name",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

The library value is optional. When it is blank, the mapper requests images for the configured user. AstroBin's legacy API does not expose or filter all library/collection metadata consistently, so the application also performs a conservative local metadata match when that information is available.

The `username` value must be the AstroBin account username, not the displayed profile alias. For the FlapAstro account this is `Rakla1073`.

### Network errors

The mapper bundles Aladin Lite 3.8.2 and serves it from the local server, so startup no longer depends on downloading the viewer runtime from the CDS website. Internet access is still required for AstroBin data and sky-survey tiles. If the page reports that the local server is unreachable, keep the launcher window open and reload the page. For other failures, inspect `server.log` in the application folder; version 1.1.1 records the failed local request and a concise error without writing API credentials.

Aladin Lite is developed by CDS and is included under its LGPL-3.0-or-later license. Its license text is distributed in `public/vendor/aladin/LICENSE`.

Environment variables can override configuration values:

```powershell
$env:ASTROBIN_USERNAME="..."
$env:ASTROBIN_LIBRARY="..."
$env:ASTROBIN_API_KEY="..."
$env:ASTROBIN_API_SECRET="..."
$env:OBSERVER_LAT="46.52"
$env:OBSERVER_LON="6.63"
$env:OBSERVER_ELEV="840"
node server.js
```

Useful cache and network settings include:

- `cache.wcsCachePath`: local WCS cache file.
- `cache.solveRoot`: downloaded solve images and ASTAP sidecars.
- `cache.imageCacheMs`: AstroBin response cache duration; default five minutes.
- `cache.requestTimeoutMs`: AstroBin API timeout; default 30 seconds.
- `cache.downloadTimeoutMs`: solve-image download timeout; default 120 seconds.
- `cache.maxApiPages`: maximum API pages followed in one refresh; default 10 and hard-limited to 50.

## Why local WCS solving is useful

The AstroBin API provides basic image metadata, but RA, Dec, orientation, dimensions, pixel scale, and field radius are not guaranteed for every image. Even when present, those values describe an approximate rectangular footprint rather than a complete distortion-aware WCS solution.

AstroBin Sky Mapper can download one of your image derivatives, solve it with ASTAP, and store a local sky polygon in `data/wcs-cache.json`. This geometry takes precedence over the approximate API footprint.

Solve one image:

```powershell
.\Solve-With-ASTAP.ps1 -Title "Sh2-103"
```

Solve all entries that do not already have a valid cached WCS polygon:

```powershell
.\Solve-With-ASTAP.ps1 -All
```

Retry failed or blocked entries deliberately:

```powershell
.\Solve-With-ASTAP.ps1 -All -RetryFailed
.\Solve-With-ASTAP.ps1 -All -RetryBlocked
```

ASTAP is optional for viewing metadata footprints. It is required only for local WCS generation. Set a non-default executable path with `ASTAP_EXE` or `solver.astapExe`.

## Development and verification

```powershell
npm run check
npm test
```

The test suite checks coordinate parsing, WCS polygon normalization, AstroBin-only downloads, private path redaction, security headers, state-changing request protection, path traversal handling, and HEAD requests.

Create a release package:

```powershell
npm run package:windows
```

The resulting ZIP and SHA-256 file are written to `dist`. The package excludes API credentials, logs, local solves, WCS cache content, tests, and repository metadata.

## Privacy and security

- The server listens on `127.0.0.1`, not on the LAN.
- API credentials are read server-side and are not returned by `/api/config`.
- Solver and cache-changing endpoints accept POST only and reject cross-origin browser requests.
- Remote API calls and downloads use timeouts.
- Downloads used for solving are restricted to HTTPS AstroBin hosts.
- Do not expose the port through router forwarding, a reverse proxy, or a public tunnel.

## Known limitations

See [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md) for API, coordinate, projection, WCS, platform, and service limitations.

## AstroBin API terms and attribution

This product uses the AstroBin API but is not endorsed or certified by AstroBin.

Users must obtain their own API credentials, respect each image's license, avoid excessive requests, and comply with the [AstroBin API documentation](https://welcome.astrobin.com/application-programming-interface) and [AstroBin Terms of Service](https://welcome.astrobin.com/terms-of-service). The interface paginates AstroBin entries at 30 per page in accordance with the published API terms.

AstroBin and its content remain the property of their respective owners. No AstroBin logo is distributed with this project.

## Third-party acknowledgements

- AstroBin provides the read-only image API and image metadata.
- [Aladin Lite](https://aladin.cds.unistra.fr/AladinLite/doc/) and the Aladin Sky Atlas are developed by the Centre de Données astronomiques de Strasbourg (CDS). The application leaves the Aladin attribution intact.
- [ASTAP](https://www.hnsky.org/astap.htm) is an optional external plate solver and is not included in the distribution.
- Development and review were assisted by OpenAI Codex.

All third-party names, services, software, data, and trademarks belong to their respective owners. Their inclusion does not imply endorsement.

## License and warranty

Copyright 2026 FlapAstro.

The project is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). Personal and other noncommercial uses permitted by that license are allowed; commercial use is restricted.

The software is provided **as is**, without warranty or condition. Suitability, configuration, API compliance, plate-solving results, and use of the software remain solely the user's responsibility.

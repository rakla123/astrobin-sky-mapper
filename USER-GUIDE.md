# AstroBin Sky Mapper User Guide

## Beta status

Version 1.2.0-beta.5 is a beta release intended for wider testing. It is suitable for exploring and organizing an AstroBin portfolio, but footprint placement and optional plate-solving results must not be treated as scientific measurements. The software is provided as is, without warranty.

When reporting a problem, include the application version, Windows version, browser and version, what you expected, what happened, the steps needed to reproduce it, and relevant lines from `server.log`. Never include your AstroBin API secret.

## Requirements

- Windows 10 or Windows 11 for the included launcher and ASTAP helper scripts.
- Node.js 18 or newer.
- A current browser with WebGL 2 support.
- Internet access to AstroBin and the selected HiPS sky-survey service.
- An AstroBin API key and secret.
- Optional: ASTAP plus a suitable star database for local plate solving.

## Installation

1. Download `AstroBin-Sky-Mapper-1.2.0-beta.5.zip` from the GitHub Releases page.
2. Optionally compare its SHA-256 value with the adjacent `.sha256` file.
3. Extract the complete archive to a writable folder. Do not run it from inside the ZIP.
4. Double-click `Start-AstroBinSky.bat`.
5. On first launch, edit the newly created `config.json`, save it, and return to the launcher.
6. Keep the launcher window open while using the mapper.

No `npm install` step is required. Aladin Lite is included in the package.

## Configuration

At minimum, set these values in `config.json`:

```json
{
  "astrobin": {
    "username": "your-account-username",
    "library": "",
    "apiKey": "your-api-key",
    "apiSecret": "your-api-secret"
  }
}
```

Use the account username used by AstroBin's API, which can differ from the public profile alias. Leave `library` empty to retrieve the configured user's images. Library and collection filtering depends on metadata exposed by AstroBin and is not guaranteed for every account.

The optional `display.survey` value selects the initial HiPS background; its default is `P/DSS2/color`. Once the viewer is open, use Aladin's native Layers control to change surveys. `orientationOffsetDeg`, `scaleSource`, and `overlayMode` define initial footprint settings.

Keep `config.json` private. It contains credentials and is deliberately excluded from distribution packages.

## Starting and stopping

Double-click `Start-AstroBinSky.bat`. The launcher starts a local Node.js server and opens the mapper at `http://127.0.0.1:8787` by default. Closing the launcher stops the server.

Starting the launcher a second time opens the existing compatible instance. If another program owns the configured port, close that program or change `app.port` in `config.json`.

Advanced users can start the server directly:

```powershell
node server.js
```

## Using the sky map

Aladin provides the map navigation and standard astronomy controls:

- Drag to pan and use the wheel or Aladin zoom buttons to change the field of view.
- Use Layers to select the background survey.
- Use the grid control to show or hide the celestial coordinate grid.
- Use the projection control to change the sky projection.
- Use the Simbad pointer, settings, and fullscreen controls as needed.

AstroBin Sky Mapper adds portfolio-specific controls:

- **Show** selects 30, 60, 100, or all retrieved entries per page. Smaller pages are more responsive.
- **Previous** and **Next** move between image pages.
- The home button returns to a north-up 180° SIN view of the complete northern celestial hemisphere, centered on the North Celestial Pole.
- Hover over or focus a footprint to show its preview and metadata. Select it to center and zoom the map.
- Entries without usable RA/Dec coordinates are excluded from the map and listed in `server.log` with their AstroBin identifiers, titles, and page URLs.

## Footprint display and calibration

**Outline** is the recommended default. It draws lightweight footprint boundaries without downloading all preview images. **Image** fills selected or nearby footprints with AstroBin preview images when the field of view is sufficiently narrow. A preview may be cropped, rotated, or resampled by AstroBin, so image-fill alignment can differ even when the outline is correct.

**Pixel** calculates approximate footprint size from pixel dimensions and pixel scale. **Field** calculates it from field radius and aspect ratio and can help when pixel metadata is missing or inconsistent.

The global 0/90/180/270-degree control adjusts metadata orientation for the displayed page. The preview panel provides per-image rotation and scale corrections, stored only in the current browser profile. Reset removes the current image's manual correction.

Footprints always use AstroBin RA/Dec as their center. The obsolete top-left anchor has been removed.

## Optional ASTAP plate solving

Metadata footprints are approximate. ASTAP can create a locally cached WCS polygon that takes precedence when available.

Solve one entry:

```powershell
.\Solve-With-ASTAP.ps1 -Title "Sh2-103"
```

Solve unsolved entries sequentially:

```powershell
.\Solve-With-ASTAP.ps1 -All
```

Retry deliberately when appropriate:

```powershell
.\Solve-With-ASTAP.ps1 -All -RetryFailed
.\Solve-With-ASTAP.ps1 -All -RetryBlocked
```

Install ASTAP and a suitable star database separately. Configure a non-default executable with `solver.astapExe` in `config.json` or the `ASTAP_EXE` environment variable. Plate solving can fail for starless, narrowband, solar, lunar, planetary, highly compressed, heavily processed, or incorrectly hinted images.

## Updating from an earlier release

1. Stop the old launcher.
2. Extract the new release into a new folder.
3. Copy only your private `config.json` into the new folder.
4. Start the new launcher and confirm the reported version.
5. Keep the old folder until the beta works correctly for you.

Do not replace new program files with old copies. An old `display.footprintAnchor` setting is ignored and may be deleted. Browser-stored page size and per-image corrections remain associated with the same local address and port.

## Troubleshooting

### Configuration incomplete

Confirm `astrobin.username`, `astrobin.apiKey`, and `astrobin.apiSecret` are present and valid JSON. The username must be the API account username, not necessarily the displayed alias.

### AstroBin could not be loaded

Keep the launcher open, reload the page, and inspect `server.log`. Check internet access, credentials, AstroBin availability, firewall or proxy restrictions, and request timeouts.

### `EADDRINUSE`

Port 8787 is already in use. The launcher normally reuses a compatible running mapper. Otherwise stop the process using that port or change `app.port`.

### Images have no coordinates

AstroBin did not expose usable RA/Dec values for those entries. Solve and publish astrometry on AstroBin or generate a local ASTAP WCS cache.

### A footprint is inaccurate

Try Pixel versus Field scale, a global orientation offset, or the per-image controls. For the most reliable boundary, solve the entry with ASTAP. See `KNOWN-LIMITATIONS.md` for projection and metadata constraints.

### The background is blank

Use Aladin's Layers control to choose another survey. Survey tiles are downloaded from external services and require network access even though the Aladin viewer code is bundled locally.

## Privacy, rights, and limitations

The server listens only on `127.0.0.1`; do not expose it with port forwarding, a public tunnel, or a reverse proxy. Credentials stay server-side and are not returned by `/api/config`.

Each AstroBin image retains its own copyright and license. This application does not grant redistribution or reuse rights. It uses the AstroBin API but is not endorsed or certified by AstroBin.

Read [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md), [SECURITY.md](SECURITY.md), and [LICENSE.md](LICENSE.md) before distribution or extended use.

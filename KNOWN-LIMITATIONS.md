# Known limitations

This document describes known constraints in AstroBin Sky Mapper 1.1.0. They are not necessarily defects in the application.

## AstroBin API

1. **The API is read-only and intentionally limited.** AstroBin documents it as providing basic image information and simple searches, not a complete export of all data visible on the website.
2. **Coordinates are not guaranteed.** RA and Dec can be absent when an image has not been successfully plate-solved, when fields are unavailable through the API endpoint, or when older records use incomplete metadata. Such images are listed but cannot be projected.
3. **Complete WCS geometry is not reliably available.** The API may provide center coordinates, orientation, dimensions, pixel scale, or field radius, but these values do not necessarily represent the exact image boundary or optical distortion.
4. **Library and collection filtering is inconsistent.** The legacy API does not expose every website library/collection relationship uniformly. The mapper tries supported query variants and uses local metadata matching only when matching metadata is actually returned.
5. **Search and pagination limits apply.** AstroBin documents a 100-result limit for subject searches. The mapper uses user-image queries and follows a configurable number of pages, but it cannot guarantee retrieval beyond AstroBin's server-side limits or future API changes.
6. **No formal uptime or schema guarantee is assumed.** Endpoint behavior, fields, authentication, limits, and terms may change. The mapper may require an update when AstroBin changes the service.
7. **Fair-use rules apply.** Results are cached to reduce traffic, and the interface shows no more than 30 AstroBin entries per page. Users remain responsible for API-key usage and compliance with AstroBin's current terms.

## Image previews and rights

1. AstroBin preview URLs can refer to rotated, cropped, resampled, or compressed derivatives. An image fill may therefore not align exactly with the footprint even when the footprint itself is correct.
2. Image availability depends on AstroBin and its CDN. Deleted, private, restricted, or moved images may fail to load.
3. Each AstroBin image retains its own copyright and license. This software does not grant rights to download, redistribute, publish, or reuse any image.
4. The application is intended for a user's own account or other content for which the user has the necessary rights and API permission.

## Projection and geometry

1. Metadata-only footprints are approximated as rectangles on the celestial sphere.
2. `field_radius` is treated as a diagonal radius and combined with the image aspect ratio. If AstroBin's value describes something different for a particular record, the result can be incorrectly scaled.
3. Orientation conventions can differ between acquisition software, AstroBin metadata, preview derivatives, and north/east screen orientation. Global and per-image calibration controls are provided as a workaround.
4. Very large fields and fields close to the celestial poles can show greater visual distortion.
5. Observer latitude, longitude, and elevation are displayed as context only. The current version does not calculate horizon visibility, rise/set times, airmass, or field rotation.

## Local ASTAP solving

1. ASTAP and its star databases are not included and must be installed separately.
2. Solving depends on sufficient stars, a suitable database, correct scale/position hints, and a usable downloaded image. Starless images, narrowband data, solar/lunar/planetary images, very large fields, heavy compression, or strongly processed images may fail.
3. The WCS reader supports common ASTAP FITS headers with CD matrices or CDELT/CROTA values. It does not model SIP or other higher-order optical distortion terms.
4. A successful-looking solve can still be wrong. The mapper rejects scale warnings, weak quad matches, and excessive position offsets, but these checks cannot prove scientific correctness.
5. Batch solving is deliberately sequential. This is slower but avoids launching several ASTAP processes and competing cache writes at once.
6. Only one solve or cache-changing operation is accepted at a time. Concurrent requests receive an HTTP 409 response.

## Platform and browser

1. The launcher, distribution builder, and ASTAP helper are Windows PowerShell scripts.
2. The Node.js server can run elsewhere, but non-Windows startup and solver integration are not packaged or tested.
3. Aladin Lite and sky surveys are loaded from external services. Offline use is not currently supported.
4. A current browser with JavaScript, WebGL, local storage, and network access is required.
5. Per-image manual calibration is stored only in the current browser profile. It is not synchronized or included in the WCS cache.
6. The server is designed for a single local user. It has no accounts, multi-user isolation, TLS, or public-hosting hardening.


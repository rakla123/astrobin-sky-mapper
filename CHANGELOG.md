# Changelog

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


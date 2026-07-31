# Security

## Supported version

Security fixes are applied to the latest release of AstroBin Sky Mapper.

## Intended deployment

The application is designed for one user on a trusted local computer. The server binds to `127.0.0.1` and must not be exposed through port forwarding, a public reverse proxy, a shared network binding, or a tunneling service.

Keep `config.json` private. It contains the user's AstroBin API key and secret and is excluded from Git and distribution packages by default.

## Reporting a vulnerability

Do not publish API credentials, private image URLs, local filesystem paths, or a working exploit in a public issue. Contact FlapAstro privately through the contact method published on the FlapAstro GitHub profile, with:

- the affected version;
- the operating system and Node.js version;
- a concise reproduction;
- the expected and observed result;
- the potential impact; and
- any suggested mitigation.


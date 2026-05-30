# Security Policy

## Supported versions

This project ships as a desktop app from the [Releases](https://github.com/J-FPV/Pixiv-PBD-Manager/releases) page. Only the latest release receives security fixes. Please upgrade before reporting an issue.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private vulnerability reporting instead: go to the repository's **Security** tab → **Report a vulnerability** (GitHub Security Advisories). That keeps the report private until a fix is available.

Please include:

- what you observed and how to reproduce it,
- the app version (Settings → software version) and your OS,
- the impact you think it has.

You can expect an initial acknowledgement within a few days. There is no bug-bounty program; this is a personal open-source project.

## Handling of credentials

This app can use a Pixiv session cookie, which is equivalent to your account password. A few things worth knowing when assessing risk:

- The cookie is stored locally, encrypted with Windows DPAPI at `.pixiv-pbd-manager/cookie.bin`. It is never committed to the repository.
- The cookie is sent only to `*.pixiv.net`. Image downloads from `i.pximg.net` are made with a `Referer` only — never the cookie — so the session is not exposed to the image CDN.
- Cookie consent is opt-in and can be revoked, which clears the stored cookie.

See the "Pixiv Cookie and privacy risks" section of the README for the full threat model. If you find a way the cookie can leak beyond the model described there, that is a vulnerability — please report it privately as above.

# Security Policy

## Supported Versions

The current development line is `0.2.x`.

## Security Boundaries

This project is designed to avoid Overleaf account secrets:

- It does not read or store Overleaf cookies.
- It does not read or store Overleaf Git tokens.
- It does not read browser history.
- It does not read local files from the browser extension.
- The extension is scoped to Overleaf project pages and the local bridge URL.
- Write tools validate `projectTitle`, `expectedFileName`, and `beforeHash` before modifying editor text.

Local tool calls use a runtime token stored under `.runtime/bridge-token.txt`. Restricted extension bridge calls are limited to Chrome Extension or Overleaf page origins. Treat the token as local-only. It is not an Overleaf credential.

## Reporting Issues

If this is published on GitHub, report security issues privately through GitHub Security Advisories if enabled. Until then, do not paste sensitive Overleaf account data, cookies, project secrets, or manuscript-private content into public issues.

## Safe Testing

Use a copied Overleaf test project before trying the bridge on real manuscripts. Always pass `projectTitle`, `expectedFileName`, `beforeHash`, and `reason` for every write.

# Contributing

Thanks for improving Overleaf Codex Browser Bridge.

## Development

Requirements:

- Node.js 18 or newer.
- Chrome or Chromium with Developer mode enabled.

Run local checks:

```powershell
npm run release:check
```

Run the bridge:

```powershell
npm start
```

Load the extension from:

```text
extension/
```

## Pull Request Checklist

- Keep permissions minimal in `extension/manifest.json`.
- Do not add code that reads cookies, passwords, browser history, or Overleaf Git tokens.
- Do not commit `.runtime/`, `snapshots/`, `dist/`, generated archives, local mirror files, or private manuscript text.
- Update `README.md` or `docs/` when behavior changes.
- Add or update tests for server protocol changes.
- Run `npm run release:check` before submitting.

## Scope

The bridge is intentionally current-tab first. Features that scan all Overleaf projects, persist account credentials, or modify multiple real papers automatically should be discussed carefully before implementation.

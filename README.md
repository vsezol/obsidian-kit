# Obsidian Kit

Inline interactive widgets for Obsidian. Type a short expression in your note and it becomes a tappable control — works in both Reading mode and Live Preview, on desktop and mobile.

## Widgets

| Syntax | Renders |
| --- | --- |
| `counter(0, 6)` | `−` `0/6` `+` buttons (default step `1`) |
| `counter(0, 6, 2)` | same, step `2` |
| `switcher(false)` | `OFF` / `ON` toggle pill |
| `range(0, 10)` | slider, default step `1` |
| `range(0, 10, 2)` | slider, step `2` |

Tapping any control rewrites the source line in place. Place the cursor inside the expression in Live Preview to edit the raw text.

### Example

```markdown
Health:
- Gym counter(0, 6)
- Meditate switcher(false)
- Mood range(0, 10)
```

## Install

### Manual

1. Download `main.js`, `manifest.json`, `styles.css` from the latest [release](https://github.com/vsezol/obsidian-kit/releases).
2. Drop them into `<vault>/.obsidian/plugins/obsidian-kit/`.
3. Enable **Obsidian Kit** in Settings → Community plugins.

### Community plugins

Once approved, search for "Obsidian Kit" in Settings → Community plugins → Browse.

## Develop

```bash
npm install
npm run dev      # esbuild watch
npm run build    # production build → main.js
npm run deploy   # build, then copy main.js/manifest.json/styles.css into your vault
```

`npm run deploy` reads the vault path from `.vault-path` (one line, gitignored) or
the `OBSIDIAN_VAULT_PATH` env var, and writes to
`<vault>/.obsidian/plugins/obsidian-kit/`.

```bash
echo "/path/to/vault" > .vault-path
npm run deploy
```

## License

MIT

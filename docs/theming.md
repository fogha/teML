# Theming guide

TeML themes map **semantic roles** to terminal styles. Documents reference roles (`success`, `heading1`, `border`, …); themes decide colors and glyphs.

## Built-in themes

Shipped in `dist/terminal/themes/`:

| Name | Use |
| --- | --- |
| `dark` | Default rich palette on dark backgrounds |
| `light` | Palette tuned for light terminals |
| `mono` | No color; plain snapshots and `render` command |
| `auto` | Adapts chrome for mixed/light-dark terminals |

Select with `--theme dark` or frontmatter `theme: dark`.

## Role map

Each theme JSON contains:

```json
{
  "name": "dark",
  "roles": {
    "heading1": { "fg": "brightCyan", "bold": true },
    "link": { "fg": "blue", "underline": true },
    "code": { "fg": "brightGreen" }
  },
  "decorations": {
    "success": { "gutterUnicode": "✓", "gutterAscii": "[OK]", "labelUnicode": "", "labelAscii": "" }
  }
}
```

| Role | Typical style | Used by |
| --- | --- | --- |
| `highlight` | { fg or bg } | `:highlight[…]` / `<mark>` emphasis |
| `deprecated` (example) | { strike: true } | Custom struck roles via frontmatter |

Roles used by the layout engine include: `heading1`–`heading4`, `paragraph`, `link`, `code`, `border`, `muted`, `success`, `warning`, `error`, `info`, `highlight`, and container-specific chrome.

## Custom roles from frontmatter

Merge document-specific roles without editing the theme file:

```yaml
---
roles:
  brand:
    fg: "#5eead4"
    bold: true
---
```

`:span` directives and HTML profile mappings can target these roles.

## Custom theme files

Pass a path to `--theme ./my-theme.json`. Paths may be absolute or relative to the working directory. Invalid keys produce `teml: warning:` on stderr and fall back to built-in defaults.

## ASCII and color fallbacks

| Capability | Behavior |
| --- | --- |
| `--ascii` | Box-drawing → `+-\|`; ✓/⚠/✗ → `[OK]`/`[WARN]`/`[FAIL]` |
| `--no-color` / `NO_COLOR` / pipe | Plain backend; roles become weight/glyph conventions only |
| `--show-urls` | Visible URL suffix when hyperlinks unavailable or flag set |

Hyperlinks (OSC 8) are emitted only when the terminal supports them **and** `--show-urls` is not set (avoids duplicating URL text).

## Strike and highlight

| Input | Theme role / style | ANSI (when colored) |
| --- | --- | --- |
| `:highlight[term]` | `roles.highlight` | Role fg/bg |
| `~~strike~~` | inline `strike: true` | SGR 9 / 29 toggle |
| `roles.old.strike: true` | merged role style | SGR 9 combined with fg/bg |

Use `mono` or `--no-color` to verify strike via layout tokens (`strike=true` in `--render-tokens`); highlight falls back to weight/glyph conventions.

## HTML profiles (related)

HTML `--profile bootstrap` maps CSS classes to TeML directives before theming applies. See `dist/html/profiles/bootstrap.json`. User profiles follow the same JSON shape.

## Tips

- Prefer **roles** over raw ANSI in documents — the same `.teml` file works in dark, light, mono, and piped CI logs.
- Use `mono` for golden snapshots; use `dark` + `--width` for local reading.
- Custom hex colors downgrade gracefully on 16- and 256-color terminals.

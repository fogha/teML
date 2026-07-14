# Demo recording

## Quick demo (built output)

```bash
npm run build
npm run demo          # teml examples/demo.teml
npm run demo:html     # teml view examples/demo.html
npm run demo:command-center   # teml view examples/service-command-center.teml --theme dark --width 100
```

## Recommended terminal recording

Use [vhs](https://github.com/charmbracelet/vhs) or asciinema:

```bash
# asciinema (install separately)
asciinema rec demo.cast -c "teml examples/demo.teml --width 80"

# vhs — example tape file:
cat > demo.tape <<'EOF'
Output demo.gif
Set Shell "bash"
Set FontSize 14
Set Width 900
Set Height 520
Type "teml examples/demo.teml --width 80"
Enter
Sleep 3s
EOF
vhs demo.tape
```

## Files synchronized with examples

| File | Purpose |
| --- | --- |
| `examples/demo.teml` | Kitchen-sink TeML (cards, alerts, kv, table) |
| `examples/demo.html` | Bootstrap-style HTML with hostile content stripped |
| `examples/demo.md` | Markdown counterpart for convert/view |
| `examples/service-command-center.teml` | Synchronized command-center (grid, metrics, progress, events) |
| `examples/service-command-center.html` | HTML counterpart with native + `data-teml` bridge |
| `examples/operations-dashboard.teml` | Ops dashboard sample |
| `fixtures/teml/10-kitchen-sink.teml` | Regression fixture (same themes as demo) |
| `fixtures/teml/35-dashboard-layout.teml` | Dashboard directive conformance fixture |

After editing `examples/demo.teml`, refresh snapshots if layout changes:

```bash
npm test -- tests/teml/fixtures.test.ts
```

## README animation

An animated GIF in the README is optional. If not checked in, record locally with the commands above and attach `demo.gif` to the README manually.

# Convert your first page in 5 minutes

This tutorial takes you from zero to a readable terminal view of a real documentation page.

## 1. Install (1 min)

```bash
npm install -g teml
# or without installing:
npx teml --version
```

From source in this repo:

```bash
npm install
npm run build
node dist/cli/main.js --version
```

## 2. View the kitchen sink (30 sec)

```bash
teml examples/demo.teml
```

You should see a deploy report with cards, alerts, a KV block, and a table. Pipe to a file to verify plain output:

```bash
teml examples/demo.teml --no-color > /tmp/demo.txt
```

## 3. Convert HTML → TeML (1 min)

```bash
teml convert examples/demo.html --to teml > /tmp/demo-from-html.teml
teml /tmp/demo-from-html.teml --width 100
```

Bootstrap-style cards and alerts map automatically with the default profile.

## 4. Convert Markdown (1 min)

```bash
teml convert examples/demo.md --from markdown --to teml
teml view examples/demo.md --width 80
```

Markdown views directly without an intermediate file.

## 5. Save a doc site page offline (1 min)

Save any documentation HTML locally (browser → Save Page, or `curl` once), then:

```bash
teml view ./saved-page.html --width 100 --no-color | less
```

Try the bundled real-page fixtures:

```bash
teml view fixtures/html/04-realpage.html --width 80
teml view fixtures/html/20-mdn-excerpt.html --width 80
```

## 6. Inspect and debug (30 sec)

```bash
teml inspect examples/demo.teml --tokens | head
teml view examples/demo.teml --debug
```

## Checklist

- [ ] `teml --version` prints `1.x`
- [ ] Kitchen sink renders with borders and colors (or plain with `--no-color`)
- [ ] HTML convert emits `:::card` / alert directives
- [ ] Markdown file views without errors
- [ ] Saved HTML page is readable at width 80–120

## Next steps

- Read [spec.md](./spec.md) for directive syntax
- Read [cli.md](./cli.md) for all flags
- Read [theming.md](./theming.md) to customize colors
- Run `npm test` in the repo for the full fixture corpus

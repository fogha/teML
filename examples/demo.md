# Deploy Report (Markdown)

Markdown counterpart to [demo.teml](./demo.teml) and [demo.html](./demo.html).

```bash
teml view examples/demo.md --width 80
teml convert examples/demo.md --from markdown --to teml
```

## Summary

Deployment finished in **4m 12s** with status :success[Passed]. Full details in the `deploy.log` file or the [dashboard](https://ops.example.com).

## Services

| Service | Status | Latency |
|---|---|---|
| payments | OK | 42ms |
| auth | OK | 18ms |
| search | Degraded | 310ms |

> Deploys are boring now. That is the point.

See [docs/demo.md](../docs/demo.md) for recording instructions.

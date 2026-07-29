#!/usr/bin/env python3
"""Incident handoff example — HTML view + Python controller + TeML runtime."""

from __future__ import annotations

from pathlib import Path

from teml_host import Context, run

VIEW = Path(__file__).with_name("view.html")


def validate(values: dict[str, str]) -> str | None:
    service = values.get("service", "").strip()
    summary = values.get("summary", "").strip()
    if not service:
        return "Affected service is required."
    if not summary:
        return "Operator summary is required."
    return None


def screen_html(error: str) -> str:
    base = VIEW.read_text(encoding="utf-8")
    return base.replace("</h2>", f'</h2>\n<div class="alert alert-danger">{error}</div>')


def main() -> int:
    outcome: str | None = None

    def on_click(widget_id: str, values: dict[str, str], ctx: Context) -> None:
        nonlocal outcome
        if widget_id == "cancel":
            outcome = "Cancelled — no incident handoff sent."
            ctx.exit()
        elif widget_id == "submit":
            error = validate(values)
            if error is None:
                summary = values.get("summary", "").replace("\n", " / ")
                paged = "yes" if values.get("page") == "true" else "no"
                outcome = (
                    "Incident handoff sent!\n"
                    f"  service:  {values.get('service', '')}\n"
                    f"  severity: {values.get('severity', '')}\n"
                    f"  summary:  {summary}\n"
                    f"  paged:    {paged}"
                )
                ctx.exit()
            else:
                ctx.render(screen_html(error), format="html")

    run(
        str(VIEW),
        frames="ansi",
        mode="patches",
        on_click=on_click,
    )
    if outcome:
        print(outcome)
    else:
        print("Session ended without submission.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

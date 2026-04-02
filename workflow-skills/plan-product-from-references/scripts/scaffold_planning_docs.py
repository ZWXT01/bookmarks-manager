#!/usr/bin/env python3
"""
Scaffold a planning bundle for pre-implementation product work.

Usage:
  python3 workflow-skills/plan-product-from-references/scripts/scaffold_planning_docs.py \
    --project-name "Example" \
    --slug "example" \
    --out "docs/planning/example"
"""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path


FILES = [
    "01-reference-analysis.md",
    "02-roadmap.md",
    "03-issue-breakdown.md",
    "04-agent-runbook.md",
    "05-agent-status.md",
    "06-risk-log.md",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create a planning document bundle from templates.")
    parser.add_argument("--project-name", required=True, help="Human-readable project or initiative name.")
    parser.add_argument("--slug", required=True, help="Folder-safe slug for the planning bundle.")
    parser.add_argument("--out", required=True, help="Target output directory.")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files.")
    return parser.parse_args()


def load_template(template_dir: Path, filename: str) -> str:
    template_name = f"{filename}.tmpl"
    template_path = template_dir / template_name
    return template_path.read_text(encoding="utf-8")


def render_template(raw: str, project_name: str, slug: str, date_str: str) -> str:
    return (
        raw.replace("{{PROJECT_NAME}}", project_name)
        .replace("{{PROJECT_SLUG}}", slug)
        .replace("{{DATE}}", date_str)
    )


def main() -> None:
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    skill_dir = script_dir.parent
    template_dir = skill_dir / "assets" / "templates"
    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")

    created = []
    skipped = []

    for filename in FILES:
        target = out_dir / filename
        if target.exists() and not args.force:
            skipped.append(str(target))
            continue

        raw = load_template(template_dir, filename)
        rendered = render_template(raw, args.project_name, args.slug, date_str)
        target.write_text(rendered, encoding="utf-8")
        created.append(str(target))

    print("Planning bundle scaffold completed.")
    if created:
        print("Created:")
        for path in created:
            print(f"  - {path}")
    if skipped:
        print("Skipped existing files:")
        for path in skipped:
            print(f"  - {path}")


if __name__ == "__main__":
    main()

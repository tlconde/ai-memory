"""Cursor Composer 2.5 orchestration harness for AMP implementation work.

Run from this directory:
  export CURSOR_API_KEY=...
  uv run python main.py task manifests/vertical-slice-architect.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from cursor_sdk import Agent, LocalAgentOptions


MODEL = "composer-2.5"
REPO_ROOT = Path(__file__).resolve().parents[2]


def load_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode("utf-8")).hexdigest()[:16]


def render_task_prompt(task: dict[str, Any]) -> str:
    skill_paths = "\n".join(f"- {path}" for path in task.get("skill_paths", []))
    context_paths = "\n".join(f"- {path}" for path in task.get("context_paths", []))
    constraints = "\n".join(f"- {item}" for item in task.get("constraints", []))
    output_contract = task.get("output_contract", "Return Markdown with findings and next steps.")

    return f"""You are Cursor Composer 2.5 acting as a bounded AMP implementation subagent.

Role:
{task["role"]}

Task:
{task["task"]}

Skill/context pack to read first:
{skill_paths or "- none"}

Repository context to inspect:
{context_paths or "- none"}

Constraints:
{constraints or "- Follow the source documents exactly."}

Output contract:
{output_contract}

Do not modify files. Return only the requested report or patch plan. If a claim depends on external tool behavior, mark it VERIFIED, PROVISIONAL, or UNKNOWN.
"""


def run_task(task_path: Path) -> str:
    api_key = os.environ.get("CURSOR_API_KEY")
    if not api_key:
        raise SystemExit("Set CURSOR_API_KEY before running the Composer harness.")

    task = load_json(task_path)
    prompt = render_task_prompt(task)

    print(f"task_id={task.get('id', task_path.stem)}")
    print(f"model={MODEL}")
    print(f"cwd={REPO_ROOT}")
    print(f"prompt_hash={prompt_hash(prompt)}")

    with Agent.create(
        model=MODEL,
        api_key=api_key,
        local=LocalAgentOptions(cwd=str(REPO_ROOT)),
    ) as agent:
        run = agent.send(prompt)
        return run.text()


def run_all(manifest_path: Path, out_dir: Path) -> None:
    manifest = load_json(manifest_path)
    out_dir.mkdir(parents=True, exist_ok=True)

    for task_ref in manifest["tasks"]:
        task_path = (manifest_path.parent / task_ref).resolve()
        report = run_task(task_path)
        task = load_json(task_path)
        report_path = out_dir / f"{task['id']}.md"
        report_path.write_text(report, encoding="utf-8")
        print(f"wrote={report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Run AMP orchestration tasks through Cursor Composer 2.5.")
    sub = parser.add_subparsers(dest="command", required=True)

    task_parser = sub.add_parser("task", help="Run one task JSON.")
    task_parser.add_argument("task_json", type=Path)

    all_parser = sub.add_parser("run-all", help="Run all tasks in a manifest JSON.")
    all_parser.add_argument("manifest_json", type=Path)
    all_parser.add_argument("--out", type=Path, default=Path("reports"))

    args = parser.parse_args()

    if args.command == "task":
        print(run_task(args.task_json.resolve()))
    elif args.command == "run-all":
        run_all(args.manifest_json.resolve(), args.out.resolve())


if __name__ == "__main__":
    main()

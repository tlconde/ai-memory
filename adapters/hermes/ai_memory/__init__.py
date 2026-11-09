"""ai-memory provider for Hermes: logs each turn through `mem log` and injects `mem index`.

Selected with `memory.provider: ai_memory` (see ../README.md). A memory failure must never
disturb the agent, so every call into `mem` is bounded by a timeout and errors only reach the
Hermes log.
"""

from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

try:
    from agent.memory_provider import MemoryProvider
except ImportError:  # Imported outside Hermes, e.g. by a test without the Hermes checkout.
    MemoryProvider = object  # type: ignore[assignment,misc]

logger = logging.getLogger(__name__)

# The store truncates to BUDGETS.maxEventChars as well; cutting here keeps huge tool output off the pipe.
MAX_TEXT = 8000
MEM_TIMEOUT_S = 2.0


def _text(content: Any) -> str:
    """Message content is a string or a list of typed parts; keep the text parts."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(p.get("text", "")) for p in content if isinstance(p, dict) and p.get("type") == "text")
    return "" if content is None else json.dumps(content, default=str)


def _safe(session: str) -> str:
    """A filename-safe session id, as `mem log` requires: [A-Za-z0-9._-], alphanumeric first, max 128."""
    return re.sub(r"^[^A-Za-z0-9]+", "", re.sub(r"[^A-Za-z0-9._-]", "_", session or ""))[:128] or "unknown"


def _refs(arguments: str) -> List[str]:
    try:
        args = json.loads(arguments)
    except (TypeError, ValueError):
        return []
    path = args.get("path") or args.get("file_path") if isinstance(args, dict) else None
    return [path] if isinstance(path, str) else []


class AiMemoryProvider(MemoryProvider):
    name = "ai_memory"

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._session = ""
        self._cursor: Dict[str, int] = {}  # session -> number of messages already logged
        self._enabled = True

    # -- calling mem ---------------------------------------------------------

    def _mem(self, args: List[str], stdin: str = "") -> Optional[str]:
        try:
            r = subprocess.run(
                [os.environ.get("MEM_BIN") or "mem", *args], input=stdin, capture_output=True, text=True,
                timeout=MEM_TIMEOUT_S, cwd=os.environ.get("TERMINAL_CWD") or None,
            )
        except (OSError, subprocess.SubprocessError, ValueError) as e:
            logger.warning("ai-memory: mem %s failed: %s", args[0], e)
            return None
        if r.returncode != 0:
            logger.warning("ai-memory: mem %s failed: %s", args[0], r.stderr.strip() or f"exit {r.returncode}")
            return None
        return r.stdout

    def _log(self, session: str, events: List[Dict[str, Any]]) -> None:
        if not (self._enabled and events):
            return
        base = {
            "ts": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "session": _safe(session),
            "host": "hermes",
        }
        lines = [json.dumps({**base, **e, "text": e["text"][:MAX_TEXT]}, ensure_ascii=False) for e in events]
        self._mem(["log"], "\n".join(lines) + "\n")

    @staticmethod
    def _events(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for m in messages:
            role, text = m.get("role"), _text(m.get("content"))
            if role == "user" and text.strip():
                out.append({"kind": "user", "text": text})
            elif role == "assistant":
                if text.strip():
                    out.append({"kind": "assistant", "text": text})
                for call in m.get("tool_calls") or []:
                    fn = call.get("function") or {}
                    args = fn.get("arguments") if isinstance(fn.get("arguments"), str) else json.dumps(fn.get("arguments"))
                    refs = _refs(args)
                    out.append({"kind": "tool_call", "tool": str(fn.get("name", "")), "text": args, **({"refs": refs} if refs else {})})
            elif role == "tool":
                out.append({"kind": "tool_result", "tool": str(m.get("name") or m.get("tool_name") or ""), "text": text})
        return out

    @staticmethod
    def _turn_start(messages: List[Dict[str, Any]], user_content: str) -> int:
        """Where the current turn begins, for a session this process has not logged yet.

        Hermes hands over the whole history, including turns loaded from its database after a
        restart or /resume. Those were logged when they happened, so only the current turn is new.
        """
        users = [i for i, m in enumerate(messages) if m.get("role") == "user"]
        same = [i for i in users if _text(messages[i].get("content")).strip() == user_content.strip()]
        return (same or users or [0])[-1]

    # -- MemoryProvider ------------------------------------------------------

    def is_available(self) -> bool:
        return True

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return []  # search and note come from the ai-memory MCP server

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        # Hermes asks providers to skip writes for cron, flush and subagent contexts.
        self._enabled = kwargs.get("agent_context", "primary") == "primary"
        self._session = session_id
        self._log(session_id, [{"kind": "session_start", "text": str(kwargs.get("platform", ""))}])

    def system_prompt_block(self) -> str:
        return (self._mem(["index"]) or "").strip()

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "",
                  messages: Optional[List[Dict[str, Any]]] = None) -> None:
        session = session_id or self._session
        with self._lock:
            if messages is None:
                self._log(session, [{"kind": "user", "text": user_content}, {"kind": "assistant", "text": assistant_content}])
                return
            start = self._cursor.get(session)
            if start is None or start > len(messages):
                start = self._turn_start(messages, user_content)
            self._cursor[session] = len(messages)
            self._log(session, self._events(messages[start:]))

    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False,
                          rewound: bool = False, **kwargs: Any) -> None:
        with self._lock:
            if rewound:  # same id, truncated transcript: re-find the turn start on the next sync
                self._cursor.pop(new_session_id, None)
            if new_session_id != self._session:
                self._session = new_session_id
                reason = "reset" if reset else f"continues {parent_session_id}" if parent_session_id else "switch"
                self._log(new_session_id, [{"kind": "session_start", "text": reason}])

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        with self._lock:
            start = self._cursor.get(self._session)
            # Log what the last sync missed, such as an interrupted final turn, then close the session.
            tail = self._events(messages[start:]) if start is not None and messages else []
            self._cursor.pop(self._session, None)
            self._log(self._session, [*tail, {"kind": "session_end", "text": ""}])


def register(ctx: Any) -> None:
    ctx.register_memory_provider(AiMemoryProvider())

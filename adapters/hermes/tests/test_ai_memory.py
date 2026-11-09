"""Tests for the Hermes ai_memory provider, against Hermes' real MemoryProvider and loader when present.

Hermes is read-only here: its checkout is only put on sys.path, bytecode writing is off, and the
loader test runs against a temporary HERMES_HOME holding a copy of the plugin.
"""

import atexit
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
# Before any Hermes import, so nothing it loads can resolve the live ~/.hermes.
os.environ["HERMES_HOME"] = tempfile.mkdtemp(prefix="hermes-home-")
atexit.register(shutil.rmtree, os.environ["HERMES_HOME"], ignore_errors=True)
HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent / "ai_memory"
HERMES = Path(os.environ.get("HERMES_AGENT_DIR", Path.home() / ".hermes" / "hermes-agent"))
if (HERMES / "agent" / "memory_provider.py").is_file():
    sys.path.insert(0, str(HERMES))
try:
    from agent.memory_provider import MemoryProvider as HermesBase
except ImportError:
    HermesBase = None
sys.path.insert(0, str(PLUGIN.parent))
import ai_memory  # noqa: E402

# OpenAI-style messages as Hermes builds them (agent/chat_completion_helpers.py, agent/tool_dispatch_helpers.py).
TURN1 = [
    {"role": "system", "content": "You are Hermes."},
    {"role": "user", "content": "What is in notes.txt?"},
    {"role": "assistant", "content": "", "tool_calls": [
        {"id": "call_1", "type": "function", "function": {"name": "read_file", "arguments": '{"path": "/work/notes.txt"}'}}]},
    {"role": "tool", "name": "read_file", "tool_name": "read_file", "content": "alpha beta", "tool_call_id": "call_1"},
    {"role": "assistant", "content": [{"type": "text", "text": "It says alpha beta."}]},
]
TURN2 = TURN1 + [
    {"role": "user", "content": "Thanks, list the folder."},
    {"role": "assistant", "content": "Listing.", "tool_calls": [
        {"id": "call_2", "type": "function", "function": {"name": "terminal", "arguments": '{"command": "ls"}'}}]},
    {"role": "tool", "name": "terminal", "tool_name": "terminal", "content": "notes.txt", "tool_call_id": "call_2"},
    {"role": "assistant", "content": "One file: notes.txt."},
]
TURN1_EVENTS = [
    {"kind": "user", "text": "What is in notes.txt?"},
    {"kind": "tool_call", "tool": "read_file", "text": '{"path": "/work/notes.txt"}', "refs": ["/work/notes.txt"]},
    {"kind": "tool_result", "tool": "read_file", "text": "alpha beta"},
    {"kind": "assistant", "text": "It says alpha beta."},
]
TURN2_EVENTS = [
    {"kind": "user", "text": "Thanks, list the folder."},
    {"kind": "assistant", "text": "Listing."},
    {"kind": "tool_call", "tool": "terminal", "text": '{"command": "ls"}'},
    {"kind": "tool_result", "tool": "terminal", "text": "notes.txt"},
    {"kind": "assistant", "text": "One file: notes.txt."},
]


class FakeMem(unittest.TestCase):
    """Points MEM_BIN at fake_mem.py and reads back what it was sent."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="mem-hermes-"))
        self.out = self.tmp / "calls.jsonl"
        self.env = {k: os.environ.get(k) for k in ("MEM_BIN", "FAKE_MEM_OUT", "FAKE_MEM_INDEX", "FAKE_MEM_FAIL", "FAKE_MEM_HANG", "TERMINAL_CWD")}
        os.environ.update(MEM_BIN=str(HERE / "fake_mem.py"), FAKE_MEM_OUT=str(self.out), TERMINAL_CWD=str(self.tmp))
        for k in ("FAKE_MEM_INDEX", "FAKE_MEM_FAIL", "FAKE_MEM_HANG"):
            os.environ.pop(k, None)

    def tearDown(self):
        for k, v in self.env.items():
            os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
        shutil.rmtree(self.tmp, ignore_errors=True)

    def calls(self):
        return [json.loads(l) for l in self.out.read_text().splitlines()] if self.out.exists() else []

    def logged(self):
        events = [json.loads(l) for c in self.calls() if c["args"] == ["log"] for l in c["stdin"].splitlines()]
        for e in events:
            self.assertRegex(e.pop("ts"), r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")
            self.assertEqual(e.pop("host"), "hermes")
        return events

    def kinds(self, session):
        return [{k: v for k, v in e.items() if k != "session"} for e in self.logged() if e["session"] == session]


class ProviderTest(FakeMem):
    def provider(self, session="s1", **kwargs):
        p = ai_memory.AiMemoryProvider()
        p.initialize(session, platform="cli", **kwargs)
        return p

    @unittest.skipIf(HermesBase is None, f"Hermes checkout not found at {HERMES}")
    def test_subclasses_the_real_hermes_base_class(self):
        p = ai_memory.AiMemoryProvider()
        self.assertIsInstance(p, HermesBase)
        self.assertEqual((p.name, p.is_available(), p.get_tool_schemas()), ("ai_memory", True, []))

    def test_system_prompt_block_is_mem_index(self):
        os.environ["FAKE_MEM_INDEX"] = "# Index\n- fact\n"
        p = self.provider()
        self.assertEqual(p.system_prompt_block(), "# Index\n- fact")
        self.assertEqual(self.calls()[-1]["args"], ["index"])
        self.assertEqual(self.calls()[-1]["cwd"], os.path.realpath(self.tmp))

    def test_initialize_logs_session_start_and_skips_non_primary_contexts(self):
        self.provider("s1")
        self.provider("cron1", agent_context="cron").sync_turn("hi", "hello", session_id="cron1", messages=TURN1)
        self.assertEqual(self.kinds("s1"), [{"kind": "session_start", "text": "cli"}])
        self.assertEqual(self.kinds("cron1"), [])

    def test_sync_turn_logs_each_message_once(self):
        p = self.provider()
        p.sync_turn("What is in notes.txt?", "It says alpha beta.", session_id="s1", messages=TURN1)
        p.sync_turn("Thanks, list the folder.", "One file: notes.txt.", session_id="s1", messages=TURN2)
        self.assertEqual(self.kinds("s1"), [{"kind": "session_start", "text": "cli"}, *TURN1_EVENTS, *TURN2_EVENTS])

    def test_history_loaded_from_hermes_db_is_not_relogged(self):
        p = ai_memory.AiMemoryProvider()  # a restarted gateway: no session_start, cursor unknown
        p.sync_turn("Thanks, list the folder.", "One file: notes.txt.", session_id="s1", messages=TURN2)
        self.assertEqual(self.kinds("s1"), TURN2_EVENTS)

    def test_sync_without_messages_logs_user_and_assistant(self):
        ai_memory.AiMemoryProvider().sync_turn("q", "a", session_id="s1")
        self.assertEqual(self.kinds("s1"), [{"kind": "user", "text": "q"}, {"kind": "assistant", "text": "a"}])

    def test_session_switch_end_and_rewind(self):
        p = self.provider("s1")
        p.sync_turn("What is in notes.txt?", "x", session_id="s1", messages=TURN1)
        p.on_session_end(TURN2)  # the second turn never synced, e.g. it was interrupted
        p.on_session_switch("s2", parent_session_id="s1", reset=True)
        p.sync_turn("What is in notes.txt?", "x", session_id="s2", messages=TURN1)
        p.on_session_switch("s2", rewound=True)  # /undo: same id, shorter transcript
        p.sync_turn("Thanks, list the folder.", "x", session_id="s2", messages=TURN2)
        self.assertEqual(self.kinds("s1"), [{"kind": "session_start", "text": "cli"}, *TURN1_EVENTS, *TURN2_EVENTS, {"kind": "session_end", "text": ""}])
        self.assertEqual(self.kinds("s2"), [{"kind": "session_start", "text": "reset"}, *TURN1_EVENTS, *TURN2_EVENTS])

    def test_session_id_is_filename_safe_and_text_is_truncated(self):
        ai_memory.AiMemoryProvider().sync_turn("q", "x" * 50_000, session_id="../a b/c")
        events = self.logged()
        self.assertEqual({e["session"] for e in events}, {"a_b_c"})
        self.assertEqual(len(events[1]["text"]), 8000)

    def test_mem_failures_never_raise(self):
        os.environ["FAKE_MEM_FAIL"] = "1"
        p = self.provider()
        self.assertEqual(p.system_prompt_block(), "")
        os.environ["MEM_BIN"] = str(self.tmp / "missing")
        p.sync_turn("q", "a", session_id="s1", messages=TURN1)
        p.on_session_end(TURN1)

    def test_a_hung_mem_is_cut_off(self):
        os.environ["FAKE_MEM_HANG"] = "1"
        old, ai_memory.MEM_TIMEOUT_S = ai_memory.MEM_TIMEOUT_S, 0.5
        try:
            self.assertEqual(self.provider().system_prompt_block(), "")
        finally:
            ai_memory.MEM_TIMEOUT_S = old


def hermes_loader():
    try:
        import plugins.memory as loader  # needs Hermes' dependencies (PyYAML and others)
        from agent.memory_manager import MemoryManager
        import toolsets  # noqa: F401  MemoryManager.add_provider imports it
        return loader, MemoryManager
    except Exception:  # noqa: BLE001  any import failure means this interpreter cannot host Hermes
        return None


@unittest.skipIf(hermes_loader() is None, "Hermes' plugin loader is not importable with this interpreter")
class RealLoaderTest(FakeMem):
    """Loads the plugin the way Hermes does, from $HERMES_HOME/plugins/ai_memory, and drives MemoryManager."""

    def test_hermes_loads_and_drives_the_provider(self):
        loader, MemoryManager = hermes_loader()
        home = self.tmp / "hermes-home"
        shutil.copytree(PLUGIN, home / "plugins" / "ai_memory")
        old_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = str(home)
        os.environ["FAKE_MEM_INDEX"] = "# Index"
        try:
            self.assertIn(("ai_memory", home / "plugins" / "ai_memory"), loader._iter_provider_dirs())
            provider = loader.load_memory_provider("ai_memory")
            self.assertEqual(type(provider).__name__, "AiMemoryProvider")
            mm = MemoryManager()
            mm.add_provider(provider)
            mm.initialize_all(session_id="s1", platform="cli", agent_context="primary")
            self.assertEqual(mm.build_system_prompt(), "# Index")
            mm.sync_all("What is in notes.txt?", "It says alpha beta.", session_id="s1", messages=TURN1)
            mm.commit_session_boundary_async(TURN1, new_session_id="s2", parent_session_id="s1")
            self.assertTrue(mm.flush_pending(timeout=10))
            mm.shutdown_all()
        finally:
            os.environ.pop("HERMES_HOME") if old_home is None else os.environ.__setitem__("HERMES_HOME", old_home)
        self.assertEqual(self.kinds("s1"), [{"kind": "session_start", "text": "cli"}, *TURN1_EVENTS, {"kind": "session_end", "text": ""}])
        self.assertEqual(self.kinds("s2"), [{"kind": "session_start", "text": "reset"}])


if __name__ == "__main__":
    unittest.main()

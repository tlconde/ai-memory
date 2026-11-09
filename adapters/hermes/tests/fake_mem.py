#!/usr/bin/env python3
"""Stands in for the real `mem` CLI: records each call as one JSON line in $FAKE_MEM_OUT."""
import json
import os
import sys
import time

stdin = sys.stdin.read()
with open(os.environ["FAKE_MEM_OUT"], "a", encoding="utf-8") as f:
    f.write(json.dumps({"args": sys.argv[1:], "cwd": os.getcwd(), "stdin": stdin}) + "\n")
if os.environ.get("FAKE_MEM_FAIL"):
    sys.exit(1)
if os.environ.get("FAKE_MEM_HANG"):
    time.sleep(10)
if sys.argv[1:2] == ["index"]:
    sys.stdout.write(os.environ.get("FAKE_MEM_INDEX", ""))

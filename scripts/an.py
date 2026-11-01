#!/usr/bin/env python3
"""Library import tool (entry alias). Superseded by an2.py — this just runs it."""

from pathlib import Path
import runpy
import sys

runpy.run_path(str(Path(__file__).with_name("an2.py")), run_name="__main__")
sys.exit(0)

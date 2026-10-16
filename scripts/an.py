#!/usr/bin/env python3
"""Library import tool (entry alias). See import-element-library-asset.py."""

from pathlib import Path
import runpy
import sys

runpy.run_path(str(Path(__file__).with_name("import-element-library-asset.py")), run_name="__main__")
sys.exit(0)

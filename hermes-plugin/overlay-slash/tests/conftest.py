"""Load the plugin directory as the ``overlay_slash`` package."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _load() -> None:
    if "overlay_slash" in sys.modules and "overlay_slash.commands" in sys.modules:
        return
    spec = importlib.util.spec_from_file_location(
        "overlay_slash",
        ROOT / "__init__.py",
        submodule_search_locations=[str(ROOT)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("could not load overlay_slash")
    module = importlib.util.module_from_spec(spec)
    sys.modules["overlay_slash"] = module
    spec.loader.exec_module(module)


_load()

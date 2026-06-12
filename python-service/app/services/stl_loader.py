# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""
Download and validate finished STL solids for the manufacturing pipeline.
"""

from __future__ import annotations

import os
import tempfile

import httpx
import trimesh

from app.services.geometry_utils import ensure_watertight


def download_stl_to_temp(url_or_path: str) -> str:
    """Download http(s) STL URL to a temp file or return the path if already local."""
    if url_or_path.startswith(("http://", "https://")):
        with tempfile.NamedTemporaryFile(suffix=".stl", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            with httpx.stream("GET", url_or_path, follow_redirects=True, timeout=120) as resp:
                resp.raise_for_status()
                with open(tmp_path, "wb") as f:
                    for chunk in resp.iter_bytes():
                        f.write(chunk)
            return tmp_path
        except Exception:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
            raise
    if not os.path.exists(url_or_path):
        raise FileNotFoundError(f"STL path does not exist: {url_or_path}")
    return url_or_path


def load_watertight_stl(path: str) -> trimesh.Trimesh:
    """Load an STL and enforce watertightness (repair then fail loudly)."""
    loaded = trimesh.load(path, force="mesh")
    if isinstance(loaded, trimesh.Scene):
        meshes = [g for g in loaded.geometry.values() if isinstance(g, trimesh.Trimesh)]
        if not meshes:
            raise ValueError("STL scene contains no mesh geometry")
        solid = trimesh.util.concatenate(meshes) if len(meshes) > 1 else meshes[0]
    elif isinstance(loaded, trimesh.Trimesh):
        solid = loaded
    else:
        raise ValueError(f"Unsupported STL content type: {type(loaded)}")

    return ensure_watertight(solid, label="manufacturing_stl")

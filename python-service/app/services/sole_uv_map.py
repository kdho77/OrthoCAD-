# Part of the Chili3d Project, under the AGPL-3.0 License.
# See LICENSE file in the project root for full license information.

"""Sole-UV ↔ footprint mm ↔ belt slice coordinates for hybrid manufacturing."""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class SoleUvFrame:
    """Footprint box in mm before belt transform (heel→toe = +X, lateral/medial = Y)."""

    min_x_mm: float
    min_y_mm: float
    length_mm: float
    width_mm: float

    @classmethod
    def from_mesh_bounds(cls, bounds: np.ndarray) -> SoleUvFrame:
        min_x, min_y = float(bounds[0][0]), float(bounds[0][1])
        max_x, max_y = float(bounds[1][0]), float(bounds[1][1])
        length = max(max_x - min_x, 1e-6)
        width = max(max_y - min_y, 1e-6)
        return cls(min_x_mm=min_x, min_y_mm=min_y, length_mm=length, width_mm=width)

    def foot_xy_to_uv(self, x_mm: float, y_mm: float) -> tuple[float, float]:
        u = (x_mm - self.min_x_mm) / self.length_mm
        center_y = self.min_y_mm + self.width_mm * 0.5
        v = (y_mm - center_y) / (self.width_mm * 0.5)
        return u, v

    def uv_to_foot_xy(self, u: float, v: float) -> tuple[float, float]:
        x = self.min_x_mm + u * self.length_mm
        center_y = self.min_y_mm + self.width_mm * 0.5
        y = center_y + v * (self.width_mm * 0.5)
        return x, y


def belt_slice_xy_to_foot_xy(
    x_belt: float,
    y_belt: float,
    z_belt: float,
    belt_angle_deg: float,
) -> tuple[float, float, float]:
    """Inverse of vertex beltTransform for a point on a slice plane at belt Z."""
    t = math.radians(belt_angle_deg)
    sin_t = math.sin(t)
    tan_t = math.tan(t)
    z_foot = z_belt * sin_t
    x_foot = x_belt
    y_foot = y_belt + z_foot / tan_t if abs(tan_t) > 1e-9 else y_belt
    return x_foot, y_foot, z_foot


def belt_slice_xy_to_sole_uv(
    x_belt: float,
    y_belt: float,
    z_belt: float,
    belt_angle_deg: float,
    frame: SoleUvFrame,
) -> tuple[float, float]:
    xf, yf, _ = belt_slice_xy_to_foot_xy(x_belt, y_belt, z_belt, belt_angle_deg)
    return frame.foot_xy_to_uv(xf, yf)


def foot_xy_to_belt_slice_xy(
    x_foot: float,
    y_foot: float,
    z_foot: float,
    belt_angle_deg: float,
) -> tuple[float, float, float]:
    t = math.radians(belt_angle_deg)
    sin_t = math.sin(t)
    tan_t = math.tan(t)
    x_b = x_foot
    z_b = z_foot / sin_t if abs(sin_t) > 1e-9 else z_foot
    y_b = y_foot - z_foot / tan_t if abs(tan_t) > 1e-9 else y_foot
    return x_b, y_b, z_b

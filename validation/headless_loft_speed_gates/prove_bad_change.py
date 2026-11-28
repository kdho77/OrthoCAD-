#!/usr/bin/env python3
"""Bad-change proof for the frozen gates.

Exits 0 when a one-byte STL edit is rejected and a missing loft_s/slice_s log is rejected.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from checks import log_gate, sha256_bytes, speed_case, stl_identity

HERE = Path(__file__).resolve().parent


def stl_with_one_triangle() -> bytes:
    # 80-byte header, uint32 triangle count, one 50-byte triangle.
    header = b"GATE" + b"\x00" * 76
    count = struct.pack("<I", 1)
    triangle = bytes([index % 251 for index in range(50)])
    return header + count + triangle


def flip_one_byte(data: bytes, index: int) -> bytes:
    mutated = bytearray(data)
    mutated[index] ^= 0x01
    return bytes(mutated)


def main() -> int:
    original = stl_with_one_triangle()
    one_byte = flip_one_byte(original, 90)
    same_length = flip_one_byte(original, 100)
    results = []

    identical = stl_identity(original, original)
    results.append({"name": "identical_stl_passes", "pass": identical["pass"] is True, "detail": identical})

    one = stl_identity(one_byte, original)
    results.append(
        {
            "name": "one_byte_stl_rejected",
            "pass": one["pass"] is False and one["candidate_sha256"] != one["baseline_sha256"],
            "detail": one,
        }
    )

    loosened = stl_identity(same_length, original)
    length_only_would_pass = len(same_length) == len(original)
    count_only_would_pass = same_length[80:84] == original[80:84]
    results.append(
        {
            "name": "same_length_and_triangle_count_still_rejected",
            "pass": loosened["pass"] is False and length_only_would_pass and count_only_would_pass,
            "detail": {
                "identity": loosened,
                "length_only_would_pass": length_only_would_pass,
                "triangle_count_header_matches": count_only_would_pass,
            },
        }
    )

    valid_line = (
        '{"msg":"cad-operator-timing","productionId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",'
        '"side":"left","loft_s":0.031,"slice_s":0.030}\n'
    )
    valid = log_gate(valid_line, "left")
    results.append({"name": "valid_timing_log_passes", "pass": valid["pass"] is True, "detail": valid})

    missing = log_gate("production finished without timing fields\n", "left")
    results.append({"name": "missing_loft_s_slice_s_rejected", "pass": missing["pass"] is False, "detail": missing})

    loft_only = log_gate('{"side":"left","loft_s":0.031}\n', "left")
    results.append({"name": "slice_s_missing_rejected", "pass": loft_only["pass"] is False, "detail": loft_only})

    strings = log_gate('{"side":"left","loft_s":"0.031","slice_s":"0.030"}\n', "left")
    results.append({"name": "non_numeric_timings_rejected", "pass": strings["pass"] is False, "detail": strings})

    zeros = log_gate('{"side":"left","loft_s":0,"slice_s":0}\n', "left")
    results.append({"name": "zero_timings_rejected", "pass": zeros["pass"] is False, "detail": zeros})

    equal = speed_case(10.0, 10.0)
    results.append({"name": "equal_loft_time_is_not_a_speedup", "pass": equal["pass"] is False, "detail": equal})

    slower = speed_case(11.0, 10.0)
    results.append({"name": "slower_loft_rejected", "pass": slower["pass"] is False, "detail": slower})

    slight = speed_case(9.5, 10.0)
    results.append(
        {"name": "under_10_percent_speedup_rejected", "pass": slight["pass"] is False, "detail": slight}
    )

    enough = speed_case(8.9, 10.0)
    results.append({"name": "ten_percent_speedup_passes", "pass": enough["pass"] is True, "detail": enough})

    proof_ok = all(item["pass"] for item in results)
    out = {
        "proof": "bad_change",
        "pass": proof_ok,
        "original_sha256": sha256_bytes(original),
        "results": results,
    }
    dest = HERE / "proofs"
    dest.mkdir(exist_ok=True)
    (dest / "bad_change_proof.json").write_text(json.dumps(out, indent=2) + "\n")
    print(json.dumps({"proof": "bad_change", "pass": proof_ok}, indent=2))
    return 0 if proof_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())

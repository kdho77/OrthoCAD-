// Copyright (c) 2026 Vertex Orthopedic. All rights reserved.
// Runs the G-code measure, which the unit config excludes (no slicer in shards).

import { defineConfig } from "@rstest/core";
import base from "../../rstest.config";

const inherited = base as { exclude?: string[] };

export default defineConfig({
    ...base,
    exclude: (inherited.exclude ?? []).filter((pattern) => !pattern.includes("optional")),
});

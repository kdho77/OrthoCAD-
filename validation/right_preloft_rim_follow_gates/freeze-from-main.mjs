// One-shot capture of the main excerpts these gates lock.
// Refuses to overwrite once frozen/FROZEN exists.
// Do not edit after the gates pull request is opened.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
    ASSERT_CALL,
    baseSha,
    extractFunction,
    FROZEN_DIR,
    RATIO_LINE,
    RIM_FOLLOW_CALL,
    repoFile,
    STATION_GATES,
    sha256File,
    surfacePaths,
} from "./lib.mjs";

const marker = resolve(FROZEN_DIR, "FROZEN");
if (existsSync(marker)) {
    console.error(`FAIL freeze: ${marker} already exists. Gates are frozen.`);
    process.exit(1);
}

const station = readFileSync(repoFile(STATION_GATES), "utf8");
if (!station.split("\n").includes(RATIO_LINE)) {
    console.error(`FAIL freeze: main is missing ${RATIO_LINE}`);
    process.exit(1);
}
const body = extractFunction(station, "assertPreLoftStations");
writeFileSync(resolve(FROZEN_DIR, "assert-preloft-stations.txt"), `${body}\n`);

const lines = [];
for (const rel of surfacePaths()) {
    lines.push(`${sha256File(repoFile(rel))}  ${rel}`);
}
writeFileSync(resolve(FROZEN_DIR, "surface-files.sha256"), `${lines.join("\n")}\n`);
writeFileSync(
    marker,
    `base ${baseSha()}\nrim-follow call locked\nassert call locked\nratio ${RATIO_LINE}\nassert call ${ASSERT_CALL}\nrim call ${RIM_FOLLOW_CALL}\n`,
);
console.log(
    `PASS freeze: captured assertPreLoftStations and ${lines.length} surface hashes from ${baseSha()}`,
);

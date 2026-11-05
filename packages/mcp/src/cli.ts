#!/usr/bin/env node

import { runOrthocadMcpStdio } from "./server.js";

runOrthocadMcpStdio().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});

#!/usr/bin/env node
// Runs after `next build` when packing: records the build's native-module links so
// `kizuki` can recreate them after npm install (npm never ships node_modules folders).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordLinks } from "../bin/cli.mjs";

const links = recordLinks(join(dirname(fileURLToPath(import.meta.url)), ".."));
console.log(`recorded ${links.length} native module links: ${links.map((l) => l.package).join(", ")}`);

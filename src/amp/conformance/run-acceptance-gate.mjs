#!/usr/bin/env node
/**
 * AMP v1 acceptance gate CLI entry.
 *
 * Usage: npm run amp:acceptance
 */

import { mainAcceptanceGate } from "./acceptance-gate.ts";

const exitCode = await mainAcceptanceGate(process.argv.slice(2));
process.exit(exitCode);

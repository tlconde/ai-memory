#!/usr/bin/env node
import { AMP_CLI_INVOCATION_DIRECT, AMP_CLI_INVOCATION_ENV } from "./invocation-mode.js";

process.env[AMP_CLI_INVOCATION_ENV] = AMP_CLI_INVOCATION_DIRECT;
await import("./index.js");

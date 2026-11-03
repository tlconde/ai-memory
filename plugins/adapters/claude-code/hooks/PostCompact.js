#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const aiDir = process.env.AI_DIR || path.join(process.cwd(), ".ai");
if (!fs.existsSync(aiDir)) process.exit(0);

const tempDir = path.join(aiDir, "temp");
fs.mkdirSync(tempDir, { recursive: true });

const reminder = [
  "# Post-Compact Reminder",
  "",
  "Read .ai/temp/pre-compact-dump.json if it exists.",
  "Restore the user's latest intent before continuing.",
  "Reconcile meaningful learnings into .ai/memory and concise verified repo navigation drift into .ai/context.",
  "If .ai/temp/import/latest-request.md exists, process it before adding new durable memory.",
  "",
  "Created: " + new Date().toISOString(),
  "",
].join("\n");

fs.writeFileSync(path.join(tempDir, "post-compact-reminder.md"), reminder);

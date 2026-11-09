---
id: "01M6ZW0680C5HDXA2AWDJC5HEP"
about: "invoicer formatCents"
evidence: ["s2-invoicer:4-10"]
verified: true
seen: 1
checked: "2026-11-09"
origin: "session"
---
formatCents in src/money.js must zero-pad the cents with String(rest).padStart(2, "0"); the raw remainder turned 1205 into $12.5 and failed test.js.

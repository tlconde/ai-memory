# Memory index

Project codename: heron-4419.

- invoicer: `formatCents` (src/money.js) zero-pads cents. Verified.
- confsvc: `npm start` needs `config.json`; copy `config.example.json`. Hypothesis: loadConfig could fall back to the example.
- fetcher: see wiki/fetcher.md (retry limit `MAX_RETRIES` = 5).

Search the log with `mem search <words>` before re-reading files.

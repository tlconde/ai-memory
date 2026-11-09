# fetcher

- The retry limit is `MAX_RETRIES` in `lib/retry.js`; it is 5 since session s4-fetcher (was 3). [s4-fetcher:9-10]
- `withRetry` loops up to `MAX_RETRIES` attempts and rethrows the last error; it does not wait between attempts. [s4-fetcher:8]
- `backoffDelay(attempt)` is exponential: `BASE_DELAY_MS * 2 ** attempt`, so 200, 400, 800 ms. [s4-fetcher:8]
- `retry.test.js` simulates an upstream that fails four times, so the test needs at least five attempts. [s4-fetcher:11]

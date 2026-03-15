import { createStore } from "@tobilu/qmd";
import { join } from "path";

const dbPath = join(process.env.USERPROFILE, ".cache", "qmd", "index.sqlite");
const store = await createStore({ dbPath });
const status = await store.getStatus();
console.log("Status:", JSON.stringify(status, null, 2));
const hits = await store.searchVector("PostgreSQL connection pooling", { limit: 5 });
console.log("Hits count:", hits.length);
console.log("Hits:", JSON.stringify(hits, null, 2));
await store.close();

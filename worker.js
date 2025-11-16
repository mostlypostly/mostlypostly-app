// worker.js — MostlyPostly Scheduler Worker
import "./db.js";               // ensure DB & schema are loaded
import "./src/core/initSchemaHealth.js"; // optional: if you want schema checks here too
import "./src/scheduler.js";    // will start scheduler ONLY when APP_ROLE=worker

console.log("🚀 MostlyPostly Scheduler Worker started");

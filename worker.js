import { startScheduler } from "./src/scheduler.js";

if (process.env.APP_ROLE !== "worker") {
    console.log("❌ worker.js launched without APP_ROLE=worker");
    process.exit(1);
}

console.log("WORKER MODE: Scheduler active");
startScheduler();

import { enqueuePost, startScheduler } from "../src/scheduler.js";

enqueuePost({
  salon_id: "rejuve",
  stylist: "Troy",
  type: "portfolio",
  platform: "instagram_feed",
  payload: { caption: "Test — Scheduler check ✂️ #MostlyPostly" }
});

startScheduler();

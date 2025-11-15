// src/utils/logHelper.js — v1.1 tenant-aware logger
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Create a simple structured logger that writes both to console and to a file.
 * Automatically includes timestamp, event id, and salon_id.
 *
 * @param {string} name - the name of the log (e.g. "moderation", "scheduler")
 * @returns {Function} log(event: string, data?: object)
 */
export function createLogger(name = "app") {
  const LOG_DIR = path.join(process.cwd(), "data", "logs");
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

  const file = path.join(LOG_DIR, `${name}.log`);

  /**
   * Writes a structured log entry.
   * Example:
   *   log("post_published", { salon_id: "rejuvesalonspa", post_id: 42, platform: "instagram" });
   */
  return function log(event, data = {}) {
    try {
      const entry = {
        t: new Date().toISOString(),
        id: crypto.randomUUID(),
        event,
        salon_id: data.salon_id || "global",
        ...data,
      };

      // pretty console output
      const label = `[${name.toUpperCase()}]`;
      console.log(label, event, JSON.stringify(entry, null, 0));

      // append to file
      fs.appendFile(file, JSON.stringify(entry) + "\n", (err) => {
        if (err) console.error(`⚠️ Failed to write to ${name}.log:`, err.message);
      });
    } catch (err) {
      console.error(`⚠️ [${name}] log() failed:`, err);
    }
  };
}

/**
 * Simple helper for one-off event logs without instantiating multiple loggers.
 */
export const logHelper = {
  log: (name, event, data = {}) => {
    const log = createLogger(name);
    log(event, data);
  },
};

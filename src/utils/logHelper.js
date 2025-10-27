// src/utils/logHelper.js
import fs from "fs";
import path from "path";
import crypto from "crypto";

const LOGS_DIR = path.join(process.cwd(), "logs");
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

export function createLogger(context = "app") {
  const file = path.join(LOGS_DIR, `${context}.log`);
  return function log(event, data = {}) {
    const entry = {
      t: new Date().toISOString(),
      id: crypto.randomUUID(),
      event,
      ...data,
    };
    console.log(JSON.stringify(entry));
    fs.appendFile(file, JSON.stringify(entry) + "\n", () => {});
  };
}

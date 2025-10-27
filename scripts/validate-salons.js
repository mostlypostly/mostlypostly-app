// scripts/validate-salons.js
import fs from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";   // ⬅️ use the 2020 draft build
import addFormats from "ajv-formats";

const schemaPath = path.resolve("schema/salon.v0.5.4.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const salonsDir = path.resolve("salons");
if (!fs.existsSync(salonsDir)) {
  console.log("(info) salons/ not found — skipping schema validation.");
  process.exit(0);
}

let failed = 0;
for (const file of fs.readdirSync(salonsDir)) {
  if (!file.endsWith(".json")) continue;
  const full = path.join(salonsDir, file);
  try {
    const data = JSON.parse(fs.readFileSync(full, "utf-8"));
    const ok = validate(data);
    if (!ok) {
      failed++;
      console.error(`❌ ${file}\n`, validate.errors);
    } else {
      console.log(`✅ ${file}`);
    }
  } catch (e) {
    failed++;
    console.error(`❌ ${file}: ${e.message}`);
  }
}
process.exit(failed ? 1 : 0);

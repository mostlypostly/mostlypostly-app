// src/core/salonLookup.js — Updated for modular salon JSON
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import chokidar from "chokidar";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let cachedSalons = [];
let lastLoadedAt = null;
let reloadTimer = null;
let watcherStarted = false;

function resolveSalonsDir() {
  const candidates = [];
  if (process.env.SALONS_DIR) candidates.push(path.resolve(process.env.SALONS_DIR));
  candidates.push(path.resolve(process.cwd(), "salons"));
  candidates.push(path.resolve(__dirname, "../../salons"));
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  return path.resolve(process.cwd(), "salons");
}

async function loadOne(filePath) {
  if (filePath.endsWith(".json")) {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    data.__file = filePath;
    return data;
  } else {
    const mod = await import(pathToFileURL(filePath) + `?t=${Date.now()}`);
    const data = mod.default || mod;
    data.__file = filePath;
    return data;
  }
}

export async function loadSalons() {
  try {
    const dir = resolveSalonsDir();
    if (!fs.existsSync(dir)) {
      console.warn(`⚠️ Salon directory not found: ${dir}`);
      cachedSalons = [];
      lastLoadedAt = new Date();
      return cachedSalons;
    }

    const entries = fs.readdirSync(dir);
    const files = entries
      .filter((f) => f.endsWith(".json") || f.endsWith(".js"))
      .map((f) => path.join(dir, f));

    const salons = [];
    for (const filePath of files) {
      try {
        const data = await loadOne(filePath);
        if (data?.salon_info?.name || data?.salon_info?.salon_name) {
          salons.push(data);
        }
      } catch (e) {
        console.error(`⚠️ Failed to load ${filePath}: ${e.message}`);
      }
    }

    cachedSalons = salons;
    lastLoadedAt = new Date();

    console.log(`✅ Loaded ${cachedSalons.length} salon(s) from ${dir}`);
    cachedSalons.forEach((s) =>
      console.log(
        `   • ${s.salon_info?.name || s.salon_info?.salon_name} (require_manager_approval=${!!s.settings?.require_manager_approval})`
      )
    );
    return cachedSalons;
  } catch (err) {
    console.error("🚫 Failed to load salons:", err);
    cachedSalons = [];
    lastLoadedAt = new Date();
    return cachedSalons;
  }
}

export function startSalonWatcher() {
  if (watcherStarted) return;
  watcherStarted = true;

  const dir = resolveSalonsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  loadSalons();

  const pattern = path.join(dir, "**/*.{json,js}");
  const watcher = chokidar.watch(pattern, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 },
  });

  const scheduleReload = (reason, file) => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(async () => {
      console.log(`🔁 Reloading salons — ${reason}: ${path.relative(dir, file)}`);
      await loadSalons();
    }, 300);
  };

  watcher
    .on("add", (f) => scheduleReload("added", f))
    .on("change", (f) => scheduleReload("changed", f))
    .on("unlink", (f) => scheduleReload("removed", f));

  console.log(`👀 Watching ${pattern} for salon changes…`);
}

// --- 🔎 Stylist / Manager lookup (updated)
export function lookupStylist(identifier) {
  if (!cachedSalons.length) {
    console.warn("⚠️ Salon cache empty — call loadSalons() first.");
    return null;
  }
  const idStr = String(identifier).trim();

  for (const salon of cachedSalons) {
    const salonInfo = salon.salon_info || {};
    const stylists = salon.stylists || [];
    const managers = salon.managers || [];

    // --- Try stylist match
    const stylist = stylists.find((s) => {
      const chat = String(s.chat_id || "").trim();
      const phone = String(s.phone || "").trim();
      const id = String(s.id || "").trim();
      return chat === idStr || phone === idStr || id === idStr;
    });

    if (stylist) {
      return {
        ...stylist,
        stylist_name: stylist.name || stylist.stylist_name || "Unknown",
        salon_name: salonInfo.name || salonInfo.salon_name || "Unknown",
        city: salonInfo.city || "Unknown",
        salon_id: salon.salon_id || null,
        booking_url: salonInfo.booking_url || null,
        role: "stylist",
        salon_info: salonInfo,
      };
    }

    // --- Try manager match
    const manager = managers.find((m) => {
      const chat = String(m.chat_id || "").trim();
      const phone = String(m.phone || "").trim();
      const id = String(m.id || "").trim();
      return chat === idStr || phone === idStr || id === idStr;
    });

    if (manager) {
      return {
        ...manager,
        stylist_name: manager.name || manager.stylist_name || "Unknown",
        salon_name: salonInfo.name || salonInfo.salon_name || "Unknown",
        city: salonInfo.city || "Unknown",
        salon_id: salon.salon_id || null,
        booking_url: salonInfo.booking_url || null,
        role: "manager",
        salon_info: salonInfo,
      };
    }
  }

  return null;
}

export function lookupManager(identifier) {
  // Use the same cachedSalons array already managed by loadSalons()
  const salons = getAllSalons ? getAllSalons() : cachedSalons || [];
  if (!salons.length) {
    console.warn("⚠️ No salons loaded when calling lookupManager()");
    return null;
  }

  const idStr = String(identifier).trim();

  for (const salon of salons) {
    const managers = salon.managers || [];
    for (const manager of managers) {
      const chat = String(manager.chat_id || "").trim();
      const phone = String(manager.phone || "").trim();
      const id = String(manager.id || "").trim();
      if (chat === idStr || phone === idStr || id === idStr) {
        return {
          ...manager,
          salon_id: salon.salon_id || null,
          salon_info: salon.salon_info || {},
        };
      }
    }
  }

  return null;
}


export function getSalonByStylist(identifier) {
  if (!cachedSalons.length) return null;
  const idStr = String(identifier).trim();

  for (const salon of cachedSalons) {
    const stylists = salon.stylists || [];
    const managers = salon.managers || [];
    if (
      stylists.some(
        (s) =>
          String(s.chat_id).trim() === idStr ||
          String(s.phone).trim() === idStr ||
          s.id === idStr
      ) ||
      managers.some(
        (m) =>
          String(m.chat_id).trim() === idStr ||
          String(m.phone).trim() === idStr ||
          m.id === idStr
      )
    ) {
      return salon;
    }
  }
  return null;
}

export function getAllSalons() {
  return cachedSalons;
}

export function getSalonSnapshot() {
  return {
    lastLoadedAt,
    salons: cachedSalons.map((s) => ({
      salon_name: s.salon_info?.name || s.salon_info?.salon_name,
      require_manager_approval: !!s.settings?.require_manager_approval,
      file_hint: s.__file,
    })),
  };
}

export function getSalonSettingFor(identifier, key) {
  const salon = getSalonByStylist(identifier);
  if (!salon) return undefined;
  return key.split(".").reduce((acc, k) => (acc ? acc[k] : undefined), salon);
}

export function reloadSalonsNow() {
  return loadSalons().then(() => getSalonSnapshot());
}

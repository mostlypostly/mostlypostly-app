import { getAllSalons } from "../core/salonLookup.js";

export default function tenantFromLink() {
  return function tenantFromLinkMiddleware(req, res, next) {
    try {
      let provided = null;

      // 1️⃣ Manager session takes priority
      if (req.manager?.salon_id) {
        provided = req.manager.salon_id;
      }

      // 2️⃣ ?salon=slug override
      else if (req.query?.salon) {
        provided = String(req.query.salon).trim();
      }

      if (!provided) {
        return next();
      }

      const salons = getAllSalons();

      // Match by slug or salon_id
      const match =
        salons[provided] ||
        Object.values(salons).find((s) => s.salon_id === provided);

      if (!match) {
        console.warn(`[tenantFromLink] Unknown salon identifier "${provided}"`);
        req.salon_id = undefined;
        return next();
      }

      // Success
      req.salon_id = match.salon_id;
      req.salon_slug = match.salon_id; // filenames use salon_id convention

      return next();
    } catch (err) {
      console.error("[tenantFromLink] ERROR:", err.message);
      return next();
    }
  };
}

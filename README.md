

````markdown
# 💇‍♀️ MostlyPostly

> **AI-powered social posting assistant for salons**  
> Created and maintained by **Troy Hardister**

---

## 🧮 Tenant Health Check (Automation)

To ensure every record carries a valid salon_id:

```bash
node scripts/check-tenant-health.js

---

## 🧩 v1.1 — Multi-Tenant Upgrade (November 2025)

**Overview:**  
MostlyPostly now supports multiple salons in a single deployment.  
All posts, media, analytics, and logs include a `salon_id` for complete tenant isolation.

### 🔑 Key Changes
- Added `salon_id` column to all database tables  
- Added tenant-aware middleware (`tenantFromLink`)  
- Per-salon tokens, booking URLs, posting windows, and logs  
- Updated Twilio → Scheduler → Publisher flow to carry `salon_id`  
- New health scripts:
  - `scripts/verify-salon-id.js`
  - `scripts/check-tenant-health.js`
- Added `/manager/login` and `/manager/logout` routes  
- Daily integrity checks ensure all new rows include `salon_id`  

**Migration Note:**  
Legacy posts before v1.1 were backfilled with `salon_id='rejuvesalonspa'`.  
All new data now enforces tenant context automatically.

---

## 🏗️ Architecture Diagram

```text
   📱 Stylist (SMS / Telegram)
          │
          ▼
   Twilio Webhook (Express)
          │
          ▼
   🧠 OpenAI (gpt-4o-mini)
          │
          ▼
   JSON { service_type, caption, hashtags[], cta }
          │
          ▼
   Preview via SMS  →  Stylist replies APPROVE / EDIT / OPTIONS
          │
          ▼
   Scheduler → Queued Post (SQLite)
          │
          ▼
   Publisher → Facebook + Instagram
          │
          ▼
   📊 Analytics + Moderation Logs
````

---

## ⚙️ Tech Stack

| Component      | Technology                                         |
| -------------- | -------------------------------------------------- |
| **Backend**    | Node.js (Express)                                  |
| **Database**   | SQLite (via better-sqlite3)                        |
| **AI Model**   | OpenAI `gpt-4o-mini` (vision + JSON mode)          |
| **Messaging**  | Twilio SMS/MMS + Telegram Bot                      |
| **Publishing** | Meta Graph API (Facebook + Instagram)              |
| **Scheduler**  | Custom `scheduler.js` with randomized post windows |
| **Hosting**    | Render (staging) → AWS (production target)         |
| **Logging**    | JSON logs (`/data/logs`) + Analytics DB            |

---

## 🗂️ Repository Structure

```
mostlypostly-clean/
├── server.js
├── db.js
├── schema.sql
├── package.json
├── salons/
│   ├── rejuvesalonspa.json
│   └── (future salons)
├── data/
│   ├── posts.json
│   ├── schedulerPolicy.json
│   └── logs/
├── src/
│   ├── core/
│   │   ├── storage.js
│   │   ├── analyticsDb.js
│   │   ├── initSchemaHealth.js
│   │   └── joinWizard.js
│   ├── publishers/
│   │   ├── facebook.js
│   │   ├── instagram.js
│   │   └── telegram.js
│   ├── routes/
│   │   ├── twilio.js
│   │   ├── dashboard.js
│   │   ├── posts.js
│   │   ├── analytics.js
│   │   ├── manager.js
│   │   └── (other routes)
│   ├── utils/
│   │   ├── moderation.js
│   │   ├── rehostTwilioMedia.js
│   │   ├── logHelper.js
│   │   └── hashtags.js
│   └── scheduler.js
└── scripts/
    ├── patch-posts-table-to-v1.js
    ├── migrate-posts-json-to-sqlite.js
    ├── verify-posts-in-db.js
    ├── verify-schema-health.js
    └── (test tools)
```

---

## 🧩 Environment Setup

### 1️⃣ Prerequisites

* Node.js v22+
* npm or pnpm
* Render account (for staging deployment)
* Meta Business Manager (for FB/IG API tokens)
* Twilio account (with SMS/MMS enabled number)

### 2️⃣ .env Template

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk-xxxx
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_AUTH_TOKEN=xxxx
TWILIO_PHONE_NUMBER=+1xxxxxxxxxx

META_PAGE_ID=xxxxxxxx
META_PAGE_TOKEN=EAAGxxxxxxxx
META_IG_BUSINESS_ID=xxxxxxxx

NODE_ENV=development
PORT=3000
```

> 🧠 **Note:** Tokens are **per-salon**. Store them securely in the `salons/` configs for multi-tenant builds.

---

## 🚀 Run & Deploy

### 🧪 Local Development

```bash
npm install
node server.js
```

Visit:
👉 [http://localhost:3000](http://localhost:3000)

You should see:

```
✅ MostlyPostly schema initialized
🚀 MostlyPostly ready on http://localhost:3000
```

### ☁️ Render Deployment (Staging)

* Connect your GitHub repo to Render
* Add the above `.env` variables
* Configure:

  * **Start command:** `node server.js`
  * **Build command:** `npm install`
* Enable **persistent disk** for `/data` and `/uploads`

### 🌩️ AWS Production Notes (Future)

When migrating to AWS:

* Move media to **S3**
* Use **RDS (Postgres)** or keep SQLite with EFS
* Move static files to **CloudFront / S3**
* Keep `/data/logs` accessible for monitoring

---

## 🧱 Multi-Tenant Architecture

Each salon runs as an isolated tenant.
All major tables include a `salon_id` column for separation.

### Schema Isolation

```sql
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  stylist_id TEXT,
  caption TEXT,
  image_url TEXT,
  status TEXT,
  scheduled_for TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

Every major query filters by `salon_id`:

```js
db.prepare("SELECT * FROM posts WHERE salon_id = ?").all(salon_id);
```

### Config Isolation

Each salon has its own config JSON:

```json
{
  "salon_id": "rejuvesalonspa",
  "manager_name": "Troy Hardister",
  "booking_url": "https://rejuvesalonspa.com/book",
  "timezone": "America/Indiana/Indianapolis",
  "default_hashtags": ["#RejuveSalonSpa", "#MostlyPostly"]
}
```

---

## ⏰ Scheduler Flow

1. On approval → post inserted into `posts` with status `queued`.
2. Scheduler runs every 5 minutes:

   ```bash
   node src/scheduler.js
   ```
3. It checks each salon’s posting window and publishes due posts.
4. Published events log to `analytics_events` with timestamp + salon_id.

---

## 📊 Analytics & Moderation

Analytics events are tracked automatically in SQLite:

| Event Type        | Description                           |
| ----------------- | ------------------------------------- |
| `post_created`    | Post JSON generated                   |
| `post_approved`   | Manager approval logged               |
| `post_published`  | Scheduler completed publish           |
| `post_flagged_ai` | Unsafe or low-quality caption flagged |
| `scheduler_run`   | Scheduler cycle completed             |

Moderation logs (AI or manual) are stored under `/data/logs/{salon_id}/moderation.log`.

---

## 🧠 Development Standards

🚫 **Do not remove or replace**:

* `db.js`, `storage.js`, `scheduler.js`
* Publisher files (facebook.js, instagram.js)
* Twilio/Telegram routes
* Analytics + moderation logging helpers

✅ **Safe changes include**:

* New routes (`src/routes/*`)
* New analytics event types
* Schema extensions via `ALTER TABLE`
* Additional helper or dashboard code

### Schema Verification

Run after schema or migration changes:

```bash
node scripts/verify-schema-health.js
```

Expected output:

```
✅ MostlyPostly schema verified
```

---

## 🧭 Roadmap

| Version | Focus                                    | Status         |
| ------- | ---------------------------------------- | -------------- |
| v1.0    | Stable single-salon MVP                  | ✅ Complete    |
| v1.1    | Multi-tenant scaling + tenant protection | ✅ Complete    |
| v1.2    | Media cache & deduplication              | ⏳ Next        |
| v1.3    | Analytics dashboard (web)                | Planned        |
| v1.4    | Token management (FB system user)        | Planned        |
| v1.5    | AWS deployment readiness                 | Future         |

---

## 👤 Author

**Troy Hardister**
Creator & Product Owner — *MostlyPostly*
📍 Carmel, Indiana
💬 [LinkedIn](https://linkedin.com) | [Website (coming soon)](#)

---

## 🧾 License

© 2025 MostlyPostly. All rights reserved.
Use permitted for internal development and pilot testing only.


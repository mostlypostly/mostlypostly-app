// routes/dashboard.js — Postly Dashboard (Enhanced with Scheduler Analytics Toggle)
import express from "express";
import fetch from "node-fetch";

const router = express.Router();

export default (db) => {
  router.get("/", async (req, res) => {
    const view = req.query.view || "database"; // 'database' or 'scheduler'
    const stylistFilter = req.query.stylist || null;

    try {
      // ======================================================
      // 📊 View 1 — Database View (existing)
      // ======================================================
      if (view === "database") {
        db.all("SELECT * FROM posts ORDER BY created_at DESC", [], (err, posts) => {
          if (err) return res.status(500).send("DB error");

          db.all(
            `SELECT stylist_name, COUNT(*) as total_posts 
             FROM posts GROUP BY stylist_name ORDER BY total_posts DESC`,
            [],
            (err2, analytics) => {
              if (err2) return res.status(500).send("DB error");

              const totalPosts = posts.length;
              const topStylist = analytics[0]?.stylist_name || "N/A";
              const topStylistCount = analytics[0]?.total_posts || 0;

              const visiblePosts = stylistFilter
                ? posts.filter((p) => p.stylist_name === stylistFilter)
                : posts;

              const stylistOptions = [
                `<option value="">All Stylists</option>`,
                ...analytics.map(
                  (a) =>
                    `<option value="${a.stylist_name}" ${
                      stylistFilter === a.stylist_name ? "selected" : ""
                    }>${a.stylist_name} (${a.total_posts})</option>`
                ),
              ].join("");

              const rows = visiblePosts
                .map(
                  (r) => `
                  <tr class="hover:bg-gray-50">
                    <td class="py-2 px-4 border-b">${r.id}</td>
                    <td class="py-2 px-4 border-b">${r.stylist_name}</td>
                    <td class="py-2 px-4 border-b">${r.salon_name}</td>
                    <td class="py-2 px-4 border-b">${r.city}</td>
                    <td class="py-2 px-4 border-b">${new Date(
                      r.created_at
                    ).toLocaleString()}</td>
                    <td class="py-2 px-4 border-b">
                      <details>
                        <summary class="cursor-pointer text-blue-600 hover:underline">View</summary>
                        <p><strong>Instagram:</strong><br>${r.ig_post.replace(/\n/g, "<br>")}</p>
                        <p><strong>Facebook:</strong><br>${r.fb_post.replace(/\n/g, "<br>")}</p>
                        <p><strong>X:</strong><br>${r.x_post.replace(/\n/g, "<br>")}</p>
                      </details>
                    </td>
                    <td class="py-2 px-4 border-b">
                      <form method="POST" action="/publish/facebook">
                        <input type="hidden" name="post_id" value="${r.id}">
                        <input type="hidden" name="stylist" value="${r.stylist_name}">
                        <button class="bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700 text-sm">
                          Repost
                        </button>
                      </form>
                    </td>
                  </tr>`
                )
                .join("");

              const html = `
                <!DOCTYPE html>
                <html lang="en">
                <head>
                  <meta charset="UTF-8" />
                  <title>Postly Dashboard</title>
                  <script src="https://cdn.tailwindcss.com"></script>
                </head>
                <body class="bg-gray-100 text-gray-800">
                  <div class="max-w-7xl mx-auto p-6">
                    <h1 class="text-3xl font-bold mb-2">💇‍♀️ Postly Dashboard</h1>
                    <p class="text-gray-600 mb-6">Monitor stylist activity and caption previews.</p>

                      <!-- 🔄 Toggle Bar -->
                      <div class="flex gap-4 mb-6">
                        <a href="/dashboard?view=database" class="px-3 py-1 rounded ${view === "database" ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border"}">Database View</a>
                        <a href="/dashboard?view=scheduler" class="px-3 py-1 rounded ${view === "scheduler" ? "bg-indigo-600 text-white" : "bg-white text-gray-700 border"}">Scheduler Analytics</a>
                      </div>

                    <div class="grid grid-cols-3 gap-4 mb-8">
                      <div class="bg-white shadow rounded-lg p-4 text-center">
                        <h2 class="text-lg font-semibold text-gray-700">Total Posts</h2>
                        <p class="text-2xl font-bold text-indigo-600">${totalPosts}</p>
                      </div>
                      <div class="bg-white shadow rounded-lg p-4 text-center">
                        <h2 class="text-lg font-semibold text-gray-700">Top Stylist</h2>
                        <p class="text-2xl font-bold text-green-600">${topStylist}</p>
                        <p class="text-gray-500">${topStylistCount} posts</p>
                      </div>
                      <div class="bg-white shadow rounded-lg p-4 text-center">
                        <h2 class="text-lg font-semibold text-gray-700">Last Update</h2>
                        <p class="text-2xl font-bold text-gray-700">${new Date().toLocaleTimeString()}</p>
                      </div>
                    </div>

                    <form method="GET" action="/dashboard" class="mb-6">
                      <input type="hidden" name="view" value="database" />
                      <label for="stylist" class="mr-2 font-semibold">Filter by Stylist:</label>
                      <select name="stylist" id="stylist" class="border rounded p-1" onchange="this.form.submit()">
                        ${stylistOptions}
                      </select>
                    </form>

                    <table class="min-w-full border bg-white shadow rounded-lg">
                      <thead class="bg-gray-200">
                        <tr>
                          <th class="py-2 px-4 border-b text-left">ID</th>
                          <th class="py-2 px-4 border-b text-left">Stylist</th>
                          <th class="py-2 px-4 border-b text-left">Salon</th>
                          <th class="py-2 px-4 border-b text-left">City</th>
                          <th class="py-2 px-4 border-b text-left">Date</th>
                          <th class="py-2 px-4 border-b text-left">Posts</th>
                          <th class="py-2 px-4 border-b text-left">Action</th>
                        </tr>
                      </thead>
                      <tbody>${rows}</tbody>
                    </table>
                  </div>
                </body>
                </html>`;
              res.send(html);
            }
          );
        });
      }

      // ======================================================
      // 📈 View 2 — Scheduler Analytics (Chart.js)
      // ======================================================
      if (view === "scheduler") {
        const response = await fetch("http://localhost:3000/analytics/scheduler");
        const data = await response.json();

        const platforms = Object.keys(data.summary?.byPlatform || {});
        const platformCounts = Object.values(data.summary?.byPlatform || {});
        const types = Object.keys(data.summary?.byType || {});
        const typeCounts = Object.values(data.summary?.byType || {});

        const html = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
            <meta charset="UTF-8" />
            <title>Scheduler Analytics</title>
            <script src="https://cdn.tailwindcss.com"></script>
            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
          </head>
          <body class="bg-gray-100 text-gray-800">
            <div class="max-w-5xl mx-auto p-6">
              <h1 class="text-3xl font-bold mb-2">📈 Scheduler Analytics</h1>
              <p class="text-gray-600 mb-6">Visual summary from scheduler logs.</p>

              <!-- 🔄 Toggle Bar -->
              <div class="flex gap-4 mb-6">
                <a href="/dashboard?view=database" class="px-3 py-1 rounded ${
                  view === "database"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-700 border"
                }">Database View</a>
                <a href="/dashboard?view=scheduler" class="px-3 py-1 rounded ${
                  view === "scheduler"
                    ? "bg-indigo-600 text-white"
                    : "bg-white text-gray-700 border"
                }">Scheduler Analytics</a>
              </div>

              <div class="grid grid-cols-2 gap-6">
                <div class="bg-white shadow rounded-lg p-4">
                  <h2 class="text-lg font-semibold text-gray-700 mb-3">Posts by Platform</h2>
                  <canvas id="platformChart"></canvas>
                </div>
                <div class="bg-white shadow rounded-lg p-4">
                  <h2 class="text-lg font-semibold text-gray-700 mb-3">Posts by Type</h2>
                  <canvas id="typeChart"></canvas>
                </div>
              </div>

              <script>
                const platformCtx = document.getElementById('platformChart');
                const typeCtx = document.getElementById('typeChart');

                new Chart(platformCtx, {
                  type: 'bar',
                  data: {
                    labels: ${JSON.stringify(platforms)},
                    datasets: [{
                      label: 'Posts per Platform',
                      data: ${JSON.stringify(platformCounts)},
                      backgroundColor: 'rgba(99, 102, 241, 0.7)'
                    }]
                  },
                  options: { plugins: { legend: { display: false } } }
                });

                new Chart(typeCtx, {
                  type: 'pie',
                  data: {
                    labels: ${JSON.stringify(types)},
                    datasets: [{
                      data: ${JSON.stringify(typeCounts)},
                      backgroundColor: ['#6366f1','#34d399','#fbbf24','#f87171','#60a5fa']
                    }]
                  },
                  options: { plugins: { legend: { position: 'bottom' } } }
                });
              </script>
            </div>
          </body>
          </html>`;
        res.send(html);
      }
    } catch (err) {
      console.error("⚠️ Dashboard route error:", err);
      res.status(500).send("Internal Server Error");
    }
  });

  return router;
};

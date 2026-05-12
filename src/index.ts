import { Hono } from "hono";
import { handleUpdate } from "./bot/handler";
import { setupWebhook } from "./bot/webhook";

export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  BOT_SECRET: string;
  WEBHOOK_URL: string;
}

const app = new Hono<{ Bindings: Env }>();

// Health check
app.get("/", (c) =>
  c.json({
    status: "online",
    bot: "GhostSweeper",
    version: "1.0.0",
    description: "Cleans deleted Telegram accounts from groups",
  })
);

// Webhook registration endpoint (call once to register)
app.get("/setup", async (c) => {
  const token = c.req.query("token");
  if (token !== c.env.BOT_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  const result = await setupWebhook(c.env.BOT_TOKEN, c.env.WEBHOOK_URL, c.env.BOT_SECRET);
  return c.json(result);
});

// Main Telegram webhook endpoint
app.post("/webhook", async (c) => {
  const secret = c.req.header("X-Telegram-Bot-Api-Secret-Token");
  if (secret !== c.env.BOT_SECRET) {
    return c.json({ error: "Forbidden" }, 403);
  }

  const update = await c.req.json();
  await handleUpdate(update, c.env);
  return c.json({ ok: true });
});

// Stats endpoint
app.get("/stats", async (c) => {
  const token = c.req.query("token");
  if (token !== c.env.BOT_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const { results } = await c.env.DB.prepare(`
      SELECT
        COUNT(*) as total_groups,
        SUM(total_removed) as total_removed,
        SUM(total_scans) as total_scans
      FROM group_stats
    `).all();
    const recent = await c.env.DB.prepare(`
      SELECT chat_id, chat_title, total_removed, total_scans, last_scan_at
      FROM group_stats
      ORDER BY last_scan_at DESC
      LIMIT 10
    `).all();
    return c.json({ summary: results[0], recent_groups: recent.results });
  } catch {
    return c.json({ error: "DB not initialised" }, 500);
  }
});

export default app;

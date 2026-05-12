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
    version: "1.1.0",
    description: "Asynchronous Edge-Optimized Telegram Sweeper",
  })
);

// Webhook registration endpoint
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
  
  // Decouple execution: Process the update in the background, freeing the webhook.
  c.executionCtx.waitUntil(
    handleUpdate(update, c.env, c.executionCtx).catch((err) => {
      console.error("[GhostSweeper] Unhandled execution error:", err);
    })
  );

  return c.json({ ok: true });
});

// Stats endpoint
app.get("/stats", async (c) => {
  const token = c.req.query("token");
  if (token !== c.env.BOT_SECRET) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  try {
    const batch = await c.env.DB.batch([
      c.env.DB.prepare(`
        SELECT COUNT(*) as total_groups, SUM(total_removed) as total_removed, SUM(total_scans) as total_scans 
        FROM group_stats
      `),
      c.env.DB.prepare(`
        SELECT chat_id, chat_title, total_removed, total_scans, last_scan_at 
        FROM group_stats 
        ORDER BY last_scan_at DESC LIMIT 10
      `)
    ]);

    return c.json({ 
      summary: batch[0].results[0], 
      recent_groups: batch[1].results 
    });
  } catch (err) {
    return c.json({ error: "Database not fully initialized or reachable" }, 500);
  }
});

export default app;

import type { Env } from "../index";

// ── Group Config ──────────────────────────────────────────────────────────────
export async function getGroupConfig(db: D1Database, chatId: number) {
  return db.prepare("SELECT * FROM group_config WHERE chat_id = ?").bind(chatId).first<{
    chat_id: number; chat_title: string; enabled: number; auto_scan: number; notify_channel: number; added_by: number; added_at: string;
  }>();
}

export async function upsertGroupConfig(db: D1Database, chatId: number, title: string, addedBy: number, enabled = 1) {
  return db.prepare(`
    INSERT INTO group_config (chat_id, chat_title, enabled, auto_scan, notify_channel, added_by)
    VALUES (?, ?, ?, 1, 1, ?)
    ON CONFLICT(chat_id) DO UPDATE SET chat_title = excluded.chat_title, enabled = excluded.enabled
  `).bind(chatId, title, enabled, addedBy).run();
}

export async function toggleGroup(db: D1Database, chatId: number, enabled: boolean) {
  return db.prepare("UPDATE group_config SET enabled = ? WHERE chat_id = ?").bind(enabled ? 1 : 0, chatId).run();
}

export async function toggleAutoScan(db: D1Database, chatId: number, auto: boolean) {
  return db.prepare("UPDATE group_config SET auto_scan = ? WHERE chat_id = ?").bind(auto ? 1 : 0, chatId).run();
}

export async function toggleNotify(db: D1Database, chatId: number, notify: boolean) {
  return db.prepare("UPDATE group_config SET notify_channel = ? WHERE chat_id = ?").bind(notify ? 1 : 0, chatId).run();
}

// ── Removed Log ───────────────────────────────────────────────────────────────
export async function logRemoval(db: D1Database, chatId: number, userId: number, reason: string) {
  return db.prepare(`INSERT INTO removal_log (chat_id, user_id, reason, removed_at) VALUES (?, ?, ?, datetime('now'))`)
    .bind(chatId, userId, reason).run();
}

export async function logRemovalsBatch(db: D1Database, chatId: number, userIds: number[], reason: string) {
  if (userIds.length === 0) return;
  const stmt = db.prepare(`INSERT INTO removal_log (chat_id, user_id, reason, removed_at) VALUES (?, ?, ?, datetime('now'))`);
  const batchStatements = userIds.map(userId => stmt.bind(chatId, userId, reason));
  return db.batch(batchStatements);
}

export async function getRecentRemovals(db: D1Database, chatId: number, limit = 10) {
  return db.prepare(`SELECT user_id, reason, removed_at FROM removal_log WHERE chat_id = ? ORDER BY removed_at DESC LIMIT ?`)
    .bind(chatId, limit).all<{ user_id: number; reason: string; removed_at: string }>();
}

// ── Group Stats ───────────────────────────────────────────────────────────────
export async function incrementStats(db: D1Database, chatId: number, title: string, removed: number) {
  return db.prepare(`
    INSERT INTO group_stats (chat_id, chat_title, total_removed, total_scans, last_scan_at)
    VALUES (?, ?, ?, 1, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET
      chat_title = excluded.chat_title, total_removed = total_removed + ?, total_scans = total_scans + 1, last_scan_at = datetime('now')
  `).bind(chatId, title, removed, removed).run();
}

export async function getGroupStats(db: D1Database, chatId: number) {
  return db.prepare("SELECT * FROM group_stats WHERE chat_id = ?").bind(chatId).first<{
    chat_id: number; chat_title: string; total_removed: number; total_scans: number; last_scan_at: string;
  }>();
}

// ── Pending Scans ─────────────────────────────────────────────────────────────
export async function savePendingScan(db: D1Database, chatId: number, members: number[]) {
  const id = `scan_${chatId}_${Date.now()}`;
  return db.prepare(`INSERT INTO pending_scans (scan_id, chat_id, member_ids, created_at) VALUES (?, ?, ?, datetime('now'))`)
    .bind(id, chatId, JSON.stringify(members)).run();
}

export async function getPendingScan(db: D1Database, chatId: number) {
  return db.prepare(`SELECT * FROM pending_scans WHERE chat_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(chatId).first<{ scan_id: string; chat_id: number; member_ids: string }>();
}

export async function deletePendingScan(db: D1Database, scanId: string) {
  return db.prepare("DELETE FROM pending_scans WHERE scan_id = ?").bind(scanId).run();
}

// ── Admin Cache ───────────────────────────────────────────────────────────────
export async function isBotAdmin(db: D1Database, chatId: number): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM bot_admin_cache WHERE chat_id = ? AND is_admin = 1").bind(chatId).first();
  return !!row;
}

export async function setBotAdmin(db: D1Database, chatId: number, isAdmin: boolean) {
  return db.prepare(`
    INSERT INTO bot_admin_cache (chat_id, is_admin, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET is_admin = excluded.is_admin, updated_at = datetime('now')
  `).bind(chatId, isAdmin ? 1 : 0).run();
}

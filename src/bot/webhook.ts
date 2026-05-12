export async function setupWebhook(
  token: string,
  webhookUrl: string,
  secret: string
): Promise<{ ok: boolean; description?: string; webhook_url?: string }> {
  const url = `https://api.telegram.org/bot${token}/setWebhook`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: [
        "message",
        "callback_query",
        "my_chat_member",
        "chat_member",
      ],
      drop_pending_updates: true,
      max_connections: 100,
    }),
  });

  const data = (await res.json()) as { ok: boolean; description?: string };

  if (data.ok) {
    return { ok: true, webhook_url: webhookUrl, description: "Webhook set successfully" };
  }
  return { ok: false, description: data.description };
}

export async function deleteWebhook(token: string) {
  const url = `https://api.telegram.org/bot${token}/deleteWebhook`;
  const res = await fetch(url, { method: "POST" });
  return res.json();
}

export async function getWebhookInfo(token: string) {
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const res = await fetch(url);
  return res.json();
}

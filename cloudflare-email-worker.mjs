export default {
  async fetch() {
    return new Response("OK - worker ativo", { status: 200 });
  },

  async email(message, env) {
    const subject = String(message.headers.get("subject") || "");
    const from = String(message.from || "");
    const to = String(message.to || "");

    // Modo mais confiavel: envia payload direto.
    // O backend tambem aceita raw, mas esse formato evita falhas de parse no Worker.
    let text = "";
    try {
      text = await new Response(message.raw).text();
    } catch (_e) {
      text = "";
    }

    const resp = await fetch(env.WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.API_KEY
      },
      body: JSON.stringify({
        to,
        from,
        subject,
        text
      })
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.log("webhook fail", resp.status, body);

      // Backup opcional
      if (env.FORWARD_TO) {
        await message.forward(env.FORWARD_TO);
      }
    }
  }
};

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const https = require("https");
const { simpleParser } = require("mailparser");
const cfg = require("./domain.js");

const app = express();
const PORT = process.env.PORT || 3000;

const OWN_DOMAIN = cfg.EMAIL_DOMAIN;
const PUBLIC_SITE_URL = String(
  process.env.PUBLIC_SITE_URL || cfg.SITE_BASE_URL
).replace(/\/+$/, "");

const ROCKSTAR_FROM_RE =
  /rockstar|socialclub|take2|gtav|gta\s*online|sc-auth/i;

function normalizeForSearch(value) {
  // Remove acentos para evitar problemas de encoding (verificacao/verificação).
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use((req, res, next) => {
  res.setHeader("X-Email-Domain", OWN_DOMAIN);
  res.setHeader("X-API-Build", cfg.API_BUILD);
  if (req.path.startsWith("/api")) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  next();
});
app.set("trust proxy", 1);
app.use(express.static(path.join(__dirname, "public")));

const DB_FILE = path.join(__dirname, "mailboxes.json");
const mailboxStore = [];
const INBOUND_API_KEY = process.env.INBOUND_API_KEY || "";
const MAILGUN_API_KEY = String(process.env.MAILGUN_API_KEY || "").trim();
const MAILGUN_DOMAIN = String(process.env.MAILGUN_DOMAIN || "").trim();
const MAILGUN_FROM = String(process.env.MAILGUN_FROM || "").trim();

function isMailgunConfigured() {
  return Boolean(MAILGUN_API_KEY && MAILGUN_DOMAIN && MAILGUN_FROM);
}

function getMailgunStatus() {
  return {
    configured: isMailgunConfigured(),
    domain: MAILGUN_DOMAIN || null,
    from: MAILGUN_FROM || null
  };
}

function generateEmail(domain) {
  const username = crypto.randomBytes(6).toString("hex");
  return `${username}@${domain}`;
}

function isOwnDomainEmail(email) {
  return email.toLowerCase().endsWith(`@${OWN_DOMAIN}`);
}

function extractCodeGeneric(blob) {
  const normalized = String(blob || "");
  const patterns = [
    /\b\d{4,8}\b/,
    /\b[A-Z0-9]{6,10}\b/
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * Prioriza padroes comuns de email de verificacao (ex.: Rockstar / Social Club).
 * Quando o remetente parece Rockstar, tenta capturar codigo numerico de 6 digitos primeiro.
 */
function extractVerificationCode(subject, text, from) {
  const blob = `${String(subject || "")}\n${String(text || "")}`;
  const fromStr = String(from || "");
  const looksRockstar = ROCKSTAR_FROM_RE.test(fromStr);

  const blobSearch = normalizeForSearch(blob);

  // Extracao robusta (sem depender de acentos/encoding em regex antigos).
  // Importante: não capturar tokens depois de "verify" sozinho, senão o assunto "Verify"
  // vira "YOUR" (ex.: "Verify" + "Your verification code is 123456").

  // 1) Para Rockstar quase sempre é 6 dígitos.
  const m6 = blobSearch.match(/\b(\d{6})\b/);
  if (m6) return m6[1];

  // Alguns emails usam "123-456" ou "123 456"
  const m6Split = blobSearch.match(/\b(\d{3})[\s-](\d{3})\b/);
  if (m6Split) return `${m6Split[1]}${m6Split[2]}`;

  // 2) Tokens "code: ABC123" ou "verification code is 123456"
  const labelRe =
    /(?:verification\s+code|codigo\s+de\s+verificacao|code|codigo|pin|token)\s*(?:is|:)?\s*([a-z0-9]{4,10})\b/i;
  const labeled = blobSearch.match(labelRe);
  if (labeled && labeled[1]) {
    const token = String(labeled[1]).trim();
    return /[a-z]/i.test(token) ? token.toUpperCase() : token;
  }

  // 3) Fallback: para Rockstar, aceita 4-8 dígitos se não achou 6.
  if (looksRockstar) {
    const mDigits = blobSearch.match(/\b(\d{4,8})\b/);
    if (mDigits) return mDigits[1];
  }

  if (looksRockstar) {
    const rockstarPatterns = [
      /(?:verification|verify|verifica(?:c|ç)(?:a|ã)o|code|codigo|c(?:o|ó)digo|pin|token)[\s:]*([A-Z0-9]{4,10})/i,
      /\b(\d{6})\b/,
      /\b(\d{4,8})\b/
    ];
    for (const pattern of rockstarPatterns) {
      const match = blob.match(pattern);
      if (match) {
        return (match[1] || match[0]).trim();
      }
    }
  }

  const genericPatterns = [
    /(?:verification|verify|code|codigo|c(?:o|ó)digo|pin)[\s:]*([A-Z0-9]{4,10})/i,
    /\b(\d{6})\b/,
    /\b(\d{4,8})\b/
  ];
  for (const pattern of genericPatterns) {
    const match = blob.match(pattern);
    if (match) {
      return (match[1] || match[0]).trim();
    }
  }

  return extractCodeGeneric(blob);
}

function isRockstarRelated(from) {
  return ROCKSTAR_FROM_RE.test(String(from || ""));
}

function migrateMailboxDomains() {
  const legacyHosts = ["mailtemp.dev", "inboxx.site", "fastmailbox.net", "wolfsotre.com"];
  const legacy = new RegExp(
    `@(?:${legacyHosts.map((h) => h.replace(/\./g, "\\.")).join("|")})$`,
    "i"
  );
  let changed = false;
  for (const item of mailboxStore) {
    if (item.email && legacy.test(item.email)) {
      item.email = item.email.replace(legacy, `@${OWN_DOMAIN}`);
      changed = true;
    }
  }
  if (changed) {
    persistMailboxes();
    console.log(`Dominios legados migrados para @${OWN_DOMAIN}.`);
  }
}

function loadMailboxesFromDisk() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return;
    }
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      mailboxStore.push(...parsed);
    }
    migrateMailboxDomains();
  } catch (error) {
    console.error("Falha ao carregar mailboxes.json:", error.message);
  }
}

function persistMailboxes() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(mailboxStore, null, 2), "utf8");
  } catch (error) {
    console.error("Falha ao salvar mailboxes.json:", error.message);
  }
}

function pickOwnDomainRecipient({ parsed, rawFallbackTo }) {
  const wantedSuffix = `@${OWN_DOMAIN}`;
  const recipients = parsed?.to?.value || [];
  for (const r of recipients) {
    const addr = String(r.address || "").trim().toLowerCase();
    if (addr.endsWith(wantedSuffix)) {
      return addr;
    }
  }

  // Alguns encaminhamentos preservam o destino real nesses headers.
  const headers = parsed?.headers;
  if (headers && typeof headers.get === "function") {
    const candidates = [
      "x-original-to",
      "x-forwarded-to",
      "x-forwarded-recipient",
      "delivered-to",
      "envelope-to",
      "x-envelope-to",
      "to"
    ];
    for (const key of candidates) {
      const value = headers.get(key);
      if (!value) continue;
      const match = String(value).match(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/i);
      if (match) {
        const addr = match[0].toLowerCase();
        if (addr.endsWith(wantedSuffix)) {
          return addr;
        }
      }
    }
  }

  const fallbackRaw = String(rawFallbackTo || "").trim();
  if (fallbackRaw) {
    // Pode vir como "Nome <usuario@faninboom.store>"
    const m = fallbackRaw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const addr = String(m ? m[0] : fallbackRaw).trim().toLowerCase();
    if (addr.endsWith(wantedSuffix)) {
      return addr;
    }
  }

  return "";
}

function findOwnDomainEmailInRawText(rawText) {
  const suffix = `@${OWN_DOMAIN}`;
  const escapedDomain = OWN_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  // Cloudflare/Gmail podem deixar o endereco em quoted-printable (ex.: =40 =2E).
  const normalized = String(rawText || "")
    .replace(/=40/gi, "@")
    .replace(/=2e/gi, ".")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  const re = new RegExp(`[A-Z0-9._%+-]+@${escapedDomain}`, "i");
  const match = normalized.match(re);
  if (!match) {
    return "";
  }

  const addr = String(match[0] || "").trim().toLowerCase();
  return addr.endsWith(suffix) ? addr : "";
}

function normalizeInboundRecipient(value) {
  const suffix = `@${OWN_DOMAIN}`;
  if (!value) return "";

  const list = Array.isArray(value) ? value : [value];
  for (const item of list) {
    const raw = String(item || "").trim();
    if (!raw) continue;
    const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const addr = String(match ? match[0] : raw).trim().toLowerCase();
    if (addr.endsWith(suffix)) {
      return addr;
    }
  }

  return "";
}

async function parseRawEmail(raw, encoding = "base64") {
  const rawStr = String(raw || "");
  const buffer =
    encoding === "utf8" ? Buffer.from(rawStr, "utf8") : Buffer.from(rawStr, "base64");
  const parsed = await simpleParser(buffer);

  // Melhor esforco: a maioria dos encaminhamentos e ASCII/UTF-8.
  const rawText = buffer.toString("utf8");
  return { parsed, rawText };
}

function sendMailgunEmail({ to, subject, text, html, from }) {
  return new Promise((resolve, reject) => {
    if (!isMailgunConfigured()) {
      reject(new Error("Mailgun nao configurado."));
      return;
    }

    const payload = new URLSearchParams();
    payload.set("from", from || MAILGUN_FROM);
    payload.set("to", to);
    payload.set("subject", subject);

    if (text) {
      payload.set("text", text);
    }
    if (html) {
      payload.set("html", html);
    }

    const request = https.request(
      {
        hostname: "api.mailgun.net",
        port: 443,
        path: `/v3/${encodeURIComponent(MAILGUN_DOMAIN)}/messages`,
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload.toString())
        }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          let parsedBody = null;
          try {
            parsedBody = body ? JSON.parse(body) : null;
          } catch (_error) {
            parsedBody = body || null;
          }

          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(parsedBody);
            return;
          }

          const details =
            typeof parsedBody === "string"
              ? parsedBody
              : parsedBody?.message || `HTTP ${response.statusCode}`;
          reject(new Error(`Mailgun recusou o envio: ${details}`));
        });
      }
    );

    request.on("error", (error) => {
      reject(error);
    });

    request.write(payload.toString());
    request.end();
  });
}

/**
 * Processa email recebido via HTTP POST, Gmail forward ou servidor SMTP (Rockstar, etc.).
 * @param {"api"|"smtp"|"gmail"} source
 */
function processInboundEmail({ to, from, subject, text }, source = "api") {
  to = String(to || "").trim().toLowerCase();
  from = String(from || "unknown@unknown").trim();
  subject = String(subject || "").trim();
  text = String(text || "").trim();

  if (!to) {
    return { ok: false, error: "Destino (to) vazio." };
  }

  if (!isOwnDomainEmail(to)) {
    return { ok: false, error: `Use apenas destinos @${OWN_DOMAIN}.` };
  }

  if (!text && !subject) {
    return { ok: false, error: "Email sem assunto e sem corpo." };
  }

  let mailbox = mailboxStore.find((item) => item.email.toLowerCase() === to);
  if (!mailbox) {
    mailbox = {
      id: crypto.randomUUID(),
      email: to,
      codes: [],
      messages: [],
      createdAt: new Date().toISOString(),
      autoCreatedByInbound: true
    };
    mailboxStore.unshift(mailbox);
  }

  const receivedAt = new Date().toISOString();
  const parsedCode = extractVerificationCode(subject, text, from);
  const rockstar = isRockstarRelated(from);
  const messageEntry = {
    id: crypto.randomUUID(),
    from,
    to,
    subject: subject || "(sem assunto)",
    text: text || "(vazio — veja assunto)",
    parsedCode,
    rockstar,
    source,
    createdAt: receivedAt
  };
  mailbox.messages.unshift(messageEntry);

  if (parsedCode) {
    mailbox.codes.unshift({
      id: crypto.randomUUID(),
      value: parsedCode,
      source: rockstar ? "rockstar-inbound" : "auto-inbound",
      createdAt: receivedAt
    });
  }
  persistMailboxes();

  return { ok: true, parsedCode, mailbox };
}

app.get("/api/health", (_req, res) => {
  const smtpEnabled = process.env.ENABLE_SMTP_INBOUND !== "false";
  const smtpPort = parseInt(process.env.SMTP_PORT || "25", 10);
  res.json({
    ok: true,
    service: "email-generator-api",
    domain: OWN_DOMAIN,
    siteUrl: `${PUBLIC_SITE_URL}/`,
    apiBuild: cfg.API_BUILD,
    outbound: {
      provider: "mailgun",
      ...getMailgunStatus()
    },
    smtpInbound: {
      enabled: smtpEnabled,
      port: smtpPort,
      hint: "MX deve apontar para este IP na porta SMTP_PORT (padrao 25)"
    }
  });
});

app.post("/api/emails/generate", (req, res) => {
  const rawCount = req.body?.count;
  let count =
    typeof rawCount === "number" && Number.isFinite(rawCount)
      ? Math.trunc(rawCount)
      : parseInt(String(rawCount ?? "").trim(), 10);
  if (!Number.isFinite(count) || count < 1) {
    count = 1;
  }
  if (count > 50) {
    count = 50;
  }

  /* Nao validamos body.domain: clientes antigos ou URLs completas nao podem bloquear.
     Emails sao sempre gerados somente em @faninboom.store */
  const domain = OWN_DOMAIN;
  const emails = [];

  try {
    for (let i = 0; i < count; i += 1) {
      const item = {
        id: crypto.randomUUID(),
        email: generateEmail(domain),
        codes: [],
        messages: [],
        createdAt: new Date().toISOString()
      };
      mailboxStore.unshift(item);
      emails.push(item);
    }
    persistMailboxes();
  } catch (error) {
    console.error("generate:", error);
    return res.status(500).json({ error: "Erro ao salvar emails. Verifique permissoes do arquivo mailboxes.json." });
  }

  res.status(201).json({
    count: emails.length,
    emails,
    domain: OWN_DOMAIN,
    apiBuild: cfg.API_BUILD
  });
});

app.post("/api/generate-email", (_req, res) => {
  const item = {
    id: crypto.randomUUID(),
    email: generateEmail(OWN_DOMAIN),
    codes: [],
    messages: [],
    createdAt: new Date().toISOString()
  };

  mailboxStore.unshift(item);
  persistMailboxes();

  res.status(201).json({
    ok: true,
    id: item.id,
    email: item.email,
    domain: OWN_DOMAIN
  });
});

app.get("/api/emails", (_req, res) => {
  res.json({ total: mailboxStore.length, data: mailboxStore });
});

app.get("/api/mailbox", (req, res) => {
  const email = String(req.query.email ?? "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Envie o parametro email." });
  }

  if (!isOwnDomainEmail(email)) {
    return res.status(400).json({
      error: `Use apenas um endereco @${OWN_DOMAIN}.`
    });
  }

  const mailbox = mailboxStore.find((item) => item.email.toLowerCase() === email);

  if (!mailbox) {
    return res.status(404).json({
      error: "Caixa nao encontrada. Gere este endereco no painel principal primeiro."
    });
  }

  res.json({ mailbox });
});

app.get("/api/latest-code", (req, res) => {
  const email = String(req.query.email ?? "").trim().toLowerCase();

  if (!email) {
    return res.status(400).json({ error: "Envie o parametro email." });
  }

  if (!isOwnDomainEmail(email)) {
    return res.status(400).json({
      error: `Use apenas um endereco @${OWN_DOMAIN}.`
    });
  }

  const mailbox = mailboxStore.find((item) => item.email.toLowerCase() === email);
  if (!mailbox) {
    return res.status(404).json({ error: "Caixa nao encontrada." });
  }

  const latestCode = mailbox.codes?.[0] || null;
  const latestMessage = mailbox.messages?.[0] || null;

  res.json({
    ok: true,
    email,
    latestCode: latestCode
      ? {
          value: latestCode.value || "",
          source: latestCode.source || "",
          createdAt: latestCode.createdAt || ""
        }
      : null,
    latestMessage: latestMessage
      ? {
          from: latestMessage.from || "",
          subject: latestMessage.subject || "",
          parsedCode: latestMessage.parsedCode || "",
          createdAt: latestMessage.createdAt || ""
        }
      : null
  });
});

app.get("/api/emails/:id/messages", (req, res) => {
  const { id } = req.params;
  const mailbox = mailboxStore.find((item) => item.id === id);

  if (!mailbox) {
    return res.status(404).json({ error: "Email nao encontrado." });
  }

  res.json({ total: mailbox.messages.length, data: mailbox.messages });
});

app.delete("/api/emails", (_req, res) => {
  mailboxStore.length = 0;
  persistMailboxes();
  res.json({ message: "Todos os emails foram removidos." });
});

app.get("/api/outbound/status", (_req, res) => {
  res.json({
    ok: true,
    provider: "mailgun",
    ...getMailgunStatus()
  });
});

app.post("/api/outbound/send", async (req, res) => {
  const to = String(req.body?.to ?? "").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const text = String(req.body?.text ?? "").trim();
  const html = String(req.body?.html ?? "").trim();
  const from = String(req.body?.from ?? "").trim();

  if (!isMailgunConfigured()) {
    return res.status(503).json({
      error: "Mailgun nao configurado. Defina MAILGUN_API_KEY, MAILGUN_DOMAIN e MAILGUN_FROM."
    });
  }

  if (!to || !subject || (!text && !html)) {
    return res.status(400).json({
      error: "Campos obrigatorios: to, subject e ao menos um entre text ou html."
    });
  }

  try {
    const providerResponse = await sendMailgunEmail({
      to,
      subject,
      text,
      html,
      from
    });

    res.status(201).json({
      ok: true,
      provider: "mailgun",
      to,
      subject,
      response: providerResponse
    });
  } catch (error) {
    console.error("[MAILGUN] Falha ao enviar:", error.message);
    res.status(502).json({
      error: error.message || "Falha ao enviar email pelo Mailgun."
    });
  }
});

app.post("/api/inbound/email", (req, res) => {
  const providedApiKey = req.headers["x-api-key"];
  if (INBOUND_API_KEY && providedApiKey !== INBOUND_API_KEY) {
    return res.status(401).json({ error: "API key invalida." });
  }

  const to = String(req.body?.to ?? "").trim().toLowerCase();
  const from = String(req.body?.from ?? "unknown@sender.local").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const text = String(req.body?.text ?? "").trim();

  if (!to || (!text && !subject)) {
    return res.status(400).json({ error: "Campos obrigatorios: to e (text ou subject)." });
  }

  const result = processInboundEmail({ to, from, subject, text }, "api");
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  res.status(201).json({
    message: "Mensagem recebida com sucesso.",
    parsedCode: result.parsedCode,
    mailbox: result.mailbox
  });
});

// Endpoint simples para Cloudflare Email Worker enviar payload direto:
// { to, from, subject, text }
app.post("/api/inbound/worker", (req, res) => {
  const providedApiKey = req.headers["x-api-key"];
  if (INBOUND_API_KEY && providedApiKey !== INBOUND_API_KEY) {
    return res.status(401).json({ error: "API key invalida." });
  }

  const to = normalizeInboundRecipient(req.body?.to);
  const from = String(req.body?.from ?? "unknown@sender.local").trim();
  const subject = String(req.body?.subject ?? "").trim();
  const text = String(req.body?.text ?? "").trim();

  if (!to || (!text && !subject)) {
    return res.status(400).json({ error: "Campos obrigatorios: to e (text ou subject)." });
  }

  const result = processInboundEmail({ to, from, subject, text }, "worker");
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  res.status(201).json({
    message: "Mensagem do worker recebida com sucesso.",
    parsedCode: result.parsedCode,
    mailbox: result.mailbox
  });
});

// Integra Gmail/Email Routing sem abrir porta: Apps Script envia o raw e o servidor parseia.
app.post("/api/inbound/gmail", async (req, res) => {
  const debugInbound = process.env.DEBUG_INBOUND === "true";
  const providedApiKey = req.headers["x-api-key"];
  if (INBOUND_API_KEY && providedApiKey !== INBOUND_API_KEY) {
    if (debugInbound) {
      console.log("[GMAIL] 401 api key invalida");
    }
    return res.status(401).json({ error: "API key invalida." });
  }

  const raw = req.body?.raw;
  const encoding = String(req.body?.encoding || "base64").toLowerCase();
  const rawTo = normalizeInboundRecipient(req.body?.to);
  const directFrom = String(req.body?.from || "").trim();
  const directSubject = String(req.body?.subject || "").trim();
  const directText = String(req.body?.text || "").trim();

  // Fallback importante: se o Worker mandar payload direto ao inves de raw,
  // ainda salvamos a mensagem no painel.
  if (!raw && rawTo && (directText || directSubject)) {
    const directResult = processInboundEmail(
      {
        to: rawTo,
        from: directFrom || "unknown@unknown",
        subject: directSubject,
        text: directText
      },
      "gmail"
    );

    if (!directResult.ok) {
      if (debugInbound) {
        console.log("[GMAIL] 400 payload direto falhou:", directResult.error);
      }
      return res.status(400).json({ error: directResult.error });
    }

    if (debugInbound) {
      console.log("[GMAIL] ok direto to:", rawTo, "| from:", directFrom || "(vazio)", "| parsedCode:", directResult.parsedCode || "(nenhum)");
    }

    return res.status(201).json({
      message: "Mensagem Gmail recebida com sucesso.",
      parsedCode: directResult.parsedCode,
      mailbox: directResult.mailbox
    });
  }

  if (!raw) {
    if (debugInbound) {
      console.log("[GMAIL] 400 sem raw e sem payload direto");
    }
    return res.status(400).json({ error: "Envie raw ou os campos to + (text ou subject)." });
  }
  if (encoding !== "base64" && encoding !== "utf8") {
    if (debugInbound) {
      console.log("[GMAIL] 400 encoding invalido:", encoding);
    }
    return res.status(400).json({ error: "encoding deve ser base64 ou utf8." });
  }

  let parsed;
  let rawText = "";
  try {
    const result = await parseRawEmail(raw, encoding);
    parsed = result.parsed;
    rawText = result.rawText || "";
  } catch (_e) {
    if (debugInbound) {
      console.log("[GMAIL] 400 falha ao parsear raw");
    }
    return res.status(400).json({ error: "Nao foi possivel parsear o email raw." });
  }

  let to = pickOwnDomainRecipient({ parsed, rawFallbackTo: rawTo });
  if (!to) {
    to = findOwnDomainEmailInRawText(rawText);
  }
  const from =
    parsed.from?.value?.[0]?.address ||
    String(parsed.from?.text || "").trim() ||
    "unknown@unknown";
  const subject = String(parsed.subject || "").trim();
  const text =
    String(parsed.text || "").trim() ||
    String(parsed.html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() ||
    "(sem corpo texto)";

  if (!to) {
    if (debugInbound) {
      console.log("[GMAIL] 400 destino nao encontrado. rawTo:", rawTo || "(vazio)", "| from:", from);
    }
    return res.status(400).json({ error: `Destino @${OWN_DOMAIN} nao encontrado no email.` });
  }

  const result = processInboundEmail({ to, from, subject, text }, "gmail");
  if (!result.ok) {
    if (debugInbound) {
      console.log("[GMAIL] 400 processInboundEmail falhou:", result.error);
    }
    return res.status(400).json({ error: result.error });
  }

  if (debugInbound) {
    console.log("[GMAIL] ok to:", to, "| from:", from, "| parsedCode:", result.parsedCode || "(nenhum)");
  }

  res.status(201).json({
    message: "Mensagem Gmail recebida com sucesso.",
    parsedCode: result.parsedCode,
    mailbox: result.mailbox
  });
});

loadMailboxesFromDisk();

const ENABLE_SMTP_INBOUND = process.env.ENABLE_SMTP_INBOUND !== "false";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "25", 10);
if (ENABLE_SMTP_INBOUND) {
  try {
    const { startSmtpInbound } = require("./smtp-inbound");
    startSmtpInbound({
      port: SMTP_PORT,
      ownDomain: OWN_DOMAIN,
      onIncoming: async (payload) => processInboundEmail(payload, "smtp")
    });
  } catch (err) {
    console.error("[SMTP] Nao foi possivel iniciar:", err.message);
    console.error(
      "      Dica Windows: porta 25 exige admin — tente SMTP_PORT=2525 e redirecione a porta no roteador, ou desative com ENABLE_SMTP_INBOUND=false"
    );
  }
}

app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/painel", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/inbox", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "inbox.html"));
});

app.get("/setup-email", (_req, res) => {
  const docPath = path.join(__dirname, "SETUP-EMAIL.md");
  try {
    const text = fs.readFileSync(docPath, "utf8");
    res.type("text/plain; charset=utf-8");
    res.send(text);
  } catch (_e) {
    res.status(404).send("Documentacao nao encontrada.");
  }
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
  console.log(`Dominio de email fixo: @${OWN_DOMAIN} | Site: ${PUBLIC_SITE_URL}/`);
});

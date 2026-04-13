const { SMTPServer } = require("smtp-server");
const { simpleParser } = require("mailparser");

function stripHtml(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Servidor SMTP de entrada: recebe email real quando o MX aponta para esta maquina.
 * @param {object} opts
 * @param {number} opts.port - geralmente 25 (MX). No Windows pode precisar admin ou usar 2525 + redirecionamento.
 * @param {string} opts.ownDomain - ex: faninboom.store
 * @param {function} opts.onIncoming - async ({ to, from, subject, text }) => { ok, error? }
 */
function startSmtpInbound({ port, ownDomain, onIncoming }) {
  const server = new SMTPServer({
    name: "faninboom-inbound",
    authOptional: true,
    disabledCommands: ["AUTH"],
    onMailFrom(_address, _session, cb) {
      cb();
    },
    onRcptTo(address, _session, cb) {
      const addr = (address.address || "").toLowerCase();
      if (!addr.endsWith(`@${ownDomain}`)) {
        return cb(new Error(`Recipient must be @${ownDomain}`));
      }
      cb();
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", async () => {
        try {
          const parsed = await simpleParser(Buffer.concat(chunks));
          let to = "";
          const recipients = parsed.to?.value || [];
          for (const r of recipients) {
            const a = (r.address || "").toLowerCase();
            if (a.endsWith(`@${ownDomain}`)) {
              to = a;
              break;
            }
          }
          if (!to && session.envelope.rcptTo?.length) {
            to = (session.envelope.rcptTo[0].address || "").toLowerCase();
          }
          const fromAddr =
            parsed.from?.value?.[0]?.address ||
            session.envelope.mailFrom?.address ||
            "unknown@unknown";
          const subject = parsed.subject || "";
          let text = parsed.text || "";
          if (!text && parsed.html) {
            text = stripHtml(parsed.html);
          }
          if (!text && parsed.textAsHtml) {
            text = stripHtml(parsed.textAsHtml);
          }

          const result = await onIncoming({
            to,
            from: fromAddr,
            subject,
            text: text || "(sem corpo texto)"
          });
          if (result && result.ok === false) {
            return callback(new Error(result.error || "Falha ao processar email"));
          }
          callback();
        } catch (err) {
          callback(err);
        }
      });
    }
  });

  server.on("error", (err) => {
    console.error("[SMTP]", err.message);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `[SMTP] Recebendo emails em 0.0.0.0:${port} -> @${ownDomain} (qualquer remetente)`
    );
  });

  return server;
}

module.exports = { startSmtpInbound };

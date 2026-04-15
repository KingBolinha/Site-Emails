const generateForm = document.querySelector("#generate-form");
const countInput = document.querySelector("#count");
const domainInput = document.querySelector("#domain");
const mailboxesContainer = document.querySelector("#mailboxes");
const refreshBtn = document.querySelector("#refresh-btn");
const clearBtn = document.querySelector("#clear-btn");
const statusElement = document.querySelector("#status");
const metricEmails = document.querySelector("#metric-emails");
const metricCodes = document.querySelector("#metric-codes");
const metricMessages = document.querySelector("#metric-messages");
const confirmClearModal = document.querySelector("#confirm-clear-modal");
const confirmClearCancelBtn = document.querySelector("#confirm-clear-cancel");
const confirmClearSubmitBtn = document.querySelector("#confirm-clear-submit");

const FIXED_DOMAIN = "faninboom.store";

let mailboxes = [];

function applyDomainField() {
  if (!domainInput) {
    return;
  }
  domainInput.value = FIXED_DOMAIN;
  domainInput.setAttribute("value", FIXED_DOMAIN);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message) {
  statusElement.textContent = message;
}

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR");
}

function truncate(value, max = 160) {
  const text = String(value || "").trim();
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}...`;
}

function updateMetrics() {
  const emailCount = mailboxes.length;
  const codeCount = mailboxes.reduce((acc, mailbox) => acc + (mailbox.codes?.length || 0), 0);
  const messageCount = mailboxes.reduce((acc, mailbox) => acc + (mailbox.messages?.length || 0), 0);

  metricEmails.textContent = String(emailCount);
  metricCodes.textContent = String(codeCount);
  metricMessages.textContent = String(messageCount);
}

function renderMessagesPreview(messages) {
  const list = (messages || []).slice(0, 3);
  if (!list.length) {
    return '<div class="empty-state">Nenhuma mensagem recebida ainda para esta caixa.</div>';
  }

  return `
    <div class="mailbox-messages">
      ${list
        .map((message) => {
          const parsedCode = message.parsedCode
            ? `<span class="parsed-chip">Codigo: ${escapeHtml(message.parsedCode)}</span>`
            : "";
          const rockstarBadge = message.rockstar
            ? '<span class="rockstar-badge">Rockstar</span>'
            : "";

          return `
            <article class="mailbox-message-preview">
              <div class="msg-title-row">
                <span class="msg-head">${escapeHtml(formatDate(message.createdAt))}</span>
                ${rockstarBadge}
              </div>
              <p class="msg-preview-subject">${escapeHtml(message.subject || "(sem assunto)")}</p>
              <p class="msg-source">De: ${escapeHtml(message.from || "desconhecido")}</p>
              ${parsedCode ? `<p class="msg-code-line">${parsedCode}</p>` : ""}
              <p class="msg-preview-body">${escapeHtml(truncate(message.text || "(sem conteudo)"))}</p>
            </article>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderCodes(codes) {
  if (!codes?.length) {
    return '<li class="pill-empty">Sem codigos</li>';
  }

  return codes
    .map((code) => `<li class="code-list-chip">${escapeHtml(code.value)}</li>`)
    .join("");
}

function renderMailboxes() {
  if (!mailboxes.length) {
    mailboxesContainer.innerHTML =
      '<div class="empty-state">Nenhum email gerado ainda. Crie a primeira caixa para comecar o recebimento.</div>';
    updateMetrics();
    return;
  }

  mailboxesContainer.innerHTML = mailboxes
    .map((mailbox) => {
      const codeCount = mailbox.codes?.length || 0;
      const messageCount = mailbox.messages?.length || 0;
      return `
        <article class="mailbox">
          <div class="email-line">
            <div class="email-value">${escapeHtml(mailbox.email)}</div>
            <div class="mailbox-meta">
              <span>Criado em ${escapeHtml(formatDate(mailbox.createdAt))}</span>
            </div>
          </div>
          <div class="mailbox-stats">
            <span class="stat-pill">${codeCount} codigos</span>
            <span class="stat-pill">${messageCount} mensagens</span>
          </div>

          <div class="mailbox-actions">
            <button type="button" data-copy="${mailbox.email}" class="btn btn-secondary copy-btn">Copiar email</button>
            <a href="/inbox?email=${encodeURIComponent(mailbox.email)}" class="btn btn-inbox">Abrir inbox</a>
          </div>

          <ul class="code-list-inline">${renderCodes(mailbox.codes || [])}</ul>
          ${renderMessagesPreview(mailbox.messages || [])}
        </article>
      `;
    })
    .join("");

  document.querySelectorAll(".copy-btn").forEach((button) => {
    button.addEventListener("click", onCopyEmail);
  });
  updateMetrics();
}

async function fetchMailboxes() {
  try {
    const response = await fetch("/api/emails", { headers: { Accept: "application/json" } });
    if (!response.ok) {
      setStatus("Nao foi possivel carregar a lista de emails.");
      return;
    }
    const payload = await response.json();
    mailboxes = payload.data || [];
    renderMailboxes();
  } catch (_error) {
    setStatus("Erro ao carregar os emails. Verifique se o servidor esta online.");
  }
}

async function fetchHealth() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      applyDomainField();
      return;
    }

    const payload = await response.json();
    applyDomainField();
    const siteLine = document.querySelector("#site-url-line");
    if (siteLine && payload.siteUrl) {
      siteLine.textContent = `URL publica ativa: ${payload.siteUrl}`;
    }

    const heroHealth = document.querySelector("#hero-health");
    if (heroHealth && payload.smtpInbound) {
      const enabled = payload.smtpInbound.enabled !== false;
      const port = payload.smtpInbound.port ? String(payload.smtpInbound.port) : "";
      heroHealth.textContent = enabled ? `smtp on :${port || "25"}` : "smtp off";
    }
  } catch (_error) {
    applyDomainField();
  }
}

function parseCountInput() {
  const raw = String(countInput?.value ?? "").trim();
  let count = parseInt(raw, 10);
  if (!Number.isFinite(count) || Number.isNaN(count)) {
    count = 1;
  }
  return Math.min(50, Math.max(1, count));
}

async function onGenerate(event) {
  event.preventDefault();

  const count = parseCountInput();
  countInput.value = String(count);
  setStatus("Gerando emails...");

  try {
    const response = await fetch("/api/emails/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ count, domain: FIXED_DOMAIN })
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      setStatus(payload.error || `Erro ${response.status}: falha ao gerar emails.`);
      return;
    }

    setStatus(`${payload.count || count} email(s) gerado(s) com sucesso.`);
    await fetchMailboxes();
  } catch (_error) {
    setStatus("Sem conexao com o servidor. Confirme se o Node esta rodando.");
  }
}

async function onClearAll() {
  const accepted = await askClearConfirmation();
  if (!accepted) return;

  try {
    const response = await fetch("/api/emails", { method: "DELETE" });
    if (!response.ok) {
      setStatus("Falha ao limpar a lista.");
      return;
    }
  } catch (_error) {
    setStatus("Erro ao limpar a lista.");
    return;
  }

  setStatus("Lista limpa.");
  await fetchMailboxes();
}

function askClearConfirmation() {
  return new Promise((resolve) => {
    if (!confirmClearModal) {
      resolve(false);
      return;
    }

    const close = (result) => {
      confirmClearModal.classList.add("hidden");
      document.removeEventListener("keydown", onKeyDown);
      confirmClearCancelBtn?.removeEventListener("click", onCancel);
      confirmClearSubmitBtn?.removeEventListener("click", onConfirm);
      confirmClearModal.removeEventListener("click", onBackdropClick);
      resolve(result);
    };

    const onCancel = () => close(false);
    const onConfirm = () => close(true);
    const onBackdropClick = (event) => {
      if (event.target === confirmClearModal) close(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") close(false);
    };

    confirmClearModal.classList.remove("hidden");
    confirmClearCancelBtn?.focus();
    confirmClearCancelBtn?.addEventListener("click", onCancel);
    confirmClearSubmitBtn?.addEventListener("click", onConfirm);
    confirmClearModal.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

async function onCopyEmail(event) {
  const value = event.currentTarget.dataset.copy;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(`Email copiado: ${value}`);
  } catch (_error) {
    setStatus("Nao foi possivel copiar o email.");
  }
}

applyDomainField();
generateForm.addEventListener("submit", onGenerate);
refreshBtn.addEventListener("click", fetchMailboxes);
clearBtn.addEventListener("click", onClearAll);
fetchHealth();
fetchMailboxes();

setInterval(() => {
  if (document.visibilityState !== "visible") {
    return;
  }
  fetchMailboxes();
}, 5000);

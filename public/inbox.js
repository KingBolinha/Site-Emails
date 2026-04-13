const inboxForm = document.querySelector("#inbox-form");
const inboxEmailInput = document.querySelector("#inbox-email");
const inboxStatus = document.querySelector("#inbox-status");
const inboxRefresh = document.querySelector("#inbox-refresh");
const inboxCopy = document.querySelector("#inbox-copy");
const inboxPanel = document.querySelector("#inbox-panel");
const inboxAddress = document.querySelector("#inbox-address");
const inboxCodes = document.querySelector("#inbox-codes");
const inboxMessages = document.querySelector("#inbox-messages");

let currentEmail = "";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message) {
  inboxStatus.textContent = message;
}

function formatDate(value) {
  return new Date(value).toLocaleString("pt-BR");
}

function setUrlEmail(email) {
  const url = new URL(window.location.href);
  if (email) {
    url.searchParams.set("email", email);
  } else {
    url.searchParams.delete("email");
  }
  window.history.replaceState({}, "", url.toString());
}

async function fetchHealthDomain() {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) {
      return;
    }
    const payload = await response.json();
    if (payload.domain && !inboxEmailInput.value.trim()) {
      inboxEmailInput.placeholder = `usuario@${payload.domain}`;
    }
  } catch (_e) {
    /* ignore */
  }
}

function renderMailbox(mailbox) {
  currentEmail = mailbox.email || "";
  inboxAddress.textContent = currentEmail;

  const codes = mailbox.codes || [];
  if (!codes.length) {
    inboxCodes.innerHTML = '<li class="pill-empty">Nenhum codigo ainda</li>';
  } else {
    inboxCodes.innerHTML = codes
      .map(
        (c) =>
          `<li><button type="button" class="code-pill" data-copy="${escapeHtml(c.value)}">${escapeHtml(c.value)}</button></li>`
      )
      .join("");
  }

  const messages = mailbox.messages || [];
  if (!messages.length) {
    inboxMessages.innerHTML = '<p class="empty-msg">Nenhuma mensagem recebida ainda.</p>';
  } else {
    inboxMessages.innerHTML = messages
      .map((m) => {
        const when = formatDate(m.createdAt);
        const from = escapeHtml(m.from || "");
        const subject = escapeHtml(m.subject || "(sem assunto)");
        const body = escapeHtml(m.text || "");
        const code = m.parsedCode
          ? `<span class="parsed-chip">Codigo: ${escapeHtml(m.parsedCode)}</span>`
          : "";
        const rockstarBadge = m.rockstar
          ? '<span class="rockstar-badge">Rockstar / Social Club</span>'
          : "";
        return `
          <article class="msg-card">
            <header class="msg-card-head">
              <div class="msg-title-row">
                <strong>${subject}</strong>
                ${rockstarBadge}
              </div>
              <time>${when}</time>
            </header>
            <p class="msg-from">De: ${from}</p>
            <p class="msg-source">Origem: ${escapeHtml(m.source || "desconhecida")}</p>
            ${code ? `<p class="msg-code-line">${code}</p>` : ""}
            <pre class="msg-body">${body}</pre>
          </article>
        `;
      })
      .join("");
  }

  document.querySelectorAll(".code-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const v = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(v);
        setStatus(`Codigo copiado: ${v}`);
      } catch (_e) {
        setStatus("Nao foi possivel copiar.");
      }
    });
  });

  inboxPanel.classList.remove("hidden");
}

async function loadMailbox(email) {
  const trimmed = email.trim().toLowerCase();
  if (!trimmed) {
    setStatus("Digite um email.");
    return;
  }

  setStatus("Carregando...");
  try {
    const response = await fetch(
      `/api/mailbox?email=${encodeURIComponent(trimmed)}`
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      inboxPanel.classList.add("hidden");
      setStatus(payload.error || "Erro ao abrir a caixa.");
      return;
    }

    if (!payload.mailbox) {
      inboxPanel.classList.add("hidden");
      setStatus("Resposta invalida do servidor.");
      return;
    }

    renderMailbox(payload.mailbox);
    setStatus(`Caixa carregada: ${trimmed}`);
    setUrlEmail(trimmed);
  } catch (_e) {
    inboxPanel.classList.add("hidden");
    setStatus("Erro de rede ao carregar a caixa.");
  }
}

inboxForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadMailbox(inboxEmailInput.value);
});

inboxRefresh.addEventListener("click", () => {
  if (currentEmail) {
    loadMailbox(currentEmail);
  } else if (inboxEmailInput.value.trim()) {
    loadMailbox(inboxEmailInput.value);
  } else {
    setStatus("Digite um email e clique em Abrir caixa.");
  }
});

inboxCopy.addEventListener("click", async () => {
  const email = currentEmail || inboxEmailInput.value.trim();
  if (!email) {
    setStatus("Nada para copiar.");
    return;
  }
  try {
    await navigator.clipboard.writeText(email);
    setStatus(`Email copiado: ${email}`);
  } catch (_e) {
    setStatus("Nao foi possivel copiar.");
  }
});

function initFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get("email");
  if (email) {
    inboxEmailInput.value = email;
    loadMailbox(email);
  }
}

fetchHealthDomain();
initFromQuery();

// Auto refresh para o codigo aparecer sem clicar em "Atualizar".
setInterval(() => {
  if (document.visibilityState !== "visible") {
    return;
  }
  if (currentEmail) {
    loadMailbox(currentEmail);
  }
}, 5000);

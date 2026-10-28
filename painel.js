const onlyDigits = (value = "") => String(value).replace(/\D/g, "");
if (document.body.dataset.page === "cliente" && "serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js"));
const maskCnpj = (value) => onlyDigits(value).slice(0, 14).replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2");
const maskPhone = (value) => {
  const number = onlyDigits(value).slice(0, 11);
  if (number.length <= 10) return number.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return number.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};
const formatCnpj = (value) => maskCnpj(value);
const formatBytes = (bytes) => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const formatDate = (value) => new Intl.DateTimeFormat("pt-BR").format(new Date(value));
const formatDateTime = (value) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const newestDocumentsFirst = (documents) => [...documents].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
const whatsappNumber = (phone) => { const number = onlyDigits(phone); return number.startsWith("55") ? number : `55${number}`; };
const formatDueDate = (value) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
const dueDateStatus = (value) => {
  if (!value) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(`${value}T00:00:00`);
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { className: "overdue", text: `Vencido em ${formatDueDate(value)}` };
  if (days === 0) return { className: "due-today", text: "Vence hoje" };
  return { className: "upcoming", text: `Vence em ${formatDueDate(value)}` };
};
const validCnpj = (value) => {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const check = (length) => {
    let sum = 0, weight = length - 7;
    for (let index = 0; index < length; index += 1) { sum += Number(cnpj[index]) * weight--; if (weight < 2) weight = 9; }
    const result = 11 - (sum % 11);
    return Number(cnpj[length]) === (result > 9 ? 0 : result);
  };
  return check(12) && check(13);
};
const api = async (url, options = {}) => {
  const response = await fetch(url, options);
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a operação.");
  return data;
};
const jsonOptions = (method, body) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const attachMasks = (cnpjInput, phoneInput) => {
  cnpjInput?.addEventListener("input", () => { cnpjInput.value = maskCnpj(cnpjInput.value); });
  phoneInput?.addEventListener("input", () => { phoneInput.value = maskPhone(phoneInput.value); });
};
const createElement = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
const setupPasswordVisibility = () => {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.parentElement?.classList.contains("password-field")) return;
    const wrapper = createElement("div", "password-field");
    input.before(wrapper); wrapper.append(input);
    const button = createElement("button", "password-toggle");
    button.type = "button"; button.setAttribute("aria-label", "Mostrar senha"); button.setAttribute("aria-pressed", "false"); button.title = "Mostrar senha";
    button.append(createElement("span", "password-eye")); wrapper.append(button);
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.setAttribute("aria-label", show ? "Ocultar senha" : "Mostrar senha");
      button.setAttribute("aria-pressed", String(show));
      button.title = show ? "Ocultar senha" : "Mostrar senha";
      input.focus();
    });
  });
};
const setupPasswordRecovery = (role) => {
  const dialog = document.querySelector("#recovery-dialog"); const requestForm = document.querySelector("#recovery-request-form"); const confirmForm = document.querySelector("#recovery-confirm-form"); const devCode = document.querySelector("#recovery-dev-code"); const openButton = document.querySelector(`[data-forgot-password="${role}"]`); let recoveryEmail = "";
  if (!dialog || !requestForm || !confirmForm || !devCode || !openButton) return;
  openButton.addEventListener("click", () => { requestForm.reset(); confirmForm.reset(); requestForm.hidden = false; confirmForm.hidden = true; devCode.hidden = true; document.querySelector("#recovery-request-error").textContent = ""; document.querySelector("#recovery-confirm-error").textContent = ""; if (!dialog.open) dialog.showModal(); document.querySelector("#recovery-email").focus(); });
  document.querySelector("[data-close-recovery]").addEventListener("click", () => dialog.close());
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const error = document.querySelector("#recovery-request-error"); const submitButton = requestForm.querySelector('[type="submit"]'); error.textContent = ""; recoveryEmail = document.querySelector("#recovery-email").value.trim(); submitButton.disabled = true; submitButton.textContent = "Enviando...";
    try { const result = await api("/api/password-recovery/request", jsonOptions("POST", { role, email: recoveryEmail })); requestForm.hidden = true; confirmForm.hidden = false; if (result.developmentCode) { devCode.textContent = `Código local de teste: ${result.developmentCode}`; devCode.hidden = false; } }
    catch (exception) { error.textContent = exception.message; }
    finally { submitButton.disabled = false; submitButton.textContent = "Enviar código"; }
  });
  confirmForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const error = document.querySelector("#recovery-confirm-error"); error.textContent = "";
    try { await api("/api/password-recovery/confirm", jsonOptions("POST", { role, email: recoveryEmail, code: document.querySelector("#recovery-code").value, password: document.querySelector("#recovery-password").value })); dialog.close(); alert("Senha redefinida. Você já pode entrar com a nova senha."); }
    catch (exception) { error.textContent = exception.message; }
  });
};

async function initializeAccountant() {
  setupPasswordRecovery("admin");
  const loginSection = document.querySelector("#admin-login");
  const dashboard = document.querySelector("#admin-dashboard");
  const loginForm = document.querySelector("#admin-login-form");
  const logoutButton = document.querySelector("#admin-sair");
  const devCredentials = document.querySelector("#dev-credentials");
  const clientDialog = document.querySelector("#cliente-dialog");
  const documentDialog = document.querySelector("#documentos-dialog");
  const usersDialog = document.querySelector("#usuarios-dialog");
  const clientForm = document.querySelector("#cliente-form");
  const documentForm = document.querySelector("#documento-form");
  const userForm = document.querySelector("#usuario-form");
  const cnpjInput = document.querySelector("#cnpj");
  const phoneInput = document.querySelector("#telefone");
  let clients = [];
  let documentClientId = null;
  attachMasks(cnpjInput, phoneInput);

  const notify = (message) => { const toast = document.querySelector("#toast"); toast.textContent = message; toast.classList.add("visible"); setTimeout(() => toast.classList.remove("visible"), 2600); };
  const showDashboard = async () => { loginSection.hidden = true; dashboard.hidden = false; logoutButton.hidden = false; await loadClients(); };
  const showLogin = () => { loginSection.hidden = false; dashboard.hidden = true; logoutButton.hidden = true; };

  const clientButton = (label, action, className = "") => { const button = createElement("button", `action-button ${className}`.trim(), label); button.type = "button"; button.dataset.action = action; return button; };
  const renderClients = () => {
    const query = document.querySelector("#busca").value.trim().toLowerCase();
    const status = document.querySelector("#filtro-status").value;
    const filtered = clients.filter((client) => {
      const matchesQuery = [client.cnpj, formatCnpj(client.cnpj), client.companyName, client.phone, client.email].some((value) => String(value).toLowerCase().includes(query));
      return matchesQuery && (status === "todos" || (status === "ativo") === client.active);
    });
    const list = document.querySelector("#lista-clientes"); list.replaceChildren();
    filtered.forEach((client) => {
      const row = createElement("article", "client-row"); row.dataset.id = client.id;
      const identity = createElement("div", "client-identity"); identity.append(createElement("strong", "", client.companyName), createElement("span", "", formatCnpj(client.cnpj)), createElement("span", `status ${client.active ? "active" : "inactive"}`, client.active ? "Ativo" : "Inativo"));
      const contact = createElement("div", "client-contact"); contact.append(createElement("span", "", `Telefone: ${client.phone}`), createElement("span", "", `E-mail: ${client.email}`), createElement("span", "", `Documentos: ${client.documentCount}`));
      const actions = createElement("div", "client-actions"); actions.append(clientButton("Documentos", "documents"), clientButton("Editar", "edit"), clientButton(client.active ? "Inativar" : "Reativar", "status", client.active ? "danger-button" : ""));
      row.append(identity, contact, actions); list.append(row);
    });
    document.querySelector("#estado-vazio").hidden = filtered.length > 0;
    document.querySelector("#total-clientes").textContent = clients.length;
    document.querySelector("#clientes-ativos").textContent = clients.filter((client) => client.active).length;
    document.querySelector("#clientes-inativos").textContent = clients.filter((client) => !client.active).length;
  };
  async function loadClients() { clients = await api("/api/clients"); renderClients(); }
  const openClientForm = (client) => {
    clientForm.reset(); document.querySelector("#cnpj-error").textContent = "";
    document.querySelector("#cliente-id").value = client?.id || "";
    document.querySelector("#form-title").textContent = client ? "Editar cliente" : "Novo cliente";
    const passwordInput = document.querySelector("#cliente-senha"); passwordInput.required = !client; document.querySelector("#senha-help").textContent = client ? "Deixe em branco para manter a senha atual." : "Use pelo menos 8 caracteres.";
    if (client) { cnpjInput.value = formatCnpj(client.cnpj); document.querySelector("#razao-social").value = client.companyName; phoneInput.value = client.phone; document.querySelector("#email").value = client.email; }
    clientDialog.showModal();
  };
  const renderDocuments = async () => {
    const documents = await api(`/api/clients/${documentClientId}/documents`);
    const documentClient = clients.find((client) => client.id === documentClientId);
    const list = document.querySelector("#lista-documentos"); list.replaceChildren();
    if (!documents.length) { list.append(createElement("p", "field-help", "Nenhum documento cadastrado.")); return; }
    newestDocumentsFirst(documents).forEach((document) => {
      const item = createElement("div", "document-item"); const info = createElement("div");
      info.append(createElement("strong", "", document.name), createElement("small", "", `${formatDate(document.createdAt)} · ${formatBytes(document.size)}`));
      info.append(createElement("small", "uploader-name", `Adicionado por ${document.uploadedByName || "Equipe"}`));
      const dueStatus = dueDateStatus(document.dueDate); if (dueStatus) info.append(createElement("span", `due-date ${dueStatus.className}`, dueStatus.text));
      info.append(createElement("span", `download-status ${document.downloadedAt ? "downloaded" : "pending"}`, document.downloadedAt ? `Baixado pelo cliente em ${formatDateTime(document.downloadedAt)}${document.downloadCount > 1 ? ` · ${document.downloadCount} downloads` : ""}` : "Ainda não baixado pelo cliente"));
      const actions = createElement("div", "document-actions");
      const whatsapp = createElement("a", "action-button whatsapp-button"); whatsapp.href = `https://wa.me/${whatsappNumber(documentClient.phone)}?text=${encodeURIComponent("Olá! Existem novos documentos anexados no seu Painel do Cliente Andressa Alves Contabilidade.")}`; whatsapp.target = "_blank"; whatsapp.rel = "noopener noreferrer"; whatsapp.title = "Avisar cliente pelo WhatsApp"; whatsapp.setAttribute("aria-label", `Avisar ${documentClient.companyName} pelo WhatsApp`); const whatsappIcon = createElement("img"); whatsappIcon.src = "wh.png"; whatsappIcon.alt = ""; whatsapp.append(whatsappIcon);
      const download = createElement("a", "action-button", "Baixar"); download.href = `/api/clients/${documentClientId}/documents/${document.id}/download`;
      const remove = clientButton("Excluir", "delete-document", "danger-button"); remove.dataset.documentId = document.id; actions.append(download, remove); item.append(info, actions); list.append(item);
      actions.prepend(whatsapp);
    });
  };
  const loadUsers = async () => {
    const users = await api("/api/admin/users"); const list = document.querySelector("#lista-usuarios"); list.replaceChildren();
    if (!users.length) { list.append(createElement("p", "field-help", "Nenhum usuário adicional cadastrado.")); return; }
    users.forEach((user) => { const item = createElement("div", "user-item"); item.dataset.id = user.id; const info = createElement("div"); info.append(createElement("strong", "", user.name), createElement("span", "", user.email), createElement("span", `status ${user.active ? "active" : "inactive"}`, user.active ? "Ativo" : "Bloqueado")); const actions = createElement("div", "user-actions"); const edit = clientButton("Editar", "edit-user"); const status = clientButton(user.active ? "Bloquear" : "Reativar", "status-user", user.active ? "danger-button" : ""); status.disabled = user.current; if (user.current) status.title = "Não é possível bloquear o usuário da sessão atual"; actions.append(edit, status); item.append(info, actions); list.append(item); });
    list.dataset.users = JSON.stringify(users);
  };
  const prepareNewUser = () => { userForm.reset(); document.querySelector("#usuario-id").value = ""; document.querySelector("#usuario-senha").required = true; document.querySelector("#usuario-senha-help").textContent = "Use pelo menos 8 caracteres."; document.querySelector("#salvar-usuario").textContent = "Cadastrar usuário"; document.querySelector("#usuario-error").textContent = ""; };
  const prepareEditUser = (user) => { userForm.reset(); document.querySelector("#usuario-id").value = user.id; document.querySelector("#usuario-nome").value = user.name; document.querySelector("#usuario-email").value = user.email; document.querySelector("#usuario-senha").required = false; document.querySelector("#usuario-senha-help").textContent = "Deixe em branco para manter a senha atual."; document.querySelector("#salvar-usuario").textContent = "Salvar alterações"; document.querySelector("#usuario-error").textContent = ""; };

  loginForm.addEventListener("submit", async (event) => { event.preventDefault(); const error = document.querySelector("#admin-login-error"); error.textContent = ""; try { await api("/api/admin/login", jsonOptions("POST", { email: document.querySelector("#admin-email").value, password: document.querySelector("#admin-password").value })); loginForm.reset(); await showDashboard(); } catch (exception) { error.textContent = exception.message; } });
  logoutButton.addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); showLogin(); });
  document.querySelector("#novo-cliente").addEventListener("click", () => openClientForm());
  document.querySelector("#gerenciar-usuarios").addEventListener("click", async () => { prepareNewUser(); await loadUsers(); usersDialog.showModal(); });
  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => clientDialog.close()));
  document.querySelector("[data-close-docs]").addEventListener("click", () => documentDialog.close());
  document.querySelector("[data-close-users]").addEventListener("click", () => usersDialog.close());
  document.querySelector("#busca").addEventListener("input", renderClients); document.querySelector("#filtro-status").addEventListener("change", renderClients);
  clientForm.addEventListener("submit", async (event) => {
    event.preventDefault(); const error = document.querySelector("#cnpj-error"); error.textContent = "";
    if (!validCnpj(cnpjInput.value)) { error.textContent = "Informe um CNPJ válido."; cnpjInput.focus(); return; }
    const id = document.querySelector("#cliente-id").value; const payload = { cnpj: cnpjInput.value, companyName: document.querySelector("#razao-social").value, phone: phoneInput.value, email: document.querySelector("#email").value, password: document.querySelector("#cliente-senha").value };
    try { await api(id ? `/api/clients/${id}` : "/api/clients", jsonOptions(id ? "PUT" : "POST", payload)); clientDialog.close(); await loadClients(); notify(id ? "Cliente atualizado." : "Cliente cadastrado."); } catch (exception) { error.textContent = exception.message; }
  });
  document.querySelector("#lista-clientes").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]"); if (!button) return; const client = clients.find((item) => item.id === button.closest(".client-row").dataset.id); if (!client) return;
    if (button.dataset.action === "edit") openClientForm(client);
    if (button.dataset.action === "status") { await api(`/api/clients/${client.id}/status`, jsonOptions("PATCH", { active: !client.active })); await loadClients(); notify(client.active ? "Cliente inativado. O acesso foi bloqueado." : "Cliente reativado."); }
    if (button.dataset.action === "documents") { documentClientId = client.id; document.querySelector("#docs-client-name").textContent = `${client.companyName} · ${formatCnpj(client.cnpj)}`; documentForm.reset(); await renderDocuments(); documentDialog.showModal(); }
  });
  documentForm.addEventListener("submit", async (event) => { event.preventDefault(); const file = document.querySelector("#documento-arquivo").files[0]; if (!file) return; const data = new FormData(); data.append("name", document.querySelector("#documento-nome").value); data.append("dueDate", document.querySelector("#documento-vencimento").value); data.append("file", file); try { await api(`/api/clients/${documentClientId}/documents`, { method: "POST", body: data }); documentForm.reset(); await renderDocuments(); await loadClients(); notify("Documento adicionado."); } catch (exception) { notify(exception.message); } });
  document.querySelector("#lista-documentos").addEventListener("click", async (event) => { const button = event.target.closest('[data-action="delete-document"]'); if (!button || !confirm("Excluir este documento permanentemente?")) return; await api(`/api/clients/${documentClientId}/documents/${button.dataset.documentId}`, { method: "DELETE" }); await renderDocuments(); await loadClients(); notify("Documento excluído."); });
  userForm.addEventListener("submit", async (event) => { event.preventDefault(); const error = document.querySelector("#usuario-error"); error.textContent = ""; const id = document.querySelector("#usuario-id").value; try { await api(id ? `/api/admin/users/${id}` : "/api/admin/users", jsonOptions(id ? "PUT" : "POST", { name: document.querySelector("#usuario-nome").value, email: document.querySelector("#usuario-email").value, password: document.querySelector("#usuario-senha").value })); prepareNewUser(); await loadUsers(); notify(id ? "Usuário atualizado." : "Usuário cadastrado. O acesso já está liberado."); } catch (exception) { error.textContent = exception.message; } });
  document.querySelector("#lista-usuarios").addEventListener("click", async (event) => { const button = event.target.closest("[data-action]"); if (!button) return; const item = button.closest(".user-item"); const users = JSON.parse(document.querySelector("#lista-usuarios").dataset.users || "[]"); const user = users.find((entry) => entry.id === item.dataset.id); if (!user) return; if (button.dataset.action === "edit-user") prepareEditUser(user); if (button.dataset.action === "status-user") { try { await api(`/api/admin/users/${user.id}/status`, jsonOptions("PATCH", { active: !user.active })); await loadUsers(); notify(user.active ? "Usuário bloqueado." : "Usuário reativado."); } catch (exception) { notify(exception.message); } } });

  try { const session = await api("/api/admin/session"); devCredentials.hidden = !session.developmentCredentials; session.authenticated ? await showDashboard() : showLogin(); } catch { showLogin(); }
}

async function initializeClient() {
  setupPasswordRecovery("client");
  const form = document.querySelector("#acesso-form"); const login = document.querySelector("#acesso-section"); const dashboard = document.querySelector("#cliente-dashboard");
  const showLogin = (message = "") => { login.hidden = false; dashboard.hidden = true; document.querySelector("#acesso-error").textContent = message; };
  const renderClientDocuments = (documents, container, expired) => {
    container.replaceChildren();
    if (!documents.length) { container.append(createElement("p", "empty-documents", expired ? "Nenhuma guia passada." : "Nenhum documento disponível no momento.")); return; }
    documents.forEach((document) => {
      const item = createElement("article", `client-document${expired ? " expired" : ""}`); const info = createElement("div");
      info.append(createElement("strong", "", document.name), createElement("span", "", `${formatDate(document.createdAt)} · ${formatBytes(document.size)}`), createElement("span", "uploader-name", `Adicionado por ${document.uploadedByName || "Equipe"}`));
      const dueStatus = dueDateStatus(document.dueDate); if (dueStatus) info.append(createElement("span", `due-date ${dueStatus.className}`, dueStatus.text));
      if (expired) { info.append(createElement("span", "expired-label", "Disponibilidade encerrada após 30 dias")); const unavailable = createElement("span", "download-unavailable", "Download indisponível"); item.append(info, unavailable); }
      else { const link = createElement("a", "primary-button", "Baixar"); link.href = `/api/client/documents/${document.id}/download`; item.append(info, link); }
      container.append(item);
    });
  };
  const showDashboard = (client) => {
    login.hidden = true; dashboard.hidden = false; document.querySelector("#cliente-razao").textContent = client.companyName; document.querySelector("#cliente-cnpj").textContent = formatCnpj(client.cnpj);
    const sortedDocuments = newestDocumentsFirst(client.documents);
    const currentDocuments = sortedDocuments.filter((document) => !document.expired); const pastDocuments = sortedDocuments.filter((document) => document.expired);
    document.querySelector("#total-atuais").textContent = currentDocuments.length; document.querySelector("#total-passadas").textContent = pastDocuments.length;
    renderClientDocuments(currentDocuments, document.querySelector("#documentos-atuais"), false); renderClientDocuments(pastDocuments, document.querySelector("#documentos-passados"), true);
  };
  const loadSession = async () => { try { showDashboard(await api("/api/client/me")); } catch (exception) { showLogin(exception.message.includes("inativo") ? exception.message : ""); } };
  form.addEventListener("submit", async (event) => { event.preventDefault(); const error = document.querySelector("#acesso-error"); error.textContent = ""; try { await api("/api/client/login", jsonOptions("POST", { identifier: document.querySelector("#acesso-identificador").value, password: document.querySelector("#acesso-senha").value })); await loadSession(); } catch (exception) { error.textContent = exception.message; } });
  document.querySelector("#sair").addEventListener("click", async () => { await api("/api/logout", { method: "POST" }); form.reset(); showLogin(); });
  document.querySelectorAll(".document-tab").forEach((tabButton) => tabButton.addEventListener("click", () => {
    const showPast = tabButton.id === "tab-passadas";
    document.querySelectorAll(".document-tab").forEach((button) => { const selected = button === tabButton; button.classList.toggle("active", selected); button.setAttribute("aria-selected", String(selected)); });
    document.querySelector("#documentos-atuais").hidden = showPast; document.querySelector("#documentos-passados").hidden = !showPast;
  }));
  await loadSession();
}

setupPasswordVisibility();
if (document.body.dataset.page === "equipe") initializeAccountant();
if (document.body.dataset.page === "cliente") initializeClient();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const { Readable } = require("stream");
const { del: deleteBlob, get: getBlob, list: listBlobs, put: putBlob } = require("@vercel/blob");
const cookieSession = require("cookie-session");
const express = require("express");
const multer = require("multer");

const app = express();
app.set("trust proxy", 1);
const port = Number(process.env.PORT) || 8080;
const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const uploadDir = path.join(dataDir, "uploads");
const dbPath = path.join(dataDir, "db.json");
const useBlobStorage = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const databasePrefix = "andressa-alves/database/";
const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "";
const smtpConfigured = Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
const production = process.env.NODE_ENV === "production";
const sessionSecret = process.env.SESSION_SECRET || "desenvolvimento-andressa-alves-altere-em-producao";
if (production && sessionSecret.length < 32) console.warn("[segurança] Configure SESSION_SECRET com pelo menos 32 caracteres.");
const sanitizeHeader = (value) => String(value).replace(/[\r\n]/g, " ");
const sendRecoveryEmail = (to, name, code) => new Promise((resolve, reject) => {
  const host = String(process.env.SMTP_HOST || "").trim(); const port = Number(process.env.SMTP_PORT) || 465; const user = String(process.env.SMTP_USER || "").trim(); const password = String(process.env.SMTP_PASSWORD || "").trim().replace(/\s+/g, ""); const from = String(process.env.SMTP_FROM || user).trim();
  const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true }); let buffer = ""; const waiting = []; const pendingResponses = [];
  const settleResponses = () => { const lines = buffer.split("\r\n"); buffer = lines.pop(); for (const line of lines) { if (/^\d{3} /.test(line)) { if (waiting.length) waiting.shift()(line); else pendingResponses.push(line); } } };
  socket.on("data", (chunk) => { buffer += chunk.toString("utf8"); settleResponses(); }); socket.on("error", reject); socket.setTimeout(15000, () => socket.destroy(new Error("Tempo limite do SMTP excedido.")));
  const response = () => pendingResponses.length ? Promise.resolve(pendingResponses.shift()) : new Promise((done) => waiting.push(done));
  const command = async (value, accepted = /^[23]/) => { if (value !== null) socket.write(`${value}\r\n`); const line = await response(); if (!accepted.test(line)) throw new Error(`SMTP recusou a operação: ${line.slice(0, 3)}`); return line; };
  socket.once("secureConnect", async () => {
    try {
      await command(null); await command(`EHLO ${sanitizeHeader(host)}`); await command("AUTH LOGIN", /^334/); await command(Buffer.from(user).toString("base64"), /^334/); await command(Buffer.from(password).toString("base64"), /^235/); await command(`MAIL FROM:<${sanitizeHeader(from)}>`); await command(`RCPT TO:<${sanitizeHeader(to)}>`); await command("DATA", /^354/);
      const subject = "Código de recuperação - Andressa Alves Contabilidade"; const body = `Olá, ${name}.\r\n\r\nSeu código de recuperação é ${code}.\r\nEle expira em 15 minutos.\r\n\r\nSe você não solicitou esta alteração, ignore esta mensagem.`;
      socket.write(`From: Andressa Alves Contabilidade <${sanitizeHeader(from)}>\r\nTo: ${sanitizeHeader(to)}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body.replace(/^\./gm, "..")}\r\n.\r\n`);
      await command(null); socket.write("QUIT\r\n"); socket.end(); resolve();
    } catch (error) { socket.destroy(); reject(error); }
  });
});

const createEmptyDb = () => ({ schemaVersion: 1, clients: [], users: [], passwordResets: [] });

if (!useBlobStorage) {
  fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(createEmptyDb(), null, 2));
}

const readDb = async () => {
  if (!useBlobStorage) return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  const result = await listBlobs({ prefix: databasePrefix, limit: 1000 });
  const latest = result.blobs.sort((left, right) => right.pathname.localeCompare(left.pathname))[0];
  if (!latest) return createEmptyDb();
  const stored = await getBlob(latest.pathname, { access: "private" });
  if (!stored?.stream) throw new Error("Não foi possível carregar o banco de dados.");
  return JSON.parse(await new Response(stored.stream).text());
};
const writeDb = async (db) => {
  if (useBlobStorage) {
    const version = `${String(Date.now()).padStart(13, "0")}-${crypto.randomUUID()}.json`;
    await putBlob(`${databasePrefix}${version}`, JSON.stringify(db), { access: "private", contentType: "application/json", addRandomSuffix: false });
    return;
  }
  const temporaryPath = `${dbPath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(db, null, 2));
  fs.renameSync(temporaryPath, dbPath);
};
const digits = (value = "") => String(value).replace(/\D/g, "");
const normalizeEmail = (value = "") => String(value).trim().toLowerCase();
const publicClient = ({ documents, passwordHash, ...client }) => ({ ...client, documentCount: documents.length });
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
};
const verifyPassword = (password, storedHash = "") => {
  const [salt, hash] = storedHash.split(":");
  const passwordText = String(password || "");
  if (!salt || !/^[a-f\d]{128}$/i.test(hash || "") || passwordText.length > 128) return false;
  const supplied = crypto.scryptSync(passwordText, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
};
const validPassword = (password) => String(password || "").length >= 8 && String(password).length <= 128;
const documentAvailabilityDays = 30;
const isDocumentExpired = (document) => Date.now() >= new Date(document.createdAt).getTime() + documentAvailabilityDays * 24 * 60 * 60 * 1000;
const newestDocumentsFirst = (documents) => [...documents].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
const validCnpj = (value) => {
  const cnpj = digits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const check = (length) => {
    let sum = 0;
    let weight = length - 7;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cnpj[index]) * weight--;
      if (weight < 2) weight = 9;
    }
    const result = 11 - (sum % 11);
    return Number(cnpj[length]) === (result > 9 ? 0 : result);
  };
  return check(12) && check(13);
};

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src 'self'; base-uri 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  if (production) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "100kb", strict: true }));
app.use(cookieSession({ name: "andressa_alves_session", keys: [sessionSecret], httpOnly: true, sameSite: "strict", secure: production, maxAge: 8 * 60 * 60 * 1000, overwrite: true }));
app.use("/api", (req, res, next) => {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  try { if (new URL(origin).host === req.get("host")) return next(); } catch {}
  return res.status(403).json({ error: "Origem da requisição não autorizada." });
});

const rateLimitBuckets = new Map();
const rateLimit = ({ limit, windowMs }) => (req, res, next) => {
  const now = Date.now(); const key = `${req.ip}:${req.path}`; let bucket = rateLimitBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; rateLimitBuckets.set(key, bucket); }
  bucket.count += 1;
  res.setHeader("RateLimit-Limit", String(limit)); res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - bucket.count))); res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count <= limit) return next();
  res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
  return res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." });
};
const loginRateLimit = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000 });
const recoveryRequestRateLimit = rateLimit({ limit: 5, windowMs: 60 * 60 * 1000 });
const recoveryConfirmRateLimit = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000 });
const rateLimitCleanup = setInterval(() => { const now = Date.now(); for (const [key, bucket] of rateLimitBuckets) if (bucket.resetAt <= now) rateLimitBuckets.delete(key); }, 15 * 60 * 1000);
rateLimitCleanup.unref();
app.use(async (req, _res, next) => {
  if (!req.path.startsWith("/api/")) return next();
  try {
    req.db = await readDb();
    if (!Array.isArray(req.db.users)) req.db.users = [];
    if (!Array.isArray(req.db.passwordResets)) req.db.passwordResets = [];
    next();
  }
  catch (error) { next(error); }
});

const requireAdmin = (req, res, next) => {
  if (req.session.role !== "admin") return res.status(401).json({ error: "Acesso administrativo necessário." });
  if (req.session.adminUserId) {
    const user = req.db.users.find((item) => item.id === req.session.adminUserId);
    if (!user || user.active === false) { req.session = null; return res.status(403).json({ error: "Este usuário está bloqueado." }); }
    req.adminUser = user;
  }
  next();
};
const requireClient = (req, res, next) => {
  if (req.session.role !== "client" || !req.session.clientId) return res.status(401).json({ error: "Acesso do cliente necessário." });
  const client = req.db.clients.find((item) => item.id === req.session.clientId);
  if (!client || !client.active) {
    req.session = null;
    return res.status(403).json({ error: "Este cliente está inativo. Entre em contato com a Andressa Alves Contabilidade." });
  }
  req.client = client;
  next();
};

app.post("/api/admin/login", loginRateLimit, (req, res) => {
  const email = normalizeEmail(req.body.email); const password = String(req.body.password || "");
  const databaseUser = req.db.users.find((user) => user.email === email);
  const environmentAccess = !databaseUser && Boolean(adminEmail && adminPassword) && email === adminEmail && password.length === adminPassword.length && crypto.timingSafeEqual(Buffer.from(password), Buffer.from(adminPassword));
  if (!environmentAccess && (!databaseUser || databaseUser.active === false || !verifyPassword(password, databaseUser.passwordHash))) return res.status(401).json({ error: "E-mail ou senha inválidos." });
  req.session = { role: "admin", adminUserId: databaseUser?.id || null, adminName: databaseUser?.name || "Equipe" }; res.json({ ok: true });
});
app.get("/api/admin/session", (req, res) => {
  let authenticated = req.session.role === "admin";
  if (authenticated && req.session.adminUserId) authenticated = req.db.users.some((user) => user.id === req.session.adminUserId && user.active !== false);
  if (!authenticated && req.session.role === "admin") req.session = null;
  res.json({ authenticated, developmentCredentials: false });
});
app.post("/api/logout", (req, res) => { req.session = null; res.json({ ok: true }); });

app.post("/api/password-recovery/request", recoveryRequestRateLimit, async (req, res) => {
  const email = normalizeEmail(req.body.email); const role = req.body.role === "admin" ? "admin" : "client"; const db = req.db;
  const account = role === "admin" ? (adminEmail && email === adminEmail ? { name: "Equipe", email } : db.users.find((user) => user.email === email)) : db.clients.find((client) => client.email === email);
  const genericMessage = "Se o e-mail estiver cadastrado, você receberá um código de recuperação.";
  if (!account) return res.json({ message: genericMessage });
  const key = `${role}:${email}`; const now = Date.now();
  db.passwordResets = db.passwordResets.filter((item) => item.expiresAt > now);
  const previous = db.passwordResets.find((item) => item.key === key);
  if (previous && now - previous.requestedAt < 60000) return res.json({ message: genericMessage });
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  db.passwordResets = db.passwordResets.filter((item) => item.key !== key);
  db.passwordResets.push({ key, codeHash: hashPassword(code), expiresAt: now + 15 * 60 * 1000, requestedAt: now, attempts: 0 });
  await writeDb(db);
  if (smtpConfigured) {
    try { await sendRecoveryEmail(email, account.name || account.companyName, code); }
    catch (error) {
      db.passwordResets = db.passwordResets.filter((item) => item.key !== key);
      await writeDb(db);
      console.error("Não foi possível enviar o e-mail de recuperação:", error.message);
      return res.status(502).json({ error: "Não foi possível enviar o código agora. Verifique a configuração de e-mail ou tente novamente em alguns minutos." });
    }
  } else {
    console.log(`[desenvolvimento] Código de recuperação para ${email}: ${code}`);
  }
  res.json({ message: genericMessage, developmentCode: process.env.NODE_ENV !== "production" && !smtpConfigured ? code : undefined });
});

app.post("/api/password-recovery/confirm", recoveryConfirmRateLimit, async (req, res) => {
  const email = normalizeEmail(req.body.email); const role = req.body.role === "admin" ? "admin" : "client"; const code = String(req.body.code || ""); const password = String(req.body.password || ""); const key = `${role}:${email}`; const db = req.db; const recovery = db.passwordResets.find((item) => item.key === key);
  if (!validPassword(password)) return res.status(400).json({ error: "A nova senha deve ter entre 8 e 128 caracteres." });
  if (!recovery || recovery.expiresAt < Date.now() || recovery.attempts >= 5) {
    db.passwordResets = db.passwordResets.filter((item) => item.key !== key);
    await writeDb(db);
    return res.status(400).json({ error: "Código inválido ou expirado. Solicite um novo código." });
  }
  recovery.attempts += 1;
  if (!verifyPassword(code, recovery.codeHash)) {
    await writeDb(db);
    return res.status(400).json({ error: "Código inválido ou expirado. Solicite um novo código." });
  }
  if (role === "client") {
    const client = db.clients.find((item) => item.email === email); if (!client) return res.status(400).json({ error: "Não foi possível redefinir a senha." }); client.passwordHash = hashPassword(password); client.updatedAt = new Date().toISOString();
  } else {
    let user = db.users.find((item) => item.email === email);
    if (!user && email === adminEmail) { user = { id: crypto.randomUUID(), name: "Equipe", email, createdAt: new Date().toISOString() }; db.users.push(user); }
    if (!user) return res.status(400).json({ error: "Não foi possível redefinir a senha." }); user.passwordHash = hashPassword(password); user.updatedAt = new Date().toISOString();
  }
  db.passwordResets = db.passwordResets.filter((item) => item.key !== key);
  await writeDb(db); res.json({ message: "Senha redefinida com sucesso." });
});

app.get("/api/admin/users", requireAdmin, (req, res) => res.json(req.db.users.map(({ passwordHash, ...user }) => ({ ...user, active: user.active !== false, current: user.id === req.session.adminUserId }))));
app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const name = String(req.body.name || "").trim(); const email = normalizeEmail(req.body.email); const password = String(req.body.password || "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email) || !validPassword(password)) return res.status(400).json({ error: "Informe nome, e-mail válido e senha entre 8 e 128 caracteres." });
  const db = req.db;
  if (email === adminEmail || db.users.some((user) => user.email === email)) return res.status(409).json({ error: "Este e-mail já possui acesso ao painel." });
  const user = { id: crypto.randomUUID(), name, email, passwordHash: hashPassword(password), active: true, createdAt: new Date().toISOString() };
  db.users.push(user); await writeDb(db); const { passwordHash, ...publicUser } = user; res.status(201).json(publicUser);
});
app.put("/api/admin/users/:id", requireAdmin, async (req, res) => {
  const db = req.db; const user = db.users.find((item) => item.id === req.params.id); if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  const name = String(req.body.name || "").trim(); const email = normalizeEmail(req.body.email); const password = String(req.body.password || "");
  if (!name || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Informe nome e e-mail válidos." });
  if (email === adminEmail || db.users.some((item) => item.id !== user.id && item.email === email)) return res.status(409).json({ error: "Este e-mail já possui acesso ao painel." });
  if (password && !validPassword(password)) return res.status(400).json({ error: "A nova senha deve ter entre 8 e 128 caracteres." });
  Object.assign(user, { name, email, updatedAt: new Date().toISOString() }); if (password) user.passwordHash = hashPassword(password); await writeDb(db);
  const { passwordHash, ...publicUser } = user; res.json(publicUser);
});
app.patch("/api/admin/users/:id/status", requireAdmin, async (req, res) => {
  if (req.params.id === req.session.adminUserId) return res.status(400).json({ error: "Você não pode bloquear o usuário da sessão atual." });
  const db = req.db; const user = db.users.find((item) => item.id === req.params.id); if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  user.active = Boolean(req.body.active); user.updatedAt = new Date().toISOString(); await writeDb(db); res.json({ id: user.id, active: user.active });
});

app.get("/api/clients", requireAdmin, (req, res) => res.json(req.db.clients.map(publicClient)));
app.post("/api/clients", requireAdmin, async (req, res) => {
  const cnpj = digits(req.body.cnpj);
  const email = normalizeEmail(req.body.email);
  if (!validCnpj(cnpj)) return res.status(400).json({ error: "Informe um CNPJ válido." });
  if (!String(req.body.companyName || "").trim() || !digits(req.body.phone) || !/^\S+@\S+\.\S+$/.test(email) || !validPassword(req.body.password)) return res.status(400).json({ error: "Preencha todos os dados e use uma senha entre 8 e 128 caracteres." });
  const db = req.db;
  if (db.clients.some((client) => client.cnpj === cnpj)) return res.status(409).json({ error: "Este CNPJ já está cadastrado." });
  if (db.clients.some((client) => client.email === email)) return res.status(409).json({ error: "Este e-mail já está cadastrado." });
  const client = { id: crypto.randomUUID(), cnpj, companyName: String(req.body.companyName).trim(), phone: String(req.body.phone).trim(), email, passwordHash: hashPassword(String(req.body.password)), active: true, createdAt: new Date().toISOString(), documents: [] };
  db.clients.push(client); await writeDb(db); res.status(201).json(publicClient(client));
});
app.put("/api/clients/:id", requireAdmin, async (req, res) => {
  const db = req.db;
  const client = db.clients.find((item) => item.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  const cnpj = digits(req.body.cnpj); const email = normalizeEmail(req.body.email);
  if (!validCnpj(cnpj)) return res.status(400).json({ error: "Informe um CNPJ válido." });
  if (db.clients.some((item) => item.id !== client.id && item.cnpj === cnpj)) return res.status(409).json({ error: "Este CNPJ já está cadastrado." });
  if (db.clients.some((item) => item.id !== client.id && item.email === email)) return res.status(409).json({ error: "Este e-mail já está cadastrado." });
  if (!String(req.body.companyName || "").trim() || !digits(req.body.phone) || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Preencha todos os dados corretamente." });
  Object.assign(client, { cnpj, companyName: String(req.body.companyName).trim(), phone: String(req.body.phone).trim(), email, updatedAt: new Date().toISOString() });
  if (req.body.password) {
    if (!validPassword(req.body.password)) return res.status(400).json({ error: "A nova senha deve ter entre 8 e 128 caracteres." });
    client.passwordHash = hashPassword(String(req.body.password));
  }
  await writeDb(db); res.json(publicClient(client));
});
app.patch("/api/clients/:id/status", requireAdmin, async (req, res) => {
  const db = req.db; const client = db.clients.find((item) => item.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Cliente não encontrado." });
  client.active = Boolean(req.body.active); client.updatedAt = new Date().toISOString(); await writeDb(db); res.json(publicClient(client));
});

const uploadStorage = useBlobStorage ? multer.memoryStorage() : multer.diskStorage({ destination: uploadDir, filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) });
const upload = multer({ storage: uploadStorage, limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
app.get("/api/clients/:id/documents", requireAdmin, (req, res) => { const client = req.db.clients.find((item) => item.id === req.params.id); if (!client) return res.status(404).json({ error: "Cliente não encontrado." }); res.json(newestDocumentsFirst(client.documents)); });
app.post("/api/clients/:id/documents", requireAdmin, upload.single("file"), async (req, res) => {
  const db = req.db; const client = db.clients.find((item) => item.id === req.params.id);
  if (!client) { if (req.file && !useBlobStorage) fs.unlinkSync(req.file.path); return res.status(404).json({ error: "Cliente não encontrado." }); }
  if (!req.file) return res.status(400).json({ error: "Selecione um arquivo." });
  const dueDate = String(req.body.dueDate || "");
  const parsedDueDate = dueDate ? new Date(`${dueDate}T00:00:00Z`) : null;
  const invalidDueDate = dueDate && (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parsedDueDate.getTime()) || parsedDueDate.toISOString().slice(0, 10) !== dueDate);
  if (invalidDueDate) { if (!useBlobStorage) fs.unlinkSync(req.file.path); return res.status(400).json({ error: "Informe uma data de vencimento válida." }); }
  const documentId = crypto.randomUUID(); let storedName = req.file.filename;
  if (useBlobStorage) { const extension = path.extname(req.file.originalname).toLowerCase(); const stored = await putBlob(`andressa-alves/documents/${client.id}/${documentId}${extension}`, req.file.buffer, { access: "private", contentType: req.file.mimetype, addRandomSuffix: false }); storedName = stored.pathname; }
  const document = { id: documentId, name: String(req.body.name || req.file.originalname).trim(), dueDate: dueDate || null, uploadedByName: req.session.adminName || "Equipe", uploadedByUserId: req.session.adminUserId || null, originalName: req.file.originalname, storedName, storage: useBlobStorage ? "blob" : "local", mimeType: req.file.mimetype, size: req.file.size, createdAt: new Date().toISOString() };
  client.documents.push(document); await writeDb(db); res.status(201).json(document);
});
app.delete("/api/clients/:clientId/documents/:documentId", requireAdmin, async (req, res) => {
  const db = req.db; const client = db.clients.find((item) => item.id === req.params.clientId);
  const document = client?.documents.find((item) => item.id === req.params.documentId);
  if (!document) return res.status(404).json({ error: "Documento não encontrado." });
  client.documents = client.documents.filter((item) => item.id !== document.id); await writeDb(db);
  if (document.storage === "blob") await deleteBlob(document.storedName); else fs.rmSync(path.join(uploadDir, document.storedName), { force: true }); res.json({ ok: true });
});

app.post("/api/client/login", loginRateLimit, (req, res) => {
  const identifier = String(req.body.identifier || "").trim();
  const cnpj = digits(identifier); const email = normalizeEmail(identifier);
  const client = req.db.clients.find((item) => item.cnpj === cnpj || item.email === email);
  if (!client || !verifyPassword(req.body.password, client.passwordHash)) return res.status(401).json({ error: "E-mail, CNPJ ou senha inválidos." });
  if (!client.active) return res.status(403).json({ error: "Este cliente está inativo. Entre em contato com a Andressa Alves Contabilidade." });
  req.session = { role: "client", clientId: client.id }; res.json({ ok: true });
});
app.get("/api/client/me", requireClient, (req, res) => res.json({ id: req.client.id, cnpj: req.client.cnpj, companyName: req.client.companyName, documents: newestDocumentsFirst(req.client.documents).map(({ storedName, ...document }) => ({ ...document, expired: isDocumentExpired(document) })) }));

const documentSource = async (document) => {
  if (document.storage === "blob") {
    const stored = await getBlob(document.storedName, { access: "private" });
    return stored?.stream ? { stream: stored.stream, contentType: stored.blob.contentType || document.mimeType } : null;
  }
  const filePath = path.join(uploadDir, document.storedName);
  return fs.existsSync(filePath) ? { filePath, contentType: document.mimeType } : null;
};
const sendDocument = async (req, res, client) => {
  const document = client.documents.find((item) => item.id === req.params.documentId);
  if (!document) return res.status(404).json({ error: "Documento não encontrado." });
  const source = await documentSource(document); if (!source) return res.status(404).json({ error: "Arquivo não encontrado." });
  if (source.filePath) return res.download(source.filePath, document.originalName);
  res.setHeader("Content-Type", source.contentType || "application/octet-stream"); res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`); res.setHeader("Cache-Control", "private, no-store");
  Readable.fromWeb(source.stream).pipe(res);
};
app.get("/api/client/documents/:documentId/download", requireClient, async (req, res) => {
  const document = req.client.documents.find((item) => item.id === req.params.documentId);
  if (!document) return res.status(404).json({ error: "Documento não encontrado." });
  if (isDocumentExpired(document)) return res.status(410).json({ error: "Este documento ultrapassou o período de 30 dias e não está mais disponível para download." });
  const source = await documentSource(document); if (!source) return res.status(404).json({ error: "Arquivo não encontrado." });
  const downloadedDocument = req.client.documents.find((item) => item.id === document.id); downloadedDocument.downloadCount = (downloadedDocument.downloadCount || 0) + 1; downloadedDocument.downloadedAt = new Date().toISOString(); await writeDb(req.db);
  if (source.filePath) return res.download(source.filePath, document.originalName);
  res.setHeader("Content-Type", source.contentType || "application/octet-stream"); res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(document.originalName)}`); res.setHeader("Cache-Control", "private, no-store"); Readable.fromWeb(source.stream).pipe(res);
});
app.get("/api/clients/:id/documents/:documentId/download", requireAdmin, async (req, res) => { const client = req.db.clients.find((item) => item.id === req.params.id); if (!client) return res.status(404).json({ error: "Cliente não encontrado." }); await sendDocument(req, res, client); });

app.get("/", (_req, res) => res.sendFile(path.join(rootDir, "index.html")));
for (const file of ["index.html", "style.css", "site.js", "painel-equipe.html", "painel-cliente.html", "painel.css", "painel.js", "manifest.webmanifest", "sw.js", "icon-192.png", "icon-512.png", "brand-andressa.png", "brand-andressa-horizontal.png", "wh.png", "andressa-alves.jpg"]) {
  app.get(`/${file}`, (_req, res) => res.sendFile(path.join(rootDir, file)));
}
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "O arquivo excede o limite de 2 MB." });
  if (error instanceof SyntaxError && error.status === 400 && "body" in error) return res.status(400).json({ error: "O conteúdo da requisição é inválido." });
  console.error(error); res.status(500).json({ error: "Não foi possível concluir a operação." });
});
if (require.main === module) app.listen(port, () => console.log(`Andressa Alves Contabilidade disponível em http://127.0.0.1:${port}`));
module.exports = app;

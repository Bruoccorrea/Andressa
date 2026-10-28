const fs = require("fs");
const path = require("path");
const { put } = require("@vercel/blob");

const rootDir = path.resolve(__dirname, "..");
const dbPath = path.join(rootDir, "data", "db.json");
const uploadDir = path.join(rootDir, "data", "uploads");

if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("Defina BLOB_READ_WRITE_TOKEN antes da migração.");
if (!fs.existsSync(dbPath)) throw new Error("Banco local não encontrado.");

const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));

async function migrate() {
  for (const client of db.clients) {
    for (const document of client.documents) {
      if (document.storage === "blob") continue;
      const localPath = path.join(uploadDir, document.storedName);
      if (!fs.existsSync(localPath)) throw new Error(`Arquivo não encontrado: ${document.originalName}`);
      const extension = path.extname(document.originalName).toLowerCase();
      const blob = await put(`andressa-alves/documents/${client.id}/${document.id}${extension}`, fs.readFileSync(localPath), { access: "private", contentType: document.mimeType, addRandomSuffix: false });
      document.storedName = blob.pathname;
      document.storage = "blob";
      console.log(`Documento migrado: ${document.originalName}`);
    }
  }
  const version = `${String(Date.now()).padStart(13, "0")}-migration.json`;
  await put(`andressa-alves/database/${version}`, JSON.stringify(db), { access: "private", contentType: "application/json", addRandomSuffix: false });
  console.log(`Banco migrado: ${db.clients.length} cliente(s), ${db.users.length} usuário(s).`);
}

migrate().catch((error) => { console.error(error); process.exitCode = 1; });

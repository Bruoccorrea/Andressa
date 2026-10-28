# Andressa Alves Contabilidade

Site institucional responsivo e portal privado de clientes e equipe, com a identidade visual e as informações públicas da Andressa Alves Contabilidade.

## Executar localmente

```powershell
npm.cmd install
npm.cmd start
```

Abra `http://127.0.0.1:8080`.

## Configuração

Copie `.env.example` para `.env` e configure:

- `ADMIN_EMAIL` e `ADMIN_PASSWORD`: credenciais iniciais da equipe.
- `SESSION_SECRET`: segredo aleatório com pelo menos 32 caracteres.
- `PORT`: porta do servidor; padrão `8080`.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM`: deixe em branco até criar e configurar o e-mail de envio.
- `BLOB_READ_WRITE_TOKEN`: opcional, para armazenar o banco e os documentos no Vercel Blob.

O banco local fica em `data/db.json` e os documentos enviados em `data/uploads/`. Essa pasta não é publicada pelo servidor. Ao usar o Vercel Blob, os novos arquivos usam o prefixo privado `andressa-alves/`.

Os códigos de recuperação expiram em 15 minutos e aceitam até cinco tentativas. Sem SMTP, em ambiente de desenvolvimento, o código aparece apenas para testes locais.

O site público oferece orçamento pelo canal de atendimento oficial e telefone divulgado no site de referência. Os dados de SMTP podem ser acrescentados quando a conta de e-mail estiver pronta.

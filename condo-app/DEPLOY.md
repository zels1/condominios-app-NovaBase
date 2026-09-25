# Guia de instalação — Gestão de Condomínios

Este guia leva-te passo a passo desde este código até teres a aplicação a funcionar
online, com o mesmo esquema que já usámos antes: **GitHub → Render (backend) → Vercel
(frontend) → Supabase (base de dados)**.

Não preciso de acesso ao teu GitHub para nada disto — vais copiar ficheiros e clicar em
botões nos sites, exatamente como da última vez.

---

## 0. O que esta aplicação faz

- **Administrador**: cria o condomínio, as frações (com permilagem), o orçamento anual;
  gera as quotas mensais automaticamente; configura juros de mora e lembretes automáticos;
  regista pagamentos; gere fornecedores/despesas; convoca assembleias e valida procurações;
  acompanha ocorrências de manutenção; publica documentos e comunicados.
- **Condómino**: vê as suas quotas e o que está em dívida; reporta ocorrências; participa
  em assembleias (vota, submete procuração); vê documentos e comunicados.

---

## 1. Criar o projeto Supabase (base de dados + login)

1. Vai a [supabase.com](https://supabase.com) → **New project**.
2. Escolhe um nome (ex: `condominios`), uma password forte para a base de dados
   (guarda-a — vais precisar dela) e a região mais próxima (Europa).
3. Espera 1-2 minutos até o projeto ficar pronto.
4. Vai a **Project Settings → Database → Connection string → URI**. Copia essa string —
   é o teu `DATABASE_URL`. Substitui `[YOUR-PASSWORD]` pela password que definiste.
   - Para produção, usa antes a string em **Connection pooling** (porta `6543`) — aguenta
     melhor múltiplos pedidos em simultâneo.
5. Vai a **Project Settings → API → JWT Settings**. Copia o **JWT Secret** — é o teu
   `SUPABASE_JWT_SECRET`.
6. Vai a **Authentication → Providers** e confirma que **Email** está ativado (vem
   ativado por padrão). Se quiseres que as pessoas confirmem o email antes de entrar,
   deixa "Confirm email" ligado; se preferires simplificar para já, podes desligar.

---

## 2. Colocar o código no GitHub

1. Cria um repositório novo e vazio em [github.com/new](https://github.com/new)
   (ex: `condominios-app`). Não adiciones README nem .gitignore — o projeto já os tem.
2. No teu computador (ou aqui, se estiveres a transferir os ficheiros), corre:
   ```bash
   cd condo-app
   git init
   git add .
   git commit -m "Primeira versão da aplicação de gestão de condomínios"
   git branch -M main
   git remote add origin https://github.com/O-TEU-USER/condominios-app.git
   git push -u origin main
   ```

---

## 3. Backend no Render

1. Vai a [render.com](https://render.com) → **New → Web Service** → liga o repositório
   que acabaste de criar.
2. Configura:
   - **Root Directory**: `backend`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
3. Em **Environment**, adiciona estas variáveis (usa os valores do passo 1):
   - `DATABASE_URL` — a connection string do Supabase
   - `SUPABASE_JWT_SECRET` — o JWT secret do Supabase
   - `FRONTEND_URL` — por agora podes deixar em branco; volta aqui depois do passo 4
     e preenche com o URL do Vercel (ex: `https://condominios-app.vercel.app`)
4. Cria o serviço. As tabelas da base de dados são criadas automaticamente no arranque.
5. Quando terminar, testa: abre `https://o-teu-backend.onrender.com/health` no browser —
   deve mostrar `{"status": "healthy"}`. E `/docs` mostra a documentação interativa da API.

---

## 4. Frontend no Vercel

1. Vai a [vercel.com](https://vercel.com) → **Add New → Project** → liga o mesmo
   repositório.
2. Configura:
   - **Root Directory**: `frontend`
   - **Framework Preset**: Vite (deteta automaticamente)
3. Em **Environment Variables**, adiciona:
   - `VITE_SUPABASE_URL` — o Project URL do Supabase (Project Settings → API)
   - `VITE_SUPABASE_ANON_KEY` — a chave `anon public` (Project Settings → API)
   - `VITE_API_URL` — o URL do backend no Render (ex: `https://o-teu-backend.onrender.com`)
4. Clica em **Deploy**.
5. Depois de publicado, copia o URL final (ex: `https://condominios-app.vercel.app`) e
   volta ao Render para preencher `FRONTEND_URL` com esse valor (passo 3.3) — isto evita
   erros de CORS no login, tal como da última vez.

---

## 5. Criar a tua conta e tornares-te administrador

1. Abre o site do Vercel e clica em **"Cria uma"** para criar conta com o teu email.
2. Ao entrares pela primeira vez, a aplicação cria-te automaticamente como **condómino**
   (é o padrão de segurança — ninguém se torna administrador sozinho). Para te tornares
   administrador:
   - Vai ao Supabase → **Table Editor** → tabela `users` → encontra a tua linha (pelo
     email) → edita a coluna `role` de `owner` para `admin` → guarda.
3. Volta à aplicação e recarrega a página — já vês o menu de administrador, e podes criar
   o teu condomínio em "**+ Novo condomínio**".

---

## 6. Automatizar juros de mora e lembretes (opcional mas recomendado)

Por padrão, tens de carregar em "Aplicar juros de mora agora" e "Correr motor de
lembretes" manualmente na aplicação. Para isto correr sozinho todos os dias:

1. No Render, cria um **novo** serviço do tipo **Cron Job** (não Web Service).
2. Aponta-o para o mesmo repositório, com um comando simples que chama os dois
   endpoints, por exemplo:
   ```bash
   curl -X POST https://o-teu-backend.onrender.com/condominiums/ID_DO_CONDOMINIO/late-fee-config/run \
     -H "Authorization: Bearer TOKEN_DE_ADMIN"
   curl -X POST https://o-teu-backend.onrender.com/condominiums/ID_DO_CONDOMINIO/reminder-configs/run \
     -H "Authorization: Bearer TOKEN_DE_ADMIN"
   ```
   (Se preferires, digo-te como gerar um token de serviço de longa duração para isto, em
   vez de usares o teu próprio login.)
3. Agenda para correr uma vez por dia (ex: `0 7 * * *` = todos os dias às 7h).

---

## 7. Testar tudo

Checklist rápida depois de tudo publicado:

- [ ] Criar conta, tornares-te admin, criar o condomínio
- [ ] Adicionar frações (confirma que a soma da permilagem dá 1000‰)
- [ ] Criar o orçamento anual
- [ ] Gerar as quotas do mês
- [ ] Configurar e aplicar juros de mora
- [ ] Configurar e correr lembretes
- [ ] Registar um pagamento
- [ ] Convocar uma assembleia, adicionar um ponto à ordem de trabalhos, votar
- [ ] Reportar uma ocorrência e avançar o estado
- [ ] Um condómino (segunda conta de teste) conseguir ver as suas próprias quotas

---

## Onde tudo isto vive

```
condo-app/
├── backend/            FastAPI + SQLAlchemy — a API
│   ├── app/
│   │   ├── models.py       esquema da base de dados
│   │   ├── services/       geração de quotas, juros de mora, lembretes
│   │   ├── routers/        endpoints da API
│   │   └── main.py         arranque da aplicação
│   └── requirements.txt
├── frontend/           React (Vite) — a interface
│   └── src/
│       ├── pages/           cada ecrã da aplicação
│       └── lib/              ligação à API e ao Supabase
└── DEPLOY.md            este guia
```

Qualquer dúvida num destes passos, diz-me em que ecrã ficaste e que mensagem aparece,
como fizemos da última vez — resolvemos passo a passo.

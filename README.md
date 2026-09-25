# Gestão de Condomínios

Aplicação completa de gestão de condomínios: quotas automáticas, juros de mora
configuráveis, lembretes automáticos, assembleias com votação por permilagem e
procurações, manutenção/ocorrências, fornecedores e despesas, documentos e comunicados.

- **Backend**: FastAPI + SQLAlchemy + PostgreSQL (pensado para o Supabase)
- **Frontend**: React (Vite), autenticação via Supabase Auth
- **Guia de instalação completo**: ver [DEPLOY.md](./DEPLOY.md)

## Estrutura

```
backend/    API FastAPI (ver backend/app/main.py)
frontend/   Interface React (ver frontend/src/App.jsx)
```

## Desenvolvimento local

### Backend
```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # preenche DATABASE_URL e SUPABASE_JWT_SECRET
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env   # preenche as variáveis VITE_*
npm run dev
```

Para publicar online, segue o [DEPLOY.md](./DEPLOY.md).

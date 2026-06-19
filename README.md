# YSQ-L3 — Formulário Web

Formulário do Questionário de Esquemas de Young (versão longa, 232 itens, 18 esquemas),
com preenchimento item a item, salvamento automático a cada resposta, e correção
automática para o terapeuta.

## Requisitos

- **Node.js 22.5 ou superior** (usa o módulo `node:sqlite`, nativo do Node — não precisa
  instalar SQLite separadamente nem compilar nada).

Verifique a versão no seu servidor:
```bash
node --version
```
Se for menor que 22.5, será preciso atualizar o Node antes de rodar este app
(no F2-424, normalmente via NVM ou pelo painel de "Versão do Node.js" do cPanel).

## Instalação local / no servidor

```bash
cd ysq-app
npm install
node server.js
```

O servidor sobe em `http://localhost:3000` (ou na porta definida em `PORT`).

Na primeira execução, um usuário admin padrão é criado automaticamente:
- **usuário:** `admin`
- **senha:** `mudar123`

**Troque isso imediatamente.** Duas formas:

1. Definir variáveis de ambiente antes da primeira execução (banco ainda não existe):
   ```bash
   ADMIN_USER=seu_usuario ADMIN_PASS=sua_senha_forte node server.js
   ```
2. Ou trocar depois diretamente no banco (veja seção "Trocar senha depois").

Defina também um `SESSION_SECRET` próprio em produção:
```bash
SESSION_SECRET="uma-string-aleatoria-longa-e-unica" node server.js
```

## Estrutura

```
ysq-app/
  data/
    items.json      → os 232 itens do questionário (texto)
    schemas.json     → os 18 esquemas e suas faixas de itens
    ysq.db           → banco SQLite (criado automaticamente, não versionar)
  public/
    form.html             → tela do paciente (link único /f/:token)
    admin-login.html       → login do terapeuta
    admin-dashboard.html  → lista de pacientes / criação de links
    admin-patient.html     → resultado calculado por esquema
    not-found.html
    styles.css
  db.js          → conexão SQLite + criação de tabelas
  scoring.js     → lógica de correção (soma, média, nível por esquema)
  server.js      → rotas Express (público + admin)
```

## Como funciona o fluxo

1. Você entra em `/admin`, faz login, digita o nome do paciente e clica em
   "Gerar link". Um link único (`/f/<token>`) é criado.
2. Você envia esse link ao paciente (WhatsApp, e-mail, etc.) — **não precisa de senha**.
3. O paciente preenche uma pergunta por vez. **Cada clique salva automaticamente**
   no banco. Se ele fechar o navegador e voltar depois, o formulário retoma
   exatamente de onde parou.
4. Ao responder o item 232, o sistema exige que todos os itens estejam
   respondidos antes de permitir finalizar.
5. Você vê no painel admin a pontuação calculada por esquema: soma, média,
   nível (Baixa / Moderada / Alta / Muito Alta) e os 3 esquemas mais elevados
   em destaque.

## Sobre os níveis de severidade (Baixa/Moderada/Alta/Muito Alta)

A ficha de correção original fornece os **totais máximos possíveis** por esquema
(ex.: Privação Emocional, 9 itens, máximo 54), mas não trouxe os pontos de corte
exatos de severidade usados no seu protocolo clínico. Implementei uma classificação
por **média de item** (não soma bruta), que é a abordagem mais comum na literatura
do YSQ:

| Média do esquema | Nível       |
|-------------------|------------|
| até 2.0            | Baixa       |
| 2.01 – 3.5          | Moderada    |
| 3.51 – 4.5          | Alta        |
| acima de 4.5        | Muito Alta  |

Se você usa outro critério de corte (por exemplo, baseado em normas brasileiras
específicas ou nos pontos de corte do Schema Therapy Institute), me avise e eu
ajusto a função `computeScores` em `scoring.js` — é uma mudança pequena e isolada.

## Segurança e dados sensíveis

Este questionário aborda temas delicados (abuso, abandono, ideação de punição).
Algumas recomendações antes de colocar em produção real:

- **Sirva sempre via HTTPS** (o F2-424 normalmente já oferece certificado SSL grátis
  via Let's Encrypt no painel — ative isso para o domínio/subdomínio usado).
- Os tokens de link são aleatórios de 32 caracteres (128 bits) — praticamente
  impossível de adivinhar, mas trate-os como uma senha: não publique em
  lugares públicos.
- Faça backup periódico do arquivo `data/ysq.db` (é um único arquivo, fácil de copiar).
- Considere apagar pacientes antigos que não sejam mais necessários
  (botão "Excluir" no painel já remove paciente + respostas).

## Rodando em produção no F2-424 (sugestão)

A forma mais simples de manter o processo Node rodando continuamente é com o
**PM2** (gerenciador de processos):

```bash
npm install -g pm2
cd ysq-app
PORT=3000 ADMIN_USER=seu_usuario ADMIN_PASS=sua_senha SESSION_SECRET=algo-aleatorio pm2 start server.js --name ysq-app
pm2 save
pm2 startup   # configura para iniciar automaticamente com o servidor
```

Depois, configure um proxy reverso (Apache/Nginx, comum em painéis de hospedagem)
apontando seu domínio/subdomínio para `http://localhost:3000`, com SSL habilitado
na frente.

## Trocar senha do admin depois

Não há tela de "esqueci a senha" ainda. Para trocar manualmente, com o servidor
parado, rode este script Node a partir da pasta do projeto:

```bash
node -e "
const { db, hashPassword } = require('./db');
const novaSenha = 'minha-nova-senha-forte';
db.prepare('UPDATE admin_users SET password_hash = ? WHERE username = ?')
  .run(hashPassword(novaSenha), 'admin');
console.log('Senha atualizada.');
"
```

## Limitações conhecidas / próximos passos sugeridos

- Apenas um usuário admin é suportado nativamente sem nenhuma tela de gestão de
  usuários (dá para adicionar mais via banco, mas não tem UI ainda).
- Não há exportação de PDF do resultado — só "Imprimir" do navegador (que já
  gera um PDF razoável via "Salvar como PDF" na caixa de impressão).
- Os pontos de corte de severidade são uma aproximação (ver seção acima).

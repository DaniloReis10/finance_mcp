# Open Finance Desktop

Aplicativo pessoal para macOS com painel local, integração Pluggy Open Finance, sincronização diária/manual e servidor MCP. Preparado para conectar Bradesco, Santander, Nubank, Inter e PicPay conforme disponibilidade do provedor. Não inicia pagamentos.

## Estado da entrega

- Interface e servidor local implementados; atalho `Open Finance.app` criado no Desktop.
- Dez testes automatizados passaram, incluindo chamada MCP com o cliente oficial.
- Sem dados fictícios. A conexão real depende de conta Pluggy com Open Finance habilitado e do consentimento em cada banco; ainda não foi testada com contas reais.
- Repositório do projeto: https://github.com/DaniloReis10/finance_mcp.
- A conexão externa com ChatGPT depende de configurar um Secure MCP Tunnel na conta OpenAI. O servidor MCP local funciona, mas não está conectado ao ChatGPT.
- Nesta instalação, o serviço de início automático do macOS não foi instalado por falta de permissão para `Library/LaunchAgents`. Abra o atalho após cada reinicialização. Fechar o navegador não encerra o processo em segundo plano; encerramento de sessão, reinício ou falha do processo exige abrir o atalho novamente.

## Uso

1. Abra **Open Finance** no Desktop. O atalho inicia o servidor e autentica sua sessão no navegador padrão.
2. Crie sua conta em https://dashboard.pluggy.ai e confirme com o provedor a habilitação, cobertura e preços de Open Finance. O aplicativo não contrata nenhum plano.
3. Em **Configurações**, insira `Client ID` e `Client Secret` da sua aplicação Pluggy. Não insira senha bancária neste formulário.
4. Clique **Conectar banco**, escolha a instituição e conclua o consentimento no fluxo do provedor/banco. A lista é obtida da API e restrita a conectores Open Finance reais.
5. Use **Sincronizar agora**, ou mantenha a atualização automática ativada.

O serviço verifica a agenda a cada minuto, após o primeiro banco ser registrado. Uma sincronização completa bem-sucedida adia a próxima por 24 horas. Em falha total ou parcial, uma nova tentativa ocorre após uma hora. Ao acordar da suspensão, o Mac processa a atualização vencida. A conexão à internet e a sessão do usuário precisam estar disponíveis. MFA ou consentimento expirado podem exigir intervenção no banco.

Os produtos desta versão são contas, cartões e transações disponibilizados pelo provedor. Investimentos, empréstimos, extratos em PDF e conciliação contábil não estão implementados. O painel soma apenas contas bancárias em BRL; cartões e outras moedas permanecem separados nos dados de contas. Datas e sinais de transações seguem o provedor.

## Desenvolvimento

Requer Node.js 22 ou superior.

```sh
npm ci
npm run build
npm test
npm start
```

O servidor escuta exclusivamente em `127.0.0.1:4318`. Abra `npm run desktop` para autenticar no navegador. Acesso direto à URL sem a sessão do atalho não libera os dados.

Variáveis opcionais: `FINANCE_DATA_DIR` muda o diretório do cofre; `PORT` altera a porta do servidor HTTP. Atalho e ponte stdio utilizam a porta padrão 4318. Para desenvolvimento com outra porta, utilize seu cliente HTTP e adapte o atalho/ponte.

### Instalação completa no macOS

`npm run install:mac` cria o atalho e o LaunchAgent da conta. Precisa de acesso ao Desktop, `~/Library/LaunchAgents/com.openfinance.desktop.plist` e ao diretório de dados. Não requer root.

Para manter os dados da instalação inicial ao habilitar o serviço permanente, execute na pasta do projeto:

```sh
FINANCE_DATA_DIR='/caminho/para/os/dados/OpenFinanceDesktop' npm run install:mac
```

O projeto precisa permanecer no mesmo caminho porque o atalho e o serviço o referenciam. O instalador também oferece `--session-only` para gerar o manifesto fora de LaunchAgents; a ativação via `launchctl` depende das permissões do ambiente. A tentativa nesta entrega retornou `Bootstrap failed: 5`; o aplicativo foi iniciado pelo atalho como processo em segundo plano.

## MCP para ChatGPT

Servidor HTTP: `http://127.0.0.1:4318/mcp`, transporte Streamable HTTP sem estado, SDK oficial MCP. Todas as chamadas exigem `Authorization: Bearer <token>`. Copie ou revogue o token na seção **Conectar ChatGPT** do aplicativo.

| Ferramenta | Função |
| --- | --- |
| `sync_status` | Consultar conexões, erros e data de atualização |
| `list_accounts` | Consultar contas, saldos e moedas |
| `list_transactions` | Consultar transações por conta/período, com paginação |
| `sync_now` | Iniciar uma atualização e acompanhar por `sync_status` |

`list_transactions` aceita `accountId`, `from` e `to` em `AAAA-MM-DD`, `limit` de 1 a 500 e `offset`. A ferramenta de sincronização é declarada como escrita; ela consulta o provedor e modifica o cache, sem realizar transações financeiras.

### Túnel privado

Não exponha o painel nem encaminhe esta porta diretamente à internet. O aplicativo foi construído para uso local de um único usuário, sem login remoto OAuth.

Use a ponte stdio `scripts/mcp-stdio.js` como destino do Secure MCP Tunnel. Ela lê o token do cofre local e encaminha somente as ferramentas MCP ao servidor HTTP autenticado. O painel precisa estar rodando. A ponte evita inserir o token bancário/MCP em configuração pública ou argumentos.

1. Siga https://developers.openai.com/api/docs/guides/secure-mcp-tunnels para obter o cliente oficial, criar um túnel e associá-lo à sua organização Platform e ao espaço ChatGPT correto.
2. Forneça a chave de execução OpenAI localmente pela variável `CONTROL_PLANE_API_KEY`; não a grave no repositório ou compartilhe no chat.
3. Configure o comando MCP do túnel para executar o Node com o caminho absoluto de `scripts/mcp-stdio.js`. Nesta instalação, defina também `FINANCE_DATA_DIR=/caminho/para/os/dados/OpenFinanceDesktop` no ambiente herdado da ponte.
4. Execute `tunnel-client doctor --profile <perfil> --explain` e `tunnel-client run --profile <perfil>` conforme a ajuda da versão instalada.
5. No ChatGPT, adicione um servidor MCP personalizado usando **Tunnel** e selecione esse túnel. A autorização de acesso fica na associação privada do túnel; a ponte stdio é de uso local. Esta aplicação não implementa um servidor OAuth público.
6. Teste `sync_status` no ChatGPT. Considere a integração concluída apenas depois dessa chamada retornar corretamente.

Após revogar o token local, reinicie a ponte/túnel para que leia o novo token. O túnel requer as permissões e credenciais próprias da conta OpenAI; elas não foram fornecidas nesta entrega.

## Dados e segurança

- Cofre AES-256-GCM com escrita atômica e arquivos privados. Diretório padrão: `~/Library/Application Support/OpenFinanceDesktop`. Nesta instalação: `/caminho/para/os/dados/OpenFinanceDesktop`.
- A chave mestra é um arquivo local com permissão `0600`, separado do conteúdo criptografado, no mesmo diretório. Isso não protege contra outro processo comprometido com os privilégios da sua conta. Use a proteção de disco e da sessão do Mac. Não há integração com Keychain nesta versão.
- Credenciais, chaves, dados bancários e logs ficam fora do repositório. Não envie o diretório de dados ao GitHub.
- Interface protegida por sessão HttpOnly/SameSite e validações de Host/Origin; MCP exige token distinto. Servidor restrito a loopback.
- Apenas dados selecionados de contas/transações são persistidos. Senhas bancárias não são recebidas pelo backend; o consentimento ocorre no widget oficial do provedor.
- Atualizações são serializadas. Todas as páginas de um banco precisam ter sido obtidas antes da substituição dos dados locais. Falhas preservam o último resultado e aparecem no histórico.
- Conexões são registradas pelo callback do widget e validadas por `clientUserId`. A sincronização usa somente os IDs salvos e não depende do endpoint comercial de listagem da Pluggy. Se a janela fechar antes do callback, a conexão não será registrada automaticamente; conclua o fluxo pelo aplicativo. Conexões antigas de outros aplicativos não são importadas.
- **Desconectar e apagar dados** remove o item no provedor e os dados locais desse banco. Confira os consentimentos também no app bancário.

## Verificação

Testes com provedor simulado cobrem criptografia, integridade, permissões, agenda e retomada, paginação, falha de consentimento, deduplicação, falha parcial, preservação de dados, concorrência, sessão, Host/Origin e transporte MCP com o cliente oficial. A ponte stdio também foi verificada contra o servidor local. O fluxo real de consentimento, quotas e atualização dos cinco bancos precisa ser validado após configurar a Pluggy.

## GitHub

Repositório: https://github.com/DaniloReis10/finance_mcp. Para obter o código:

```sh
git clone https://github.com/DaniloReis10/finance_mcp.git
cd finance_mcp
npm ci
npm run build
```

O diretório de dados deve ficar fora do checkout. Os caminhos acima são exemplos: use o mesmo diretório de dados em todas as inicializações para preservar suas conexões.

## Referências

- Pluggy Connect: https://docs.pluggy.ai/en/docs/connect-widget/introduction
- Open Finance e habilitação: https://docs.pluggy.ai/en/docs/open-finance/overview
- Atualização de conexão: https://docs.pluggy.ai/en/reference/items/items-update
- MCP no ChatGPT: https://developers.openai.com/api/docs/guides/custom-mcp-server
- Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels

# mercury-router

Mod para o Claude Code que escolhe o **modelo** (Haiku, Sonnet ou Opus) e o **effort** de cada prompt.
Para isso ele pergunta a um modelo gratuito, na **OpenRouter** (padrão: `nvidia/nemotron-3.5-lightning:free`) ou na **NVIDIA NIM** (`minimaxai/minimax-m3.1-flash`), que tipo de trabalho o prompt é, e traduz a resposta em modelo + effort.

Ele foi desenhado para não desperdiçar o *prompt cache*: cada modelo tem o seu próprio cache, então trocar de modelo no meio de uma conversa longa costuma sair mais caro do que ficar. Por isso, com o cache quente, ele prefere **manter o modelo e baixar o effort**, e só troca de modelo no começo da conversa, depois que o cache expira, ou quando a tarefa realmente pede.

Uma faixa acima da caixa de prompt mostra o que está respondendo:

```
🧭 último turno: Opus 5.5 · low · cache 97% · trivial 92% · cache quente: mantém modelo, −effort
```

## O que você precisa

- Claude Code **2.1.299 ou mais novo** (o app desktop ou o CLI). Versões antigas não carregam mods.
- Uma conta na OpenRouter e uma **chave de API** (passo 2). O modelo padrão, `nvidia/nemotron-3.5-lightning:free`, é gratuito. Modelos gratuitos podem ter limite temporário no provedor; se isso acontecer, troque `routerModel` (veja as opções abaixo).

## Privacidade

Para decidir, **o texto de cada prompt que você digita é enviado à OpenRouter (ou à NVIDIA, se esse for o provedor)** (até 12.000 caracteres), junto com um resumo do estado da conversa (tamanho, falhas recentes, tipo do turno anterior). Não vai o histórico da conversa, nem arquivos, nem as respostas do Claude. Não use o mod se isso não for aceitável para o seu trabalho.

## 1. Instalar

Descompacte o zip em uma pasta que você vá manter, por exemplo `C:\claude-mods\` (Windows) ou `~/claude-mods/` (Mac/Linux). O Claude Code lê o mod direto dessa pasta, então **não apague nem mova a pasta depois de instalar**.

**No terminal (CLI):**

```bash
claude plugin marketplace add /caminho/para/mercury-router
claude plugin install mercury-router@pedro-mods
```

(No Windows, use o caminho completo, por exemplo `C:\claude-mods\mercury-router`.)

**No app desktop**, onde o comando `/plugin` não funciona: clique em **+** ao lado da caixa de prompt, depois **Plugins**, **Add marketplace**, cole o caminho da pasta `mercury-router` e então **Add plugin** no `mercury-router`.

Para confirmar:

```bash
claude plugin list
```

Deve aparecer `mercury-router@pedro-mods` com `Status: enabled`. A instalação padrão é no escopo `user`, ou seja, vale para todos os seus projetos.

## 2. Criar a chave da OpenRouter

1. Entre em <https://openrouter.ai> e crie uma conta (ou faça login).
2. Abra <https://openrouter.ai/keys> e clique em **Create Key**. Dê um nome, como `claude-code-router`.
3. Copie a chave (começa com `sk-or-`). Ela só é mostrada uma vez.

Dica: na página da chave dá para definir um limite de gasto. O modelo gratuito não cobra, mas o limite protege caso você troque de modelo depois.

## 3. Colocar a chave no mod

A chave é uma opção **sensível** do plugin e fica guardada pelo Claude Code, nunca nos arquivos do mod. Escolha um jeito:

**a) No Claude Code (interativo):** digite

```
/plugin configure mercury-router@pedro-mods
```

e preencha `openrouterApiKey`. (Se a instalação já tiver mostrado uma tela de configuração, a chave pode ser colocada ali.)

**b) Pelo terminal, sem deixar a chave no histórico do shell:** o comando lê os valores da entrada padrão em JSON. No PowerShell:

```powershell
$k = Read-Host "Chave da OpenRouter" -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k))
@{ openrouterApiKey = $plain } | ConvertTo-Json -Compress | claude plugin configure mercury-router@pedro-mods --values-stdin
```

No bash/zsh:

```bash
read -rs -p "Chave da OpenRouter: " K; echo
printf '{"openrouterApiKey":"%s"}' "$K" | claude plugin configure mercury-router@pedro-mods --values-stdin
unset K
```

Depois rode `/reload-plugins` no Claude Code (ou abra uma sessão nova).

**Não** coloque a chave em um arquivo versionado nem a cole em chats. Se ela vazar, apague-a em <https://openrouter.ai/keys> e crie outra.

## 4. Conferir se funcionou

No Claude Code:

```
/router
```

Deve responder algo como:

```
mercury-router ligado · roteador nvidia/nemotron-3.5-lightning:free · chave ok · TTL do cache 60 min · …
```

Se aparecer **chave faltando**, a chave não foi gravada no plugin instalado: refaça o passo 3 e o `/reload-plugins`.
Depois mande um prompt qualquer: a faixa `🧭 …` acima da caixa de prompt mostra o modelo, o effort e a taxa de cache.

## Comandos

| Comando | O que faz |
| --- | --- |
| `/router` | Mostra o estado: chave, TTL, cache quente ou frio, última decisão. |
| `/router off` | Desliga o roteamento: o modelo da sessão responde. |
| `/router on` | Liga de novo. |

## Opções

Mude com `/plugin configure mercury-router@pedro-mods` (cada mudança recarrega o mod).

| Opção | Padrão | Para quê |
| --- | --- | --- |
| `openrouterApiKey` | — | Chave da OpenRouter. Sem ela o mod não faz nada e o modelo da sessão responde. |
| `routerProvider` | `openrouter` | Onde o modelo de decisão roda: `openrouter` ou `nvidia`. |
| `nvidiaApiKey` | — | Chave da NVIDIA NIM (`nvapi-…`), usada quando `routerProvider` é `nvidia`. |
| `routerModel` | vazio | Modelo que classifica cada prompt. Vazio usa o padrão do provedor: `nvidia/nemotron-3.5-lightning:free` na OpenRouter, `minimaxai/minimax-m3.1-flash` na NVIDIA. Precisa aceitar resposta em JSON. |
| `routeSubagents` | `false` | Aplica a decisão também aos subagentes. |
| `cacheTtl` | `auto` | Duração do prompt cache: `1h` em assinatura Claude, `5m` com chave de API ou provedor de nuvem. `auto` detecta pelo ambiente. |
| `showBand` | `true` | Faixa acima da caixa de prompt. |
| `showFooter` | `false` | Também escreve a linha sob cada resposta (no app desktop ela fica dobrada num "aviso do Claude Code"). |

## Usar a NVIDIA NIM

1. Crie uma chave em <https://build.nvidia.com> (começa com `nvapi-`).
2. Coloque a chave em `nvidiaApiKey` e mude `routerProvider` para `nvidia`, com `/plugin configure mercury-router@pedro-mods`.
3. Rode `/reload-plugins` e confira com `/router`.

Nem todo modelo listado em `https://integrate.api.nvidia.com/v1/models` responde para a sua conta: muitos devolvem 404. O padrão, `minimaxai/minimax-m3.1-flash`, foi testado e acertou os quatro prompts de exemplo em 1 a 2 segundos. Confira os limites da camada gratuita na sua conta: o mod faz uma chamada por prompt.

## Como ele decide (resumo)

- Prompts que só confirmam ("ok, entendi", "valeu") ficam em effort **low**, no modelo que já está com o cache quente.
- "Sim, pode fazer", "continua" e parecidos herdam a decisão anterior, pois carregam a dificuldade do turno anterior.
- Perguntas triviais ficam em **low**. Trabalho de várias etapas nunca roda abaixo de **high** no Sonnet.
- Com o cache do modelo atual quente, o mod mantém o modelo e ajusta só o effort. O Haiku só entra em perguntas triviais e com contexto pequeno.
- Duas ferramentas com erro no mesmo turno, ou você dizendo "ainda está quebrado", sobem o effort e depois o modelo.
- O effort `max` nunca é escolhido automaticamente.

## Desinstalar

```bash
claude plugin uninstall mercury-router@pedro-mods
claude plugin marketplace remove pedro-mods
```

Depois apague a chave em <https://openrouter.ai/keys>, se não for mais usá-la.

## Desenvolvimento

```bash
claude plugin validate .
claude plugin test .
```

Os testes ficam em `hooks/router.test.ts`.

# PDF semanal da Escala / Relatório de revezamento executado — desenho técnico (para aprovação)

Status: **desenho APROVADO; implementado em DEV/Preview (nada em PROD).** Seção 12 descreve o que foi implementado e as decisões finais (acima valem as decisões da seção 12 quando diferirem).

## 0. O que existe hoje (investigado)
| Dado | Onde | Observação |
|---|---|---|
| Escala oficial | `escala_producao_alocacoes` (+ `escala_producao_dias.periodos_snapshot`) | linhas por (data, período, funcionário): máquina/produto/etapa/operação/peças, `origem` auto/manual, `excecao_revezamento`. No PROD só existe a partir de **20/10/2026** (9 dias). |
| Versões temporais do plano | `escala_plano_versoes` (append-only, `valido_desde`, `hash_plano`, linhas) | só desde **21/10** (34 versões, semanas 19/10 e 26/10). Permite saber "qual era o plano em T". |
| Execução real | `apontamentos_producao` (estado atual; edição = UPDATE no lugar; histórico em `apontamento_producao_historico`) | uma linha por (máquina, período, data): funcionário, produto, etapa, **operacao_id gravada**, produzido/refugo, `status` produzindo/sem_producao (+motivo; sem_producao não tem pessoa). |
| Ausências | `ausencias_funcionarios` (+ atraso em aberto) e histórico | janelas por período. |
| Ajuste manual auditado | `escala_producao_eventos` tipo `edicao_manual` (motivo, antes/depois, usuário) | hoje 0 eventos. |
| Hash / JSON canônico | `src/features/escala/hashCanonico.ts` (`sha256Hex`, JSON canônico determinístico, TS puro) | reaproveitável. |
| Regra de revezamento | `src/features/escala/rotacao.ts` | mesma operação em períodos consecutivos; M3→T1 conta; T3→M1 zera. |
| Auditoria de usuário | `usuarios`, `escala_usuario_atual()`, `is_admin()`, `has_permissao('escala_producao')` | reutilizáveis. |
| PDF/QR | **nenhuma biblioteca instalada** | precisa adicionar (ver §6). |

**Achado que molda o desenho:** a Escala oficial e a execução real divergem muito. Em 26/10, em M1 só 1 de 15 pessoas operou a máquina prevista e 13 fizeram outra operação (M2 0/15; M3 1/15). Logo o relatório EXECUTADO **não pode** partir da Escala; tem que partir dos apontamentos.

## 1. Fonte canônica do EXECUTADO
Por (funcionário, dia produtivo, período já encerrado), em ordem de precedência:
1. **Apontamento `produzindo` da pessoa naquele período** → fonte `APONTAMENTO` (evidência forte): máquina, operação (a gravada no apontamento), produto, boas/refugo. Duas máquinas no mesmo período aparecem as duas.
2. **Ausência registrada** que cobre o período (e nenhum apontamento da pessoa) → `AUSÊNCIA` (nunca inventa posto). Ausência + apontamento no mesmo período = inconsistência, mostrada ("apontamento prevalece").
3. **Sem apontamento nem ausência, com linha oficial com posto:**
   - a máquina foi apontada por OUTRA pessoa, ou lançada `sem_producao` → `NÃO COMPROVADO` (oficial contradito; onde a pessoa esteve = dado insuficiente);
   - a máquina não tem nenhum apontamento → `ESCALA OFICIAL CONSOLIDADA, SEM APONTAMENTO` (evidência fraca, marcada †; nunca equiparada a apontamento).
4. Linha oficial sem posto → `SEM POSTO` (fonte oficial); sem nenhuma linha/evidência → `SEM EVIDÊNCIA`.
5. `sem_producao` (não tem pessoa): vira o quadro "máquinas sem produção por período" com o motivo (falta_operador/falta_material/…).
Nada é inferido além disso. Período ainda em andamento ou depois do "consolidado até" não entra.

## 2. Divergência Escala × Apontamento
Nunca se reescreve nada. Cada célula do EXECUTADO guarda também o **planejado** (linha oficial consolidada do período) e um indicador `planejado ≠ realizado` quando máquina ou operação diferem; o PDF mostra o realizado e, discretamente, "Planejado diferente do realizado" com o planejado em nota. O relatório de Escala PLANEJADA (A) mostra só o planejado.
Revezamento do executado é validado **sobre o executado**: pares M1→M2, M2→M3, M3→T1, T1→T2, T2→T3 (T3→M1 reinicia). Pares com `AUSÊNCIA`/`SEM POSTO` não se aplicam; pares com `NÃO COMPROVADO`/`SEM EVIDÊNCIA` são **não verificáveis** e contados à parte. Resumo em três estados — **SIM** (0 violações, 0 não verificáveis), **SIM, COM RESSALVAS (N pares não verificáveis)**, **NÃO (N violações listadas: pessoa, dia, períodos, operação)**. Nunca se esconde violação histórica.

## 3. Snapshot congelado
Uma RPC de leitura (`escala_relatorio_fontes(semana)`, uma única chamada/transação ⇒ visão consistente) devolve tudo que o relatório usa: dias e períodos, linhas oficiais, versão do plano vigente (id + `hash_plano`), apontamentos atuais da semana (campos relevantes), ausências, eventos `edicao_manual`, equipe e **nomes** (funcionário, máquina, produto, operação) como estavam. O servidor monta o conteúdo (função pura, determinística) e grava o **snapshot** (texto canônico + jsonb) — o PDF é renderizado a partir do snapshot, nunca de consulta nova. O cliente não envia conteúdo: só pede "gerar semana X, tipo Y".

## 4. Hash
`hash = SHA-256(texto canônico do snapshot)` (JSON canônico: chaves ordenadas, sem ruído de float; o texto exato fica em `conteudo_canonico`). O snapshot inclui código, versão, tipo, parcial/final, `consolidado_ate` e `gerado_em`; portanto o hash amarra o conteúdo e a identidade do relatório. O banco **verifica** (CHECK `hash = encode(sha256(convert_to(conteudo_canonico,'utf8')),'hex')`) e recusa UPDATE/DELETE (trigger). O rodapé mostra o hash abreviado (12 caracteres); o completo fica no sistema e na página de verificação. Também se guarda `pdf_sha256` (hash do arquivo entregue) — a página de verificação permite conferir um PDF recebido (o navegador calcula o SHA-256 do arquivo e compara).
`fonte_digest`: SHA-256 dos insumos (apontamentos relevantes + ausências + versão do plano). É comparado com os dados atuais para sinalizar "Existem alterações posteriores ao relatório vN" **sem alterar** o PDF antigo.

## 5. Onde guardar
Migration aditiva, só tabelas novas (nenhuma tabela existente é alterada):
- `escala_relatorios` (append-only): `id uuid`, `codigo` (`ESC-AAAA-SS-NNNN`), `semana_inicio`, `tipo` (planejada|executada), `versao`, `status` (parcial|final), `consolidado_ate`, `gerado_em` (checado contra `now()`), `gerado_por`, `schema_versao`, `conteudo_canonico text`, `conteudo jsonb`, `hash_sha256`, `fonte_digest`, `pdf_sha256`, `pdf_bytes`; `unique(semana_inicio, tipo, versao)`.
- `escala_relatorio_pdfs` (append-only): `relatorio_id`, `pdf bytea` (≈100–300 KB). Dentro do banco ⇒ coberto pelo backup `pg_dump` existente; sem Storage novo.
- RLS: leitura para admin/`escala_producao`; escrita só por RPC/serviço. A auditoria "quem/quando/semana/versão/hash/tipo/parcial-final" são as próprias colunas da linha imutável.
- Código: `ESC-AAAA-SS-NNNN` com AAAA/SS = ano e semana ISO (26/10/2026 = semana 44) e NNNN = nº da família (semana+tipo) no ano-semana; todas as versões da família mantêm o código e mudam `versao` (v1, v2…).

## 6. PDF e QR
- Geração no servidor (route handler Node), a partir do snapshot; A4 paisagem, só Helvetica/preto-e-branco (legível impresso), páginas numeradas, rodapé fixo (Sittech Soluções Industriais · ID · versão · Página X de Y · hash abreviado).
- Estrutura: capa/resumo (identificação, semana, gerado em HH:MM:SS SP, versão, PARCIAL/FINAL + "dados consolidados até", resumo do revezamento, contagens por fonte) → **grade por funcionário** (linhas = dias, colunas M1..T3; cada célula: máquina / operação / produto, marcador de fonte e de divergência) → violações e não verificáveis → ausências e sem produção → declaração + assinaturas (Responsável, Testemunha 1 e 2 com Nome/CPF/Assinatura/Data em branco; CPF nunca preenchido pelo sistema).
- Bibliotecas novas: `pdf-lib` (PDF, sem dependências nativas) e `qrcode` (gera a matriz; o QR é desenhado como vetor). Versões fixas; revisão de licença (MIT).
- QR → `{BASE_URL}/relatorios/escala/verificar/{id-da-versão}` (UUID da versão, não adivinhável). `BASE_URL` vem de configuração do servidor, não do cliente.
- Página `/relatorios/escala/verificar/{id}`: somente leitura; mostra existe, semana, tipo, geração, hash completo, versão, parcial/final, e "existe versão mais recente / alterações posteriores". Sem dados de funcionários. **Decisão sua:** pública (sem login) ou exigindo login.
- Arquivo: `SITTECH_Revezamento_2026-10-26_a_2026-11-01_v1.pdf`.

## 7. Versões, parcial e final
- Gerar de novo nunca apaga: cria `versao+1` com novo `gerado_em`, hash, `gerado_por`. As anteriores seguem consultáveis e baixáveis.
- **PARCIAL** enquanto a semana não terminou (faixa "RELATÓRIO PARCIAL — dados consolidados até DD/MM/AAAA HH:MM"); **FINAL** depois do fim do último dia produtivo (proposta: +2 h de tolerância para lançamentos tardios; decisão sua). Final só se gera depois dessa hora.
- Correção posterior de apontamento/escala: o PDF antigo não muda; a tela marca "Existem alterações posteriores ao relatório vN" e oferece nova versão.

## 8. Interface e segurança
Botão **GERAR PDF** em `/escala-producao` (menu: Escala planejada / Revezamento executado) → confirmação mostrando semana, tipo, parcial/final, "consolidado até" e a versão que será criada; lista "Relatórios desta semana" (versão, status, data, hash abreviado, baixar, verificar). Gerar exige `admin` ou `escala_producao`; consulta histórica pela mesma permissão (decisão: permissão dedicada?). O conteúdo vem do banco no servidor; nada digitável pelo usuário.

## 9. Testes (os pedidos)
Funções puras (conteúdo, revezamento, fontes, hash) e SQL em rollback: semana normal conforme; M3→T1; violação real aparece; ausência; posto sem produção; planejado ≠ apontado; parcial; final; duas versões; alteração posterior detectada pelo `fonte_digest`; hash muda com o conteúdo e é igual para o mesmo snapshot (TS = PostgreSQL `sha256`); relatório antigo não muda (UPDATE/DELETE recusados); QR/URL aponta para o id correto; PDF determinístico a partir do mesmo snapshot (mesmos bytes); permissões.

## 10. Impacto
Banco: 2 tabelas novas + 3–4 funções; sem mudar tabelas existentes nem a Escala/Produção Real/Previsão. Código: módulo de conteúdo (puro), renderizador PDF, 2 route handlers, 1 página pública, ajustes na tela da Escala. Dependências: `pdf-lib`, `qrcode`.

## 11. Riscos
1. **Histórico curto:** Escala só desde 20/10, versões de plano desde 21/10 — o primeiro relatório completo possível é o da semana 26/10; 19/10 sairia parcial/sem planejado confiável.
2. **O executado é tão bom quanto os apontamentos** (quem lança, quando). O hash prova integridade do que o sistema registrou, não a verdade dos fatos; por isso a declaração e as assinaturas, e a redação sem valor jurídico absoluto.
3. A Escala oficial hoje diverge da execução: muitas células "planejado ≠ realizado" (por desenho); pode surpreender.
4. Células "sem apontamento" existirão; o revezamento "SIM" pode vir com ressalvas — preferi não afirmar o que não se comprova.
5. Apontamentos corrigidos depois (histórico de edição) mudam a resposta de uma nova versão; as anteriores ficam preservadas.
6. Página de verificação pública expõe metadados mínimos (sem nomes); confirmar a decisão.
7. Fuso: tudo em `timestamptz`, impresso em America/Sao_Paulo.
8. Dependência de bibliotecas novas e de PDF gerado no servidor (tempo/memória em Vercel Hobby: ~9 páginas, esperado ≪ 10 s).

## 12. Implementação (DEV/Preview) e decisões finais
- **Migration** `20261031100000_escala_relatorios.sql`: permissão `escala_relatorios` (CHECK de `usuario_permissoes`), tabelas append-only `escala_relatorios` e `escala_relatorio_pdfs`, triggers de imutabilidade e de conferência do hash do PDF, RPCs `escala_relatorio_fontes` (insumos consistentes, só service_role), `escala_relatorio_proximo`, `escala_relatorio_registrar` (só service_role; o BANCO recalcula o hash do conteúdo e do PDF e checa o relógio), `escala_relatorio_listar` (permissão) e `escala_relatorio_verificar` (só service_role; devolve metadados e o conteúdo canônico apenas para o servidor recalcular o hash).
- **Código do relatório:** `ESC-EXEC-AAAA-SS-NNNN` (executado) e `ESC-PLAN-AAAA-SS-NNNN` (planejado) — famílias distintas; versões v1, v2… compartilham o código da família; o QR aponta para o **id da versão**.
- **Conteúdo canônico** (`src/features/escala-relatorio/conteudo.ts`): funcionário × dia × período com fonte (APONTAMENTO / AUSENCIA / OFICIAL_SEM_APONTAMENTO / SEM_POSTO_OFICIAL / NAO_COMPROVADO / SEM_EVIDENCIA; PLANEJADO / PLANEJADO_SEM_POSTO na planejada), posto planejado e marca "planejado diferente do realizado", sem produção por máquina, ausências, revezamento, cobertura, versão do plano usada e digest dos insumos. Hash = SHA-256 do JSON canônico; o texto exato fica em `conteudo_canonico`.
- **Cobertura de evidência** = (comprovados por apontamento + comprovados por ausência) ÷ esperados, em aritmética inteira (décimos de ponto percentual, meio-para-cima): 225/240 = 93,8%. Esperado = (pessoa da equipe produtiva da semana ou com apontamento) × dia produtivo × período consolidado, ativa naquele período segundo a linha do tempo de situação. Apontamento de quem não era esperado não entra na cobertura (contado à parte).
- **Revezamento:** estados SIM / SIM COM RESSALVAS / NÃO e a frase explicativa vão no PDF. Só se afirma onde os DOIS períodos estão comprovados por apontamento (usa a `operacao_id` gravada no apontamento); pares com ausência/sem posto são "não aplicáveis"; escala oficial sem apontamento, não comprovado e sem evidência são "não verificáveis".
- **Parcial/Final:** decidido pelo sistema. FINAL = fechamento lógico (ver §13; substitui a regra antiga "último período + 2 h") registrado em `elegivel_final_em`; o banco recusa FINAL antes disso. No PARCIAL só entram períodos encerrados há ≥ 30 min (os apontamentos ainda chegam) e o PDF traz a faixa "RELATÓRIO PARCIAL — dados consolidados até …".
- **Alterações posteriores:** `fonte_digest` (apontamentos, linhas oficiais e ausências dos períodos considerados + equipe/dias/linha do tempo) comparado com os insumos de agora na lista e na página de verificação; o relatório antigo não é alterado.
- **PDF** (`pdf.ts`, pdf-lib + qrcode): A4 paisagem, preto e branco, Helvetica, páginas numeradas, rodapé (Sittech · código · versão · Página X de Y · hash abreviado), página 1 com identificação/resumo/QR, grade por funcionário, violações, sem produção, ausências, declaração e assinaturas (CPF em branco). Determinístico: mesmo snapshot ⇒ mesmos bytes.
- **Página pública** `/relatorios/escala/verificar/{id}`: somente leitura; mostra relatório válido, código, semana, tipo, versão, parcial/final, gerado em, hashes, integridade, versões posteriores e alterações posteriores nos dados-fonte; **nunca** nomes, CPF, escala, apontamentos ou ausências. Permite conferir um PDF recebido (hash calculado no navegador).
- **UI:** botão GERAR PDF (com `escala_relatorios`) em /escala-producao → modal para gerar nova versão (planejada/executada), lista das versões com baixar PDF, hash abreviado, marca "Existem alterações posteriores aos dados utilizados neste relatório" e link de verificação.
- **Dependências novas:** `pdf-lib@1.17.1`, `qrcode@1.5.4` (fixadas); declaração mínima de tipos do `qrcode` em `src/types/qrcode.d.ts`.
- **Variável opcional:** `RELATORIO_BASE_URL` (origem usada no QR; sem ela vale a origem da requisição).

## 13. Fechamento automático e envio por e-mail (DEV/Preview — nada em PROD)

**Regra.** O Revezamento executado é finalizado sozinho na **sexta-feira 18:00 (America/Sao_Paulo)**; se o sábado for dia produtivo (lido de `previsao_dias_produtivos`), na **sábado 18:00** (domingo produtivo, se um dia existir, fecha no domingo 18:00). Sexta sem produção também fecha na sexta. Semana sem nenhum dia produtivo não gera relatório. O horário é **lógico**: um worker que roda às 18:07 gera "gerado em 18:07, consolidado até 18:00". No FINAL a tolerância de 30 min dos apontamentos é 0 (o prazo declarado é o próprio 18:00); no PARCIAL continua 30 min.

**Fluxo (sem tela):** worker → config ligada? → semana ≥ `desde_semana`? → hora ≥ fechamento lógico? → reivindica o fechamento (lease) → lê os insumos **como de 18:00** → snapshot canônico → cobertura/conformidade → hash do conteúdo → PDF → hash do PDF → registra a versão (uma transação, conferida pelo banco) → armazena o PDF → envia o e-mail com o PDF **anexado** → registra o resultado.

**Estado conhecido às 18:00 (`escala_relatorio_fontes(semana, como_de)`).** Apontamentos/ausências criados depois são ignorados; edições posteriores são desfeitas pelo histórico (valor mais antigo entre as edições posteriores); o plano oficial vem da versão de `escala_plano_versoes` vigente no instante (linhas e períodos do dia); situação de funcionário só vale o registrado até o instante. Limites conhecidos: exclusão de apontamento depois das 18:00 não é reconstruível (o histórico some em cascata) e a equipe da semana não tem carimbo (vale a atual). Em ambos os casos o digest acusa "alterações posteriores".

**Tabelas.** `escala_relatorio_config` (1 linha; nasce **desligada**; `desde_semana` impede retroativo; destinatário `tamara@sittech.com.br`; alterada só por `escala_relatorio_config_definir`, admin); `escala_relatorio_fechamentos` (1 por semana+tipo: `fechamento_logico_em`, geração `pendente/gerado/erro` e e-mail `pendente/enviado/falhou` **separados**, tentativas, último erro, `email_enviado_em`, `email_provedor_id`, lease); `escala_relatorios.fechamento_automatico` (+ índice único parcial: **um** automático por semana+tipo; `gerado_por` nulo = sistema; só FINAL e só executado).

**Idempotência/retry.** unique(semana,tipo) + lease de 4 min + índice único parcial: execuções simultâneas geram um só final e um só e-mail. Falha técnica de geração não cria v2 (nada é gravado; nova tentativa gera a v1). Falha de e-mail nunca regera: a retentativa reenvia o **mesmo PDF**. Retentativa automática a cada ≥ 10 min, até 12 tentativas por etapa; depois só pelo botão **REENVIAR E-MAIL** (mesmo PDF; chave de idempotência por clique).

**Depois das 18:00.** A v1 não muda. A tela mostra "Existem alterações posteriores aos dados utilizados neste relatório."; versões novas só por geração manual (nunca reenviadas automaticamente). Parcial nunca é enviado automaticamente; a Escala planejada só é gerada manualmente.

**Agendamento.** O worker `/api/escala/drenar` (GitHub Actions a cada 5 min, `CRON_SECRET`) passou a chamar o fechamento ao final de cada ciclo (barato: só trabalha na sexta/sábado ≥ 18:00 ou em retentativas). Segunda via independente: Vercel Cron `0 21 * * 5,6` (18:00 SP; na Hobby o minuto é aproximado). Nada depende do navegador.

**E-mail.** Não existia infraestrutura. `src/lib/escala-relatorio/email.ts`: interface `ProvedorEmail` com **Resend** (HTTPS `fetch`, sem dependência nova; `RESEND_API_KEY`, `ESCALA_EMAIL_FROM` com domínio verificado; anexo base64; `Idempotency-Key`), `mock` (testes/DEV) e "nenhum" (falha explícita). **Trava de ambiente:** fora de `VERCEL_ENV=production`, o Resend só entrega a destinatários listados em `ESCALA_EMAIL_PERMITIDOS`; os demais são bloqueados e a tentativa fica registrada como falha. Segredos só em variável de ambiente do servidor; o banco guarda destinatário, status, tentativas, último erro e id do provedor — nunca credencial.

**Exemplos:** `docs/relatorio-escala-exemplos/EXEMPLO_ILUSTRATIVO_email.txt` e `EXEMPLO_ILUSTRATIVO_fechamento_automatico_SITTECH_Revezamento_2026-11-02_a_2026-11-08_v1.pdf` (dados fictícios).

**Ativar em PROD (quando autorizado):** migration → código → configurar `ESCALA_EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `ESCALA_EMAIL_FROM`, `RELATORIO_BASE_URL` → `select escala_relatorio_config_definir(true, '<segunda da semana inicial>')` → verificar o envio de teste a um destinatário interno antes de ligar para a Tamara.

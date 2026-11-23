-- Tarefas das planilhas "CONTROLE KAJU": Natal Disney, Natal Petit e Tarefas novembro (sem projeto).
-- Só entram onde o projeto existe (produção); em outros bancos não faz nada. Ids fixos: rodar de novo não duplica.
-- Complexidade não estava na planilha: média. A ordem de criação segue a da planilha.

INSERT INTO "tasks" ("id", "organization_id", "project_id", "title", "complexity", "status", "completed_on", "completed_at", "created_at", "updated_at")
SELECT v.id, p."organization_id", p."id", v.title, 'medium'::"TaskComplexity", v.status::"TaskStatus", v.completed_on,
       CASE WHEN v.completed_on IS NULL THEN NULL ELSE (v.completed_on + TIME '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
       TIMESTAMPTZ '2026-11-10 12:00:00-03' + v.ord * INTERVAL '1 second', now()
FROM "projects" p, (VALUES
  ('task_seed_disney_01', 'Comprar EPIS', 'done', DATE '2026-11-18', 1),
  ('task_seed_disney_02', 'Comprar embalagens', 'pending', NULL, 2),
  ('task_seed_disney_03', 'Comprar bolinhas', 'done', DATE '2026-11-18', 3),
  ('task_seed_disney_04', 'Fazer bolinhas', 'pending', NULL, 4),
  ('task_seed_disney_05', 'Comprar todos os adereços da arvore', 'pending', NULL, 5),
  ('task_seed_disney_06', 'Contratar andaime', 'pending', NULL, 6),
  ('task_seed_disney_07', 'Contratar a equipe e fechar datas (incluindo o Luft)', 'pending', NULL, 7),
  ('task_seed_disney_08', 'Comprar as caixas para fazer as caixinhas de presente', 'pending', NULL, 8),
  ('task_seed_disney_09', 'Fazer as caixas', 'pending', NULL, 9),
  ('task_seed_disney_10', 'Comprar laços para as caixinhas', 'pending', NULL, 10),
  ('task_seed_disney_11', 'Fazer uma mapa 3d da árvore em escala e posicionar TODOS os elementos por área', 'pending', NULL, 11),
  ('task_seed_disney_12', 'Um plano de ação da montagem e desmontagem', 'pending', NULL, 12),
  ('task_seed_disney_13', 'Montar a árvore dia 02 ou 03', 'pending', NULL, 13),
  ('task_seed_disney_14', 'Desmontar a árvore', 'pending', NULL, 14)
) AS v(id, title, status, completed_on, ord)
WHERE p."id" = 'cmwtkl5py000zrt0191i440ta'
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "tasks" ("id", "organization_id", "project_id", "title", "complexity", "status", "completed_on", "completed_at", "created_at", "updated_at")
SELECT v.id, p."organization_id", p."id", v.title, 'medium'::"TaskComplexity", v.status::"TaskStatus", v.completed_on,
       CASE WHEN v.completed_on IS NULL THEN NULL ELSE (v.completed_on + TIME '12:00') AT TIME ZONE 'America/Sao_Paulo' END,
       TIMESTAMPTZ '2026-11-10 12:00:00-03' + v.ord * INTERVAL '1 second', now()
FROM "projects" p, (VALUES
  ('task_seed_petit_01', 'Comprar os adereços: cinto, luva, bota, meias calças listradas, meia social pro papai noel', 'done', DATE '2026-11-14', 1),
  ('task_seed_petit_02', 'Colar strass no papai noel', 'pending', NULL, 2),
  ('task_seed_petit_03', 'Colar arabesco no papai noel', 'pending', NULL, 3),
  ('task_seed_petit_04', 'Talvez customizar a bota e o cinto', 'pending', NULL, 4),
  ('task_seed_petit_05', 'Levar elanca e enximento na Natalícia para a barriga', 'done', DATE '2026-11-18', 5),
  ('task_seed_petit_06', 'Fazer 6 laços de veludo', 'pending', NULL, 6),
  ('task_seed_petit_07', 'Comprar os botões de biscoito (ou fazer)', 'pending', NULL, 7),
  ('task_seed_petit_08', 'Comprar ou fazer & Aplicar a bengala, bala e bolachinha (12 trios)', 'in_progress', NULL, 8),
  ('task_seed_petit_09', 'Comprar balinhas pequenininhas para os laços', 'pending', NULL, 9),
  ('task_seed_petit_10', 'Levar o tecido branco para a Nat fazer os babados dos vetidos', 'done', DATE '2026-11-18', 10)
) AS v(id, title, status, completed_on, ord)
WHERE p."id" = 'cmwtkkw5r0021n401d9ke3jau'
ON CONFLICT ("id") DO NOTHING;

-- Planilha "Tarefas novembro": tarefas sem projeto, na organização da Casa Kaju (a dona do projeto
-- Natal Disney). Os extras da planilha viram a descrição.
INSERT INTO "tasks" ("id", "organization_id", "project_id", "title", "description", "complexity", "status", "completed_on", "completed_at", "created_at", "updated_at")
SELECT v.id, p."organization_id", NULL, v.title, v.description, v.complexity::"TaskComplexity", v.status::"TaskStatus", v.completed_on,
       CASE WHEN v.status = 'done' THEN COALESCE((v.completed_on + TIME '12:00') AT TIME ZONE 'America/Sao_Paulo', TIMESTAMPTZ '2026-11-20 12:00:00-03') END,
       TIMESTAMPTZ '2026-10-01 12:00:00-03' + v.ord * INTERVAL '1 second', now()
FROM "projects" p, (VALUES
  ('task_seed_geral_01', 'Ir na prova bailarinos (sapatos e collant)', NULL, 'medium', 'done', DATE '2026-11-19', 1),
  ('task_seed_geral_02', 'Ir na fundação achar os chapéis', NULL, 'medium', 'done', DATE '2026-11-18', 2),
  ('task_seed_geral_03', 'Ir comprar os EPIS', NULL, 'medium', 'done', DATE '2026-11-18', 3),
  ('task_seed_geral_04', 'Confirmar com a Nat se deu certo os tecidos', NULL, 'medium', 'done', NULL, 4),
  ('task_seed_geral_05', 'Falar com os expositores sobre Feira - 21', NULL, 'low', 'done', DATE '2026-11-18', 5),
  ('task_seed_geral_06', 'Organizar feira - 28', NULL, 'medium', 'pending', NULL, 6),
  ('task_seed_geral_07', 'Imprimir emails do APUAMA pra FCC', NULL, 'medium', 'done', DATE '2026-11-18', 7),
  ('task_seed_geral_08', 'Instalar lona no Ateliê', NULL, 'medium', 'done', DATE '2026-11-11', 8),
  ('task_seed_geral_09', 'Arrumar JARDIM', NULL, 'high', 'done', DATE '2026-11-11', 9),
  ('task_seed_geral_10', 'Criar grupo dos residentes e mandar instrução da porta', NULL, 'medium', 'done', DATE '2026-11-14', 10),
  ('task_seed_geral_11', 'Finalizar Midia KIT', NULL, 'medium', 'pending', NULL, 11),
  ('task_seed_geral_12', 'Colocar contas em débito automático', NULL, 'medium', 'pending', NULL, 12),
  ('task_seed_geral_13', 'Dar uma resposta para o Anderson', NULL, 'low', 'done', DATE '2026-11-13', 13),
  ('task_seed_geral_14', 'Editar vídeo de Yoga', NULL, 'medium', 'done', DATE '2026-11-19', 14),
  ('task_seed_geral_15', 'Tranferir copel', NULL, 'medium', 'done', DATE '2026-11-12', 15),
  ('task_seed_geral_16', 'Quitar o que falta p/ a Cibraco', NULL, 'medium', 'pending', NULL, 16),
  ('task_seed_geral_17', 'Comprar coisas online figurinos Petiz', NULL, 'medium', 'done', DATE '2026-11-17', 17),
  ('task_seed_geral_18', 'Atualizar forms de inscrição do Yoga', NULL, 'low', 'done', DATE '2026-11-18', 18),
  ('task_seed_geral_19', 'Mandar notas Reticências para o Edran', NULL, 'low', 'done', DATE '2026-11-12', 19),
  ('task_seed_geral_20', 'Enviar contrato de locação para a Marcela e cobrar pagamento da Borracharia', NULL, 'low', 'done', DATE '2026-11-18', 20),
  ('task_seed_geral_21', 'Arrumar vazamento da torneira', NULL, 'medium', 'in_progress', NULL, 21),
  ('task_seed_geral_22', 'Solicitar reparo da caixa d''agua', NULL, 'medium', 'pending', NULL, 22),
  ('task_seed_geral_23', 'Adicionar os feirantes no grupo e ver demanda de pessoas fixas semanais', NULL, 'medium', 'done', DATE '2026-11-11', 23),
  ('task_seed_geral_24', 'Comprar tapetinhos de yoga', NULL, 'medium', 'done', NULL, 24),
  ('task_seed_geral_25', 'Arrumar extensão', NULL, 'medium', 'done', DATE '2026-11-11', 25),
  ('task_seed_geral_26', 'Assinar o contrato', NULL, 'medium', 'done', NULL, 26),
  ('task_seed_geral_27', 'Desfazer caixas + limpeza', NULL, 'medium', 'done', NULL, 27),
  ('task_seed_geral_28', 'Arrumar o gás', NULL, 'medium', 'done', DATE '2026-11-11', 28),
  ('task_seed_geral_29', 'Arrumar o sifão', NULL, 'low', 'done', DATE '2026-11-12', 29),
  ('task_seed_geral_30', 'Colocar alarme', NULL, 'medium', 'done', NULL, 30),
  ('task_seed_geral_31', 'Atuaizar alvará de funcionamento', NULL, 'medium', 'pending', NULL, 31),
  ('task_seed_geral_32', 'Levar tecidos Positivo para a Regiane', NULL, 'medium', 'done', DATE '2026-11-13', 32),
  ('task_seed_geral_33', 'Comprar álcool e paninhos pros tapetinhos', NULL, 'medium', 'done', NULL, 33),
  ('task_seed_geral_34', 'Organizar evento de Yoga e chamar lojas/ serviços', NULL, 'medium', 'done', NULL, 34),
  ('task_seed_geral_35', 'Pegar sapatos da Santos Andrade - Edu Giacomini', NULL, 'medium', 'done', NULL, 35),
  ('task_seed_geral_36', 'Contrato e novos acordos com a Mikaela', NULL, 'medium', 'done', NULL, 36),
  ('task_seed_geral_37', 'Fazer orçamento da Petit', NULL, 'medium', 'done', NULL, 37),
  ('task_seed_geral_38', 'Elaborar MidiaKit', NULL, 'high', 'done', NULL, 38),
  ('task_seed_geral_39', 'Criar grupo editais com a Alyssa', NULL, 'low', 'done', NULL, 39),
  ('task_seed_geral_40', 'Atualizar planilha de editais', NULL, 'medium', 'done', NULL, 40),
  ('task_seed_geral_41', 'Falar com as locações da casa sobre a mudança', NULL, 'low', 'done', NULL, 41),
  ('task_seed_geral_42', 'Lista da compra de tecidos - POSITIVO PG', NULL, 'medium', 'done', NULL, 42),
  ('task_seed_geral_43', 'Lista de adereços - POSITIVO PG', NULL, 'medium', 'done', NULL, 43),
  ('task_seed_geral_44', 'Lista de customizações - POSITIVO PG', NULL, 'medium', 'done', NULL, 44),
  ('task_seed_geral_45', 'Pensar na PROGRAMAÇÃO para mandar no CIRCUITO INDEPENDÊNTE do FTC', 'Inscrições em MARÇO de 2026', 'high', 'pending', NULL, 45),
  ('task_seed_geral_46', 'Fazer palestra UTFPR', NULL, 'high', 'done', NULL, 46),
  ('task_seed_geral_47', 'Cenografia e Figurino - NO PALCO COM OUTRAS MULHERES', NULL, 'high', 'done', NULL, 47),
  ('task_seed_geral_48', 'Cenografia - RETICÊNCIAS', NULL, 'high', 'done', NULL, 48),
  ('task_seed_geral_49', 'Orçamento Isa', NULL, 'low', 'done', NULL, 49),
  ('task_seed_geral_50', 'Contrato de Residência - Mikaela', NULL, 'medium', 'done', NULL, 50),
  ('task_seed_geral_51', 'Contrato de Residência - Tossi', NULL, 'medium', 'done', NULL, 51),
  ('task_seed_geral_52', 'Agenda do fim do ano', NULL, 'medium', 'pending', NULL, 52),
  ('task_seed_geral_53', 'Palestra UTFPR', NULL, 'high', 'done', NULL, 53),
  ('task_seed_geral_54', 'Solicitar desligamento auxiliar', NULL, 'low', 'done', NULL, 54),
  ('task_seed_geral_55', 'Levar aviamentos Petiz para a Natalícia', NULL, 'medium', 'done', NULL, 55),
  ('task_seed_geral_56', 'Cobrar o Tossi', NULL, 'medium', 'pending', NULL, 56),
  ('task_seed_geral_57', 'Orçamento musical Associação dos Cegos', NULL, 'medium', 'done', NULL, 57),
  ('task_seed_geral_58', 'Organizar agenda do ano que vem (focado no Me Encontre, Apuama e Exílio)', NULL, 'medium', 'pending', NULL, 58),
  ('task_seed_geral_59', 'Programar eventos de novembro na Kaju', NULL, 'medium', 'pending', NULL, 59),
  ('task_seed_geral_60', 'Ir na fundação', NULL, 'medium', 'pending', NULL, 60),
  ('task_seed_geral_61', 'Ir na caixa cultural tentar pauta pro Apuama', NULL, 'medium', 'pending', NULL, 61),
  ('task_seed_geral_62', 'Solicitar o desligamento da luz perante a Copel e nos encaminhar o Protocolo de Desligamento, Fatura do consumo final e respectivo comprovante de pagamento;', 'DEPOIS DA VISTORIA', 'medium', 'done', DATE '2026-11-12', 62),
  ('task_seed_geral_63', 'O titular da conta nos solicite a elaboração de termo de autorização, para que, de posse deste documento, possa ir presencialmente em uma das Agências da Sanepar (localizada na Rua da Cidadania) proceder o pedido de Desligamento. É necessário nos encaminhar o protocolo desta solicitação, para podermos acompanhar o seu andamento.', 'DEPOIS DA VISTORIA', 'medium', 'done', DATE '2026-11-12', 63),
  ('task_seed_geral_64', 'Ver sobre taxa de manutenção do imóvél', NULL, 'low', 'done', NULL, 64),
  ('task_seed_geral_65', 'Conferir multa de desocupação do imóvel', NULL, 'medium', 'done', DATE '2026-11-17', 65),
  ('task_seed_geral_66', 'Contrato de locação - Marcela Perbitsch', NULL, 'low', 'done', DATE '2026-10-07', 66),
  ('task_seed_geral_67', 'Fazer orçamento da Disney', NULL, 'medium', 'done', NULL, 67),
  ('task_seed_geral_68', 'Receber do POSITIVO', 'Falta PG', 'medium', 'pending', NULL, 68),
  ('task_seed_geral_69', 'Repor estoque do Café para a Feira das Monte Serrat', NULL, 'medium', 'done', NULL, 69),
  ('task_seed_geral_70', 'Trocar a pilha da campainha', NULL, 'medium', 'done', NULL, 70),
  ('task_seed_geral_71', 'Pagar a água e solicitar religue', NULL, 'low', 'done', DATE '2026-10-07', 71)
) AS v(id, title, description, complexity, status, completed_on, ord)
WHERE p."id" = 'cmwtkl5py000zrt0191i440ta'
ON CONFLICT ("id") DO NOTHING;

-- Quem realizou ("Kao", "Ju"): a pessoa da equipe cujo nome começa assim. Se nenhuma ou mais de uma
-- pessoa bater, fica sem marcar (dá para marcar depois, reabrindo e concluindo de novo).
WITH who(task_id, nick) AS (VALUES
  ('task_seed_geral_02', 'Kao'),
  ('task_seed_geral_02', 'Ju'),
  ('task_seed_geral_03', 'Kao'),
  ('task_seed_geral_03', 'Ju'),
  ('task_seed_geral_05', 'Ju'),
  ('task_seed_geral_07', 'Ju'),
  ('task_seed_geral_08', 'Kao'),
  ('task_seed_geral_08', 'Ju'),
  ('task_seed_geral_09', 'Kao'),
  ('task_seed_geral_09', 'Ju'),
  ('task_seed_geral_14', 'Kao'),
  ('task_seed_geral_15', 'Ju'),
  ('task_seed_geral_18', 'Ju'),
  ('task_seed_geral_19', 'Ju'),
  ('task_seed_geral_20', 'Ju'),
  ('task_seed_geral_23', 'Kao'),
  ('task_seed_geral_23', 'Ju'),
  ('task_seed_geral_24', 'Kao'),
  ('task_seed_geral_25', 'Kao'),
  ('task_seed_geral_25', 'Ju'),
  ('task_seed_geral_26', 'Kao'),
  ('task_seed_geral_26', 'Ju'),
  ('task_seed_geral_28', 'Kao'),
  ('task_seed_geral_28', 'Ju'),
  ('task_seed_geral_30', 'Kao'),
  ('task_seed_geral_30', 'Ju'),
  ('task_seed_geral_33', 'Ju'),
  ('task_seed_geral_34', 'Kao'),
  ('task_seed_geral_34', 'Ju'),
  ('task_seed_geral_35', 'Kao'),
  ('task_seed_geral_35', 'Ju'),
  ('task_seed_geral_36', 'Ju'),
  ('task_seed_geral_36', 'Kao'),
  ('task_seed_geral_37', 'Kao'),
  ('task_seed_geral_37', 'Ju'),
  ('task_seed_geral_38', 'Kao'),
  ('task_seed_geral_39', 'Kao'),
  ('task_seed_geral_40', 'Ju'),
  ('task_seed_geral_41', 'Ju'),
  ('task_seed_geral_42', 'Kao'),
  ('task_seed_geral_42', 'Ju'),
  ('task_seed_geral_43', 'Ju'),
  ('task_seed_geral_43', 'Kao'),
  ('task_seed_geral_44', 'Ju'),
  ('task_seed_geral_44', 'Kao'),
  ('task_seed_geral_46', 'Kao'),
  ('task_seed_geral_48', 'Kao'),
  ('task_seed_geral_48', 'Ju'),
  ('task_seed_geral_49', 'Ju'),
  ('task_seed_geral_50', 'Kao'),
  ('task_seed_geral_51', 'Kao'),
  ('task_seed_geral_53', 'Kao'),
  ('task_seed_geral_53', 'Ju'),
  ('task_seed_geral_54', 'Ju'),
  ('task_seed_geral_57', 'Kao'),
  ('task_seed_geral_57', 'Ju'),
  ('task_seed_geral_64', 'Kao'),
  ('task_seed_geral_64', 'Ju'),
  ('task_seed_geral_66', 'Ju'),
  ('task_seed_geral_67', 'Kao'),
  ('task_seed_geral_67', 'Ju'),
  ('task_seed_geral_71', 'Ju')
),
matches AS (
  SELECT w.task_id, m."id" AS member_id, count(*) OVER (PARTITION BY w.task_id, w.nick) AS n
  FROM who w
  JOIN "tasks" t ON t."id" = w.task_id
  JOIN "organization_members" m ON m."organization_id" = t."organization_id"
  JOIN "users" u ON u."id" = m."user_id"
  WHERE lower(u."name") LIKE lower(w.nick) || '%'
)
INSERT INTO "task_completers" ("task_id", "member_id")
SELECT task_id, member_id FROM matches WHERE n = 1
ON CONFLICT DO NOTHING;

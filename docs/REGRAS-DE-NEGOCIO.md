# Regras de negócio do Kami

Uma linha por regra, com o teste que a garante. Se uma regra mudar, mude o
teste junto. Se uma regra nova entrar, ela ganha uma linha aqui e um teste.
`backend/tests/test_regras_doc.py` falha se algum teste citado aqui não
existir, para o documento não ficar desatualizado em silêncio.

Os testes estão em `backend/tests/` e são citados como `arquivo::teste`.
Valores (xp, limites) são os do código no momento da escrita. A fonte da
verdade é o código e o teste.

## API (todas as rotas)

| Regra | Descrição | Teste |
|---|---|---|
| API-01 | Apagar algo que não existe responde 404 com `codigo: nao_encontrado`, em toda rota DELETE | `test_regras_api.py::test_api_01_apagar_o_que_nao_existe_responde_404` |
| API-02 | Erro inesperado vira JSON com `codigo` e um `id` curto que também está no log, com headers CORS | `test_erros.py::test_erro_inesperado_vira_json_com_codigo_e_cors` |
| API-03 | Banco ocupado, disco cheio, banco inacessível e corrompido têm mensagem própria | `test_erros.py::test_erros_do_sqlite_tem_mensagem_propria` |
| API-04 | Erro esperado mantém a mensagem e ganha `codigo` (validação, não encontrado) | `test_erros.py::test_erros_esperados_ganham_codigo_e_mantem_a_mensagem` |
| API-05 | Sem o token de sessão, nenhuma rota responde (só `/health` e o preflight CORS) | `test_security.py::test_requisicao_sem_header_recebe_401`, `test_security.py::test_health_continua_aberto` |

## XP e ações (núcleo)

| Regra | Descrição | Teste |
|---|---|---|
| XP-01 | Registrar uma ação credita o xp em cada categoria e recalcula o nível | `test_nucleo.py::test_register_action_credits_xp_and_updates_level` |
| XP-02 | Categoria repetida na mesma ação conta uma vez só | `test_integridade_xp.py::test_repeated_category_counts_once` |
| XP-03 | Ação manual tem teto de xp (50) | `test_integridade_xp.py::test_manual_action_xp_is_capped` |
| XP-04 | Nível segue a curva `100 × n^1,3` por nível | `test_nucleo.py::test_register_action_accumulates_xp_across_calls` |
| XP-05 | Desfazer a entidade que gerou xp (desmarcar, reabrir, apagar) estorna o log e o xp, e o xp nunca fica negativo | `test_integridade_xp.py::test_reopening_milestone_removes_completion_log`, `test_aprendizado.py::test_reopening_milestone_never_leaves_negative_xp` |
| XP-06 | Ações repetíveis por sincronização (GitHub, e-mail, contribuição em meta) rendem xp no máximo 1x por dia | `test_integridade_xp.py::test_github_manual_sync_credits_once_per_day`, `test_integridade_xp.py::test_goal_contribution_xp_once_per_day` |
| XP-07 | O dia da ação é o dia local, não o UTC | `test_tempo_e_progresso.py::test_late_night_action_counts_for_the_local_day` |
| XP-08 | Desfazer também rebloqueia a conquista que deixou de valer, mesmo quando o estado muda depois do estorno | `test_integridade_xp.py::test_xp_08_unpaying_fixed_bill_relocks_contas_em_dia`, `test_integridade_xp.py::test_xp_08_reopening_milestone_relocks_trilha_em_dia`, `test_integridade_xp.py::test_xp_08_deleting_paid_debt_relocks_quitado` |
| XP-09 | A revisão do xp antigo simula sem mudar nada e só aplica depois de salvar uma cópia do banco | `test_revisao_xp.py::test_preview_does_not_change_anything`, `test_revisao_xp.py::test_apply_saves_a_backup_copy_first` |
| XP-10 | Ação registrada à mão pode ser apagada e estorna o xp; ação automática só se desfaz na origem | `test_lancamentos.py::test_xp_10_deleting_manual_action_refunds_xp`, `test_lancamentos.py::test_xp_10_automatic_action_is_only_undone_at_its_origin` |

## Conquistas

| Regra | Descrição | Teste |
|---|---|---|
| CQ-01 | Conquista desbloqueia quando o critério vale, e a resposta da ação avisa | `test_nucleo.py::test_register_action_response_reports_newly_unlocked_achievements` |
| CQ-02 | Conquista secreta bloqueada aparece mascarada (`???`) | `test_conquistas_motor.py::test_locked_secret_achievement_is_masked` |
| CQ-03 | Critério desconhecido nunca desbloqueia | `test_conquistas_motor.py::test_unknown_criterion_never_unlocks` |
| CQ-04 | Conquista personalizada conta só ações de verdade (sem bônus nem ação manual), com a palavra-chave quando houver | `test_conquistas_personalizadas.py::test_conta_so_acoes_de_verdade_com_a_palavra` |
| CQ-05 | Concluir e reabrir o mesmo marco não conta como várias conclusões | `test_integridade_xp.py::test_count_achievement_ignores_reverted_completions` |
| CQ-06 | Pagar a última conta fixa do mês desbloqueia "contas em dia" na hora | `test_integridade_xp.py::test_xp_08_unpaying_fixed_bill_relocks_contas_em_dia` |
| CQ-07 | Toda ação rebloqueia a conquista que deixou de valer (ex.: saída retroativa que deixa negativo um mês fechado tira "mês no azul"); as de sequência usam o recorde e não somem | `test_integridade_xp.py::test_cq_07_retroactive_expense_relocks_mes_no_azul` |

## Hábito: sequência, proteções, missões e bônus

| Regra | Descrição | Teste |
|---|---|---|
| HAB-01 | A sequência continua se a última ação foi ontem e quebra depois de um dia em branco | `test_tempo_e_progresso.py::test_streak_still_alive_if_last_action_was_yesterday`, `test_tempo_e_progresso.py::test_streak_broken_after_a_missed_day` |
| HAB-02 | Ganha 1 proteção a cada 7 dias seguidos, no máximo 2 guardadas | `test_protecao_sequencia.py::test_ganha_uma_protecao_a_cada_7_dias_com_acao`, `test_protecao_sequencia.py::test_nunca_guarda_mais_de_2` |
| HAB-03 | Um dia em branco consome uma proteção e a sequência continua; hoje nunca consome | `test_protecao_sequencia.py::test_dia_em_branco_consome_protecao_e_sequencia_continua`, `test_protecao_sequencia.py::test_hoje_nunca_consome_protecao` |
| HAB-04 | Missões: até 3 por dia e 1 por semana, só entre as possíveis, geradas uma vez por dia local | `test_missoes.py::test_missoes_geradas_uma_vez_por_dia`, `test_missoes.py::test_candidatos_respeitam_o_estado_real` |
| HAB-05 | Desfazer a ação que concluiu a missão volta a missão a pendente e estorna o bônus | `test_missoes.py::test_desfazer_volta_missao_pra_pendente_e_estorna_bonus` |
| HAB-06 | Bônus: +5 na primeira ação do dia, multiplicador de sequência, 2× no atributo atrasado; cada um com teto de 20 | `test_bonus.py::test_bonus_somam_e_cada_um_tem_teto_de_20` |
| HAB-07 | Bônus e missões não contam nas conquistas de contagem | `test_bonus.py::test_bonus_nao_conta_nas_conquistas_de_contagem`, `test_missoes.py::test_bonus_nao_conta_nas_conquistas_de_contagem` |
| HAB-08 | Ação manual do núcleo não ganha bônus nem conclui missão | `test_bonus.py::test_acao_manual_do_nucleo_nao_ganha_bonus`, `test_missoes.py::test_acao_manual_do_nucleo_nao_conclui_missao` |
| HAB-09 | Atributo sem ação há 14 dias fica "esquecido" no radar, sem perder xp | `test_atributo_esquecido.py::test_esquece_com_14_dias_sem_acao`, `test_atributo_esquecido.py::test_api_expoe_e_nao_mexe_no_xp` |

## Finanças

| Regra | Descrição | Teste |
|---|---|---|
| FIN-01 | Todo lançamento é de uma conta; entrada soma no saldo, saída desconta do saldo ou lança na fatura | `test_financas.py::test_create_transaction_debits_saldo_on_saida` |
| FIN-02 | Saída em conta com saldo e crédito exige escolher a forma de pagamento | `test_financas.py::test_create_transaction_saida_requires_forma_pagamento_when_conta_has_both` |
| FIN-03 | Saída não passa do saldo nem do limite (o valor exato é aceito) | `test_financas.py::test_create_transaction_saida_saldo_insuficiente_returns_422`, `test_financas.py::test_create_transaction_saida_saldo_exato_e_valido` |
| FIN-04 | Transferência interna move saldo entre contas; externa só debita a origem | `test_financas.py::test_create_transaction_transferencia_interna_moves_saldo_between_contas`, `test_financas.py::test_create_transaction_transferencia_externa_only_debits_origem` |
| FIN-05 | O resumo do mês ignora transferências e compara com o mês anterior (janeiro olha dezembro) | `test_financas.py::test_summary_ignores_transferencias`, `test_financas.py::test_summary_handles_january_wrapping_to_previous_december` |
| FIN-06 | Lançamento rende 3 de xp em finanças | `test_financas.py::test_create_transaction_credits_xp_in_financas` |
| FIN-07 | Pagar conta fixa com conta vinculada lança a saída real e rende 4 de xp, uma vez por período | `test_integridade_xp.py::test_paying_already_paid_fixed_bill_twice_credits_once` |
| FIN-08 | Desmarcar o pagamento devolve o dinheiro e estorna o xp | `test_integridade_xp.py::test_pay_unpay_fixed_bill_does_not_farm_xp` |
| FIN-09 | Renda recorrente: as ocorrências do mês são geradas sob demanda, uma vez só | `test_financas.py::test_get_income_entries_is_idempotent` |
| FIN-10 | Receber renda numa conta credita o saldo; desmarcar estorna saldo e xp | `test_financas.py::test_pay_income_entry_with_conta_credits_saldo_real`, `test_integridade_xp.py::test_pay_unpay_income_does_not_farm_xp` |
| FIN-11 | Fonte de renda encadeada não pode se referir a si mesma nem formar ciclo, e não pode ser apagada se outra depende dela | `test_financas.py::test_income_source_offset_fonte_rejects_cycle`, `test_financas.py::test_delete_income_source_blocked_when_referenced_by_chain` |
| FIN-12 | Apagar conta fixa, assinatura ou fonte de renda estorna o xp dos meses pagos; as transações reais ficam | `test_integridade_xp.py::test_fin_12_deleting_fixed_bill_refunds_paid_months_but_keeps_transaction`, `test_integridade_xp.py::test_fin_12_recreating_and_paying_again_does_not_farm_xp` |
| FIN-13 | Quitar dívida rende xp e, com conta, lança a saída; desmarcar desfaz tudo e rebloqueia "quitado"; quitar duas vezes conta uma | `test_integridade_xp.py::test_fin_13_paying_debt_from_account_debits_balance_and_credits_xp`, `test_integridade_xp.py::test_fin_13_unpaying_debt_returns_money_refunds_xp_and_relocks_achievement`, `test_integridade_xp.py::test_fin_13_paying_debt_twice_credits_and_debits_once` |
| FIN-14 | Apagar um lançamento avulso desfaz o efeito (entrada, saída no saldo ou no crédito, transferência interna ou externa) e estorna o xp | `test_lancamentos.py::test_fin_14_deleting_entrada_removes_money_and_xp`, `test_lancamentos.py::test_fin_14_deleting_credit_purchase_lowers_the_bill`, `test_lancamentos.py::test_fin_14_deleting_transfers_restores_both_sides` |
| FIN-15 | Corrigir um lançamento troca de uma vez; se o novo não passa na validação, o antigo fica como estava; o xp continua o de um lançamento | `test_lancamentos.py::test_fin_15_correcting_amount_fixes_balance_and_keeps_one_xp`, `test_lancamentos.py::test_fin_15_correction_that_fails_validation_keeps_the_old_transaction` |
| FIN-16 | Lançamento gerado por outro módulo (conta fixa, assinatura, renda, meta, dívida) mostra a origem e só se desfaz por lá | `test_lancamentos.py::test_fin_16_transaction_from_another_module_is_marked_and_only_undone_there` |
| FIN-17 | Lançamentos antigos ganham o vínculo com o xp pela descrição e ordem, então apagá-los também estorna | `test_lancamentos.py::test_fin_17_migration_links_old_transaction_xp_so_deleting_refunds_it` |
| FIN-18 | Apagar o lançamento que concluiu uma missão volta a missão a pendente e estorna o bônus | `test_missoes.py::test_apagar_o_lancamento_volta_a_missao_e_estorna_o_bonus` |

## Carteira (bancos, contas, assinaturas, parcelas)

| Regra | Descrição | Teste |
|---|---|---|
| CART-01 | Nome de conta é único dentro do banco | `test_carteira.py::test_create_account_duplicate_name_in_same_bank_returns_422` |
| CART-02 | Apagar a última conta de um banco apaga o banco | `test_carteira.py::test_delete_last_account_of_bank_deletes_bank_too` |
| CART-03 | Assinatura paga com conta lança a saída; desmarcar estorna saldo e xp | `test_integridade_xp.py::test_pay_unpay_subscription_does_not_farm_xp` |
| CART-04 | Compra parcelada lança o total na fatura e respeita o limite (o valor exato é aceito) | `test_carteira.py::test_create_compra_parcelada_updates_fatura_atual_da_conta`, `test_carteira.py::test_create_compra_parcelada_valor_exato_do_limite_e_valido` |
| CART-05 | A parcela atual e "quitada" vêm do calendário, com ajuste manual (+1 adianta, −1 desfaz) | `test_carteira.py::test_compra_parcelada_parcela_atual_and_quitada_computed_from_calendar`, `test_carteira.py::test_ajustar_parcelas_delta_negativo_desfaz_ajuste` |
| CART-06 | Editar ou apagar compra parcelada reconcilia a fatura da conta (inclusive ao trocar de conta) | `test_carteira.py::test_update_compra_parcelada_move_conta_reconcilia_ambas`, `test_carteira.py::test_delete_compra_parcelada_reverts_fatura_atual` |

## Metas

| Regra | Descrição | Teste |
|---|---|---|
| MET-01 | Progresso = valor atual ÷ alvo, sem passar de 100%; alcançar o alvo conclui a meta | `test_metas.py::test_reaching_target_marks_goal_as_concluida_and_credits_bonus_xp` |
| MET-02 | Meta concluída não aceita mais contribuição | `test_metas.py::test_cannot_contribute_to_completed_goal` |
| MET-03 | O peso (baixo, médio, alto, épico) multiplica o xp de contribuição e de conclusão | `test_metas.py::test_weight_multiplies_contribution_and_completion_xp` |
| MET-04 | Contribuição financeira de uma conta lança a saída real; apagar a meta mantém a transação | `test_metas.py::test_financeira_contribute_conta_creates_real_transaction`, `test_metas.py::test_deleting_goal_keeps_real_transaction_in_financas` |
| MET-05 | Meta de aprendizado e acadêmica avança sozinha pelo vínculo, não aceita contribuição manual e não volta atrás | `test_metas.py::test_aprendizado_goal_progresses_automatically_and_completes`, `test_metas.py::test_aprendizado_goal_does_not_uncomplete_when_milestone_reopened`, `test_metas.py::test_academica_goal_rejects_manual_contribution` |
| MET-06 | Apagar a meta estorna o xp das contribuições e do bônus | `test_integridade_xp.py::test_deleting_goal_refunds_contributions_and_bonus` |
| MET-07 | Baixar o alvo de uma meta não a conclui sozinha | `test_metas.py::test_update_goal_lowering_target_does_not_auto_complete` |

## Aprendizado

| Regra | Descrição | Teste |
|---|---|---|
| APR-01 | Progresso da trilha = marcos concluídos ÷ total | `test_aprendizado.py::test_progress_pct_computed_from_milestones` |
| APR-02 | Concluir marco credita xp uma vez; reabrir estorna o xp exato | `test_aprendizado.py::test_completing_milestone_twice_does_not_double_credit_xp`, `test_aprendizado.py::test_reopening_milestone_refunds_the_exact_xp_awarded` |
| APR-03 | Marco pendente há mais de 30 dias vira "esquecido" na leitura | `test_aprendizado.py::test_stale_pending_milestone_becomes_esquecido_on_read` |
| APR-04 | Apagar trilha ou marco concluído estorna o xp | `test_integridade_xp.py::test_deleting_track_refunds_completed_milestones`, `test_integridade_xp.py::test_deleting_completed_milestone_refunds_xp` |
| APR-05 | Reordenar exige a lista completa de ids (sem faltar nem sobrar) | `test_aprendizado.py::test_reorder_rejects_mismatched_milestone_set`, `test_aprendizado.py::test_reorder_tracks_rejects_mismatched_set` |
| APR-06 | Concluir marco que já ficou "esquecido" não conta para "trilha em dia" | `test_aprendizado.py::test_completing_previously_stale_milestone_does_not_unlock_trilha_em_dia` |
| APR-09 | Editar nome, objetivo e status da trilha não mexe no xp | `test_aprendizado.py::test_apr_09_editing_track_name_goal_and_status_does_not_touch_xp` |

## Carreira

| Regra | Descrição | Teste |
|---|---|---|
| CAR-01 | Área atual, área-meta e interesses não rendem xp | `test_carreira.py::test_update_career_profile_does_not_credit_xp`, `test_carreira.py::test_create_and_list_interest_without_xp` |
| CAR-02 | Primeira posição rende o xp de marco inicial; as seguintes rendem mais em tempo real que retroativas | `test_carreira.py::test_create_first_position_credits_milestone_xp`, `test_carreira.py::test_create_second_position_with_todays_date_credits_realtime_xp` |
| CAR-03 | Apagar e recriar a primeira posição não rende xp de novo | `test_carreira.py::test_recreating_first_position_does_not_farm_xp` |
| CAR-04 | Formação só rende xp ao concluir; reabrir estorna o xp exato | `test_carreira.py::test_create_education_em_andamento_does_not_credit_xp`, `test_carreira.py::test_reopening_concluded_education_refunds_exact_xp` |
| CAR-05 | Primeiro salário e retroativos rendem xp fixo; reajuste em tempo real rende pelo aumento, com teto | `test_carreira.py::test_realtime_salary_record_scales_xp_with_growth_pct`, `test_carreira.py::test_realtime_salary_record_caps_xp_at_max` |
| CAR-06 | Apagar salário estorna o xp, e repetir não rende de novo | `test_carreira.py::test_realtime_salary_jump_cannot_be_farmed_by_deleting` |
| CAR-08 | Corrigir valor ou data de um salário recalcula o xp daquele registro; os outros campos não mexem no xp | `test_carreira.py::test_car_08_fixing_typo_in_realtime_salary_recalculates_xp`, `test_carreira.py::test_car_08_editing_other_fields_keeps_salary_xp` |

## Calendário

| Regra | Descrição | Teste |
|---|---|---|
| CAL-01 | O calendário junta contas fixas, dívidas, assinaturas, parcelas, metas com prazo e ações, sem tabela própria; renda fica de fora | `test_calendario.py::test_fixed_bill_appears_on_due_day`, `test_calendario.py::test_no_income_events_in_calendar` |
| CAL-02 | Vencimento no dia 31 cai no último dia dos meses curtos | `test_calendario.py::test_fixed_bill_due_day_clamped_to_last_day_of_month` |
| CAL-03 | Parcela aparece só durante a janela das parcelas | `test_calendario.py::test_compra_parcelada_appears_only_during_installment_window` |
| CAL-05 | Evento próprio aparece só no seu mês | `test_calendario.py::test_cal_05_evento_proprio_aparece_so_no_seu_mes` |
| CAL-06 | Recorrência respeita a data final e o fim dos meses curtos | `test_calendario.py::test_cal_06_recorrencia_semanal_respeita_o_fim`, `test_calendario.py::test_cal_06_recorrencia_mensal_no_dia_31_cai_no_ultimo_dia_do_mes_curto` |
| CAL-07 | Editar e mover a data do evento | `test_calendario.py::test_cal_07_editar_e_mover_data_do_evento` |
| CAL-08 | Apagar evento; título, data, hora e recorrência são validados | `test_calendario.py::test_cal_08_apagar_evento_e_validacoes` |

## Organização

| Regra | Descrição | Teste |
|---|---|---|
| ORG-01 | Salvar link rende xp; apagar estorna, sem render de novo ao repetir | `test_organizacao.py::test_create_link_credits_xp`, `test_integridade_xp.py::test_add_and_delete_link_does_not_farm_xp` |
| ORG-02 | Repositório do GitHub só rende xp se existir; apagar e readicionar não zera o limite diário | `test_organizacao.py::test_create_github_repo_not_found_404_from_github_does_not_credit_xp`, `test_integridade_xp.py::test_github_delete_and_readd_does_not_reset_daily_sync_limit` |
| ORG-03 | Senha de e-mail nunca volta pela API | `test_organizacao.py::test_create_email_account_never_returns_password`, `test_organizacao.py::test_list_email_accounts_never_returns_password` |
| ORG-04 | Chave da busca só é salva depois de validada | `test_organizacao.py::test_save_search_key_invalid_key_returns_422_and_does_not_save` |
| ORG-05 | E-mail vira só texto limpo: nada de HTML guardado nem mostrado, link sem URL longa na prévia, e-mail só em HTML tem prévia | `test_email_texto.py::test_html_converts_structure_and_drops_hidden_and_scripts`, `test_organizacao.py::test_sync_html_only_email_has_clean_preview_and_full_text`, `email-texto.test.js` (desenho sem HTML) |
| ORG-06 | Texto completo do e-mail é guardado só por 90 dias (a prévia fica) | `test_organizacao.py::test_old_full_text_is_pruned_on_sync` |
| ORG-07 | Nota rende xp só ao ser criada, no máximo 3 por dia; apagar a de hoje estorna sem abrir brecha pra repetir | `test_notas.py::test_only_three_notes_a_day_give_xp`, `test_notas.py::test_deleting_a_note_from_today_reverts_xp_and_cannot_farm` |
| ORG-08 | Nota guarda markdown, nunca HTML; a lista mostra só a prévia em texto puro | `test_notas.py::test_create_edit_and_get_note_keeps_markdown`, `test_notas.py::test_preview_strips_markdown` |
| ORG-09 | Trancar exige o PIN ligado; o texto vai cifrado e some da lista, da busca e do widget (o título fica) | `test_notas.py::test_lock_requires_pin_on`, `test_notas.py::test_locked_note_hides_text_everywhere_and_opens_with_pin` |
| ORG-10 | Nota trancada só abre, muda ou é apagada com o PIN (mesma espera crescente do app) | `test_notas.py::test_locked_note_edit_and_delete_need_the_access_key`, `test_notas.py::test_wrong_pin_on_notes_counts_toward_the_wait` |
| ORG-12 | Busca global ignora acento e maiúscula; cada palavra precisa aparecer em algum campo | `test_busca.py::test_accent_and_case_insensitive_both_ways`, `test_busca.py::test_every_word_must_match_somewhere` |
| ORG-13 | Busca não revela texto de nota trancada nem conquista secreta ainda bloqueada | `test_busca.py::test_locked_note_is_found_by_title_only`, `test_busca.py::test_locked_secret_achievement_is_not_a_spoiler` |
| ORG-14 | Captura rápida não rende xp (rende o que ela virar); tarefa entra como "- [ ] texto" na nota "tarefas" (criada e fixada uma vez) | `test_entrada.py::test_capturing_gives_no_xp`, `test_entrada.py::test_task_goes_to_the_tasks_note_creating_it_once` |
| ORG-11 | Texto de nota trancada vai no backup com senha e se perde se a chave dos segredos for redefinida | `test_notas.py::test_protected_backup_carries_locked_text_and_plain_backup_does_not`, `test_notas.py::test_key_reset_loses_locked_text_but_keeps_the_note` |
| ORG-15 | Marcar um hábito rende +5 xp no atributo dele, uma vez por dia por hábito; desmarcar estorna; apagar o hábito estorna todas as marcas | `test_habitos.py::test_marking_gives_xp_once_and_unmarking_reverts`, `test_habitos.py::test_delete_reverts_all_xp` |
| ORG-16 | Hábito se marca até 2 dias atrás, nunca no futuro nem fora dos dias fixos dele; pausado/arquivado não se marca | `test_habitos.py::test_past_days_up_to_two_back`, `test_habitos.py::test_fixed_day_off_cannot_be_marked`, `test_habitos.py::test_pause_resume_and_archive` |
| ORG-17 | Sequência do hábito: dia fora da programação, pausado ou hoje ainda sem marca não quebra; "x por semana" conta em semanas cumpridas | `test_habitos.py::test_daily_streak_counts_back_and_today_unmarked_does_not_break`, `test_habitos.py::test_fixed_days_skip_the_days_off`, `test_habitos.py::test_paused_days_neither_count_nor_break`, `test_habitos.py::test_weekly_streak_is_in_weeks` |
| ORG-18 | Marca de hábito é ação de verdade: conta na sequência geral e nas missões (marcar o hábito do dia; dias com todos os hábitos feitos) | `test_habitos.py::test_marking_counts_for_global_streak`, `test_habitos.py::test_daily_mission_for_a_habit_due_today`, `test_habitos.py::test_weekly_mission_counts_days_with_everything_done` |

## Sistema (backup e reset)

| Regra | Descrição | Teste |
|---|---|---|
| SIS-01 | Importar e resetar exigem a palavra de confirmação; com a palavra errada, nada muda | `test_sistema.py::test_import_leaves_data_untouched_on_bad_confirmation`, `test_sistema.py::test_reset_rejects_wrong_confirmation_word` |
| SIS-02 | Exportar e importar preserva os dados (inclui dias protegidos e retrospectivas) | `test_sistema.py::test_import_restores_a_previous_backup`, `test_protecao_sequencia.py::test_backup_leva_os_dias_protegidos` |
| SIS-03 | Reset volta ao estado de instalação nova | `test_sistema.py::test_reset_reseeds_fresh_install_defaults` |
| SIS-04 | Exportar marca a data do último backup no perfil | `test_sistema.py::test_export_sets_last_backup_at_on_profile` |
| SIS-05 | Ao abrir uma versão nova, o banco é copiado para `backups/` antes de qualquer atualização (instalação nova não gera cópia; a mesma versão não copia de novo) | `test_backup_migracao.py::test_sis_05_opening_a_new_version_backs_up_first_and_only_once`, `test_backup_migracao.py::test_sis_05_fresh_install_makes_no_backup_and_records_version` |
| SIS-06 | Ficam só as 3 cópias mais recentes | `test_backup_migracao.py::test_sis_06_keeps_only_the_3_most_recent_backups` |
| SIS-07 | Se a atualização do banco falhar, ele volta sozinho para a cópia e o app não abre com o banco pela metade | `test_backup_migracao.py::test_sis_07_failed_migration_restores_the_backup_and_stops` |
| SIS-08 | O diagnóstico (versão, sistema e o fim do log) sai sem e-mails, chaves, senhas, valores em R$ e sem o nome da pasta pessoal | `test_diagnostico.py::test_sis_08_diagnostico_tira_dados_pessoais_do_log`, `test_diagnostico.py::test_sis_08_diagnostico_so_traz_o_fim_do_log` |
| SIS-09 | O backend termina junto com o app: fechar a janela encerra a árvore inteira do sidecar, e se o app sumir sem avisar o backend percebe e sai sozinho | `test_processo.py::test_sis_09_backend_notices_when_the_app_process_is_gone`, `test_processo.py::test_sis_09_without_the_app_pid_there_is_nothing_to_watch` |

## Segurança

| Código | Regra | Teste |
|---|---|---|
| SEG-01 | A chave que protege as senhas salvas fica no cofre do sistema, não num arquivo; cada pasta de dados tem a sua entrada | `test_crypto.py::test_seg_01_new_install_keeps_key_in_the_vault_not_in_a_file`, `test_crypto.py::test_seg_01_each_data_folder_has_its_own_vault_entry`, `test_crypto.py::test_seg_01_status_and_diagnostic_say_where_the_key_is` |
| SEG-02 | A chave antiga (arquivo `.secret_key`) vai pro cofre sem perder nenhuma senha, e o arquivo só é apagado depois que o cofre devolveu a chave igual | `test_crypto.py::test_seg_02_old_key_file_moves_to_the_vault_and_secrets_still_open`, `test_crypto.py::test_seg_02_vault_that_does_not_keep_the_key_leaves_the_file_alone` |
| SEG-03 | Sem cofre no sistema, a chave fica num arquivo só do dono e o app avisa | `test_crypto.py::test_seg_03_without_a_vault_the_key_stays_in_a_private_file`, `test_crypto.py::test_seg_03_vault_can_be_turned_off_by_env` |
| SEG-04 | Se o cofre não tem mais a chave, nenhuma chave nova é criada por cima: salvar ou ler senha responde 409 `chave_indisponivel` | `test_crypto.py::test_seg_04_lost_vault_key_is_never_replaced_silently`, `test_crypto.py::test_seg_04_vault_offline_after_migration_does_not_create_a_file_key`, `test_crypto.py::test_seg_04_unavailable_key_answers_409_with_its_own_code` |
| SEG-05 | Redefinir a chave (com a palavra de confirmação) apaga as senhas, o token e a chave da busca salvos, e salvar volta a funcionar | `test_crypto.py::test_seg_05_redefining_the_key_erases_old_secrets_and_works_again` |
| SEG-06 | Nenhuma entrada absurda (texto gigante, número enorme ou negativo, tipo errado, JSON quebrado) vira erro 500, em nenhuma rota — a varredura pega rota nova sozinha | `test_limites_entrada.py::test_seg_06_extreme_bodies_never_cause_500`, `test_limites_entrada.py::test_seg_06_malformed_json_never_causes_500`, `test_limites_entrada.py::test_seg_06_extreme_query_params_never_cause_500` |
| SEG-07 | Texto: 200 caracteres por padrão, 5.000 nos textos livres (descrição, notas, objetivo), 30.000 no desenho ASCII; campo com limite próprio usa o dele. Números entre -10¹² e 10¹², sem `Infinity`/`NaN`. Passou → 422 com mensagem em português | `test_limites_entrada.py::test_seg_07_short_text_fields_stop_at_200_characters`, `test_limites_entrada.py::test_seg_07_free_text_fields_take_5000_characters`, `test_limites_entrada.py::test_seg_07_ascii_avatar_of_120_columns_still_fits`, `test_limites_entrada.py::test_seg_07_field_with_its_own_limit_keeps_it`, `test_limites_entrada.py::test_seg_07_numbers_are_bounded_and_must_be_finite` |
| SEG-08 | Corpo de requisição até 1 MB (50 MB na importação de backup), contado mesmo sem `Content-Length`; passou → 413 antes de chegar na rota | `test_limites_entrada.py::test_seg_08_body_over_1_mb_is_refused_before_the_route`, `test_limites_entrada.py::test_seg_08_streamed_body_without_length_is_also_counted`, `test_limites_entrada.py::test_seg_08_backup_import_accepts_more_than_1_mb_up_to_50` |
| SEG-09 | Todo modelo de entrada herda os limites, e nenhuma rota recebe caminho de arquivo | `test_limites_entrada.py::test_seg_09_every_input_model_inherits_the_limits`, `test_limites_entrada.py::test_seg_09_no_route_takes_a_file_path` |
| SEG-10 | O backup com senha não deixa nada legível no arquivo (nem nomes de tabela) e leva as senhas salvas | `test_backup_protegido.py::test_seg_10_protected_backup_cannot_be_read_without_the_password` |
| SEG-11 | Com a senha certa, a importação restaura tudo, inclusive as senhas salvas | `test_backup_protegido.py::test_seg_11_right_password_restores_everything_including_saved_passwords` |
| SEG-12 | O backup com senha funciona em outro computador (as senhas voltam cifradas com a chave de lá); o sem senha não leva as senhas | `test_backup_protegido.py::test_seg_12_protected_backup_works_on_another_computer`, `test_backup_protegido.py::test_seg_12_backup_without_password_does_not_carry_passwords_to_another_computer` |
| SEG-13 | Senha errada, arquivo alterado (dados ou cabeçalho) ou parâmetros absurdos são recusados sem mudar nada | `test_backup_protegido.py::test_seg_13_wrong_password_is_refused_and_changes_nothing`, `test_backup_protegido.py::test_seg_13_tampered_file_is_refused`, `test_backup_protegido.py::test_seg_13_absurd_scrypt_parameters_are_refused_before_deriving` |
| SEG-14 | Senha de no mínimo 8 caracteres; chave por scrypt (N=2¹⁷, r=8, p=1) com sal e nonce novos a cada exportação; conta como backup feito; senha salva ilegível fica de fora e é contada | `test_backup_protegido.py::test_seg_14_password_needs_8_characters`, `test_backup_protegido.py::test_seg_14_key_derivation_uses_owasp_scrypt_parameters`, `test_backup_protegido.py::test_seg_14_protected_export_counts_as_a_backup`, `test_backup_protegido.py::test_seg_14_password_that_cannot_be_read_now_stays_out` |
| SEG-15 | O PIN é opcional (desligado, o app abre como antes); ao ligar, o código de recuperação aparece uma vez e só os hashes ficam guardados, num arquivo só do dono | `test_pin.py::test_seg_15_without_pin_the_app_opens_as_before`, `test_pin.py::test_seg_15_turning_on_shows_a_recovery_code_once_and_keeps_only_hashes` |
| SEG-16 | Com o PIN ligado, o backend nasce bloqueado e nenhum dado sai pela API (423) até o PIN certo — só o estado, o desbloqueio, a recuperação, o `/health` e o log de erro da tela passam | `test_pin.py::test_seg_16_locked_app_serves_no_data_through_the_api`, `test_pin.py::test_seg_16_right_pin_unlocks_wrong_pin_does_not` |
| SEG-17 | 5 erros seguidos → espera de 30 s, dobrando a cada erro a mais até 15 min; fechar e abrir o app não zera | `test_pin.py::test_seg_17_five_wrong_attempts_make_it_wait_and_restart_does_not_reset`, `test_pin.py::test_seg_17_wait_is_capped_at_15_minutes` |
| SEG-18 | Esqueci o PIN: o código de recuperação (digitado de qualquer jeito) cria um PIN novo e um código novo, e o antigo deixa de valer; sem o código, apagar o `pin.json` abre o app com os dados intactos | `test_pin.py::test_seg_18_recovery_code_sets_a_new_pin_and_a_new_code`, `test_pin.py::test_seg_18_deleting_the_pin_file_is_the_last_resort_and_keeps_the_data` |
| SEG-19 | Trocar ou tirar o PIN pede o atual; o PIN tem de 4 a 8 dígitos de 0 a 9 | `test_pin.py::test_seg_19_changing_or_removing_the_pin_asks_for_the_current_one`, `test_pin.py::test_seg_19_pin_has_4_to_8_digits` |
| SEG-20 | Bloqueio por inatividade é opcional (desligado por padrão; 5, 15 ou 30 min) | `test_pin.py::test_seg_20_inactivity_lock_is_optional_and_locks_on_request` |
| SEG-21 | Arquivo do PIN estragado não tranca a pessoa pra fora; o hash usa scrypt lento | `test_pin.py::test_seg_21_damaged_pin_file_does_not_lock_the_person_out`, `test_pin.py::test_seg_21_pin_hash_uses_slow_scrypt` |
| SEG-22 | A auditoria de dependências (pip, npm, cargo) falha só com vulnerabilidade alta/crítica — ou de severidade desconhecida — sem exceção; exceção tem data e vence; avisos do cargo nunca falham | `test_auditoria.py::test_seg_22_only_high_and_critical_fail`, `test_auditoria.py::test_seg_22_unknown_severity_counts_as_high`, `test_auditoria.py::test_seg_22_cargo_uses_the_cvss_vector_and_warnings_never_fail`, `test_auditoria.py::test_seg_22_exceptions_need_a_date_and_stop_counting_after_it`, `test_auditoria.py::test_seg_22_npm_report_is_read_with_its_own_severity`, `test_auditoria.py::test_seg_22_cvss3_score_matches_the_official_calculator` |
| SEG-23 | A janela do app só tem as permissões que usa (sem shell, arquivos ou processos; links só http/https), a CSP só roda o código do app e só fala com o backend local, e os comandos Rust expostos são os 4 conhecidos | `test_capacidades.py::test_seg_23_window_permissions_are_the_minimum_the_app_uses`, `test_capacidades.py::test_seg_23_csp_runs_only_the_apps_own_code_and_talks_only_to_the_local_backend`, `test_capacidades.py::test_seg_23_rust_commands_exposed_to_the_window_are_known` |

## Invariantes (sequências aleatórias)

Rodam sequências aleatórias, com semente fixa, de ações em vários módulos
(com missões e bônus ligados) e conferem depois de cada passo.

| Regra | Descrição | Teste |
|---|---|---|
| INV-01 | O xp de cada atributo é a soma do xp do log daquele atributo | `test_invariantes.py::test_inv_01_a_04_sequencia_aleatoria_nunca_quebra_as_regras` |
| INV-02 | O nível de cada atributo é o que a curva dá para aquele xp | `test_invariantes.py::test_inv_01_a_04_sequencia_aleatoria_nunca_quebra_as_regras` |
| INV-03 | Saldo da conta = saldo inicial + entradas − saídas lançadas nela | `test_invariantes.py::test_inv_01_a_04_sequencia_aleatoria_nunca_quebra_as_regras` |
| INV-04 | Toda conquista desbloqueada continua cumprindo o critério | `test_invariantes.py::test_inv_01_a_04_sequencia_aleatoria_nunca_quebra_as_regras` |
| INV-05 | Fazer e desfazer volta xp e saldo exatamente ao estado anterior | `test_invariantes.py::test_inv_05_fazer_e_desfazer_volta_ao_estado_anterior` |

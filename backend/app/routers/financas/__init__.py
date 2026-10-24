"""
Módulo Finanças (v1).

Endpoints:
  Renda recorrente (v2 — CRUD completo de fontes + encadeamento, ver
  redesenho no topo de app/database.py::_migrate_income_v2 e schema.sql):
    GET/POST/PUT/DELETE /income-sources      cadastro das fontes de renda
    GET /income-entries?month=YYYY-MM        garante e devolve as ocorrências do mês
    PUT /income-entries/{id}/pay             marca como paga (gera transação real
                                              se a fonte tem conta_id, ver
                                              app/finance_utils.py)
    PUT /income-entries/{id}/unpay           desfaz o pagamento (reverte a
                                              transação se houver)

  Cadastros simples (CRUD básico):
    /fixed-bills, /debts

  Contas fixas — instância mensal (mesmo padrão de wallet_subscriptions,
  ver app/routers/wallet.py — unifica os dois conceitos, item 1 do mapa
  de problemas). Marcar como paga é OPCIONALMENTE real (item 6): se a
  conta fixa tem conta_id vinculada E o usuário confirma no momento de
  marcar como paga, gera uma transação 'saida' de verdade e desconta
  saldo/fatura — igual um app de finanças de verdade faria. Sem conta
  vinculada, ou se o usuário recusar, continua só lembrete:
    GET /fixed-bills/periods?month=YYYY-MM   garante e devolve as instâncias do mês
    PUT /fixed-bills/periods/{id}/pay        marca como paga (gerar_transacao opcional)
    PUT /fixed-bills/periods/{id}/unpay      desfaz (reverte a transação se houver)

  Transações + visão agregada:
    GET/POST /transactions?month=YYYY-MM     toda transação é vinculada a uma
                                              wallet_account (conta_id obrigatório).
                                              'entrada' soma em saldo_atual;
                                              'saida' desconta de saldo_atual OU
                                              lança em fatura_atual (depende de
                                              forma_pagamento, exigido só quando a
                                              conta tem os dois); 'transferencia'
                                              move saldo entre 2 contas (interna)
                                              ou só debita a origem (externa).
    GET /summary?month=YYYY-MM               entradas/saídas/saldo, comparação
                                              com mês anterior, categorias
                                              (transferências não entram nessa soma)

  Bancos/contas/assinaturas da wallet ficam em app/routers/wallet.py.
"""
# MAN-02: o módulo virou pacote — comum.py (constantes, schemas e helpers
# compartilhados), renda.py, contas.py e lancamentos.py —, mas continua UM
# router montado em /api/financas (main.py não mudou). As partes entram na
# ordem em que as rotas estavam no arquivo único.
from fastapi import APIRouter

from app.routers.financas import contas, lancamentos, renda

router = APIRouter()
router.include_router(renda.router)
router.include_router(contas.router)
router.include_router(lancamentos.router)

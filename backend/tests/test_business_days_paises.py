"""I18N-06 (P-95): dia útil com os feriados do país da pessoa."""
import datetime

from app.business_days import add_business_days, eh_dia_util, nth_business_day_of_month

D = datetime.date


def test_brasil_continua_o_padrao():
    # 2 de novembro (Finados) não é dia útil no Brasil
    assert not eh_dia_util(D(2026, 11, 2))
    assert eh_dia_util(D(2026, 11, 2), "US")


def test_feriados_de_outros_paises():
    assert not eh_dia_util(D(2026, 11, 26), "US")  # Thanksgiving
    assert not eh_dia_util(D(2026, 10, 3), "DE") or D(2026, 10, 3).weekday() >= 5  # Dia da Unidade
    assert not eh_dia_util(D(2026, 1, 12), "JP")  # Dia da Maioridade (2ª segunda de janeiro)
    assert eh_dia_util(D(2026, 1, 12), "BR")


def test_pais_sem_calendario_e_so_fim_de_semana():
    assert eh_dia_util(D(2026, 1, 26), "IN")  # sem feriados conhecidos
    assert not eh_dia_util(D(2026, 1, 24), "IN")  # sábado
    assert eh_dia_util(D(2026, 11, 2), None)


def test_enesimo_dia_util_muda_com_o_pais():
    # janeiro de 2026: 12 é o Dia da Maioridade no Japão
    assert nth_business_day_of_month(2026, 1, 7, "BR") == D(2026, 1, 12)
    assert nth_business_day_of_month(2026, 1, 7, "JP") == D(2026, 1, 13)


def test_somar_dias_uteis_pula_feriado_do_pais():
    # quinta 26/11/2026 é Thanksgiving nos EUA
    assert add_business_days(D(2026, 11, 25), 1, "US") == D(2026, 11, 27)
    assert add_business_days(D(2026, 11, 25), 1, "BR") == D(2026, 11, 26)


def test_consciencia_negra_no_brasil_desde_2024():
    assert not eh_dia_util(D(2026, 11, 20), "BR")
    assert eh_dia_util(D(2026, 11, 20), "US")
    assert eh_dia_util(D(2023, 11, 20), "BR")  # antes da lei: dia comum

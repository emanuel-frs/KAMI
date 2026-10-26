# Tradução do Kami

O Kami fala 10 idiomas: português (o original), inglês, espanhol, francês,
italiano, alemão, chinês simplificado, japonês, coreano e hindi. As
traduções foram feitas com ajuda de IA e **não passaram por revisão de
falante nativo** — correções são muito bem-vindas (ver "Como corrigir",
no fim).

## Onde ficam os textos

- `frontend/i18n/<idioma>.json` — um dicionário por idioma, chaves planas
  (`"metas.ver_trilha": "ver trilha"`). O `pt.json` é a fonte: toda chave
  nasce nele e os outros 9 têm exatamente as mesmas chaves e variáveis
  (`{nome}`, `{n}`…) — `tests/frontend/i18n-dicionarios.test.js` confere.
- Plural: `{"one": "…", "other": "…"}` (e `"zero"` quando o português diz
  "nenhum…"). O app escolhe a forma pelo `Intl.PluralRules` do idioma.
- O backend não traduz nada: manda a chave (`erro.*`, `log.*`,
  `lancamento.*`) e o texto em português de reserva; o app mostra no
  idioma da pessoa. Valores em variáveis `valor_*` são dinheiro e saem na
  moeda escolhida em configurações.
- O que a pessoa escreveu (nomes de metas, contas, notas) nunca é
  traduzido.

## Tom

- **Informal em todos**: tu (es "tú", fr "tu", it "tu"), de "du"; japonês
  com です/ます; coreano em 해요체 (-요); hindi com आप. Português do
  Brasil, espanhol neutro latino, francês da França, chinês simplificado.
- **Curto e com cara de terminal**, como no português: frases diretas,
  sem exclamação à toa.
- **Minúsculas** como no português (títulos, botões, menus), menos no
  alemão, que mantém os substantivos com maiúscula. Siglas e nomes
  próprios (PIN, GitHub, Windows, Kami no começo de frase) como sempre.
- Termos técnicos do formulário que vêm da API (`'tipo_data'`,
  `'YYYY-MM'`) ficam como estão.

## Glossário

Use sempre estes termos — o mesmo conceito com a mesma palavra em todo o
app. `tests/frontend/i18n-glossario.test.js` barra as variantes que já
apareceram e foram trocadas.

| pt | en | es | fr | it | de | zh | ja | ko | hi |
|---|---|---|---|---|---|---|---|---|---|
| núcleo (tela) | core | núcleo | noyau | nucleo | Kern | 核心 | コア | 코어 | कोर |
| finanças | finances | finanzas | finances | finanze | Finanzen | 财务 | 家計 | 재정 | वित्त |
| carreira | career | carrera | carrière | carriera | Karriere | 职业 | キャリア | 커리어 | करियर |
| aprendizado | learning | aprendizaje | apprentissage | apprendimento | Lernen | 学习 | 学習 | 학습 | सीखना |
| organização | organization | organización | organisation | organizzazione | Organisation | 整理 | 整理 | 정리 | व्यवस्था |
| metas pessoais | personal goals | metas personales | objectifs personnels | obiettivi personali | persönliche Ziele | 个人目标 | 個人目標 | 개인 목표 | निजी लक्ष्य |
| calendário | calendar | calendario | calendrier | calendario | Kalender | 日历 | カレンダー | 캘린더 | कैलेंडर |
| hábitos | habits | hábitos | habitudes | abitudini | Gewohnheiten | 习惯 | 習慣 | 습관 | आदतें |
| xp | xp | xp | xp | xp | XP | xp | xp | xp | xp |
| nível | level | nivel | niveau | livello | Level | 等级 | レベル | 레벨 | लेवल |
| atributos | attributes | atributos | attributs | attributi | Attribute | 属性 | 属性 | 속성 | गुण |
| conquistas | achievements | logros | succès | traguardi | Erfolge | 成就 | 実績 | 업적 | उपलब्धियाँ |
| missões | missions | misiones | missions | missioni | Missionen | 任务 | ミッション | 미션 | मिशन |
| sequência | streak | racha | série | serie | Serie | 连续 | 連続 | 연속 | सिलसिला |
| proteções | shields | protecciones | protections | protezioni | Schutzschilde | 保护 | シールド | 보호막 | सुरक्षा कवच |
| meta | goal | meta | objectif | obiettivo | Ziel | 目标 | 目標 | 목표 | लक्ष्य |
| trilha | track | ruta | parcours | percorso | Lernpfad | 路线 | トラック | 트랙 | ट्रैक |
| marco | milestone | hito | étape | tappa | Meilenstein | 里程碑 | マイルストーン | 마일스톤 | पड़ाव |
| hábito | habit | hábito | habitude | abitudine | Gewohnheit | 习惯 | 習慣 | 습관 | आदत |
| lembrete | reminder | recordatorio | rappel | promemoria | Erinnerung | 提醒 | リマインダー | 리마인더 | रिमाइंडर |
| nota | note | nota | note | nota | Notiz | 笔记 | メモ | 메모 | नोट |
| captura rápida | quick capture | captura rápida | saisie rapide | cattura rapida | Schnellerfassung | 快速记录 | クイック入力 | 빠른 입력 | झटपट दर्ज |
| caixa de entrada (captura) | inbox | bandeja de entrada | boîte de réception | posta in arrivo | Eingang | 收件箱 | 受信箱 | 받은편지함 | इनबॉक्स |
| conta fixa | fixed bill | cuenta fija | facture fixe | spesa fissa | Fixkosten | 固定账单 | 固定費 | 고정 지출 | तय बिल |
| assinatura | subscription | suscripción | abonnement | abbonamento | Abo | 订阅 | サブスク | 구독 | सब्सक्रिप्शन |
| dívida | debt | deuda | dette | debito | Schuld | 债务 | 借金 | 빚 | क़र्ज़ |
| cópias automáticas | automatic copies | copias automáticas | copies automatiques | copie automatiche | automatische Kopien | 自动副本 | 自動コピー | 자동 사본 | स्वचालित प्रतियाँ |
| configurações | settings | configuración | paramètres | impostazioni | Einstellungen | 设置 | 設定 | 설정 | सेटिंग्स |

Notas:

- "caixa de entrada" aqui é a da captura rápida (organização › entrada).
  A caixa de entrada do **e-mail** pode usar o termo de e-mail do idioma
  (ja 受信トレイ, de Posteingang).
- Hindi: "लेवल" é o nível do jogo; "स्तर" fica pro nível de uma formação.
  "शृंखला" só no sentido de encadeamento (fontes de renda); a sequência
  de dias é "सिलसिला".
- O nome das telas é o do menu (`nav.*`); textos que citam uma tela usam
  o mesmo nome.

## Como corrigir uma tradução

1. Abra uma issue em <https://github.com/emanuel-frs/KAMI/issues/new/choose>
   (o link "sugerir correção" em configurações › aparência leva pra lá)
   com o texto como está, como deveria ficar e o idioma. Print ajuda.
2. Ou mande um PR mexendo só no `frontend/i18n/<idioma>.json`: mantenha a
   chave, as variáveis entre chaves e as tags (`<strong>`, `<code>`,
   `<kbd>`) do português. `npm test` confere chaves, variáveis e plurais.

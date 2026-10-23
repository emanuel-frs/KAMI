; Ganchos do instalador NSIS do Kami (DIST-03, desinstalação limpa).
;
; O modelo do Tauri já cuida de parte: ao desinstalar (e NÃO na
; atualização pelo app, que desinstala a versão antiga com /UPDATE) tira o
; valor "Kami" do Run do registro (iniciar com o sistema) e os atalhos
; Kami.lnk que ele criou — inclusive os com o ícone da cor (ICO-01), que são
; os mesmos arquivos. A caixa "Remover dados do programa" (desmarcada por
; padrão) apaga só as pastas do webview (com.kami.app).
;
; Daqui:
;   - sempre (fora da atualização): o rastro do iniciar com o sistema que o
;     Windows guarda no Gerenciador de Tarefas (StartupApproved);
;   - com a caixa marcada, ou /APAGARDADOS na linha de comando (pra
;     desinstalar sem perguntas — `uninstall.exe /S /APAGARDADOS` — e pro
;     teste no CI): a pasta de dados do Kami (%APPDATA%\kami: banco, cópias,
;     log) e a chave das senhas no Gerenciador de Credenciais. A chave é
;     achada pelo usuário "chave-dos-segredos-<16 hex>" que o backend usa
;     (app/crypto.py), não pelos rótulos do cmdkey, que mudam com o idioma
;     do Windows. A pasta extra das cópias, se houver, fica.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}"

    ClearErrors
    ${GetOptions} $CMDLINE "/APAGARDADOS" $R9
    ${IfNot} ${Errors}
      StrCpy $DeleteAppDataCheckboxState 1
      ; o modelo já passou pela parte dele com a caixa desmarcada
      SetShellVarContext current
      RmDir /r "$APPDATA\${BUNDLEID}"
      RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
    ${EndIf}

    ${If} $DeleteAppDataCheckboxState = 1
      SetShellVarContext current
      RmDir /r "$APPDATA\kami"
      ; o alvo aparece como "LegacyGeneric:target=kami": tenta o nome completo
      ; e o curto (cada versão do cmdkey aceita um). A saída vai pra
      ; %TEMP%\kami-desinstalar.log (diagnóstico; o e2e do Windows lê)
      nsExec::ExecToStack `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$alvo = $$null; cmdkey /list | ForEach-Object { if ($$_ -match '(\S*target=\S+)\s*$$') { $$alvo = $$Matches[1] } elseif ($$alvo -and $$_ -match 'chave-dos-segredos-[0-9a-f]{16}\s*$$') { 'apagando ' + $$alvo; cmdkey ('/delete:' + $$alvo); cmdkey ('/delete:' + ($$alvo -replace '^.*target=', '')); $$alvo = $$null } }"`
      Pop $R9
      Pop $R8
      FileOpen $R7 "$TEMP\kami-desinstalar.log" w
      FileWrite $R7 "codigo=$R9$\r$\n$R8"
      FileClose $R7
    ${EndIf}
  ${EndIf}
!macroend

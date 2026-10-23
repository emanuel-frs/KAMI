//! "Remover tudo do Kami deste computador" (DIST-03, P-91/P-92).
//!
//! Configurações › backup e dados. Antes daqui o frontend já confirmou duas
//! vezes, ofereceu exportar e pediu ao backend que tirasse a chave das
//! senhas do cofre do sistema (`POST /api/sistema/remover-do-computador`).
//! Este comando faz o resto, nesta ordem:
//!   1. desliga o início com o sistema (registro do Windows / .desktop do
//!      autostart no Linux);
//!   2. desfaz o ícone na cor de destaque (lançador do Linux, atalhos do
//!      Windows de volta pro ícone do executável);
//!   3. derruba o backend e apaga a pasta de dados inteira (banco, cópias
//!      automáticas, log, ícones da cor, a chave em arquivo de sistemas sem
//!      cofre). A pasta extra das cópias (pendrive, Drive...) FICA — é a
//!      cópia da pessoa fora do computador;
//!   4. fecha o app; ao sair, apaga o que o webview guarda (cache,
//!      armazenamento local) — só dá com a janela fechada;
//!   5. Windows: se pedido, abre o desinstalador do programa.
//!
//! O programa em si não sai daqui (o pacote é do sistema); a tela explica
//! como removê-lo.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};

/// Ligado do começo da remoção até o app fechar: o vigia (CONF-02) não
/// sobe o backend de novo, e a saída apaga o cache do webview.
static REMOVENDO: AtomicBool = AtomicBool::new(false);

pub fn removendo() -> bool {
    REMOVENDO.load(Ordering::SeqCst)
}

/// Apaga uma pasta inteira, tentando de novo por alguns segundos: no
/// Windows o backend recém-derrubado pode segurar o banco por um instante.
fn apagar_pasta(pasta: &Path) -> Result<(), String> {
    let mut ultimo = None;
    for _ in 0..20 {
        match std::fs::remove_dir_all(pasta) {
            Ok(()) => return Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => ultimo = Some(e),
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    Err(format!(
        "não deu pra apagar {} ({}). feche o kami e apague a pasta à mão.",
        pasta.display(),
        ultimo.map(|e| e.to_string()).unwrap_or_default()
    ))
}

#[tauri::command]
pub fn remover_tudo_do_computador(app: AppHandle, abrir_desinstalador: bool) -> Result<(), String> {
    REMOVENDO.store(true, Ordering::SeqCst);
    crate::janela::desligar_autostart(&app);
    let _ = crate::icone_tema::restaurar_lancador();
    crate::parar_backend(&app);
    if let Err(e) = apagar_pasta(&crate::kami_data_dir()) {
        // sem a pasta apagada o app não pode fingir que terminou: volta a
        // funcionar (backend de pé) e a tela mostra o erro
        REMOVENDO.store(false, Ordering::SeqCst);
        crate::subir_backend_de_novo(&app);
        return Err(e);
    }

    #[cfg(target_os = "windows")]
    if abrir_desinstalador {
        // o NSIS do Tauri deixa o desinstalador ao lado do kami.exe
        if let Some(desinstalador) = std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|p| p.join("uninstall.exe")))
            .filter(|p| p.exists())
        {
            let _ = std::process::Command::new(desinstalador).spawn();
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = abrir_desinstalador;

    app.exit(0);
    Ok(())
}

/// Chamado na saída do app (RunEvent::Exit): com a remoção pedida, apaga as
/// pastas do webview (`com.kami.app` em dados, dados locais e cache).
/// Não roda com KAMI_DATA_DIR definido (modo demo, testes): essas pastas são
/// do identificador do app, as MESMAS do Kami de verdade da pessoa.
pub fn ao_sair(app: &AppHandle) {
    if !removendo() || std::env::var_os("KAMI_DATA_DIR").is_some_and(|d| !d.is_empty()) {
        return;
    }
    let caminhos = app.path();
    for pasta in [caminhos.app_data_dir(), caminhos.app_local_data_dir(), caminhos.app_cache_dir()]
        .into_iter()
        .flatten()
    {
        let _ = apagar_pasta(&pasta);
    }
}

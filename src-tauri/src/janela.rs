//! Bandeja e início com o sistema (ORG-05, P-48/P-67..P-69).
//!
//! Duas opções, as duas DESLIGADAS por padrão, ligadas em configurações ›
//! notificações:
//! - `bandeja`: o ✕ esconde a janela em vez de sair; o kami continua
//!   rodando (e avisando os lembretes) com um ícone na bandeja — menu
//!   "abrir kami", "captura rápida", "sair".
//! - `iniciar_com_sistema`: registra o kami pra abrir no login
//!   (tauri-plugin-autostart) com `--oculto`; com a bandeja ligada ele
//!   começa escondido nela, sem a bandeja abre a janela normal.
//!
//! Ficam num arquivo da máquina (`janela.json` na pasta de dados), não no
//! banco: são da máquina, não da pessoa — um backup levado pra outro
//! computador não liga o início automático de lá — e o Rust precisa saber
//! delas antes do backend subir (ao fechar e ao iniciar).
//!
//! GNOME (P-68): sem a extensão AppIndicator o ícone não aparece; o kami
//! continua rodando escondido e abrir o app de novo traz a janela de volta
//! (tauri-plugin-single-instance, registrado em main.rs).

use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;

pub const ARG_OCULTO: &str = "--oculto";
const ID_BANDEJA: &str = "kami-bandeja";

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Preferencias {
    #[serde(default)]
    pub bandeja: bool,
    #[serde(default)]
    pub iniciar_com_sistema: bool,
}

pub struct EstadoJanela(pub Mutex<Preferencias>);

fn arquivo(dir: &PathBuf) -> PathBuf {
    dir.join("janela.json")
}

pub fn carregar(dir: &PathBuf) -> Preferencias {
    std::fs::read_to_string(arquivo(dir))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn salvar(dir: &PathBuf, prefs: &Preferencias) -> Result<(), String> {
    let texto = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(arquivo(dir), texto).map_err(|e| format!("não foi possível salvar as preferências da janela: {}", e))
}

/// Instância única (ORG-05): abrir o kami de novo mostra a janela que já
/// está aberta em vez de uma segunda.
///
/// CONF-09: com `KAMI_DATA_DIR` definido (modo demo, testes, e2e) a
/// "identidade" da instância passa a ser a pasta de dados — no Linux o
/// plugin aceita um nome próprio no D-Bus. Sem isso, um Kami de verdade
/// aberto na bandeja recebia o app do teste (que fechava na hora) e o e2e
/// não rodava na máquina de quem usa o app. Sem a variável nada muda: o
/// nome continua o identificador do app. No Windows o plugin não tem essa
/// opção (o e2e de lá roda no CI, sem outro Kami aberto).
pub fn instancia_unica() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let builder = tauri_plugin_single_instance::Builder::new().callback(|app, _args, _cwd| mostrar(app));
    #[cfg(target_os = "linux")]
    let builder = match std::env::var_os("KAMI_DATA_DIR").filter(|d| !d.is_empty()) {
        Some(dir) => {
            use std::hash::{Hash, Hasher};
            // DefaultHasher::new() tem chave fixa: a mesma pasta dá o mesmo
            // nome em toda execução (é o que a segunda instância precisa)
            let mut h = std::collections::hash_map::DefaultHasher::new();
            dir.hash(&mut h);
            // parte de nome D-Bus não pode começar com dígito → "d" na frente
            builder.dbus_id(format!("com.kami.app.d{:016x}", h.finish()))
        }
        None => builder,
    };
    builder.build()
}

/// Mostra a janela principal (da bandeja, da segunda instância…).
pub fn mostrar(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Cria o ícone da bandeja (se ainda não existe).
pub fn criar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(ID_BANDEJA).is_some() {
        return Ok(());
    }
    let abrir = MenuItem::with_id(app, "abrir", "abrir kami", true, None::<&str>)?;
    let captura = MenuItem::with_id(app, "captura", "captura rápida", true, None::<&str>)?;
    let separador = PredefinedMenuItem::separator(app)?;
    let sair = MenuItem::with_id(app, "sair", "sair", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&abrir, &captura, &separador, &sair])?;

    let mut builder = TrayIconBuilder::with_id(ID_BANDEJA)
        .tooltip("kami")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, evento| match evento.id().as_ref() {
            "abrir" => mostrar(app),
            "captura" => {
                mostrar(app);
                let _ = app.emit("kami://captura", ());
            }
            "sair" => pedir_saida(app),
            _ => {}
        })
        .on_tray_icon_event(|icone, evento| {
            // clique esquerdo abre (Windows; no Linux o AppIndicator só tem o menu)
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = evento
            {
                mostrar(icone.app_handle());
            }
        });
    if let Some(icone) = app.default_window_icon() {
        builder = builder.icon(icone.clone());
    }
    builder.build(app)?;
    Ok(())
}

fn remover_bandeja(app: &AppHandle) {
    let _ = app.remove_tray_by_id(ID_BANDEJA);
}

/// "sair" da bandeja: o frontend salva o que estiver pendente (nota
/// aberta…) e chama `janela_sair`. Se ele não responder em 4 s, sai assim
/// mesmo.
fn pedir_saida(app: &AppHandle) {
    mostrar(app);
    let _ = app.emit("kami://sair", ());
    let app2 = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(4));
        app2.exit(0);
    });
}

/// Bandeja ligada? (o ✕ esconde em vez de fechar — ver main.rs)
pub fn bandeja_ligada(app: &AppHandle) -> bool {
    app.state::<EstadoJanela>().0.lock().map(|p| p.bandeja).unwrap_or(false)
}

#[tauri::command]
pub fn janela_preferencias(app: AppHandle) -> Preferencias {
    let mut prefs = app.state::<EstadoJanela>().0.lock().unwrap().clone();
    // o registro de verdade é do sistema (a pessoa pode ter tirado de lá)
    if let Ok(ligado) = app.autolaunch().is_enabled() {
        prefs.iniciar_com_sistema = ligado;
    }
    prefs
}

#[tauri::command]
pub fn janela_definir(app: AppHandle, campo: String, valor: bool) -> Result<Preferencias, String> {
    let dir = crate::kami_data_dir();
    let estado = app.state::<EstadoJanela>();
    let mut prefs = estado.0.lock().unwrap();
    match campo.as_str() {
        "bandeja" => {
            if valor {
                criar_bandeja(&app).map_err(|e| format!("não foi possível criar o ícone da bandeja: {}", e))?;
            } else {
                remover_bandeja(&app);
            }
            prefs.bandeja = valor;
        }
        "iniciar_com_sistema" => {
            let auto = app.autolaunch();
            let r = if valor { auto.enable() } else { auto.disable() };
            r.map_err(|e| format!("não foi possível {} o início com o sistema: {}", if valor { "ligar" } else { "desligar" }, e))?;
            prefs.iniciar_com_sistema = valor;
        }
        _ => return Err(format!("opção desconhecida: {}", campo)),
    }
    salvar(&dir, &prefs)?;
    Ok(prefs.clone())
}

/// Saída de verdade (menu da bandeja › sair, depois de o frontend salvar).
#[tauri::command]
pub fn janela_sair(app: AppHandle) {
    app.exit(0);
}

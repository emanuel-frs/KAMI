//! Bandeja e início com o sistema (ORG-05, P-48/P-67..P-69).
//!
//! Duas opções, as duas DESLIGADAS por padrão, ligadas em configurações ›
//! notificações:
//! - `bandeja`: o ✕ esconde a janela em vez de sair; o kami continua
//!   rodando (e avisando os lembretes) com um ícone na bandeja — menu
//!   "abrir kami", "captura rápida", "sair".
//! - `iniciar_com_sistema`: registra o kami pra abrir no login
//!   (crate auto-launch, ver `inicio_com_sistema`) com `--oculto`; com a bandeja ligada ele
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
use auto_launch::{AutoLaunch, AutoLaunchBuilder, WindowsEnableMode};

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
/// I18N-01: os textos do menu da bandeja no idioma do app. Quem traduz é o
/// frontend (os dicionários moram lá) e manda com `janela_textos_bandeja`;
/// até ele mandar — a bandeja pode nascer antes, com o Kami iniciado
/// escondido — fica o português.
pub struct TextosBandeja(pub Mutex<[String; 3]>);

impl Default for TextosBandeja {
    fn default() -> Self {
        Self(Mutex::new(["abrir kami".into(), "captura rápida".into(), "sair".into()]))
    }
}

fn menu_da_bandeja(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let [abrir, captura, sair] = app.state::<TextosBandeja>().0.lock().unwrap().clone();
    let abrir = MenuItem::with_id(app, "abrir", abrir, true, None::<&str>)?;
    let captura = MenuItem::with_id(app, "captura", captura, true, None::<&str>)?;
    let separador = PredefinedMenuItem::separator(app)?;
    let sair = MenuItem::with_id(app, "sair", sair, true, None::<&str>)?;
    Menu::with_items(app, &[&abrir, &captura, &separador, &sair])
}

#[tauri::command]
pub fn janela_textos_bandeja(app: AppHandle, abrir: String, captura: String, sair: String) -> Result<(), String> {
    // texto de menu curto; nada de vir um parágrafo inteiro de fora
    let curto = |s: String| s.chars().take(60).collect::<String>();
    *app.state::<TextosBandeja>().0.lock().unwrap() = [curto(abrir), curto(captura), curto(sair)];
    if let Some(bandeja) = app.tray_by_id(ID_BANDEJA) {
        let menu = menu_da_bandeja(&app).map_err(|e| e.to_string())?;
        bandeja.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn criar_bandeja(app: &AppHandle) -> tauri::Result<()> {
    if app.tray_by_id(ID_BANDEJA).is_some() {
        return Ok(());
    }
    let menu = menu_da_bandeja(app)?;

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

/// O início com o sistema, SEMPRE só pra pessoa que está usando
/// (`HKCU\...\Run` no Windows, `~/.config/autostart` no Linux).
///
/// Antes era o tauri-plugin-autostart, que usa o modo "dinâmico" do
/// auto-launch: com o Kami aberto como administrador ele gravava em
/// `HKLM\...\Run` — iniciar com o sistema pra TODOS os usuários do PC, e
/// uma entrada que o desinstalador (por usuário) não apaga. Achado no e2e
/// do Windows da 1.14 (o runner do GitHub é administrador). Desligar
/// continua tirando das duas (o auto-launch tenta o HKLM e ignora se não
/// tiver permissão), então uma entrada antiga em HKLM some ao desligar.
fn inicio_com_sistema(app: &AppHandle) -> Result<AutoLaunch, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // AppImage: o caminho do próprio .AppImage, não o do executável montado
    // em /tmp/.mount_* (que some quando o app fecha)
    let caminho = std::env::var_os("APPIMAGE")
        .filter(|_| cfg!(target_os = "linux"))
        .map(PathBuf::from)
        .unwrap_or(exe);
    AutoLaunchBuilder::new()
        .set_app_name(&app.package_info().name)
        .set_app_path(&caminho.display().to_string())
        .set_args(&[ARG_OCULTO])
        .set_windows_enable_mode(WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn janela_preferencias(app: AppHandle) -> Preferencias {
    let mut prefs = app.state::<EstadoJanela>().0.lock().unwrap().clone();
    // o registro de verdade é do sistema (a pessoa pode ter tirado de lá)
    if let Ok(ligado) = inicio_com_sistema(&app).and_then(|a| a.is_enabled().map_err(|e| e.to_string())) {
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
            let auto = inicio_com_sistema(&app)?;
            let r = if valor { auto.enable() } else { auto.disable() };
            r.map_err(|e| format!("não foi possível {} o início com o sistema: {}", if valor { "ligar" } else { "desligar" }, e))?;
            if valor {
                autostart_com_tryexec();
            }
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

// ── DIST-03: autostart que não sobra ────────────────────────────────────

/// Arquivo do autostart no Linux — o mesmo caminho que o `auto-launch`
/// usa (`$HOME/.config/autostart`, ele não olha o XDG_CONFIG_HOME), com o
/// nome do app ("Kami").
#[cfg(target_os = "linux")]
fn arquivo_autostart() -> Option<PathBuf> {
    dirs::home_dir().map(|h| h.join(".config/autostart/Kami.desktop"))
}

/// O programa do `Exec=` (o caminho que o `auto-launch` escreveu).
#[cfg(target_os = "linux")]
fn programa_do_exec(texto: &str) -> Option<&str> {
    texto.lines().find_map(|l| l.strip_prefix("Exec=")).and_then(|e| e.split_whitespace().next())
}

/// Acrescenta `TryExec=<programa>`: se o Kami for removido (`dnf remove`,
/// AppImage apagado) sem abrir de novo, a sessão ignora a entrada em vez de
/// tentar abrir um programa que não existe a cada login.
#[cfg(target_os = "linux")]
fn com_tryexec(texto: &str) -> String {
    if texto.lines().any(|l| l.starts_with("TryExec=")) {
        return texto.to_string();
    }
    let Some(prog) = programa_do_exec(texto) else { return texto.to_string() };
    let mut linhas: Vec<String> = Vec::new();
    for l in texto.lines() {
        linhas.push(l.to_string());
        if l.starts_with("Exec=") {
            linhas.push(format!("TryExec={prog}"));
        }
    }
    linhas.join("\n") + "\n"
}

#[cfg(target_os = "linux")]
fn autostart_com_tryexec() {
    let Some(arquivo) = arquivo_autostart() else { return };
    if let Ok(texto) = std::fs::read_to_string(&arquivo) {
        let _ = std::fs::write(&arquivo, com_tryexec(&texto));
    }
}

#[cfg(not(target_os = "linux"))]
fn autostart_com_tryexec() {}

/// Na abertura: o autostart aponta pra um programa que não existe mais
/// (trocou o .deb pelo AppImage, moveu o AppImage) → reescreve pro
/// executável atual. Só quando o de lá SUMIU: um build de desenvolvimento
/// aberto não toma o autostart da versão instalada.
pub fn conferir_autostart(app: &AppHandle) {
    #[cfg(target_os = "linux")]
    {
        let Some(arquivo) = arquivo_autostart() else { return };
        let Ok(texto) = std::fs::read_to_string(&arquivo) else { return };
        if !texto.contains(ARG_OCULTO) {
            return; // não é o nosso
        }
        let sumiu = programa_do_exec(&texto).map(|p| !std::path::Path::new(p).exists()).unwrap_or(false);
        if sumiu && inicio_com_sistema(app).is_ok_and(|a| a.enable().is_ok()) {
            autostart_com_tryexec();
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = app;
}

/// "Remover tudo do Kami deste computador": desliga o início com o sistema.
pub fn desligar_autostart(app: &AppHandle) {
    if let Ok(auto) = inicio_com_sistema(app) {
        if auto.is_enabled().unwrap_or(false) {
            let _ = auto.disable();
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod testes {
    use super::*;

    #[test]
    fn autostart_ganha_tryexec_uma_vez() {
        let texto = "[Desktop Entry]\nType=Application\nName=Kami\nExec=/opt/kami/Kami.AppImage --oculto\nTerminal=false";
        let novo = com_tryexec(texto);
        assert!(novo.contains("Exec=/opt/kami/Kami.AppImage --oculto\nTryExec=/opt/kami/Kami.AppImage\n"));
        assert_eq!(com_tryexec(&novo), novo);
        assert_eq!(programa_do_exec(texto), Some("/opt/kami/Kami.AppImage"));
    }
}

// Subsistema "windows" no build de release (AJU-01): sem isso o .exe é
// compilado como app de CONSOLE e o Windows abre uma janela de terminal
// preta junto com o Kami (e fechar essa janela derruba o app). Só em
// release — em `cargo tauri dev` (debug_assertions ligado) o console
// continua aparecendo, porque é nele que saem os `print!` do sidecar.
// Sem console, o print!/eprint! do repasse de log abaixo não dá panic: a
// std do Rust trata o handle de saída inexistente do Windows como um
// "ralo" e descarta a escrita (o log de verdade fica no
// kami-backend.log, gravado pelo próprio sidecar).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Kami — processo principal do Tauri.
//
// Responsabilidade: subir o backend (sidecar do PyInstaller, decisão
// 19) junto com o app, encerrar esse processo quando a janela
// principal for fechada, e expor a porta em que o backend subiu pro
// frontend via o comando `get_backend_port` (ALINHAMENTO.md 2.5 — a
// porta deixou de ser fixa em 8000, o sidecar agora escolhe uma porta
// livre e grava num arquivo; ver backend/run_server.py e
// backend/app/paths.py).
//
// Falhas do backend agora são REPORTADAS, não engolidas:
//   - se o sidecar não consegue nem iniciar (ex.: antivírus bloqueou o
//     .exe), o app abre mesmo assim e `get_backend_port` devolve um erro
//     legível em vez de o Rust dar panic (antes: `.expect(...)`);
//   - se o sidecar morre durante o startup, o erro sai na hora (não
//     espera o timeout) com as últimas linhas que ele imprimiu;
//   - o timeout de espera pela porta subiu de 10s pra 60s — no primeiro
//     start em Windows, o executável onefile se descompacta e o
//     Defender escaneia tudo, o que facilmente passa de 10s;
//   - todo erro cita o caminho do kami-backend.log (gravado pelo
//     run_server.py na pasta de dados).
//
// Ao fechar, no Windows o processo do sidecar é encerrado com
// `taskkill /T` (árvore inteira): no modo onefile o PyInstaller sobe um
// processo "bootloader" que por sua vez sobe o Python de verdade, e
// matar só o pai deixava o filho vivo, segurando a porta e travando
// reinstalação/atualização.
//
// Token de sessão: o sidecar gera um segredo a cada execução e o grava
// em `backend_token.txt` (0600) na pasta de dados, ANTES de publicar a
// porta. `get_backend_token` só lê esse arquivo e entrega ao frontend,
// que o envia no header `X-Kami-Token`. Assim uma página web qualquer
// que descubra a porta não consegue usar a API (ver
// backend/app/security.py). Em modo dev sem sidecar não há token.
//
// Reinício (CONF-02): o frontend (components/backend-watchdog.js) checa
// o /health de tempos em tempos; se o backend caiu, chama
// `restart_backend`, que encerra o processo antigo (se ainda houver) e
// sobe outro com porta e token novos — sem fechar o app. Cada processo
// tem uma GERAÇÃO: os eventos do processo antigo (inclusive o
// "Terminated" de quando nós mesmos o matamos pra reiniciar) só contam
// se a geração ainda for a atual, senão marcariam o processo novo como
// falho. `open_log_folder` abre a pasta de dados com o kami-backend.log
// selecionado (caminho fixo no Rust — a janela não ganha permissão
// nenhuma de abrir caminhos arbitrários).
//
// Pasta de dados: `KAMI_DATA_DIR` (opcional) substitui o caminho padrão
// — é o "modo demo" (dados fictícios sem tocar nos reais). Precisa
// continuar igual ao backend/app/paths.py.
//
// Modo dev sem sidecar: pra iterar rápido no backend sem precisar
// rodar o PyInstaller a cada mudança, defina a variável de ambiente
// KAMI_DEV_NO_SIDECAR=1 antes de `cargo tauri dev` — o app não sobe
// o sidecar, e você roda `uvicorn app.main:app --reload` manualmente
// à parte, como sempre foi. Nesse modo o uvicorn manual sobe fixo em
// 8000 (não passa por run_server.py, então não existe port file) —
// por isso `get_backend_port` também precisa saber desse modo e
// devolver 8000 direto, sem tentar ler o arquivo (ver DevPortOverride
// abaixo).

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<CommandChild>>);

/// Some(8000) quando KAMI_DEV_NO_SIDECAR está setado (uvicorn manual,
/// porta fixa de sempre); None no caso normal (sidecar real, porta
/// dinâmica lida do port file).
struct DevPortOverride(Option<u16>);

/// Estado de saúde do sidecar, preenchido pelo loop de eventos do
/// processo e lido por `get_backend_port`.
#[derive(Default)]
struct BackendState {
    /// Some(mensagem) quando o sidecar não iniciou ou já terminou.
    failure: Option<String>,
    /// Últimas linhas de stdout/stderr do sidecar (pra mensagem de erro).
    tail: Vec<String>,
    /// Geração do processo atual (CONF-02) — sobe a cada reinício; evento
    /// de processo de geração antiga é ignorado.
    generation: u64,
}

#[derive(Default)]
struct BackendStatus(Mutex<BackendState>);

const PORT_FILE_NAME: &str = "backend_port.txt";
const TOKEN_FILE_NAME: &str = "backend_token.txt";
const LOG_FILE_NAME: &str = "kami-backend.log";
// 60s (era 10s): o primeiro start no Windows (onefile + scan do
// antivírus) pode demorar bem mais que isso — ver nota no topo.
const PORT_FILE_TIMEOUT: Duration = Duration::from_secs(60);
const TAIL_MAX_LINES: usize = 20;
const TAIL_SHOWN_IN_ERROR: usize = 5;

/// Espelha app/paths.py (ramo frozen) — precisa ficar em sync
/// manualmente se um dia mudar de lado. O sidecar SEMPRE roda
/// congelado (PyInstaller), mesmo disparado via `cargo tauri dev`,
/// então este é o único ramo que importa aqui.
fn kami_data_dir() -> PathBuf {
    // override explícito (modo demo/testes) — mesma variável do paths.py
    if let Some(custom) = std::env::var_os("KAMI_DATA_DIR") {
        if !custom.is_empty() {
            return PathBuf::from(custom);
        }
    }

    #[cfg(target_os = "windows")]
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("sem home dir"));

    #[cfg(target_os = "macos")]
    let base = dirs::home_dir()
        .expect("sem home dir")
        .join("Library/Application Support");

    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| dirs::home_dir().expect("sem home dir").join(".local/share"));

    base.join("kami")
}

fn port_file_path() -> PathBuf {
    kami_data_dir().join(PORT_FILE_NAME)
}

fn token_file_path() -> PathBuf {
    kami_data_dir().join(TOKEN_FILE_NAME)
}

fn log_file_path() -> PathBuf {
    kami_data_dir().join(LOG_FILE_NAME)
}

/// Monta a mensagem final de erro mostrada pro usuário: o motivo, as
/// últimas linhas do backend (se houver) e onde está o log completo.
fn failure_message(reason: &str, tail: &[String]) -> String {
    let mut msg = format!("O backend do Kami {}.", reason);
    let shown: Vec<&str> = tail
        .iter()
        .rev()
        .take(TAIL_SHOWN_IN_ERROR)
        .rev()
        .map(|l| l.as_str())
        .collect();
    if !shown.is_empty() {
        msg.push_str(&format!(" Últimas linhas: {}", shown.join(" | ")));
    }
    msg.push_str(&format!(" Log completo: {}", log_file_path().display()));
    msg
}

fn set_failure(app: &tauri::AppHandle, generation: u64, reason: &str) {
    let status = app.state::<BackendStatus>();
    let mut state = status.0.lock().unwrap();
    if state.generation != generation {
        return; // processo antigo (já substituído por um reinício)
    }
    // mantém o PRIMEIRO motivo — os seguintes costumam ser consequência
    if state.failure.is_none() {
        let msg = failure_message(reason, &state.tail);
        state.failure = Some(msg);
    }
}

fn push_tail(app: &tauri::AppHandle, generation: u64, line: &[u8]) {
    let text = String::from_utf8_lossy(line).trim().to_string();
    if text.is_empty() {
        return;
    }
    let status = app.state::<BackendStatus>();
    let mut state = status.0.lock().unwrap();
    if state.generation != generation {
        return;
    }
    state.tail.push(text);
    if state.tail.len() > TAIL_MAX_LINES {
        state.tail.remove(0);
    }
}

/// Encerra o sidecar — o bootloader do PyInstaller onefile E o Python
/// filho, que é o backend de verdade. Matar só o bootloader (o que o
/// `child.kill()` faz) deixava o backend órfão no Linux a cada fechada do
/// app e a cada "reiniciar".
/// - Windows: `taskkill /T /F` mata a árvore inteira.
/// - Linux: o mesmo, à mão — os descendentes vêm de
///   `/proc/<pid>/task/<pid>/children`.
/// Se mesmo assim o app sumir sem passar por aqui (travou, foi morto), o
/// backend percebe pelo KAMI_APP_PID e sai sozinho (backend/app/processo.py).
fn kill_backend(child: CommandChild) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.pid().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    #[cfg(target_os = "linux")]
    {
        for pid in descendants(child.pid()) {
            let _ = std::process::Command::new("kill")
                .args(["-KILL", &pid.to_string()])
                .status();
        }
    }
    let _ = child.kill();
}

/// Todos os descendentes de `pid`, dos netos pros filhos (Linux).
#[cfg(target_os = "linux")]
fn descendants(pid: u32) -> Vec<u32> {
    let mut out = Vec::new();
    let path = format!("/proc/{pid}/task/{pid}/children");
    if let Ok(text) = std::fs::read_to_string(path) {
        for child in text.split_whitespace().filter_map(|p| p.parse::<u32>().ok()) {
            out.extend(descendants(child));
            out.push(child);
        }
    }
    out
}

#[tauri::command]
async fn get_backend_port(
    dev_override: tauri::State<'_, DevPortOverride>,
    status: tauri::State<'_, BackendStatus>,
) -> Result<u16, String> {
    if let Some(fixed_port) = dev_override.0 {
        return Ok(fixed_port);
    }

    let port_file = port_file_path();
    let start = Instant::now();

    loop {
        // falha primeiro: se o sidecar já morreu, não adianta devolver
        // uma porta (mesmo que o arquivo exista) — ninguém escuta nela
        let failure = status.0.lock().unwrap().failure.clone();
        if let Some(msg) = failure {
            return Err(msg);
        }

        if let Ok(content) = std::fs::read_to_string(&port_file) {
            if let Ok(port) = content.trim().parse::<u16>() {
                return Ok(port);
            }
        }

        if start.elapsed() > PORT_FILE_TIMEOUT {
            let tail = status.0.lock().unwrap().tail.clone();
            return Err(failure_message(
                &format!(
                    "não respondeu em {}s (porta não publicada em {})",
                    PORT_FILE_TIMEOUT.as_secs(),
                    port_file.display()
                ),
                &tail,
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Devolve o token de sessão do backend. String vazia = sem token (modo
/// dev com uvicorn manual), e o frontend simplesmente não envia o header.
/// O sidecar grava o token antes da porta, então quando `get_backend_port`
/// já respondeu o arquivo existe; a espera curta abaixo só cobre a
/// janela de escrita/rename.
#[tauri::command]
async fn get_backend_token(
    dev_override: tauri::State<'_, DevPortOverride>,
) -> Result<String, String> {
    if dev_override.0.is_some() {
        return Ok(String::new());
    }

    let token_file = token_file_path();
    let start = Instant::now();
    loop {
        if let Ok(content) = std::fs::read_to_string(&token_file) {
            let token = content.trim().to_string();
            if !token.is_empty() {
                return Ok(token);
            }
        }
        if start.elapsed() > Duration::from_secs(5) {
            // Causa mais comum em desenvolvimento: o binário do sidecar em
            // src-tauri/binaries/ é de um build ANTERIOR ao token de sessão
            // (`cargo tauri dev` e `build.sh --dev` não o reconstroem). O
            // backend sobe e publica a porta, mas nunca grava o token.
            return Err(format!(
                "O backend do Kami não publicou o token de sessão em {}. \
                 Isso costuma indicar um sidecar desatualizado: rode ./build.sh \
                 (sem --dev e sem --skip-sidecar) para reconstruí-lo e tente de novo. \
                 Se o problema persistir, veja o kami-backend.log na mesma pasta.",
                token_file.display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

/// Sobe o sidecar e liga o loop de eventos dele. Usado no startup e no
/// reinício (CONF-02). Falha ao iniciar não derruba o app: vira o motivo
/// devolvido por `get_backend_port`.
fn spawn_backend(app: &tauri::AppHandle) {
    let generation = app.state::<BackendStatus>().0.lock().unwrap().generation;

    // apaga port/token de uma execução anterior antes de subir o sidecar
    // novo — sem isso, get_backend_port poderia devolver a porta velha por
    // um instante caso seja chamado antes do sidecar novo sobrescrever o
    // arquivo (ver ALINHAMENTO.md, nota sobre "porta fantasma")
    let _ = std::fs::remove_file(port_file_path());
    let _ = std::fs::remove_file(token_file_path());

    // KAMI_APP_PID: o backend encerra sozinho quando este processo some
    // (app travou ou foi morto) — ver backend/app/processo.py
    let spawn_result = app
        .shell()
        .sidecar("kami-backend")
        .map(|command| command.env("KAMI_APP_PID", std::process::id().to_string()))
        .and_then(|command| command.spawn());

    match spawn_result {
        Ok((mut rx, child)) => {
            app.state::<BackendProcess>().0.lock().unwrap().replace(child);

            // Repassa stdout/stderr do backend pro console do Tauri (útil em
            // dev), guarda as últimas linhas pra mensagem de erro e registra
            // quando o processo morre — tudo marcado com a geração.
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            print!("[kami-backend] {}", String::from_utf8_lossy(&line));
                            push_tail(&handle, generation, &line);
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[kami-backend] {}", String::from_utf8_lossy(&line));
                            push_tail(&handle, generation, &line);
                        }
                        CommandEvent::Error(err) => {
                            set_failure(&handle, generation, &format!("reportou um erro ({})", err));
                        }
                        CommandEvent::Terminated(payload) => {
                            set_failure(
                                &handle,
                                generation,
                                &format!("encerrou inesperadamente (código {:?})", payload.code),
                            );
                        }
                        _ => {}
                    }
                }
            });
        }
        Err(err) => {
            set_failure(
                app,
                generation,
                &format!(
                    "não pôde ser iniciado ({}) — verifique se o antivírus não bloqueou ou colocou o arquivo em quarentena",
                    err
                ),
            );
        }
    }
}

/// Reinicia o backend (CONF-02): encerra o processo atual, se ainda
/// existir, zera o estado de saúde com uma geração nova e sobe outro. O
/// frontend depois chama `get_backend_port`/`get_backend_token` de novo,
/// que esperam a porta e o token NOVOS (os arquivos antigos foram
/// apagados em spawn_backend).
#[tauri::command]
async fn restart_backend(
    app: tauri::AppHandle,
    dev_override: tauri::State<'_, DevPortOverride>,
) -> Result<(), String> {
    if dev_override.0.is_some() {
        return Err(
            "Modo dev (KAMI_DEV_NO_SIDECAR): o backend roda à parte — suba o uvicorn de novo no terminal."
                .to_string(),
        );
    }
    if let Some(child) = app.state::<BackendProcess>().0.lock().unwrap().take() {
        kill_backend(child);
    }
    {
        let status = app.state::<BackendStatus>();
        let mut state = status.0.lock().unwrap();
        state.generation += 1;
        state.failure = None;
        state.tail.clear();
    }
    spawn_backend(&app);
    Ok(())
}

/// Abre a pasta de dados com o kami-backend.log selecionado (ou só a
/// pasta, se o log ainda não existir).
#[tauri::command]
fn open_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let log = log_file_path();
    let result = if log.exists() {
        app.opener().reveal_item_in_dir(&log)
    } else {
        app.opener().open_path(kami_data_dir().to_string_lossy(), None::<&str>)
    };
    result.map_err(|e| format!("não foi possível abrir a pasta do log ({}): {}", kami_data_dir().display(), e))
}

mod icone_tema; // ICO-01: ícone do app na cor de destaque
mod janela; // ORG-05: bandeja e iniciar com o sistema

fn main() {
    tauri::Builder::default()
        // ORG-05 (P-67/P-68): abrir o kami de novo mostra a janela que já
        // está aberta (ou escondida na bandeja) em vez de uma segunda — tem
        // que ser o primeiro plugin registrado
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| janela::mostrar(app)))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![janela::ARG_OCULTO]),
        ))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .manage(BackendProcess(Mutex::new(None)))
        .manage(BackendStatus::default())
        .manage(janela::EstadoJanela(Mutex::new(janela::carregar(&kami_data_dir()))))
        .invoke_handler(tauri::generate_handler![
            get_backend_port,
            get_backend_token,
            restart_backend,
            open_log_folder,
            icone_tema::aplicar_icone_tema,
            janela::janela_preferencias,
            janela::janela_definir,
            janela::janela_sair
        ])
        .setup(|app| {
            // ORG-05: bandeja ligada → ícone já no começo; iniciado pelo
            // sistema (--oculto) com bandeja → começa escondido nela
            if janela::bandeja_ligada(app.handle()) {
                if let Err(e) = janela::criar_bandeja(app.handle()) {
                    eprintln!("[kami] bandeja indisponível: {}", e);
                } else if std::env::args().any(|a| a == janela::ARG_OCULTO) {
                    if let Some(w) = app.get_webview_window("main") {
                        let _ = w.hide();
                    }
                }
            }

            if std::env::var("KAMI_DEV_NO_SIDECAR").is_ok() {
                println!(
                    "[kami] KAMI_DEV_NO_SIDECAR definido — não subindo o sidecar. \
                     Rode o backend manualmente (uvicorn app.main:app --reload)."
                );
                app.manage(DevPortOverride(Some(8000)));
                return Ok(());
            }
            app.manage(DevPortOverride(None));

            spawn_backend(app.handle());

            Ok(())
        })
        .on_window_event(|window, event| {
            // ORG-05: com a bandeja ligada o ✕ só esconde (o kami continua
            // avisando os lembretes); sair de vez é pelo menu da bandeja
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if janela::bandeja_ligada(window.app_handle()) {
                    api.prevent_close();
                    let _ = window.hide();
                    let _ = window.emit("kami://escondido", ());
                    return;
                }
            }
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(child) = window
                    .state::<BackendProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    kill_backend(child);
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("erro ao rodar a aplicação Kami")
        .run(|app, event| {
            // "sair" da bandeja (app.exit) não passa pelo Destroyed da janela
            // em todo sistema — garante que o backend não fica órfão
            if let tauri::RunEvent::Exit = event {
                if let Some(child) = app.state::<BackendProcess>().0.lock().unwrap().take() {
                    kill_backend(child);
                }
            }
        });
}

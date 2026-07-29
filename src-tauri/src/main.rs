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
// AVISO: escrito sem Rust/Cargo disponíveis no ambiente onde isso foi
// gerado — nem a base (sidecar/CommandChild) nem a parte nova
// (get_backend_port) foram compiladas/validadas aqui. Rode
// `cargo check` e ajuste conforme os erros do compilador, com atenção
// especial a duas coisas que dependem de versão instalada:
//   - assinatura do tauri-plugin-shell (CommandChild/CommandEvent)
//   - se `dirs = "5"` precisa ir no Cargo.toml (usado só em
//     kami_data_dir, pra achar a pasta de dados do usuário por SO —
//     mesmo papel do Path.home() do lado Python em paths.py)
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

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<CommandChild>>);

/// Some(8000) quando KAMI_DEV_NO_SIDECAR está setado (uvicorn manual,
/// porta fixa de sempre); None no caso normal (sidecar real, porta
/// dinâmica lida do port file).
struct DevPortOverride(Option<u16>);

const PORT_FILE_NAME: &str = "backend_port.txt";
const PORT_FILE_TIMEOUT: Duration = Duration::from_secs(10);

/// Espelha app/paths.py (ramo frozen) — precisa ficar em sync
/// manualmente se um dia mudar de lado. O sidecar SEMPRE roda
/// congelado (PyInstaller), mesmo disparado via `cargo tauri dev`,
/// então este é o único ramo que importa aqui.
fn kami_data_dir() -> PathBuf {
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

#[tauri::command]
async fn get_backend_port(
    dev_override: tauri::State<'_, DevPortOverride>,
) -> Result<u16, String> {
    if let Some(fixed_port) = dev_override.0 {
        return Ok(fixed_port);
    }

    let port_file = port_file_path();
    let start = Instant::now();

    loop {
        if let Ok(content) = std::fs::read_to_string(&port_file) {
            if let Ok(port) = content.trim().parse::<u16>() {
                return Ok(port);
            }
        }
        if start.elapsed() > PORT_FILE_TIMEOUT {
            return Err(format!(
                "timeout esperando o backend escrever a porta em {}",
                port_file.display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![get_backend_port])
        .setup(|app| {
            if std::env::var("KAMI_DEV_NO_SIDECAR").is_ok() {
                println!(
                    "[kami] KAMI_DEV_NO_SIDECAR definido — não subindo o sidecar. \
                     Rode o backend manualmente (uvicorn app.main:app --reload)."
                );
                app.manage(DevPortOverride(Some(8000)));
                return Ok(());
            }
            app.manage(DevPortOverride(None));

            // apaga um port file de uma execução anterior antes de subir o
            // sidecar novo — sem isso, get_backend_port poderia devolver a
            // porta velha por um instante caso seja chamado antes do
            // sidecar novo sobrescrever o arquivo (ver ALINHAMENTO.md,
            // nota sobre "porta fantasma")
            let _ = std::fs::remove_file(port_file_path());

            let shell = app.shell();
            let (mut rx, child) = shell
                .sidecar("kami-backend")
                .expect(
                    "não achei o sidecar kami-backend — rodou scripts/build_sidecar.sh antes?",
                )
                .spawn()
                .expect("falha ao iniciar o backend (sidecar)");

            app.state::<BackendProcess>()
                .0
                .lock()
                .unwrap()
                .replace(child);

            // Repassa stdout/stderr do backend pro console do Tauri —
            // útil pra depurar em dev sem precisar de terminal
            // separado rodando o uvicorn.
            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            print!("[kami-backend] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            eprint!("[kami-backend] {}", String::from_utf8_lossy(&line));
                        }
                        _ => {}
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                if let Some(child) = window
                    .state::<BackendProcess>()
                    .0
                    .lock()
                    .unwrap()
                    .take()
                {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao rodar a aplicação Kami");
}
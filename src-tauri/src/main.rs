// Kami — processo principal do Tauri.
//
// Responsabilidade: subir o backend (sidecar do PyInstaller, decisão
// 19) junto com o app, e encerrar esse processo quando a janela
// principal for fechada — sem isso o uvicorn empacotado ficaria
// órfão rodando em segundo plano depois que o usuário "fecha" o
// Kami.
//
// AVISO: escrito sem Rust/Cargo disponíveis no ambiente onde isso foi
// gerado, então a API exata do tauri-plugin-shell (nomes de método,
// forma de CommandChild/CommandEvent) não foi compilada/validada
// aqui. A ideia geral (spawn de sidecar, capturar Child num State,
// matar em WindowEvent::Destroyed) é o padrão documentado do Tauri
// v2, mas rode `cargo check` e ajuste conforme os erros do compilador
// — principalmente se a versão do tauri-plugin-shell instalada tiver
// mudado assinatura de algo desde que este arquivo foi escrito.
//
// Modo dev sem sidecar: pra iterar rápido no backend sem precisar
// rodar o PyInstaller a cada mudança, defina a variável de ambiente
// KAMI_DEV_NO_SIDECAR=1 antes de `cargo tauri dev` — o app não sobe
// o sidecar, e você roda `uvicorn app.main:app --reload` manualmente
// à parte, como sempre foi.

use std::sync::Mutex;

use tauri::Manager;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct BackendProcess(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            if std::env::var("KAMI_DEV_NO_SIDECAR").is_ok() {
                println!(
                    "[kami] KAMI_DEV_NO_SIDECAR definido — não subindo o sidecar. \
                     Rode o backend manualmente (uvicorn app.main:app --reload)."
                );
                return Ok(());
            }

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
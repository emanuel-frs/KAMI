//! Aviso de versão nova e atualização pelo próprio app (DIST-01, P-75).
//!
//! O kami **só avisa**: nada é baixado nem instalado sozinho. Quem decide
//! quando procurar é o frontend (components/atualizacao.js — ao abrir e uma
//! vez por dia, e só com "procurar atualizações" ligado em configurações ›
//! sobre); daqui nunca sai requisição por conta própria.
//!
//! - `atualizacao_procurar`: consulta o `latest.json` da última Release do
//!   GitHub (endereço e chave pública em tauri.conf.json › plugins.updater)
//!   e devolve a versão nova, se houver, e se dá pra instalar por aqui.
//! - `atualizacao_instalar`: baixa (progresso no evento
//!   `kami://atualizacao-progresso`), confere a assinatura com a chave
//!   pública embutida — pacote com assinatura errada é recusado pelo plugin
//!   antes de qualquer coisa —, derruba o backend e instala. Windows: o
//!   instalador NSIS fecha o app e abre a versão nova. AppImage: o arquivo é
//!   trocado e o app reinicia.
//!
//! Só dá pra instalar daqui no Windows (NSIS) e no AppImage. `.deb`, `.rpm`
//! e AUR: o gerenciador de pacotes é quem atualiza — a tela só avisa e
//! aponta pra página da versão.
//!
//! `KAMI_ATUALIZACAO_URL` troca o endereço do latest.json (testes do
//! DIST-01, com um servidor local). Não abre brecha: a assinatura continua
//! conferida com a chave embutida, e endereço sem https só é aceito num build
//! feito com `dangerousInsecureTransportProtocol` ligado — o publicado não.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Ligado entre o fim do download e o app fechar: o vigia (CONF-02) não
/// pode subir o backend de novo no meio da instalação.
static INSTALANDO: AtomicBool = AtomicBool::new(false);

pub fn instalando() -> bool {
    INSTALANDO.load(Ordering::SeqCst)
}

/// A última versão encontrada (instalar usa a mesma que a tela mostrou).
#[derive(Default)]
pub struct Pendente(pub Mutex<Option<Update>>);

#[derive(Serialize)]
pub struct Disponivel {
    versao: String,
    atual: String,
    notas: Option<String>,
    /// AAAA-MM-DD, quando o latest.json traz
    data: Option<String>,
    /// false: .deb/.rpm/AUR — só o aviso
    instalavel: bool,
}

fn pode_instalar_daqui() -> bool {
    if cfg!(target_os = "windows") {
        return true;
    }
    // o AppImage em execução sempre tem $APPIMAGE (o runtime define)
    std::env::var_os("APPIMAGE").is_some()
}

fn updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let mut builder = app.updater_builder();
    if let Some(url) = std::env::var("KAMI_ATUALIZACAO_URL").ok().filter(|u| !u.is_empty()) {
        let url = url.parse().map_err(|e| format!("KAMI_ATUALIZACAO_URL inválida: {}", e))?;
        builder = builder.endpoints(vec![url]).map_err(|e| e.to_string())?;
    }
    let app_saida = app.clone();
    builder
        // Windows: o plugin fecha o app com process::exit logo depois de
        // abrir o instalador — sem passar pelo RunEvent::Exit, que é quem
        // derruba o backend. Sem isto o kami-backend.exe ficaria aberto e o
        // instalador não conseguiria trocá-lo.
        .on_before_exit(move || crate::parar_backend(&app_saida))
        .build()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn atualizacao_procurar(app: AppHandle) -> Result<Option<Disponivel>, String> {
    let update = updater(&app)?
        .check()
        .await
        .map_err(|e| format!("não deu pra procurar atualizações: {}", e))?;
    let resposta = update.as_ref().map(|u| Disponivel {
        versao: u.version.clone(),
        atual: u.current_version.clone(),
        notas: u.body.clone(),
        data: u.date.map(|d| {
            let d = d.date();
            format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
        }),
        instalavel: pode_instalar_daqui(),
    });
    *app.state::<Pendente>().0.lock().unwrap() = update;
    Ok(resposta)
}

#[derive(Clone, Serialize)]
struct Progresso {
    baixado: usize,
    total: Option<u64>,
}

#[tauri::command]
pub async fn atualizacao_instalar(app: AppHandle) -> Result<(), String> {
    if !pode_instalar_daqui() {
        return Err("esta instalação é atualizada pelo gerenciador de pacotes do sistema".into());
    }
    let update = app
        .state::<Pendente>()
        .0
        .lock()
        .unwrap()
        .clone()
        .ok_or("nenhuma versão nova encontrada — procure de novo")?;
    let mut baixado = 0usize;
    let evento = app.clone();
    let bytes = update
        .download(
            move |pedaco, total| {
                baixado += pedaco;
                let _ = evento.emit("kami://atualizacao-progresso", Progresso { baixado, total });
            },
            || {},
        )
        .await
        .map_err(|e| match e {
            // o download confere a assinatura antes de devolver os bytes
            tauri_plugin_updater::Error::Minisign(_) | tauri_plugin_updater::Error::SignatureUtf8(_) => format!(
                "a assinatura da versão {} não confere com a do kami — nada foi instalado. baixe pela página de releases.",
                update.version
            ),
            e => format!("não deu pra baixar a versão {}: {}", update.version, e),
        })?;

    INSTALANDO.store(true, Ordering::SeqCst);
    // AppImage: o arquivo é trocado com o app aberto, mas o backend sai antes
    // (no Windows quem faz isso é o on_before_exit acima)
    if !cfg!(target_os = "windows") {
        crate::parar_backend(&app);
    }
    if let Err(e) = update.install(&bytes) {
        INSTALANDO.store(false, Ordering::SeqCst);
        // o backend caiu de propósito: sobe de novo pro app continuar usável
        crate::subir_backend_de_novo(&app);
        return Err(format!("não deu pra instalar a versão {}: {}", update.version, e));
    }
    app.restart();
}

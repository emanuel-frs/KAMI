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
//!   trocado e o app reinicia. `.rpm`: o kami roda `rpm -U --nosignature`
//!   pelo pkexec (o sistema pede a senha; ver `instalar_rpm`) e o app
//!   reinicia na versão nova.
//!
//! Dá pra instalar daqui no Windows (NSIS), no AppImage e no `.rpm` (o
//! latest.json tem a entrada `linux-x86_64-rpm`). `.deb` e AUR: o
//! gerenciador de pacotes é quem atualiza — a tela só avisa e aponta pra
//! página da versão.
//!
//! `KAMI_ATUALIZACAO_URL` troca o endereço do latest.json (testes do
//! DIST-01, com um servidor local). Não abre brecha: a assinatura continua
//! conferida com a chave embutida, e endereço sem https só é aceito num build
//! feito com `dangerousInsecureTransportProtocol` ligado — o publicado não.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::utils::{config::BundleType, platform::bundle_type};
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
    /// false: .deb/AUR — só o aviso
    instalavel: bool,
    /// "windows" | "appimage" | "rpm" | "outro" — o texto da tela muda
    pacote: &'static str,
}

fn pacote() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if std::env::var_os("APPIMAGE").is_some() {
        // o AppImage em execução sempre tem $APPIMAGE (o runtime define)
        "appimage"
    } else if bundle_type() == Some(BundleType::Rpm) {
        "rpm"
    } else {
        "outro"
    }
}

fn pode_instalar_daqui() -> bool {
    pacote() != "outro"
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
        .map_err(|e| match e {
            // o GitHub respondeu, mas sem um latest.json válido — é o caso
            // até sair a primeira versão com o aviso (a 1.14.0)
            tauri_plugin_updater::Error::ReleaseNotFound => {
                "o GitHub respondeu, mas a página de versões ainda não tem a lista de atualizações do kami. as versões publicadas estão em github.com/emanuel-frs/KAMI/releases.".to_string()
            }
            tauri_plugin_updater::Error::Reqwest(_) | tauri_plugin_updater::Error::Network(_) => {
                "sem conexão com o GitHub agora — confira a internet e tente de novo.".to_string()
            }
            e => format!("não deu pra procurar atualizações: {}", e),
        })?;
    let resposta = update.as_ref().map(|u| Disponivel {
        versao: u.version.clone(),
        atual: u.current_version.clone(),
        notas: u.body.clone(),
        data: u.date.map(|d| {
            let d = d.date();
            format!("{:04}-{:02}-{:02}", d.year(), u8::from(d.month()), d.day())
        }),
        instalavel: pode_instalar_daqui(),
        pacote: pacote(),
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
    // AppImage/.rpm: os arquivos são trocados com o app aberto, mas o backend sai antes
    // (no Windows quem faz isso é o on_before_exit acima)
    if !cfg!(target_os = "windows") {
        crate::parar_backend(&app);
    }
    #[cfg(target_os = "linux")]
    let instalado = if pacote() == "rpm" { linux::instalar_rpm(&bytes) } else { instalar_pelo_plugin(&update, &bytes) };
    #[cfg(not(target_os = "linux"))]
    let instalado = instalar_pelo_plugin(&update, &bytes);
    if let Err(e) = instalado {
        INSTALANDO.store(false, Ordering::SeqCst);
        // o backend caiu de propósito: sobe de novo pro app continuar usável
        // (numa porta nova — o frontend reconecta, ver atualizacao.js)
        crate::subir_backend_de_novo(&app);
        return Err(e);
    }
    app.restart();
}

fn instalar_pelo_plugin(update: &Update, bytes: &[u8]) -> Result<(), String> {
    update
        .install(bytes)
        .map_err(|e| format!("não deu pra instalar a versão {}: {}", update.version, e))
}

#[cfg(target_os = "linux")]
mod linux {
    /// `.rpm` (P-196): instalado aqui, e não pelo plugin. O plugin roda
    /// `pkexec rpm -U`, e o rpm 6 (Fedora 44 em diante) exige assinatura GPG por
    /// padrão (`%_pkgverify_level all`): o pacote da Release, sem GPG, era
    /// recusado com "Failed to install package" (visto na 1.18 → 2.0.0).
    ///
    /// `--nosignature` desliga só a conferência GPG do rpm. A autenticidade já
    /// foi conferida no download pela assinatura do kami (minisign, chave
    /// embutida no app), e os resumos (digests) do pacote o rpm continua
    /// conferindo. Sem os fallbacks do plugin (zenity/kdialog/sudo no terminal):
    /// janela de senha em inglês e um `sudo` sem terminal só confundiam.
    ///
    /// Erros voltam como `rpm:<motivo>[:detalhe]` — o frontend traduz
    /// (atualizacao.js › mensagemDeFalha).
    pub(super) fn instalar_rpm(bytes: &[u8]) -> Result<(), String> {
        // "\xED\xAB\xEE\xDB": o começo de todo .rpm (o plugin confere o mesmo)
        if !bytes.starts_with(&[0xED, 0xAB, 0xEE, 0xDB]) {
            return Err("rpm:failed:o arquivo baixado não é um .rpm".into());
        }
        let pasta = pasta_temporaria().map_err(|e| format!("rpm:failed:{}", e))?;
        let arquivo = pasta.join("kami.rpm");
        let resultado = std::fs::write(&arquivo, bytes)
            .map_err(|e| format!("rpm:failed:{}", e))
            .and_then(|_| rodar_rpm(&arquivo));
        let _ = std::fs::remove_dir_all(&pasta);
        resultado
    }

    /// Pasta só do usuário (0700) no /tmp: o root, pelo pkexec, lê dela.
    fn pasta_temporaria() -> std::io::Result<std::path::PathBuf> {
        use std::os::unix::fs::DirBuilderExt;
        let pasta = std::env::temp_dir().join(format!("kami-atualizacao-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&pasta);
        std::fs::DirBuilder::new().mode(0o700).create(&pasta)?;
        Ok(pasta)
    }

    /// O comando que instala (separado pro teste conferir os argumentos).
    fn comando_rpm(arquivo: &std::path::Path) -> std::process::Command {
        let mut cmd = std::process::Command::new("pkexec");
        cmd.args(["rpm", "-U", "--nosignature"]).arg(arquivo);
        cmd.stdin(std::process::Stdio::null());
        cmd
    }

    fn rodar_rpm(arquivo: &std::path::Path) -> Result<(), String> {
        let saida = comando_rpm(arquivo).output().map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "rpm:no-pkexec".to_string()
            } else {
                format!("rpm:failed:{}", e)
            }
        })?;
        match saida.status.code() {
            Some(0) => Ok(()),
            // pkexec: 126 = a pessoa fechou a janela da senha; 127 = sem
            // autorização (senha errada 3×, ou o polkit não deixa)
            Some(126) => Err("rpm:canceled".into()),
            Some(127) => Err("rpm:denied".into()),
            _ => Err(format!(
                "rpm:failed:{}",
                ultima_linha(&saida.stderr, &saida.stdout)
            )),
        }
    }

    /// A última linha com texto do que o rpm disse (é onde fica o motivo).
    fn ultima_linha(stderr: &[u8], stdout: &[u8]) -> String {
        let texto = String::from_utf8_lossy(if stderr.iter().any(|b| !b.is_ascii_whitespace()) {
            stderr
        } else {
            stdout
        });
        let linha = texto
            .lines()
            .rev()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("")
            .to_string();
        linha.chars().take(300).collect()
    }

    #[cfg(test)]
    mod testes {
        use super::*;

        #[test]
        fn rpm_usa_nosignature_e_nada_mais() {
            let cmd = comando_rpm(std::path::Path::new("/tmp/x/kami.rpm"));
            let args: Vec<_> = cmd
                .get_args()
                .map(|a| a.to_string_lossy().into_owned())
                .collect();
            assert_eq!(args, ["rpm", "-U", "--nosignature", "/tmp/x/kami.rpm"]);
        }

        #[test]
        fn arquivo_que_nao_e_rpm_e_recusado_antes_do_pkexec() {
            assert_eq!(
                instalar_rpm(b"<html>").unwrap_err(),
                "rpm:failed:o arquivo baixado não é um .rpm"
            );
        }

        #[test]
        fn ultima_linha_pega_o_motivo() {
            let err = b"aviso qualquer\n\tpackage kami-0:2.0.0-1.x86_64 does not verify: no signature\n\n";
            assert_eq!(
                ultima_linha(err, b""),
                "package kami-0:2.0.0-1.x86_64 does not verify: no signature"
            );
            assert_eq!(ultima_linha(b"  \n", b"so no stdout\n"), "so no stdout");
        }
    }
}

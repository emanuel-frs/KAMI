//! Ícone do app na cor de destaque (ICO-01) — opcional, desligado por
//! padrão (P-08); o frontend chama `aplicar_icone_tema` quando a opção
//! está ligada (na abertura e ao trocar a cor) e com `cor: None` ao
//! desligar.
//!
//! Os ícones de cada cor são gerados por scripts/gerar_icones_tema.py e
//! embutidos aqui (`include_bytes!`) — o comando só aceita os nomes da
//! lista, nunca um caminho vindo de fora.
//!
//! O que muda e quando:
//! - janela e barra de tarefas (Windows e Linux X11): `set_icon`, na hora;
//! - Windows, atalhos `Kami.lnk` do Menu Iniciar e da área de trabalho:
//!   ícone apontado pro `.ico` da cor (copiado pra pasta de dados) — muda
//!   quando o Explorer atualizar;
//! - Linux (lançador/dock, inclusive GNOME no Wayland, que ignora o
//!   `set_icon`): um `Kami.desktop` do usuário em
//!   `~/.local/share/applications/` (copiado do instalado pelo .deb/.rpm,
//!   com `Icon=` no png da cor) tem prioridade sobre o do sistema — muda ao
//!   reabrir o app. Marcado com `X-Kami-IconeTema` pra só remover o nosso.
//!   AppImage não instala .desktop no sistema: ali só a janela muda.
//!
//! Desligar volta o ícone padrão na janela, remove o .desktop do usuário e
//! aponta os atalhos de novo pro próprio executável.

use std::path::{Path, PathBuf};

use tauri::image::Image;
use tauri::Manager; // app_handle() da janela

macro_rules! icone {
    ($nome:literal) => {
        (
            $nome,
            include_bytes!(concat!("../icons/themes/", $nome, "/256x256.png")) as &[u8],
            include_bytes!(concat!("../icons/themes/", $nome, "/icon.ico")) as &[u8],
        )
    };
}

const ICONES: &[(&str, &[u8], &[u8])] = &[
    icone!("verde"),
    icone!("ambar"),
    icone!("azul"),
    icone!("vermelho"),
    icone!("cinza"),
    icone!("lilas"),
    icone!("dourado"),
    icone!("turquesa"),
    icone!("coral"),
];

#[cfg(target_os = "linux")]
const MARCA_DESKTOP: &str = "X-Kami-IconeTema";
#[cfg(target_os = "linux")]
const DESKTOP_DO_SISTEMA: &[&str] = &[
    "/usr/share/applications/Kami.desktop",
    "/usr/local/share/applications/Kami.desktop",
];

fn pasta_icones(dados: &Path) -> PathBuf {
    dados.join("icones")
}

/// Aplica (`Some(cor)`) ou desfaz (`None`) o ícone na cor de destaque.
/// Devolve onde mudou, pra tela explicar ("janela", "lançador"...).
#[tauri::command]
pub fn aplicar_icone_tema(window: tauri::WebviewWindow, cor: Option<String>) -> Result<Vec<String>, String> {
    let dados = crate::kami_data_dir();
    let mut onde = Vec::new();

    let Some(cor) = cor else {
        if let Some(padrao) = window.app_handle().default_window_icon() {
            window.set_icon(padrao.clone()).map_err(|e| e.to_string())?;
        }
        onde.push("janela".to_string());
        if restaurar_lancador()? {
            onde.push("lançador".to_string());
        }
        return Ok(onde);
    };

    let (nome, png, ico) = ICONES
        .iter()
        .find(|(n, _, _)| *n == cor.as_str())
        .ok_or_else(|| format!("cor de ícone desconhecida: {cor}"))?;

    let imagem = Image::from_bytes(png).map_err(|e| format!("ícone {nome} inválido: {e}"))?;
    window.set_icon(imagem).map_err(|e| e.to_string())?;
    onde.push("janela".to_string());

    let pasta = pasta_icones(&dados);
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    let png_path = pasta.join(format!("kami-{nome}.png"));
    let ico_path = pasta.join(format!("kami-{nome}.ico"));
    std::fs::write(&png_path, png).map_err(|e| e.to_string())?;
    std::fs::write(&ico_path, ico).map_err(|e| e.to_string())?;

    if aplicar_lancador(&png_path, &ico_path)? {
        onde.push("lançador".to_string());
    }
    Ok(onde)
}

// ── Linux: .desktop do usuário ──────────────────────────────────────────

#[cfg(target_os = "linux")]
fn desktop_do_usuario() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| dirs::home_dir().map(|h| h.join(".local/share")))?;
    Some(base.join("applications").join("Kami.desktop"))
}

#[cfg(target_os = "linux")]
fn aplicar_lancador(png: &Path, _ico: &Path) -> Result<bool, String> {
    let Some(sistema) = DESKTOP_DO_SISTEMA.iter().map(Path::new).find(|p| p.exists()) else {
        // AppImage ou modo dev: não há lançador instalado pra sobrepor. Se
        // sobrou um nosso de quando havia (a pessoa trocou o .deb pelo
        // AppImage), ele sai — apontaria pra um programa que não existe
        // mais (DIST-03)
        restaurar_lancador()?;
        return Ok(false);
    };
    let Some(destino) = desktop_do_usuario() else { return Ok(false) };
    let original = std::fs::read_to_string(sistema).map_err(|e| e.to_string())?;
    if let Some(pasta) = destino.parent() {
        std::fs::create_dir_all(pasta).map_err(|e| e.to_string())?;
    }
    std::fs::write(&destino, desktop_com_icone(&original, png)).map_err(|e| e.to_string())?;
    Ok(true)
}

/// O `.desktop` do sistema com o `Icon=` da cor e a nossa marca. DIST-03:
/// e com `TryExec=` (o programa do `Exec=`) — se o pacote for removido sem
/// o Kami abrir de novo, o menu ignora este arquivo sozinho em vez de
/// mostrar um Kami que não abre.
#[cfg(target_os = "linux")]
fn desktop_com_icone(original: &str, png: &Path) -> String {
    let tem_tryexec = original.lines().any(|l| l.starts_with("TryExec="));
    let mut linhas = Vec::new();
    for l in original.lines().filter(|l| !l.starts_with(MARCA_DESKTOP)) {
        if l.starts_with("Icon=") {
            linhas.push(format!("Icon={}", png.display()));
        } else {
            linhas.push(l.to_string());
        }
        if !tem_tryexec {
            if let Some(prog) = l.strip_prefix("Exec=").and_then(|e| e.split_whitespace().next()) {
                linhas.push(format!("TryExec={prog}"));
            }
        }
    }
    linhas.push(format!("{MARCA_DESKTOP}=true"));
    linhas.join("\n") + "\n"
}

#[cfg(target_os = "linux")]
pub(crate) fn restaurar_lancador() -> Result<bool, String> {
    let Some(destino) = desktop_do_usuario() else { return Ok(false) };
    match std::fs::read_to_string(&destino) {
        // só apaga o que é nosso — um Kami.desktop que a pessoa escreveu fica
        Ok(texto) if texto.lines().any(|l| l.starts_with(MARCA_DESKTOP)) => {
            std::fs::remove_file(&destino).map_err(|e| e.to_string())?;
            Ok(true)
        }
        _ => Ok(false),
    }
}

// ── Windows: atalhos Kami.lnk ───────────────────────────────────────────

/// Aponta o ícone dos atalhos `Kami.lnk` (Menu Iniciar do usuário e área de
/// trabalho) pra `icone`, ou pro próprio executável se `icone` for None.
/// PowerShell + WScript.Shell, sem janela; o caminho vai por variável de
/// ambiente, nunca colado no script.
#[cfg(target_os = "windows")]
fn atalhos(icone: Option<&Path>) -> Result<bool, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SCRIPT: &str = r#"
$ws = New-Object -ComObject WScript.Shell
$lugares = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath("Desktop"))
$n = 0
foreach ($l in $lugares) {
  if (-not (Test-Path $l)) { continue }
  Get-ChildItem -Path $l -Filter "Kami.lnk" -Recurse -Depth 2 -ErrorAction SilentlyContinue | ForEach-Object {
    $s = $ws.CreateShortcut($_.FullName)
    if ($env:KAMI_ICONE) { $s.IconLocation = "$env:KAMI_ICONE,0" } else { $s.IconLocation = "$($s.TargetPath),0" }
    $s.Save(); $n++
  }
}
Write-Output $n
"#;
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .creation_flags(CREATE_NO_WINDOW);
    match icone {
        Some(p) => cmd.env("KAMI_ICONE", p),
        None => cmd.env_remove("KAMI_ICONE"),
    };
    let out = cmd.output().map_err(|e| format!("não foi possível atualizar os atalhos: {e}"))?;
    let alterados: u32 = String::from_utf8_lossy(&out.stdout).trim().parse().unwrap_or(0);
    Ok(alterados > 0)
}

#[cfg(target_os = "windows")]
fn aplicar_lancador(_png: &Path, ico: &Path) -> Result<bool, String> {
    atalhos(Some(ico))
}

#[cfg(target_os = "windows")]
pub(crate) fn restaurar_lancador() -> Result<bool, String> {
    atalhos(None)
}

// ── outros sistemas: só a janela ────────────────────────────────────────

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn aplicar_lancador(_png: &Path, _ico: &Path) -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
pub(crate) fn restaurar_lancador() -> Result<bool, String> {
    Ok(false)
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn todas_as_cores_tem_icone_valido() {
        for (nome, png, ico) in ICONES {
            assert!(Image::from_bytes(png).is_ok(), "png de {nome}");
            assert_eq!(&ico[..4], &[0, 0, 1, 0], "ico de {nome}"); // cabeçalho de .ico
        }
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn lancador_com_icone_ganha_tryexec_e_marca() {
        let original = "[Desktop Entry]\nExec=kami %U\nIcon=kami\nName=Kami\n";
        let novo = desktop_com_icone(original, Path::new("/d/icones/kami-coral.png"));
        assert_eq!(
            novo,
            "[Desktop Entry]\nExec=kami %U\nTryExec=kami\nIcon=/d/icones/kami-coral.png\nName=Kami\nX-Kami-IconeTema=true\n"
        );
        // reaplicar não duplica nada
        assert_eq!(desktop_com_icone(&novo, Path::new("/d/icones/kami-coral.png")), novo);
    }
}

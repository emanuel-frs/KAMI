//! Ícone do app na cor de destaque (ICO-01) — opcional, desligado por
//! padrão (P-08); o frontend chama `aplicar_icone_tema` quando a opção
//! está ligada (na abertura e ao trocar a cor) e com `cor: None` ao
//! desligar.
//!
//! 2.1.0: o ícone é GERADO na hora, nas duas cores do avatar (o "K" no
//! preenchimento, o quadrado no contorno — aparência › cores), a partir do
//! ícone verde embutido: ele só tem preto e o verde #8fbf8f (com o
//! antisserrilhado entre os dois), então o canal verde diz "quanto de K"
//! tem cada pixel. Antes eram 9 ícones prontos, um por cor — não cabia a
//! cor livre. O comando só aceita `#rrggbb`, nunca um caminho vindo de fora.
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

/// O ícone base (o "K" verde no quadrado preto), de onde saem todas as cores.
const ICONE_BASE: &[u8] = include_bytes!("../icons/tema-base.png");
/// O verde do "K" no ícone base (canal G de #8fbf8f / #90c090).
const VERDE_BASE: f32 = 192.0;

fn ler_hex(cor: &str) -> Result<[u8; 3], String> {
    let h = cor.strip_prefix('#').filter(|h| h.len() == 6 && h.chars().all(|c| c.is_ascii_hexdigit()));
    let h = h.ok_or_else(|| format!("cor inválida: {cor}"))?;
    let canal = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).map_err(|e| e.to_string());
    Ok([canal(0)?, canal(2)?, canal(4)?])
}

/// RGBA do ícone base com o "K" em `preenchimento` e o fundo em `contorno`.
fn recolorir(preenchimento: [u8; 3], contorno: [u8; 3]) -> Result<(Vec<u8>, u32, u32), String> {
    let base = Image::from_bytes(ICONE_BASE).map_err(|e| format!("ícone base inválido: {e}"))?;
    let mut rgba = base.rgba().to_vec();
    for px in rgba.chunks_exact_mut(4) {
        let t = (f32::from(px[1]) / VERDE_BASE).clamp(0.0, 1.0);
        for i in 0..3 {
            let (a, b) = (f32::from(contorno[i]), f32::from(preenchimento[i]));
            px[i] = (a + (b - a) * t).round() as u8;
        }
    }
    Ok((rgba, base.width(), base.height()))
}

fn png_de(rgba: &[u8], largura: u32, altura: u32) -> Result<Vec<u8>, String> {
    let mut saida = Vec::new();
    let mut enc = png::Encoder::new(&mut saida, largura, altura);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    let mut escritor = enc.write_header().map_err(|e| e.to_string())?;
    escritor.write_image_data(rgba).map_err(|e| e.to_string())?;
    escritor.finish().map_err(|e| e.to_string())?;
    Ok(saida)
}

/// `.ico` com uma imagem só, em PNG (formato aceito desde o Windows Vista):
/// cabeçalho de 6 bytes + 1 entrada de 16 + o PNG.
fn ico_de(png: &[u8]) -> Vec<u8> {
    let mut ico = vec![0, 0, 1, 0, 1, 0];
    ico.extend_from_slice(&[0, 0, 0, 0]); // 256×256 (0 = 256), sem paleta, reservado
    ico.extend_from_slice(&1u16.to_le_bytes()); // planos
    ico.extend_from_slice(&32u16.to_le_bytes()); // bits por pixel
    ico.extend_from_slice(&(png.len() as u32).to_le_bytes());
    ico.extend_from_slice(&22u32.to_le_bytes()); // onde o PNG começa
    ico.extend_from_slice(png);
    ico
}

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

/// Aplica (`Some(preenchimento)`) ou desfaz (`None`) o ícone nas cores do
/// avatar; `contorno` ausente = preto. Devolve onde mudou, pra tela
/// explicar ("janela", "lançador"...).
#[tauri::command]
pub fn aplicar_icone_tema(
    window: tauri::WebviewWindow,
    preenchimento: Option<String>,
    contorno: Option<String>,
) -> Result<Vec<String>, String> {
    let dados = crate::kami_data_dir();
    let mut onde = Vec::new();
    let Some(preenchimento) = preenchimento else {
        if let Some(padrao) = window.app_handle().default_window_icon() {
            window.set_icon(padrao.clone()).map_err(|e| e.to_string())?;
        }
        onde.push("janela".to_string());
        if restaurar_lancador()? {
            onde.push("lançador".to_string());
        }
        return Ok(onde);
    };
    let k = ler_hex(&preenchimento)?;
    let fundo = ler_hex(contorno.as_deref().unwrap_or("#000000"))?;
    let (rgba, largura, altura) = recolorir(k, fundo)?;
    let png = png_de(&rgba, largura, altura)?;
    window
        .set_icon(Image::new_owned(rgba, largura, altura))
        .map_err(|e| e.to_string())?;
    onde.push("janela".to_string());
    let pasta = pasta_icones(&dados);
    std::fs::create_dir_all(&pasta).map_err(|e| e.to_string())?;
    // um par de arquivos por combinação de cores (o nome muda junto: o
    // lançador e o Explorer guardam ícone em cache pelo caminho); os de
    // antes saem
    let nome = format!("kami-{}-{}", hex_sem_cerquilha(k), hex_sem_cerquilha(fundo));
    if let Ok(itens) = std::fs::read_dir(&pasta) {
        for item in itens.flatten() {
            let n = item.file_name().to_string_lossy().to_string();
            if n.starts_with("kami-") && !n.starts_with(&nome) && (n.ends_with(".png") || n.ends_with(".ico")) {
                let _ = std::fs::remove_file(item.path());
            }
        }
    }
    let png_path = pasta.join(format!("{nome}.png"));
    let ico_path = pasta.join(format!("{nome}.ico"));
    std::fs::write(&png_path, &png).map_err(|e| e.to_string())?;
    std::fs::write(&ico_path, ico_de(&png)).map_err(|e| e.to_string())?;
    if aplicar_lancador(&png_path, &ico_path)? {
        onde.push("lançador".to_string());
    }
    Ok(onde)
}

fn hex_sem_cerquilha(c: [u8; 3]) -> String {
    format!("{:02x}{:02x}{:02x}", c[0], c[1], c[2])
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
    fn icone_recolorido_nas_duas_cores() {
        let (rgba, l, a) = recolorir([0xff, 0x8a, 0x3d], [0x2a, 0x16, 0x40]).unwrap();
        assert_eq!((l, a), (256, 256));
        let px: Vec<&[u8]> = rgba.chunks_exact(4).filter(|p| p[3] == 255).collect();
        // só as duas cores (e o antisserrilhado entre elas) — nada do verde
        assert!(px.iter().any(|p| p[..3] == [0xff, 0x8a, 0x3d]));
        assert!(px.iter().any(|p| p[..3] == [0x2a, 0x16, 0x40]));
        assert!(!px.iter().any(|p| p[..3] == [0x90, 0xc0, 0x90]));
        let png = png_de(&rgba, l, a).unwrap();
        assert!(Image::from_bytes(&png).is_ok());
        let ico = ico_de(&png);
        assert_eq!(&ico[..4], &[0, 0, 1, 0]); // cabeçalho de .ico
        assert_eq!(&ico[22..26], &[0x89, b'P', b'N', b'G']);
    }

    #[test]
    fn cor_fora_do_formato_e_recusada() {
        assert_eq!(ler_hex("#C9A0DC").unwrap(), [0xc9, 0xa0, 0xdc]);
        for ruim in ["c9a0dc", "#c9a0d", "#c9a0dcz", "../x", "#gggggg", ""] {
            assert!(ler_hex(ruim).is_err(), "{ruim}");
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

# Roadmap de instalação e distribuição

Itens registrados para uma fase futura. Nada nesta lista foi
implementado nesta rodada.

- **Assinatura de código no Windows:** decisão pendente do dono do
  projeto. A SignPath Foundation oferece assinatura gratuita quando o
  projeto atende aos requisitos de repositório público e licença OSI;
  certificados comerciais são uma alternativa paga. Azure Artifact
  Signing aceita pessoa física somente nos EUA/Canadá. Ao implementar,
  configurar `signCommand` para assinar o executável do Tauri e assinar
  também o sidecar `kami-backend.exe`.
- **PyInstaller onefile → onedir:** pode reduzir falsos positivos de
  antivírus e acelerar a inicialização, mas o `externalBin` do Tauri
  espera um único executável; será necessário definir como empacotar a
  pasta de arquivos do backend.
- **Atualização automática:** avaliar o updater do Tauri, incluindo
  criação e guarda de chaves próprias antes de habilitá-lo.
- **macOS:** fora do escopo desta rodada; requer builds, testes e
  distribuição específicos.
- **Publicação Linux:** avaliar publicação no AUR, em um repositório
  apt e no COPR. O `PKGBUILD` atual fica apenas no repositório e não é
  publicado no AUR.

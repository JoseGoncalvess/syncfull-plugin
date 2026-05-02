# SyncFull - Plugin de Sincronização Completa para Obsidian

O SyncFull é um plugin de sincronização local completa para Obsidian, projetado para sincronizar todos os tipos de arquivos (texto e binários) entre seu vault e uma pasta de destino local ou em rede.

## Funcionalidades Principais

### Sincronização Multi-tipo
- **Arquivos de Texto**: Markdown, JSON, TXT, etc.
- **Arquivos Binários**: Imagens, PDFs, áudio, vídeo, documentos Office
- **Detecção Automática**: Identifica o tipo de arquivo pelo formato e trata cada um adequadamente

### Monitorização em Tempo Real
- **Debounce Inteligente**: Aguarda 2.5 segundos para evitar múltiplas sincronizações durante edições rápidas
- **Eventos do Vault**: Detecta criação, modificação e exclusão de arquivos automaticamente
- **Fila de Processamento**: Organiza múltiplas alterações para processamento eficiente

### Gestão de Caminhos
- **Path Mapping**: Configuração flexível do diretório de destino
- **Validação Automática**: Verifica permissões e existência do caminho
- **Criação de Diretórios**: Cria estrutura de pastas automaticamente se necessário

### Interface Intuitiva
- **Status Bar**: Indicadores visuais em tempo real ( Conectado,  Sincronizando, Erro)
- **Comandos Rápidos**: Forçar sincronização completa e validar destino
- **Configurações Simples**: Interface limpa para configuração do caminho de destino

## Requisitos

- **Obsidian**: Versão 0.15.0 ou superior
- **Plataforma**: Apenas desktop (requer acesso ao sistema de arquivos)
- **Sistema**: Windows, macOS ou Linux

## Instalação

### Instalação Manual
1. Baixe os arquivos `main.js`, `manifest.json` e `styles.css` da última release
2. Crie a pasta `.obsidian/plugins/syncfull-plugin/` no seu vault
3. Copie os arquivos para esta pasta
4. Ative o plugin nas configurações do Obsidian

### Desenvolvimento
```bash
# Clone o repositório
git clone https://github.com/SEU-USER/syncfull-plugin.git
cd syncfull-plugin

# Instale as dependências
npm install

# Inicie o desenvolvimento (modo watch)
npm run dev

# Build para produção
npm run build
```

## Configuração

1. Após instalar o plugin, vá em **Configurações > Comunidade Plugins > SyncFull**
2. Configure o **Caminho de Destino** para a pasta onde deseja sincronizar:
   - **Windows**: `C:\Backup\Obsidian` ou `\\NAS\Backup`
   - **macOS**: `/Volumes/Backup/Obsidian`
   - **Linux**: `/home/user/backup/obsidian`

3. Use os comandos:
   - **Ctrl/Cmd + P > "Forçar Sincronização"**: Sincroniza todos os arquivos
   - **Ctrl/Cmd + P > "Validar Destino"**: Verifica se o caminho está acessível

## Como Funciona

### Fluxo de Sincronização
1. **Detecção**: Eventos do vault acionam o monitoramento
2. **Debounce**: Aguarda 2.5 segundos para agrupar alterações
3. **Classificação**: Identifica arquivos binários vs texto
4. **Leitura**: Usa método apropriado (`read()` ou `readBinary()`)
5. **Escrita**: Salva no formato correto (UTF-8 ou ArrayBuffer)
6. **Feedback**: Atualiza status bar e notificações

### Tipos de Arquivos Suportados
- **Imagens**: .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg, .ico
- **Áudio**: .mp3, .wav, .ogg, .flac, .aac
- **Vídeo**: .mp4, .avi, .mov, .wmv, .flv, .mkv
- **Documentos**: .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx
- **Compactados**: .zip, .rar, .7z, .tar, .gz
- **Executáveis**: .exe, .dll, .so, .dylib, .bin, .dat, .db, .sqlite

## Solução de Problemas

### Erros Comuns
- **"Caminho não encontrado"**: Verifique se o diretório de destino existe e está acessível
- **"Sem permissões de escrita"**: Certifique-se de ter permissões no diretório de destino
- **"Sistema de ficheiros não inicializado"**: Configure o caminho de destino nas configurações

### Logs de Depuração
O plugin logs detalhados no console do desenvolvedor do Obsidian (Ctrl/Cmd + Shift + I):
- `[SyncFull]` - Logs de operações normais
- `[SyncFull] Erro` - Logs de erros para depuração

## Contribuição

Contribuições são bem-vindas! Por favor:

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. Commit suas mudanças (`git commit -am 'Adiciona nova funcionalidade'`)
4. Push para a branch (`git push origin feature/nova-funcionalidade`)
5. Abra um Pull Request

## Licença

Este projeto está licenciado sob a Licença MIT - veja o arquivo [LICENSE](LICENSE) para detalhes.

## Links

- [Documentação Técnica](doc/Guia-Implementacao-SyncFull.md)
- [Issues e Sugestões](https://github.com/SEU-USER/syncfull-plugin/issues)
- [Releases](https://github.com/SEU-USER/syncfull-plugin/releases)

---

**SyncFull** - Sincronização completa, simples e confiável para seu Obsidian.

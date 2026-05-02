# Especificação Técnica: SyncFull (Obsidian Plugin)

Este documento serve como guia de implementação para o plugin de sincronização local completa para Obsidian, focado em ambientes de rede local (LAN) ou armazenamento externo.

## 1. Visão Geral (Abordagem SyncFull)
O plugin atua como o motor principal de sincronização. Ele monitoriza alterações no Vault ativo e as replica para um "Ponto de Montagem" (pasta local ou rede) sem a necessidade de uma aplicação intermédia.

## 2. Funcionalidades Principais

### A. Monitorização de Ficheiros (File Watcher)
- **Implementação:** Utilizar `this.app.vault.on('modify', ...)` e `on('create', ...)`.
- **Lógica:** Sempre que um ficheiro é alterado, ele é adicionado a uma fila de sincronização (Buffer) com um atraso de 2.5 segundos para evitar múltiplas escritas durante a digitação.
- **Suporte Multi-tipo:** Detecção automática de arquivos binários vs texto para tratamento diferenciado.

### B. Mapeamento de Caminhos (Path Mapping)
- **Configuração:** Interface nas definições do plugin para selecionar a pasta de destino.
- **Validação:** Verificação de permissões de escrita e existência do caminho através do módulo `fs` do Node.js.

### C. Gestor de Integridade (Hashing)
- **Algoritmo:** SHA-256.
- **Ficheiro de Estado:** Criação de um ficheiro `sync-metadata.json` oculto no destino para armazenar hashes e timestamps da última sincronização bem-sucedida.

### D. Resolução de Conflitos
- **Estratégia:** "Last Write Wins" (LWW) por defeito, com opção de criar cópias de conflito.
- **Deteção:** Se o ficheiro no destino foi alterado após o último `sync-metadata.json`, o plugin gera um aviso ou cria o ficheiro `Nota (Conflito).md`.

### E. Status Bar e Feedback UI
- **Visual:** Ícone na barra inferior do Obsidian indicando:
    - 🟢 Conectado e Sincronizado
    - 🟡 Sincronização em curso...
    - 🔴 Erro de Acesso (Caminho não encontrado)

### F. Suporte Multi-tipo de Arquivos
- **Detecção Automática:** Identificação de arquivos binários por extensão (.jpg, .png, .pdf, .json, etc.)
- **Tratamento Diferenciado:**
  - **Arquivos de Texto:** Lidos com `app.vault.read()` e escritos como UTF-8
  - **Arquivos Binários:** Lidos com `app.vault.readBinary()` e escritos como `ArrayBuffer/Uint8Array`
- **Extensões Suportadas:**
  - **Imagens:** .jpg, .jpeg, .png, .gif, .bmp, .webp, .svg, .ico
  - **Áudio:** .mp3, .wav, .ogg, .flac, .aac
  - **Vídeo:** .mp4, .avi, .mov, .wmv, .flv, .mkv
  - **Documentos:** .pdf, .doc, .docx, .xls, .xlsx, .ppt, .pptx
  - **Compactados:** .zip, .rar, .7z, .tar, .gz
  - **Executáveis/Binários:** .exe, .dll, .so, .dylib, .bin, .dat, .db, .sqlite

## 3. Arquitetura de Dados
O plugin deve operar de forma atômica. Durante a escrita no destino, deve criar um ficheiro temporário `.tmp` e renomeá-lo apenas após o sucesso da transferência para evitar corrupção de dados em caso de queda de rede.

## 4. Implementação Técnica

### 4.1. FileSystemModule (fsModule.ts)
```typescript
class FileSystemModule {
    async copyFile(sourceFile: TFile, sourceContent: string | ArrayBuffer): Promise<void>
    private isBinaryFile(filePath: string): boolean
    async validateDestination(): Promise<{ valid: boolean; error?: string }>
}
```

### 4.2. SyncFullPlugin (main.ts)
```typescript
class SyncFullPlugin extends Plugin {
    private syncQueue: FileChangeEvent[]
    private handleFileChange(file: TFile, type: 'modify' | 'create' | 'delete'): void
    private async syncFile(change: FileChangeEvent): Promise<void>
    private isBinaryFile(filePath: string): boolean
    async forceSync(): Promise<void>
}
```

### 4.3. Fluxo de Sincronização
1. **Detecção:** Evento do vault aciona `handleFileChange()`
2. **Debounce:** Agrega múltiplas alterações em 2.5 segundos
3. **Processamento:** `syncFile()` detecta tipo e lê conteúdo apropriado
4. **Escrita:** `fsModule.copyFile()` escreve no formato correto
5. **Feedback:** Atualiza status bar e notificações

## 5. Requisitos Tecnológicos
- **Runtime:** Electron/Node.js (acesso a `fs` e `path`).
- **Linguagem:** TypeScript.
- **Build Tool:** Esbuild.

---
*Este documento é a base para a evolução do ecossistema de sincronização local, aproveitando a lógica de projetos anteriores de automação de ficheiros.*

# Plano de Implementação Detalhado - SyncFull

## 📋 Visão Geral

Plugin de sincronização local completa para Obsidian que serve como motor principal para sincronizar o vault ativo com uma pasta local ou unidade de rede, utilizando módulos nativos do Node.js (fs, path, crypto) disponíveis no ambiente Electron.

---

## 🟢 FASE 1 - CORE FUNCIONALIDADES (Prioridade Alta)

### ✅ Passo 1: Definições (Settings Tab) - CONCLUÍDO
**Status:** ✅ **Concluído**

**Implementação:**
- ✅ Interface `MyPluginSettings` com campo `destinationPath: string`
- ✅ `DEFAULT_SETTINGS` com caminho vazio por padrão
- ✅ `SampleSettingTab` com UI configurada
- ✅ Campo "Caminho de Destino" com descrição detalhada
- ✅ Salvamento automático das configurações
- ✅ Classe renomeada para `SyncMaestroPlugin`

**Arquivos modificados:**
- `src/settings.ts` - Interface e UI de configurações
- `src/main.ts` - Renomeação da classe principal

---

### ✅ Passo 2: Monitorização do Vault (Watcher) - CONCLUÍDO
**Status:** ✅ **Concluído**

**Objetivo:** Implementar eventos de monitorização com debounce para evitar múltiplos disparos.

**Implementação realizada:**
- ✅ Sistema de debounce (2.5 segundos de inatividade)
- ✅ Fila de sincronização (sync queue)
- ✅ Método `handleFileChange()`
- ✅ Timer para debounce
- ✅ Filtragem de ficheiros (apenas não ocultos)
- ✅ Eventos para modify, create, delete
- ✅ Integração completa com FileSystemModule

**Dependências:** Nenhuma (API Obsidian nativa)

**Arquivos modificados:**
- ✅ `src/main.ts` - Eventos de monitorização e debounce
- ✅ Integração com sistema de sincronização

---

### ✅ Passo 3: Módulo de Sistema de Ficheiros (FS Module)
**Status:** ✅ **Concluído**

**Objetivo:** Criar classe dedicada à comunicação com a pasta de destino usando Node.js fs.promises.

**Implementação realizada:**
```typescript
// Arquivo criado: src/fsModule.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { TFile } from 'obsidian';

export class FileSystemModule {
    constructor(private destinationPath: string) {}
    
    async validateDestination(): Promise<{ valid: boolean; error?: string }>
    async copyFile(sourceFile: TFile, sourceContent: string): Promise<void>
    async deleteFile(relativePath: string): Promise<void>
    async fileExists(relativePath: string): Promise<boolean>
    async createDirectory(dirPath: string): Promise<void>
    async readFile(relativePath: string): Promise<string>
    async listMarkdownFiles(): Promise<string[]>
    async getFileStats(relativePath: string): Promise<{ size: number; mtime: number } | null>
}
```

**Componentes implementados:**
- ✅ **Classe `FileSystemModule`** completa
- ✅ **Validação de permissões de escrita** com testes específicos
- ✅ **Verificação de existência do caminho** com tratamento ENOENT/EACCES
- ✅ **Cópia de ficheiros com tratamento de erros** robusto
- ✅ **Criação de diretórios recursiva** com `mkdir({ recursive: true })`
- ✅ **Integração completa com main.ts**

**Funcionalidades adicionais implementadas:**
- ✅ **Listagem de ficheiros Markdown** recursiva
- ✅ **Obtenção de estatísticas** (size, mtime)
- ✅ **Leitura de conteúdo** de ficheiros no destino
- ✅ **Tratamento específico** de erros de sistema

**Dependências:** Node.js fs, path (crypto não necessário nesta fase)

**Arquivos modificados/criados:**
- ✅ `src/fsModule.ts` - Novo arquivo com classe completa
- ✅ `src/main.ts` - Integração com inicialização e validação

---

### ✅ Passo 4: Sincronização Inicial
**Status:** ✅ **Concluído**

**Objetivo:** Criar comando "Forçar Sincronização" na Command Palette.

**Implementação realizada:**
```typescript
// Comandos adicionados no método onload() do main.ts
this.addCommand({
    id: 'force-sync',
    name: 'Forçar Sincronização',
    callback: async () => {
        await this.forceSync();
    }
});

this.addCommand({
    id: 'validate-destination',
    name: 'Validar Destino de Sincronização',
    callback: async () => {
        await this.validateDestination();
    }
});
```

**Componentes implementados:**
- ✅ **Comando "Forçar Sincronização"** na Command Palette
- ✅ **Comando "Validar Destino"** na Command Palette
- ✅ **Método `forceSync()`** completo com validação
- ✅ **Leitura de todos os ficheiros Markdown** do vault
- ✅ **Cópia para pasta de destino** usando FileSystemModule
- ✅ **Feedback progressivo** ao utilizador (Notices)
- ✅ **Tratamento robusto de erros** individual por ficheiro
- ✅ **Estatísticas detalhadas** (sucessos vs erros)

**Funcionalidades adicionais implementadas:**
- ✅ **Validação prévia** do destino antes de sincronizar
- ✅ **Progresso visual** a cada 10 ficheiros processados
- ✅ **Relatório final** com contagem detalhada
- ✅ **Status bar atualizada** durante todo o processo
- ✅ **Captura individual** de erros sem interromper processo

**Dependências:** Passo 3 (FS Module) ✅

**Arquivos modificados:**
- ✅ `src/main.ts` - Adicionados comandos e métodos forceSync()/validateDestination()

---

## 🎉 MVP FUNCIONAL COMPLETO

Com os 4 primeiros passos concluídos, o Sync Maestro oferece:

### **✅ Funcionalidades Operacionais:**
- **Configuração** de caminho de destino via Settings Tab
- **Monitorização** em tempo real com debounce (2.5s)
- **Sistema de ficheiros** robusto com validação
- **Sincronização manual** completa via Command Palette
- **Feedback visual** contínuo na status bar

### **🚀 Comandos Disponíveis:**
- `Forçar Sincronização` - Sincronização completa do vault
- `Validar Destino` - Verificação manual do caminho

### **📊 Pronto para Testes:**
O sistema está pronto para testes funcionais completos antes de avançar para os passos de robustez (5-8).

---

## 🟡 FASE 2 - INTEGRIDADE E CONFIABILIDADE (Prioridade Média)

### ✅ Passo 5: Sistema de Hashing (SHA-256) - CONCLUÍDO
**Status:** ✅ **Concluído**

**Objetivo:** Implementar verificação de integridade de ficheiros usando SHA-256.

**Implementação realizada:**
```typescript
// No FS Module
async calculateFileHash(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
}

// Estrutura de metadata
interface SyncMetadata {
    [filePath: string]: {
        hash: string;
        lastSync: number;
        size: number;
    };
}
```

**Componentes implementados:**
- ✅ Sistema de hashing SHA-256 para arquivos de texto e binários
- ✅ Ficheiro `sync-metadata.json` no destino
- ✅ Comparação de hashes para deteção de alterações
- ✅ Cache de hashes para performance
- ✅ Validação de integridade pós-cópia
- ✅ Métodos loadSyncMetadata() e saveSyncMetadata()
- ✅ Verificação de modificações com isFileModified()
- ✅ Atualização automática de metadata
- ✅ Remoção de metadata ao deletar arquivos

**Dependências:** Passo 3 (FS Module)

---

### ⏳ Passo 6: Resolução de Conflitos
**Status:** ⏳ **Pendente**

**Objetivo:** Implementar estratégia "Last Write Wins" com opção de cópias de conflito.

**Implementação necessária:**
```typescript
interface ConflictResolution {
    strategy: 'last-writes-wins' | 'create-copy' | 'skip';
    createConflictCopies: boolean;
}

async handleConflict(sourceFile: TFile, destPath: string): Promise<void> {
    // Verificar se ficheiro destino foi alterado após último sync
    // Aplicar estratégia de resolução
    // Criar cópia de conflito se necessário
}
```

**Componentes a implementar:**
- [ ] Deteção de conflitos (timestamps + hashes)
- [ ] Estratégia "Last Write Wins" por defeito
- [ ] Geração de ficheiros de conflito: `Nota (Conflito).md`
- [ ] Configuração de estratégia nas definições
- [ ] Log de conflitos resolvidos

**Dependências:** Passo 5 (Hashing)

---

### ⏳ Passo 7: Status Bar e Feedback UI
**Status:** ⏳ **Pendente**

**Objetivo:** Implementar feedback visual na barra inferior do Obsidian.

**Implementação necessária:**
```typescript
// Estados possíveis:
// 🟢 Conectado e Sincronizado
// 🟡 Sincronização em curso...
// 🔴 Erro de Acesso (Caminho não encontrado)
// ⚠️ Conflitos detetados

private updateStatusBar(status: 'connected' | 'syncing' | 'error' | 'conflict'): void {
    const statusIcons = {
        connected: '🟢',
        syncing: '🟡',
        error: '🔴',
        conflict: '⚠️'
    };
    
    this.statusBarItemEl.setText(`${statusIcons[status]} Sync Maestro`);
}
```

**Componentes a implementar:**
- [ ] Status bar item no bottom bar
- [ ] Estados visuais com ícones
- [ ] Atualização automática de estado
- [ ] Tooltip com informações detalhadas
- [ ] Notificações para eventos importantes

**Dependências:** Passo 2 (Watcher)

---

## 🔵 FASE 3 - ROBUSTEZ E PERFORMANCE (Prioridade Baixa)

### ⏳ Passo 8: Escrita Atômica
**Status:** ⏳ **Pendente**

**Objetivo:** Implementar sistema de ficheiros temporários para evitar corrupção.

**Implementação necessária:**
```typescript
async atomicCopy(sourcePath: string, destPath: string): Promise<void> {
    const tempPath = `${destPath}.tmp.${Date.now()}`;
    
    try {
        await fs.copyFile(sourcePath, tempPath);
        await fs.rename(tempPath, destPath);
    } catch (error) {
        // Limpar ficheiro temporário em caso de erro
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}
```

**Componentes a implementar:**
- [ ] Sistema de ficheiros temporários `.tmp`
- [ ] Operação atômica (copy + rename)
- [ ] Limpeza automática de temporários
- [ ] Verificação de integridade pós-cópia
- [ ] Rollback em caso de falha

**Dependências:** Passo 3 (FS Module)

---

## 📁 Estrutura de Arquivos Final

```
src/
├── main.ts                 # Plugin principal com eventos e comandos
├── settings.ts            # Interface de configurações
├── fsModule.ts            # Módulo de sistema de ficheiros
├── syncManager.ts         # Gestor de sincronização
├── conflictResolver.ts    # Resolução de conflitos
└── types.ts              # Tipos e interfaces TypeScript

doc/
├── Guia-Implementacao-Sync-Maestro.md
└── Plano-Implementacao-Sync-Maestro.md
```

---

## 🔧 Configurações Adicionais

### package.json (dependências)
```json
{
  "dependencies": {
    "obsidian": "latest"
  },
  "devDependencies": {
    "@types/node": "latest",
    "typescript": "latest"
  }
}
```

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020", "DOM"],
    "types": ["node"]
  }
}
```

---

## 🚀 Ordem de Implementação Sugerida

1. **Passo 2** - Monitorização (fundamental para tudo)
2. **Passo 3** - FS Module (base para operações)
3. **Passo 4** - Sincronização Inicial (primeira funcionalidade útil)
4. **Passo 5** - Hashing (integridade)
5. **Passo 7** - Status Bar (feedback visual)
6. **Passo 6** - Resolução de Conflitos (robustez)
7. **Passo 8** - Escrita Atômica (segurança final)

---

## 📊 Critérios de Sucesso

### Mínimo Viável (MVP)
- ✅ Passos 1-4 completos
- Sincronização básica funcional
- Interface de configurações operacional

### Versão Completa
- Todos os 8 passos implementados
- Sistema robusto com tratamento de erros
- Feedback visual completo
- Resolução de conflitos funcional

---

## 🔄 Checklist de Testes

### Testes Unitários
- [ ] Validação de caminhos de destino
- [ ] Cálculo de hashes SHA-256
- [ ] Operações de cópia/eliminação
- [ ] Detecção de conflitos

### Testes de Integração
- [ ] Sincronização completa do vault
- [ ] Monitorização em tempo real
- [ ] Recuperação de erros
- [ ] Performance com grandes volumes

### Testes de UI
- [ ] Interface de configurações
- [ ] Comandos na Command Palette
- [ ] Status bar funcional
- [ ] Notificações informativas

---

*Este documento serve como guia principal para o desenvolvimento do Sync Maestro, garantindo que todas as funcionalidades sejam implementadas de forma estruturada e testada.*

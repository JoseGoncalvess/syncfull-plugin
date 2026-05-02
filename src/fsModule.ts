import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { TFile } from 'obsidian';

/**
 * Interface para metadata de sincronização
 */
export interface SyncMetadata {
    [filePath: string]: {
        hash: string;
        lastSync: number;
        size: number;
        modifiedTime: number;
    };
}

/**
 * Interface para detecção de conflitos
 */
export interface ConflictInfo {
    filePath: string;
    sourceHash: string;
    destHash: string;
    sourceModified: number;
    destModified: number;
    conflictType: 'content' | 'timestamp' | 'both';
}

/**
 * Módulo de Sistema de Ficheiros para comunicação com a pasta de destino
 * Utiliza módulos nativos do Node.js (fs, path) disponíveis no ambiente Electron
 */
export class FileSystemModule {
    constructor(private destinationPath: string) { }

    /**
     * Valida se a pasta de destino existe e está acessível
     */
    async validateDestination(): Promise<{ valid: boolean; error?: string }> {
        try {
            // Verificar se o caminho existe
            const stats = await fs.stat(this.destinationPath);

            // Verificar se é um diretório
            if (!stats.isDirectory()) {
                return { valid: false, error: 'O caminho especificado não é um diretório' };
            }

            // Testar permissões de escrita criando um ficheiro temporário
            const testFile = path.join(this.destinationPath, '.sync-test-' + Date.now());
            await fs.writeFile(testFile, 'test');
            await fs.unlink(testFile);

            return { valid: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';

            if (errorMessage.includes('ENOENT')) {
                return { valid: false, error: 'O diretório de destino não existe' };
            } else if (errorMessage.includes('EACCES') || errorMessage.includes('EPERM')) {
                return { valid: false, error: 'Sem permissões de escrita no diretório de destino' };
            } else {
                return { valid: false, error: `Erro ao acessar diretório: ${errorMessage}` };
            }
        }
    }

    /**
     * Copia um ficheiro do vault para a pasta de destino
     */
    async copyFile(sourceFile: TFile, sourceContent: string | ArrayBuffer): Promise<void> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        // Construir caminho completo do destino
        const destPath = path.join(this.destinationPath, sourceFile.path);

        // Garantir que o diretório de destino existe
        const destDir = path.dirname(destPath);
        await this.createDirectory(destDir);

        try {
            // Determinar se é arquivo binário ou texto baseado na extensão
            const isBinaryFile = this.isBinaryFile(sourceFile.path);

            if (isBinaryFile && sourceContent instanceof ArrayBuffer) {
                // Escrever arquivo binário como buffer
                await fs.writeFile(destPath, new Uint8Array(sourceContent));
                console.log(`[SyncFull] Ficheiro binário copiado: ${sourceFile.path} -> ${destPath}`);
            } else if (!isBinaryFile && typeof sourceContent === 'string') {
                // Escrever arquivo de texto como UTF-8
                await fs.writeFile(destPath, sourceContent, 'utf-8');
                console.log(`[SyncFull] Ficheiro de texto copiado: ${sourceFile.path} -> ${destPath}`);
            } else {
                // Fallback: tentar converter string para buffer se necessário
                const content = typeof sourceContent === 'string' ? Buffer.from(sourceContent, 'utf-8') : new Uint8Array(sourceContent);
                await fs.writeFile(destPath, content);
                console.log(`[SyncFull] Ficheiro copiado (fallback): ${sourceFile.path} -> ${destPath}`);
            }
        } catch (error) {
            throw new Error(`Falha ao copiar ficheiro ${sourceFile.path}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }


    /**
     * Elimina um ficheiro na pasta de destino
     */
    async deleteFile(relativePath: string): Promise<void> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        const destPath = path.join(this.destinationPath, relativePath);

        try {
            await fs.unlink(destPath);
            console.log(`[SyncFull] Ficheiro eliminado: ${destPath}`);
        } catch (error) {
            // Se o ficheiro não existe, não é considerado erro
            if (error instanceof Error && error.message.includes('ENOENT')) {
                console.log(`[SyncFull] Ficheiro já não existe: ${destPath}`);
                return;
            }
            throw new Error(`Falha ao eliminar ficheiro ${relativePath}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Verifica se um ficheiro existe na pasta de destino
     */
    async fileExists(relativePath: string): Promise<boolean> {
        if (!this.destinationPath) {
            return false;
        }

        const destPath = path.join(this.destinationPath, relativePath);

        try {
            await fs.access(destPath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Cria diretórios recursivamente se não existirem
     */
    async createDirectory(dirPath: string): Promise<void> {
        try {
            await fs.mkdir(dirPath, { recursive: true });
            console.log(`[SyncFull] Diretório criado/verificado: ${dirPath}`);
        } catch (error) {
            throw new Error(`Falha ao criar diretório ${dirPath}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Lê o conteúdo de um ficheiro na pasta de destino
     */
    async readFile(relativePath: string): Promise<string> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        const destPath = path.join(this.destinationPath, relativePath);

        try {
            const content = await fs.readFile(destPath, 'utf-8');
            return content;
        } catch (error) {
            throw new Error(`Falha ao ler ficheiro ${relativePath}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Lista todos os ficheiros Markdown na pasta de destino
     */
    async listMarkdownFiles(): Promise<string[]> {
        if (!this.destinationPath) {
            return [];
        }

        const markdownFiles: string[] = [];

        async function scanDirectory(dirPath: string, basePath: string = ''): Promise<void> {
            try {
                const entries = await fs.readdir(dirPath, { withFileTypes: true });

                for (const entry of entries) {
                    const fullPath = path.join(dirPath, entry.name);
                    const relativePath = path.join(basePath, entry.name);

                    if (entry.isDirectory()) {
                        await scanDirectory(fullPath, relativePath);
                    } else if (entry.isFile() && entry.name.endsWith('.md')) {
                        // Usar caminhos relativos com separadores universais
                        markdownFiles.push(relativePath.replace(/\\/g, '/'));
                    }
                }
            } catch (error) {
                console.warn(`[SyncFull] Aviso ao escanear diretório ${dirPath}:`, error);
            }
        }

        await scanDirectory(this.destinationPath);
        return markdownFiles;
    }

    /**
     * Obtém estatísticas de um ficheiro (tamanho, data de modificação)
     */
    async getFileStats(relativePath: string): Promise<{ size: number; mtime: number } | null> {
        if (!this.destinationPath) {
            return null;
        }

        const destPath = path.join(this.destinationPath, relativePath);

        try {
            const stats = await fs.stat(destPath);
            return {
                size: stats.size,
                mtime: stats.mtime.getTime()
            };
        } catch {
            return null;
        }
    }

    /**
     * Atualiza o caminho de destino
     */
    updateDestinationPath(newPath: string): void {
        this.destinationPath = newPath;
        console.log(`[SyncFull] Caminho de destino atualizado para: ${newPath}`);
    }

    /**
     * Obtém o caminho de destino atual
     */
    getDestinationPath(): string {
        return this.destinationPath;
    }

    /**
     * Calcula hash SHA-256 de um arquivo
     */
    async calculateFileHash(filePath: string): Promise<string> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        const fullPath = path.join(this.destinationPath, filePath);

        try {
            const fileBuffer = await fs.readFile(fullPath);
            const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            console.log(`[SyncFull] Hash calculado: ${filePath} -> ${hash}`);
            return hash;
        } catch (error) {
            throw new Error(`Falha ao calcular hash do arquivo ${filePath}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Carrega metadata de sincronização do arquivo sync-metadata.json
     */
    async loadSyncMetadata(): Promise<SyncMetadata> {
        if (!this.destinationPath) {
            return {};
        }

        const metadataPath = path.join(this.destinationPath, 'sync-metadata.json');

        try {
            const content = await fs.readFile(metadataPath, 'utf-8');
            const metadata = JSON.parse(content) as SyncMetadata;
            console.log(`[SyncFull] Metadata carregado: ${Object.keys(metadata).length} arquivos`);
            return metadata;
        } catch (error) {
            if (error instanceof Error && error.message.includes('ENOENT')) {
                console.log('[SyncFull] Arquivo de metadata não encontrado, criando novo');
                return {};
            }
            console.warn('[SyncFull] Erro ao carregar metadata:', error);
            return {};
        }
    }

    /**
     * Salva metadata de sincronização no arquivo sync-metadata.json
     */
    async saveSyncMetadata(metadata: SyncMetadata): Promise<void> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        const metadataPath = path.join(this.destinationPath, 'sync-metadata.json');

        try {
            const content = JSON.stringify(metadata, null, 2);
            await fs.writeFile(metadataPath, content, 'utf-8');
            console.log(`[SyncFull] Metadata salvo: ${Object.keys(metadata).length} arquivos`);
        } catch (error) {
            throw new Error(`Falha ao salvar metadata: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Verifica se um arquivo foi modificado desde a última sincronização
     */
    async isFileModified(filePath: string, currentHash: string, currentSize: number): Promise<boolean> {
        const metadata = await this.loadSyncMetadata();
        const fileMetadata = metadata[filePath];

        if (!fileMetadata) {
            console.log(`[SyncFull] Arquivo não encontrado no metadata: ${filePath}`);
            return true; // Arquivo novo, precisa sincronizar
        }

        const isModified = fileMetadata.hash !== currentHash || fileMetadata.size !== currentSize;
        console.log(`[SyncFull] Arquivo modificado? ${filePath}: ${isModified}`);
        return isModified;
    }

    /**
     * Atualiza metadata de sincronização para um arquivo
     */
    async updateFileMetadata(filePath: string, hash: string, size: number): Promise<void> {
        const metadata = await this.loadSyncMetadata();

        metadata[filePath] = {
            hash,
            lastSync: Date.now(),
            size,
            modifiedTime: Date.now()
        };

        await this.saveSyncMetadata(metadata);
        console.log(`[SyncFull] Metadata atualizado: ${filePath}`);
    }

    /**
     * Remove arquivo do metadata de sincronização
     */
    async removeFileMetadata(filePath: string): Promise<void> {
        const metadata = await this.loadSyncMetadata();

        if (metadata[filePath]) {
            delete metadata[filePath];
            await this.saveSyncMetadata(metadata);
            console.log(`[SyncFull] Metadata removido: ${filePath}`);
        }
    }

    /**
     * Detecta conflitos entre arquivo fonte e destino
     */
    async detectConflict(sourceFile: TFile, sourceHash: string): Promise<ConflictInfo | null> {
        if (!this.destinationPath) {
            return null;
        }

        const destPath = path.join(this.destinationPath, sourceFile.path);

        try {
            // Verificar se arquivo existe no destino
            const destExists = await this.fileExists(sourceFile.path);
            if (!destExists) {
                return null; // Sem conflito, arquivo novo
            }

            // Obter hash do arquivo destino
            const destHash = await this.calculateFileHash(sourceFile.path);

            // Obter estatísticas do arquivo destino
            const destStats = await this.getFileStats(sourceFile.path);
            if (!destStats) {
                return null;
            }

            // Comparar hashes e timestamps
            const sourceModified = sourceFile.stat.mtime;
            const destModified = destStats.mtime;

            // Determinar tipo de conflito
            let conflictType: 'content' | 'timestamp' | 'both' = 'content';

            if (sourceHash !== destHash) {
                conflictType = 'content';
            } else if (Math.abs(sourceModified - destModified) > 1000) {
                conflictType = 'timestamp';
            } else {
                return null; // Sem conflito
            }

            return {
                filePath: sourceFile.path,
                sourceHash,
                destHash,
                sourceModified,
                destModified,
                conflictType
            };
        } catch (error) {
            console.warn(`[SyncFull] Erro ao detectar conflito para ${sourceFile.path}:`, error);
            return null;
        }
    }

    /**
     * Resolve conflito baseado na estratégia configurada
     */
    async resolveConflict(
        conflict: ConflictInfo,
        sourceFile: TFile,
        content: string | ArrayBuffer,
        strategy: 'last-writes-wins' | 'create-copy' | 'skip',
        createCopies: boolean
    ): Promise<{ action: string; resultPath?: string }> {
        console.log(`[SyncFull] Resolvendo conflito: ${conflict.filePath} (${strategy})`);

        switch (strategy) {
            case 'last-writes-wins':
                // Última escrita vence - sempre usar o mais recente
                const isSourceNewer = conflict.sourceModified > conflict.destModified;

                if (isSourceNewer) {
                    await this.atomicCopy(sourceFile, content);
                    return { action: 'synced-source', resultPath: conflict.filePath };
                } else {
                    return { action: 'skipped-dest-newer' };
                }

            case 'create-copy':
                if (createCopies) {
                    // Criar cópia do arquivo com sufixo de conflito
                    const ext = path.extname(conflict.filePath);
                    const base = path.basename(conflict.filePath, ext);
                    const dir = path.dirname(conflict.filePath);
                    const conflictPath = path.join(dir, `${base} (conflito)${ext}`);

                    // Criar arquivo de conflito
                    const conflictFile = {
                        ...sourceFile,
                        path: conflictPath
                    } as TFile;

                    await this.atomicCopy(conflictFile, content);
                    return { action: 'conflict-copy-created', resultPath: conflictPath };
                } else {
                    // Fallback para last-writes-wins
                    return await this.resolveConflict(conflict, sourceFile, content, 'last-writes-wins', false);
                }

            case 'skip':
                // Pular arquivo, não sincronizar
                return { action: 'skipped' };

            default:
                throw new Error(`Estratégia de conflito desconhecida: ${strategy}`);
        }
    }

    /**
     * Gera nome único para cópia de conflito
     */
    private generateConflictName(filePath: string): string {
        const ext = path.extname(filePath);
        const base = path.basename(filePath, ext);
        const dir = path.dirname(filePath);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        return path.join(dir, `${base} (conflito ${timestamp})${ext}`);
    }

    /**
     * Implementa escrita atômica para evitar corrupção de arquivos
     */
    async atomicCopy(sourceFile: TFile, content: string | ArrayBuffer): Promise<void> {
        if (!this.destinationPath) {
            throw new Error('Caminho de destino não configurado');
        }

        const destPath = path.join(this.destinationPath, sourceFile.path);
        const tempPath = `${destPath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

        try {
            console.log(`[SyncFull] Iniciando escrita atômica: ${sourceFile.path}`);

            // Criar diretório se não existir
            const destDir = path.dirname(destPath);
            await this.createDirectory(destDir);

            // Escrever para arquivo temporário
            const isBinaryFile = this.isBinaryFile(sourceFile.path);

            if (isBinaryFile && content instanceof ArrayBuffer) {
                // Escrever arquivo binário como buffer
                await fs.writeFile(tempPath, new Uint8Array(content));
            } else if (!isBinaryFile && typeof content === 'string') {
                // Escrever arquivo de texto como UTF-8
                await fs.writeFile(tempPath, content, 'utf-8');
            } else {
                // Fallback: converter conforme necessário
                const fileContent = typeof content === 'string'
                    ? Buffer.from(content, 'utf-8')
                    : new Uint8Array(content);
                await fs.writeFile(tempPath, fileContent);
            }

            console.log(`[SyncFull] Arquivo temporário criado: ${tempPath}`);

            // Mover atomicamente para o destino final
            await fs.rename(tempPath, destPath);

            console.log(`[SyncFull] Escrita atômica concluída: ${sourceFile.path}`);

        } catch (error) {
            // Limpar arquivo temporário em caso de erro
            try {
                await fs.unlink(tempPath);
                console.log(`[SyncFull] Arquivo temporário removido: ${tempPath}`);
            } catch (cleanupError) {
                console.warn(`[SyncFull] Erro ao limpar arquivo temporário ${tempPath}:`, cleanupError);
            }

            throw new Error(`Falha na escrita atômica do arquivo ${sourceFile.path}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
        }
    }

    /**
     * Verifica se um arquivo é binário baseado na extensão
     */
    private isBinaryFile(filePath: string): boolean {
        const binaryExtensions = [
            // Imagens
            '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico',
            // Áudio
            '.mp3', '.wav', '.ogg', '.flac', '.aac',
            // Vídeo
            '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
            // Documentos
            '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
            // Arquivos compactados
            '.zip', '.rar', '.7z', '.tar', '.gz',
            // Executáveis e binários
            '.exe', '.dll', '.so', '.dylib',
            // Outros binários comuns
            '.bin', '.dat', '.db', '.sqlite'
        ];

        const ext = filePath.split('.').pop()?.toLowerCase();
        return ext ? binaryExtensions.includes('.' + ext) : false;
    }
}

import * as fs from 'fs/promises';
import * as path from 'path';
import { TFile } from 'obsidian';

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

        const ext = path.extname(filePath).toLowerCase();
        return binaryExtensions.includes(ext);
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
}

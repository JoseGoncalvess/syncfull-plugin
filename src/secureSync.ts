import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { TFile } from 'obsidian';
import { Notice } from 'obsidian';
import { SyncProtectionManager, DeviceInfo, SyncRequest } from './protection';

export interface FileChange {
	filePath: string;
	operation: 'create' | 'update' | 'delete';
	content?: string | ArrayBuffer;
	hash?: string;
	timestamp: number;
}

export interface SyncOperation {
	id: string;
	deviceId: string;
	filePath: string;
	operation: 'create' | 'update' | 'delete';
	content?: string | ArrayBuffer;
	timestamp: number;
	status: 'pending' | 'processing' | 'completed' | 'failed';
	error?: string;
}

export interface SyncResult {
	success: boolean;
	error?: string;
	message?: string;
	operationsProcessed?: number;
	conflicts?: string[];
}

/**
 * Gerenciador de sincronização segura
 * Implementa operações validadas cliente ↔ servidor
 */
export class SecureSyncManager {
	private protectionManager: SyncProtectionManager;
	private deviceId: string;
	private isServer: boolean;
	private basePath: string;
	private clientPath: string;

	constructor(
		protectionManager: SyncProtectionManager,
		deviceId: string,
		isServer: boolean,
		basePath: string,
		clientPath?: string
	) {
		this.protectionManager = protectionManager;
		this.deviceId = deviceId;
		this.isServer = isServer;
		this.basePath = basePath;
		this.clientPath = clientPath || '';
	}

	/**
	 * Cliente: Sincroniza arquivo para o servidor
	 */
	async syncFileToServer(filePath: string, content: string | ArrayBuffer): Promise<SyncResult> {
		try {
			console.log(`[SecureSync] Enviando arquivo para servidor: ${filePath}`);

			if (this.isServer) {
				return {
					success: false,
					error: 'Servidor não pode enviar arquivos para si mesmo'
				};
			}

			// Calcular hash do conteúdo
			const hash = this.calculateHash(content);

			// Solicitar permissão de escrita
			const hasPermission = await this.protectionManager.validateWriteAccess(this.deviceId, filePath);
			if (!hasPermission) {
				return {
					success: false,
					error: 'Sem permissão de escrita no servidor'
				};
			}

			// Criar lock para operação
			const lockResult = await this.protectionManager.createLock(filePath, this.deviceId);
			if (!lockResult.success) {
				return {
					success: false,
					error: lockResult.error || 'Não foi possível criar lock'
				};
			}

			try {
				// Escrever arquivo no servidor
				const serverFilePath = path.join(this.basePath, filePath);
				await this.atomicWrite(serverFilePath, content);

				// Liberar lock
				await this.protectionManager.releaseLock(filePath, this.deviceId);

				console.log(`[SecureSync] Arquivo enviado com sucesso: ${filePath}`);
				return {
					success: true,
					message: `Arquivo ${filePath} sincronizado com sucesso`
				};
			} catch (writeError) {
				// Garantir que lock seja liberado mesmo em caso de erro
				await this.protectionManager.releaseLock(filePath, this.deviceId);
				throw writeError;
			}
		} catch (error) {
			console.error('[SecureSync] Erro ao sincronizar arquivo para servidor:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Cliente: Baixa alterações do servidor
	 */
	async downloadFromServer(): Promise<SyncResult> {
		try {
			console.log('[SecureSync] Baixando alterações do servidor...');

			if (this.isServer) {
				return {
					success: false,
					error: 'Servidor não baixa alterações de si mesmo'
				};
			}

			if (!this.clientPath) {
				return {
					success: false,
					error: 'Caminho local do cliente não configurado'
				};
			}

			// Obter lista de arquivos no servidor
			const serverFiles = await this.getServerFileList();
			const localFiles = await this.getLocalFileList();

			const operations: SyncOperation[] = [];
			let operationsProcessed = 0;

			// Identificar arquivos para baixar/atualizar
			for (const serverFile of serverFiles) {
				const localFile = localFiles.find(f => f.path === serverFile.path);

				if (!localFile || serverFile.mtime > localFile.mtime) {
					operations.push({
						id: `download-${serverFile.path}`,
						deviceId: this.deviceId,
						filePath: serverFile.path,
						operation: localFile ? 'update' : 'create',
						timestamp: Date.now(),
						status: 'pending'
					});
				}
			}

			// Identificar arquivos para deletar localmente
			for (const localFile of localFiles) {
				const serverFile = serverFiles.find(f => f.path === localFile.path);

				if (!serverFile) {
					operations.push({
						id: `delete-${localFile.path}`,
						deviceId: this.deviceId,
						filePath: localFile.path,
						operation: 'delete',
						timestamp: Date.now(),
						status: 'pending'
					});
				}
			}

			// Executar operações
			for (const operation of operations) {
				operation.status = 'processing';

				try {
					await this.processDownloadOperation(operation);
					operation.status = 'completed';
					operationsProcessed++;
				} catch (error) {
					operation.status = 'failed';
					operation.error = error instanceof Error ? error.message : 'Erro desconhecido';
					console.error(`[SecureSync] Erro na operação ${operation.id}:`, error);
				}
			}

			const failedOperations = operations.filter(op => op.status === 'failed');

			return {
				success: failedOperations.length === 0,
				message: `${operationsProcessed} arquivos processados com sucesso`,
				operationsProcessed,
				conflicts: failedOperations.map(op => `${op.filePath}: ${op.error}`)
			};
		} catch (error) {
			console.error('[SecureSync] Erro ao baixar do servidor:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Servidor: Recebe solicitação de sincronização
	 */
	async receiveSyncRequest(request: SyncRequest): Promise<SyncResult> {
		try {
			console.log(`[SecureSync] Recebendo solicitação de ${request.deviceId} para ${request.filePath}`);

			if (!this.isServer) {
				return {
					success: false,
					error: 'Apenas servidores podem receber solicitações'
				};
			}

			// Validar permissão do dispositivo
			const hasPermission = await this.protectionManager.validateWriteAccess(request.deviceId, request.filePath);
			if (!hasPermission) {
				return {
					success: false,
					error: 'Dispositivo não autorizado'
				};
			}

			// Criar lock
			const lockResult = await this.protectionManager.createLock(request.filePath, request.deviceId);
			if (!lockResult.success) {
				return {
					success: false,
					error: lockResult.error || 'Arquivo bloqueado'
				};
			}

			// TODO: Implementar processamento real da solicitação
			// Por enquanto, apenas simula sucesso
			await this.protectionManager.releaseLock(request.filePath, request.deviceId);

			return {
				success: true,
				message: 'Solicitação recebida com sucesso'
			};
		} catch (error) {
			console.error('[SecureSync] Erro ao receber solicitação:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Servidor: Valida e integra alteração
	 */
	async validateAndIntegrate(filePath: string, content: string | ArrayBuffer, deviceId: string): Promise<SyncResult> {
		try {
			console.log(`[SecureSync] Integrando alteração de ${deviceId} em ${filePath}`);

			if (!this.isServer) {
				return {
					success: false,
					error: 'Apenas servidores podem integrar alterações'
				};
			}

			// Validar checksum se fornecido
			const calculatedHash = this.calculateHash(content);
			// TODO: Comparar com hash fornecido na solicitação

			// Verificar conflitos
			const conflictCheck = await this.checkForConflicts(filePath, calculatedHash);
			if (conflictCheck.hasConflict) {
				// TODO: Implementar estratégia de resolução de conflitos
				console.warn(`[SecureSync] Conflito detectado em ${filePath}`);
			}

			// Integrar alteração
			const serverFilePath = path.join(this.basePath, filePath);
			await this.atomicWrite(serverFilePath, content);

			// Notificar outros clientes
			await this.notifyOtherClients(deviceId, [{
				filePath,
				operation: 'update',
				timestamp: Date.now()
			}]);

			return {
				success: true,
				message: `Alteração em ${filePath} integrada com sucesso`
			};
		} catch (error) {
			console.error('[SecureSync] Erro ao integrar alteração:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Servidor: Notifica outros clientes sobre mudanças
	 */
	async notifyOtherClients(excludeDevice: string, changes: FileChange[]): Promise<void> {
		try {
			console.log(`[SecureSync] Notificando clientes sobre ${changes.length} mudanças`);

			// TODO: Implementar sistema de notificação
			// Por enquanto, apenas log
			for (const change of changes) {
				console.log(`[SecureSync] Mudança: ${change.operation} em ${change.filePath}`);
			}
		} catch (error) {
			console.error('[SecureSync] Erro ao notificar clientes:', error);
		}
	}

	/**
	 * Processa operação de download
	 */
	private async processDownloadOperation(operation: SyncOperation): Promise<void> {
		const serverFilePath = path.join(this.basePath, operation.filePath);
		const clientFilePath = path.join(this.clientPath, operation.filePath);

		switch (operation.operation) {
			case 'create':
			case 'update':
				// Garantir que diretório existe
				const clientDir = path.dirname(clientFilePath);
				await fs.mkdir(clientDir, { recursive: true });

				// Copiar arquivo do servidor para cliente
				await fs.copyFile(serverFilePath, clientFilePath);
				break;

			case 'delete':
				// Deletar arquivo local
				await fs.unlink(clientFilePath);
				break;
		}
	}

	/**
	 * Obtém lista de arquivos do servidor
	 */
	private async getServerFileList(): Promise<Array<{ path: string; mtime: number; size: number }>> {
		const files: Array<{ path: string; mtime: number; size: number }> = [];

		const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				if (entry.name.startsWith('.sync-') || entry.name.startsWith('.')) {
					continue; // Ignorar arquivos de sistema
				}

				const fullPath = path.join(dirPath, entry.name);
				const entryRelativePath = path.join(relativePath, entry.name);

				if (entry.isDirectory()) {
					await scanDirectory(fullPath, entryRelativePath);
				} else {
					const stats = await fs.stat(fullPath);
					files.push({
						path: entryRelativePath,
						mtime: stats.mtime.getTime(),
						size: stats.size
					});
				}
			}
		};

		await scanDirectory(this.basePath);
		return files;
	}

	/**
	 * Obtém lista de arquivos locais
	 */
	private async getLocalFileList(): Promise<Array<{ path: string; mtime: number; size: number }>> {
		const files: Array<{ path: string; mtime: number; size: number }> = [];

		const scanDirectory = async (dirPath: string, relativePath: string = ''): Promise<void> => {
			const entries = await fs.readdir(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				if (entry.name.startsWith('.sync-') || entry.name.startsWith('.')) {
					continue; // Ignorar arquivos de sistema
				}

				const fullPath = path.join(dirPath, entry.name);
				const entryRelativePath = path.join(relativePath, entry.name);

				if (entry.isDirectory()) {
					await scanDirectory(fullPath, entryRelativePath);
				} else {
					const stats = await fs.stat(fullPath);
					files.push({
						path: entryRelativePath,
						mtime: stats.mtime.getTime(),
						size: stats.size
					});
				}
			}
		};

		await scanDirectory(this.clientPath);
		return files;
	}

	/**
	 * Verifica conflitos
	 */
	private async checkForConflicts(filePath: string, newHash: string): Promise<{ hasConflict: boolean; existingHash?: string }> {
		try {
			const serverFilePath = path.join(this.basePath, filePath);
			const content = await fs.readFile(serverFilePath);
			const existingHash = crypto.createHash('sha256').update(content).digest('hex');

			return {
				hasConflict: existingHash !== newHash,
				existingHash
			};
		} catch (error) {
			// Arquivo não existe, sem conflito
			return { hasConflict: false };
		}
	}

	/**
	 * Escrita atômica de arquivo
	 */
	private async atomicWrite(filePath: string, content: string | ArrayBuffer): Promise<void> {
		const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

		try {
			// Converter ArrayBuffer para Uint8Array se necessário
			const writeContent = content instanceof ArrayBuffer
				? new Uint8Array(content)
				: content;

			await fs.writeFile(tempPath, writeContent);
			await fs.rename(tempPath, filePath);
		} catch (error) {
			// Limpar arquivo temporário em caso de erro
			try {
				await fs.unlink(tempPath);
			} catch {
				// Ignorar erro ao limpar
			}
			throw error;
		}
	}

	/**
	 * Calcula hash SHA-256 do conteúdo
	 */
	private calculateHash(content: string | ArrayBuffer): string {
		if (typeof content === 'string') {
			return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
		} else {
			return crypto.createHash('sha256').update(new Uint8Array(content)).digest('hex');
		}
	}

	/**
	 * Obtém estatísticas de sincronização
	 */
	async getSyncStats(): Promise<{
		totalFiles: number;
		pendingOperations: number;
		lastSync: number;
		conflicts: number;
	}> {
		try {
			if (this.isServer) {
				const files = await this.getServerFileList();
				return {
					totalFiles: files.length,
					pendingOperations: 0,
					lastSync: Date.now(),
					conflicts: 0
				};
			} else {
				const serverFiles = await this.getServerFileList();
				const localFiles = await this.getLocalFileList();

				return {
					totalFiles: serverFiles.length,
					pendingOperations: Math.max(0, serverFiles.length - localFiles.length),
					lastSync: Date.now(),
					conflicts: 0 // TODO: Implementar detecção de conflitos
				};
			}
		} catch (error) {
			console.error('[SecureSync] Erro ao obter estatísticas:', error);
			return {
				totalFiles: 0,
				pendingOperations: 0,
				lastSync: 0,
				conflicts: 0
			};
		}
	}
}

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { TFile, App } from 'obsidian';
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
	private app: App;
	private protectionManager: SyncProtectionManager;
	private deviceId: string;
	private isServer: boolean;
	private basePath: string;
	private clientPath: string;
	private conflictResolution: 'last-writes-wins' | 'create-copy' | 'skip';

	constructor(
		app: App,
		protectionManager: SyncProtectionManager,
		deviceId: string,
		isServer: boolean,
		basePath: string,
		clientPath?: string,
		conflictResolution: 'last-writes-wins' | 'create-copy' | 'skip' = 'last-writes-wins'
	) {
		this.app = app;
		this.protectionManager = protectionManager;
		this.deviceId = deviceId;
		this.isServer = isServer;
		this.basePath = basePath;
		this.clientPath = clientPath || '';
		this.conflictResolution = conflictResolution;
	}

	/**
	 * Cliente: Deleta arquivo no servidor
	 */
	async deleteFileFromServer(filePath: string): Promise<SyncResult> {
		try {
			console.log(`[SecureSync] Deletando arquivo no servidor: ${filePath}`);

			if (this.isServer) {
				return {
					success: false,
					error: 'Servidor não pode deletar arquivos para si mesmo'
				};
			}

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
				// Deletar arquivo no servidor
				const serverFilePath = path.join(this.basePath, filePath);
				console.log(`[SecureSync] deleteFileFromServer - Caminho do servidor: ${serverFilePath}`);
				console.log(`[SecureSync] deleteFileFromServer - basePath: ${this.basePath}`);
				console.log(`[SecureSync] deleteFileFromServer - filePath: ${filePath}`);

				// Verificar se arquivo existe antes de deletar
				try {
					await fs.access(serverFilePath);
					await fs.unlink(serverFilePath);
					console.log(`[SecureSync] Arquivo deletado com sucesso: ${filePath}`);
				} catch (accessError) {
					console.log(`[SecureSync] Arquivo não existe no servidor: ${filePath}`);
					// Considerar sucesso se arquivo não existe (já foi deletado)
				}

				// Liberar lock
				await this.protectionManager.releaseLock(filePath, this.deviceId);

				return {
					success: true,
					message: `Arquivo ${filePath} deletado com sucesso`
				};
			} catch (deleteError) {
				console.error(`[SecureSync] deleteFileFromServer - Erro ao deletar arquivo:`, deleteError);
				// Garantir que lock seja liberado mesmo em caso de erro
				await this.protectionManager.releaseLock(filePath, this.deviceId);
				throw deleteError;
			}
		} catch (error) {
			console.error('[SecureSync] Erro ao deletar arquivo no servidor:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Servidor: Deleta arquivo localmente
	 */
	async deleteFileLocally(filePath: string): Promise<SyncResult> {
		try {
			console.log(`[SecureSync] Deletando arquivo localmente: ${filePath}`);

			if (!this.isServer) {
				return {
					success: false,
					error: 'Apenas servidores podem deletar arquivos localmente'
				};
			}

			// Deletar arquivo na PastaBase do servidor
			const serverFilePath = path.join(this.basePath, filePath);
			console.log(`[SecureSync] deleteFileLocally - Caminho do arquivo: ${serverFilePath}`);
			console.log(`[SecureSync] deleteFileLocally - basePath: ${this.basePath}`);
			console.log(`[SecureSync] deleteFileLocally - filePath: ${filePath}`);

			try {
				// Verificar se o arquivo exato existe
				await fs.access(serverFilePath);
				await fs.unlink(serverFilePath);
				console.log(`[SecureSync] Arquivo deletado localmente com sucesso: ${filePath}`);
			} catch (accessError) {
				console.log(`[SecureSync] Arquivo não encontrado no caminho exato: ${serverFilePath}`);
				console.log(`[SecureSync] Erro de acesso:`, accessError);

				// Tentar encontrar arquivo com nome similar (caso sensitivo)
				try {
					const dir = path.dirname(serverFilePath);
					const fileName = path.basename(serverFilePath);
					console.log(`[SecureSync] Procurando em diretório: ${dir}`);
					console.log(`[SecureSync] Nome do arquivo procurado: ${fileName}`);

					const files = await fs.readdir(dir);
					console.log(`[SecureSync] Arquivos no diretório:`, files);

					// Procurar arquivo exato (case-sensitive)
					const exactMatch = files.find(f => f === fileName);
					if (exactMatch) {
						const exactPath = path.join(dir, exactMatch);
						console.log(`[SecureSync] Arquivo encontrado com nome exato: ${exactPath}`);
						await fs.unlink(exactPath);
						console.log(`[SecureSync] Arquivo deletado localmente com sucesso: ${exactMatch}`);
						return {
							success: true,
							message: `Arquivo ${exactMatch} deletado localmente com sucesso`
						};
					}

					// Procurar arquivo ignorando case
					const caseInsensitiveMatch = files.find(f => f.toLowerCase() === fileName.toLowerCase());
					if (caseInsensitiveMatch) {
						const caseInsensitivePath = path.join(dir, caseInsensitiveMatch);
						console.log(`[SecureSync] Arquivo encontrado (case-insensitive): ${caseInsensitivePath}`);
						await fs.unlink(caseInsensitivePath);
						console.log(`[SecureSync] Arquivo deletado localmente com sucesso: ${caseInsensitiveMatch}`);
						return {
							success: true,
							message: `Arquivo ${caseInsensitiveMatch} deletado localmente com sucesso`
						};
					}

					console.log(`[SecureSync] Arquivo não encontrado em nenhuma variação: ${filePath}`);
				} catch (searchError) {
					console.error(`[SecureSync] Erro ao buscar arquivo:`, searchError);
				}

				console.log(`[SecureSync] Arquivo não existe localmente: ${filePath}`);
				// Considerar sucesso se arquivo não existe (já foi deletado)
			}

			// Aproveitamos o processo de deleção local para fazer uma limpeza de locks presos
			await this.protectionManager.cleanOrphanLocks();

			return {
				success: true,
				message: `Arquivo ${filePath} deletado localmente com sucesso`
			};
		} catch (error) {
			console.error('[SecureSync] Erro ao deletar arquivo localmente:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
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
				let targetPath = path.join(this.basePath, filePath);
				const conflictCheck = await this.checkForConflicts(filePath, hash);

				if (conflictCheck.hasConflict) {
					if (this.conflictResolution === 'skip') {
						console.log(`[SecureSync] Conflito detectado em ${filePath}. Ignorando (skip).`);
						await this.protectionManager.releaseLock(filePath, this.deviceId);
						return { success: true, message: 'Sincronização ignorada devido a conflito' };
					} else if (this.conflictResolution === 'create-copy') {
						const ext = path.extname(filePath);
						const base = path.basename(filePath, ext);
						const dir = path.dirname(filePath);
						const conflictName = `${base}_conflito_${Date.now()}${ext}`;
						targetPath = path.join(this.basePath, dir, conflictName);
						console.log(`[SecureSync] Conflito em ${filePath}. Criando cópia: ${conflictName}`);
					}
				}

				console.log(`[SecureSync] syncFileToServer - Escrevendo em: ${targetPath}`);
				await this.atomicWrite(targetPath, content);

				// Liberar lock
				await this.protectionManager.releaseLock(filePath, this.deviceId);

				console.log(`[SecureSync] Arquivo enviado com sucesso: ${filePath}`);
				return {
					success: true,
					message: `Arquivo ${filePath} sincronizado com sucesso`
				};
			} catch (writeError) {
				console.error(`[SecureSync] syncFileToServer - Erro ao escrever arquivo:`, writeError);
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
	 * Cliente ou Servidor: Envia todos os arquivos locais (do Vault) para a PastaBase
	 */
	async uploadToServer(): Promise<SyncResult> {
		try {
			console.log('[SecureSync] Enviando arquivos locais para a PastaBase...');

			// Obter lista de arquivos do servidor e locais (do Vault)
			const serverFiles = await this.getServerFileList();
			const localFiles = this.app.vault.getFiles().filter(f => !f.path.startsWith('.'));

			const operations: SyncOperation[] = [];
			let operationsProcessed = 0;

			// Identificar arquivos para enviar (create/update)
			for (const localFile of localFiles) {
				const serverFile = serverFiles.find(f => f.path === localFile.path);

				if (!serverFile) {
					operations.push({
						id: `upload-${localFile.path}`,
						deviceId: this.deviceId,
						filePath: localFile.path,
						operation: 'create',
						timestamp: Date.now(),
						status: 'pending'
					});
				} else {
					const timeDiff = localFile.stat.mtime - serverFile.mtime;
					const toleranceMs = 2000;

					if (timeDiff > toleranceMs) {
						operations.push({
							id: `upload-${localFile.path}`,
							deviceId: this.deviceId,
							filePath: localFile.path,
							operation: 'update',
							timestamp: Date.now(),
							status: 'pending'
						});
					}
				}
			}

			// Identificar arquivos para deletar no servidor
			for (const serverFile of serverFiles) {
				const localFile = localFiles.find(f => f.path === serverFile.path);
				if (!localFile) {
					operations.push({
						id: `delete-server-${serverFile.path}`,
						deviceId: this.deviceId,
						filePath: serverFile.path,
						operation: 'delete',
						timestamp: Date.now(),
						status: 'pending'
					});
				}
			}

			console.log(`[SecureSync] Resumo do Upload:`);
			console.log(`[SecureSync] - Arquivos para criar: ${operations.filter(op => op.operation === 'create').length}`);
			console.log(`[SecureSync] - Arquivos para atualizar: ${operations.filter(op => op.operation === 'update').length}`);
			console.log(`[SecureSync] - Arquivos para deletar: ${operations.filter(op => op.operation === 'delete').length}`);

			if (operations.length === 0) {
				return {
					success: true,
					message: 'Todos os arquivos já estão enviados para a PastaBase',
					operationsProcessed: 0
				};
			}

			// Executar operações
			for (const operation of operations) {
				operation.status = 'processing';
				try {
					if (operation.operation === 'delete') {
						if (this.isServer) {
							await this.deleteFileLocally(operation.filePath);
						} else {
							await this.deleteFileFromServer(operation.filePath);
						}
					} else {
						const abstractFile = this.app.vault.getAbstractFileByPath(operation.filePath);
						if (abstractFile instanceof TFile) {
							const content = await this.app.vault.readBinary(abstractFile);
							if (this.isServer) {
								await this.validateAndIntegrate(operation.filePath, content, this.deviceId);
							} else {
								await this.syncFileToServer(operation.filePath, content);
							}
						}
					}
					operation.status = 'completed';
					operationsProcessed++;
				} catch (error) {
					operation.status = 'failed';
					operation.error = error instanceof Error ? error.message : 'Erro desconhecido';
				}
			}

			const failedOperations = operations.filter(op => op.status === 'failed');

			return {
				success: failedOperations.length === 0,
				message: `${operationsProcessed} arquivos enviados com sucesso`,
				operationsProcessed,
				conflicts: failedOperations.map(op => `${op.filePath}: ${op.error || 'Erro desconhecido'}`)
			};
		} catch (error) {
			console.error('[SecureSync] Erro ao enviar para a PastaBase:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Cliente ou Servidor: Baixa alterações do servidor
	 */
	async downloadFromServer(): Promise<SyncResult> {
		try {
			console.log('[SecureSync] Baixando alterações da PastaBase...');

			// Obter lista de arquivos do servidor
			const serverFiles = await this.getServerFileList();
			const localFiles = await this.getLocalFileList();

			const operations: SyncOperation[] = [];
			let operationsProcessed = 0;

			// Identificar arquivos para baixar/atualizar
			for (const serverFile of serverFiles) {
				const localFile = localFiles.find(f => f.path === serverFile.path);

				console.log(`[SecureSync] Verificando arquivo: ${serverFile.path}`);
				console.log(`[SecureSync] - Servidor mtime: ${new Date(serverFile.mtime).toISOString()} (${serverFile.mtime})`);
				console.log(`[SecureSync] - Local ${localFile ? 'mtime: ' + new Date(localFile.mtime).toISOString() + ` (${localFile.mtime})` : 'não existe'}`);

				if (!localFile) {
					console.log(`[SecureSync] - Arquivo não existe localmente, será baixado (CREATE)`);
					operations.push({
						id: `download-${serverFile.path}`,
						deviceId: this.deviceId,
						filePath: serverFile.path,
						operation: 'create',
						timestamp: Date.now(),
						status: 'pending'
					});
				} else {
					const timeDiff = serverFile.mtime - localFile.mtime;
					const toleranceMs = 2000; // 2 segundos de tolerância para problemas de precisão de timestamp

					console.log(`[SecureSync] - Diferença de tempo: ${timeDiff}ms (servidor - local)`);

					if (Math.abs(timeDiff) <= toleranceMs) {
						console.log(`[SecureSync] - Arquivos considerados idênticos (dentro da tolerância de ${toleranceMs}ms), ignorando`);
					} else if (timeDiff > toleranceMs) {
						console.log(`[SecureSync] - Servidor é ${timeDiff}ms mais recente, será atualizado (UPDATE)`);
						console.log(`[SecureSync] - Diferença em segundos: ${(timeDiff / 1000).toFixed(2)}s`);
						operations.push({
							id: `download-${serverFile.path}`,
							deviceId: this.deviceId,
							filePath: serverFile.path,
							operation: 'update',
							timestamp: Date.now(),
							status: 'pending'
						});
					} else {
						console.log(`[SecureSync] - Local é ${Math.abs(timeDiff)}ms mais recente, ignorando`);
					}
				}
			}

			// Identificar arquivos locais que não existem no servidor
			// IMPORTANTE: Não deletar arquivos locais automaticamente, pois o servidor 
			// pode estar vazio ou o arquivo pode ser novo localmente e ainda não enviado.
			// Sem um banco de dados local (sync state), deletar arquivos ausentes é destrutivo.
			/*
			for (const localFile of localFiles) {
				const serverFile = serverFiles.find(f => f.path === localFile.path);

				if (!serverFile) {
					console.log(`[SecureSync] Arquivo local não existe no servidor. Aguardando Push: ${localFile.path}`);
				}
			}
			*/

			console.log(`[SecureSync] Resumo da sincronização:`);
			console.log(`[SecureSync] - Total de operações: ${operations.length}`);
			console.log(`[SecureSync] - Arquivos para criar: ${operations.filter(op => op.operation === 'create').length}`);
			console.log(`[SecureSync] - Arquivos para atualizar: ${operations.filter(op => op.operation === 'update').length}`);
			console.log(`[SecureSync] - Arquivos para deletar: ${operations.filter(op => op.operation === 'delete').length}`);

			if (operations.length === 0) {
				console.log(`[SecureSync] Nenhuma operação necessária - arquivos já sincronizados`);
				return {
					success: true,
					message: 'Todos os arquivos já estão sincronizados',
					operationsProcessed: 0
				};
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
			let targetPath = path.join(this.basePath, filePath);

			if (conflictCheck.hasConflict) {
				if (this.conflictResolution === 'skip') {
					console.warn(`[SecureSync] Conflito detectado em ${filePath}. Ignorando (skip).`);
					return { success: true, message: 'Ignorado devido a conflito' };
				} else if (this.conflictResolution === 'create-copy') {
					const ext = path.extname(filePath);
					const base = path.basename(filePath, ext);
					const dir = path.dirname(filePath);
					const conflictName = `${base}_conflito_${Date.now()}${ext}`;
					targetPath = path.join(this.basePath, dir, conflictName);
					console.warn(`[SecureSync] Conflito em ${filePath}. Criando cópia: ${conflictName}`);
				}
			}

			// Integrar alteração
			await this.atomicWrite(targetPath, content);

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

		switch (operation.operation) {
			case 'create':
			case 'update':
				// Ler do servidor
				const content = await fs.readFile(serverFilePath);

				// Escrever no vault do Obsidian usando a API oficial
				const abstractFile = this.app.vault.getAbstractFileByPath(operation.filePath);

				if (abstractFile instanceof TFile) {
					// Verificar conflitos
					const localContent = await this.app.vault.readBinary(abstractFile);
					const localHash = this.calculateHash(localContent);
					const serverHash = this.calculateHash(content);

					if (localHash !== serverHash) {
						if (this.conflictResolution === 'skip') {
							console.log(`[SecureSync] Conflito no download em ${operation.filePath}. Ignorando (skip).`);
							return;
						} else if (this.conflictResolution === 'create-copy') {
							const ext = path.extname(operation.filePath);
							const base = path.basename(operation.filePath, ext);
							const dir = path.dirname(operation.filePath);
							const conflictName = dir === '.' || dir === '' ? `${base}_conflito_${Date.now()}${ext}` : `${dir}/${base}_conflito_${Date.now()}${ext}`;
							
							console.log(`[SecureSync] Conflito no download em ${operation.filePath}. Criando cópia: ${conflictName}`);
							await this.ensureVaultFolders(conflictName);
							await this.app.vault.createBinary(conflictName, content);
							return;
						}
					}
					
					// Já existe, atualiza
					await this.app.vault.modifyBinary(abstractFile, content);
				} else {
					// Não existe, cria
					// Garantir que as pastas existam no vault
					await this.ensureVaultFolders(operation.filePath);
					await this.app.vault.createBinary(operation.filePath, content);
				}
				break;

			case 'delete':
				// Deletar arquivo local no vault
				const fileToDelete = this.app.vault.getAbstractFileByPath(operation.filePath);
				if (fileToDelete instanceof TFile) {
					await this.app.vault.trash(fileToDelete, true); // true para mover para lixeira de sistema, ou false para lixeira do Obsidian
				}
				break;
		}
	}

	/**
	 * Garante que a estrutura de pastas existe no Vault
	 */
	private async ensureVaultFolders(filePath: string): Promise<void> {
		// Substituir \ por / para compatibilidade com Obsidian
		const normalizedPath = filePath.replace(/\\/g, '/');
		const parts = normalizedPath.split('/');
		let currentPath = '';

		// Percorre todas as partes exceto o nome do arquivo
		for (let i = 0; i < parts.length - 1; i++) {
			const part = parts[i];
			if (!part) continue;
			
			currentPath = currentPath === '' ? part : `${currentPath}/${part}`;
			const folder = this.app.vault.getAbstractFileByPath(currentPath);

			if (!folder) {
				await this.app.vault.createFolder(currentPath);
			}
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
				const entryRelativePath = path.join(relativePath, entry.name).replace(/\\/g, '/');

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
	 * Obtém lista de arquivos locais do Vault
	 */
	private async getLocalFileList(): Promise<Array<{ path: string; mtime: number; size: number }>> {
		const files: Array<{ path: string; mtime: number; size: number }> = [];
		const vaultFiles = this.app.vault.getFiles();

		for (const file of vaultFiles) {
			if (file.path.startsWith('.')) continue; // Ignorar arquivos de sistema

			files.push({
				path: file.path,
				mtime: file.stat.mtime,
				size: file.stat.size
			});
		}

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
			console.log(`[SecureSync] atomicWrite - Iniciando salvamento: ${filePath}`);
			console.log(`[SecureSync] atomicWrite - Arquivo temporário: ${tempPath}`);
			console.log(`[SecureSync] atomicWrite - Tipo de conteúdo: ${typeof content}`);
			console.log(`[SecureSync] atomicWrite - Tamanho do conteúdo: ${content instanceof ArrayBuffer ? content.byteLength : content.length} bytes`);

			// Verificar se diretório existe
			const dir = path.dirname(filePath);
			console.log(`[SecureSync] atomicWrite - Verificando diretório: ${dir}`);

			try {
				await fs.access(dir);
				console.log(`[SecureSync] atomicWrite - Diretório existe`);
			} catch (error) {
				console.log(`[SecureSync] atomicWrite - Diretório não existe, criando...`);
				await fs.mkdir(dir, { recursive: true });
				console.log(`[SecureSync] atomicWrite - Diretório criado`);
			}

			// Converter ArrayBuffer para Uint8Array se necessário
			const writeContent = content instanceof ArrayBuffer
				? new Uint8Array(content)
				: content;

			console.log(`[SecureSync] atomicWrite - Escrevendo arquivo temporário...`);
			await fs.writeFile(tempPath, writeContent);
			console.log(`[SecureSync] atomicWrite - Arquivo temporário escrito com sucesso`);

			console.log(`[SecureSync] atomicWrite - Renomeando para arquivo final...`);
			await fs.rename(tempPath, filePath);
			console.log(`[SecureSync] atomicWrite - Arquivo salvo com sucesso: ${filePath}`);

			// Verificar se arquivo realmente foi salvo
			try {
				const stats = await fs.stat(filePath);
				console.log(`[SecureSync] atomicWrite - Verificação: arquivo existe, tamanho: ${stats.size} bytes`);
			} catch (error) {
				console.error(`[SecureSync] atomicWrite - ERRO: arquivo não foi salvo corretamente:`, error);
				throw error;
			}

		} catch (error) {
			console.error(`[SecureSync] atomicWrite - Erro ao salvar arquivo ${filePath}:`, error);

			// Limpar arquivo temporário em caso de erro
			try {
				await fs.unlink(tempPath);
				console.log(`[SecureSync] atomicWrite - Arquivo temporário removido`);
			} catch {
				console.log(`[SecureSync] atomicWrite - Não foi possível remover arquivo temporário`);
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

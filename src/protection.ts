import * as fs from 'fs/promises';
import * as path from 'path';
import { Notice } from 'obsidian';

export interface DeviceInfo {
	id: string;
	name: string;
	lastSync: number;
	status: 'online' | 'offline';
	vaultPath: string;
	firstSeen: number;
}

export interface SyncRequest {
	deviceId: string;
	filePath: string;
	operation: 'create' | 'update' | 'delete';
	timestamp: number;
	checksum?: string;
}

export interface ProtectionResult {
	success: boolean;
	error?: string;
	message?: string;
}

/**
 * Gerenciador de proteção da PastaBase
 * Controla acesso e autorizações para dispositivos clientes
 */
export class SyncProtectionManager {
	private basePath: string;
	private protectionPath: string;
	private devicesPath: string;
	private locksPath: string;
	private auditLogPath: string;

	constructor(basePath: string) {
		this.basePath = basePath;
		this.protectionPath = path.join(basePath, '.sync-protection');
		this.devicesPath = path.join(this.protectionPath, '.authorized-devices');
		this.locksPath = path.join(this.protectionPath, '.operation-locks');
		this.auditLogPath = path.join(this.protectionPath, '.sync-audit.log');
	}

	/**
	 * Inicializa o sistema de proteção
	 */
	async initializeProtection(): Promise<ProtectionResult> {
		try {
			console.log('[SyncProtection] Inicializando sistema de proteção...');

			// Criar diretórios de proteção
			await fs.mkdir(this.protectionPath, { recursive: true });
			await fs.mkdir(this.locksPath, { recursive: true });

			// Criar flag de proteção
			const protectionFlag = path.join(this.protectionPath, '.read-only-flag');
			await fs.writeFile(protectionFlag, 'PROTECTION_ENABLED', 'utf8');

			// Inicializar arquivo de dispositivos autorizados
			await this.initializeDevicesFile();

			// Inicializar arquivo de auditoria
			await this.logOperation('SYSTEM', 'PROTECTION_INITIALIZED', 'Sistema de proteção ativado');

			console.log('[SyncProtection] Sistema de proteção inicializado com sucesso');
			return {
				success: true,
				message: 'Sistema de proteção ativado com sucesso'
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao inicializar proteção:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Autoriza um novo dispositivo
	 */
	async authorizeDevice(deviceInfo: DeviceInfo): Promise<ProtectionResult> {
		try {
			console.log(`[SyncProtection] Autorizando dispositivo: ${deviceInfo.id}`);

			// Verificar se proteção está ativa
			const protectionActive = await this.isProtectionActive();
			if (!protectionActive) {
				return {
					success: false,
					error: 'Sistema de proteção não está ativo'
				};
			}

			// Carregar dispositivos existentes
			const devices = await this.loadAuthorizedDevices();
			
			// Verificar se dispositivo já existe
			if (devices[deviceInfo.id]) {
				// Atualizar dispositivo existente
				devices[deviceInfo.id] = {
					...devices[deviceInfo.id],
					...deviceInfo,
					lastSync: Date.now()
				};
			} else {
				// Adicionar novo dispositivo
				devices[deviceInfo.id] = {
					...deviceInfo,
					firstSeen: Date.now(),
					lastSync: Date.now()
				};
			}

			// Salvar lista atualizada
			await this.saveAuthorizedDevices(devices);

			// Log da operação
			await this.logOperation(deviceInfo.id, 'DEVICE_AUTHORIZED', `Dispositivo ${deviceInfo.name} autorizado`);

			console.log(`[SyncProtection] Dispositivo ${deviceInfo.id} autorizado com sucesso`);
			return {
				success: true,
				message: `Dispositivo ${deviceInfo.name} autorizado`
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao autorizar dispositivo:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Valida se um dispositivo tem permissão de escrita
	 */
	async validateWriteAccess(deviceId: string, filePath: string): Promise<boolean> {
		try {
			// Verificar se proteção está ativa
			const protectionActive = await this.isProtectionActive();
			if (!protectionActive) {
				console.warn('[SyncProtection] Proteção não está ativa, acesso negado por segurança');
				return false;
			}

			// Verificar se dispositivo está autorizado
			const devices = await this.loadAuthorizedDevices();
			const device = devices[deviceId];

			if (!device) {
				console.warn(`[SyncProtection] Dispositivo ${deviceId} não autorizado`);
				await this.logOperation(deviceId, 'ACCESS_DENIED', `Dispositivo não autorizado para ${filePath}`);
				return false;
			}

			// Verificar se dispositivo está online (timeout de 5 minutos)
			const now = Date.now();
			const timeout = 5 * 60 * 1000; // 5 minutos
			if (now - device.lastSync > timeout) {
				console.warn(`[SyncProtection] Dispositivo ${deviceId} offline`);
				device.status = 'offline';
				await this.saveAuthorizedDevices(devices);
				return false;
			}

			// Verificar se não há lock no arquivo
			const lockExists = await this.checkFileLock(filePath);
			if (lockExists) {
				console.warn(`[SyncProtection] Arquivo ${filePath} está bloqueado`);
				return false;
			}

			// Atualizar status do dispositivo
			device.status = 'online';
			device.lastSync = now;
			await this.saveAuthorizedDevices(devices);

			return true;
		} catch (error) {
			console.error('[SyncProtection] Erro ao validar acesso:', error);
			return false;
		}
	}

	/**
	 * Cria um lock para operação em arquivo
	 */
	async createLock(filePath: string, deviceId: string): Promise<ProtectionResult> {
		try {
			const lockFile = path.join(this.locksPath, `${path.basename(filePath)}.lock`);
			const lockData = {
				deviceId,
				filePath,
				timestamp: Date.now()
			};

			await fs.writeFile(lockFile, JSON.stringify(lockData, null, 2), 'utf8');

			await this.logOperation(deviceId, 'LOCK_CREATED', `Lock criado para ${filePath}`);

			return {
				success: true,
				message: 'Lock criado com sucesso'
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao criar lock:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Libera um lock de arquivo
	 */
	async releaseLock(filePath: string, deviceId: string): Promise<ProtectionResult> {
		try {
			const lockFile = path.join(this.locksPath, `${path.basename(filePath)}.lock`);

			// Verificar se lock existe e pertence ao dispositivo
			try {
				const lockContent = await fs.readFile(lockFile, 'utf8');
				const lockData = JSON.parse(lockContent);

				if (lockData.deviceId !== deviceId) {
					return {
						success: false,
						error: 'Lock pertence a outro dispositivo'
					};
				}
			} catch (error) {
				// Lock não existe ou está corrompido
				console.warn('[SyncProtection] Lock não encontrado ou corrompido');
			}

			await fs.unlink(lockFile);

			await this.logOperation(deviceId, 'LOCK_RELEASED', `Lock liberado para ${filePath}`);

			return {
				success: true,
				message: 'Lock liberado com sucesso'
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao liberar lock:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Verifica se existe lock para um arquivo
	 */
	private async checkFileLock(filePath: string): Promise<boolean> {
		try {
			const lockFile = path.join(this.locksPath, `${path.basename(filePath)}.lock`);
			await fs.access(lockFile);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Verifica se proteção está ativa
	 */
	async isProtectionActive(): Promise<boolean> {
		try {
			const protectionFlag = path.join(this.protectionPath, '.read-only-flag');
			await fs.access(protectionFlag);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Lista dispositivos autorizados
	 */
	async getAuthorizedDevices(): Promise<DeviceInfo[]> {
		try {
			const devices = await this.loadAuthorizedDevices();
			return Object.values(devices);
		} catch (error) {
			console.error('[SyncProtection] Erro ao listar dispositivos:', error);
			return [];
		}
	}

	/**
	 * Remove autorização de um dispositivo
	 */
	async revokeDeviceAuthorization(deviceId: string): Promise<ProtectionResult> {
		try {
			const devices = await this.loadAuthorizedDevices();
			
			if (!devices[deviceId]) {
				return {
					success: false,
					error: 'Dispositivo não encontrado'
				};
			}

			const deviceName = devices[deviceId].name;
			delete devices[deviceId];

			await this.saveAuthorizedDevices(devices);
			await this.logOperation(deviceId, 'DEVICE_REVOKED', `Autorização revogada para ${deviceName}`);

			return {
				success: true,
				message: `Autorização de ${deviceName} revogada`
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao revogar autorização:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Inicializa arquivo de dispositivos autorizados
	 */
	private async initializeDevicesFile(): Promise<void> {
		try {
			await fs.access(this.devicesPath);
		} catch {
			// Arquivo não existe, criar vazio
			await fs.writeFile(this.devicesPath, JSON.stringify({}, null, 2), 'utf8');
		}
	}

	/**
	 * Carrega dispositivos autorizados
	 */
	private async loadAuthorizedDevices(): Promise<Record<string, DeviceInfo>> {
		try {
			const content = await fs.readFile(this.devicesPath, 'utf8');
			return JSON.parse(content);
		} catch (error) {
			console.warn('[SyncProtection] Erro ao carregar dispositivos, usando lista vazia');
			return {};
		}
	}

	/**
	 * Salva dispositivos autorizados
	 */
	private async saveAuthorizedDevices(devices: Record<string, DeviceInfo>): Promise<void> {
		await fs.writeFile(this.devicesPath, JSON.stringify(devices, null, 2), 'utf8');
	}

	/**
	 * Registra operação no log de auditoria
	 */
	private async logOperation(deviceId: string, operation: string, details: string): Promise<void> {
		try {
			const timestamp = new Date().toISOString();
			const logEntry = `[${timestamp}] ${deviceId}: ${operation} - ${details}\n`;
			
			await fs.appendFile(this.auditLogPath, logEntry, 'utf8');
		} catch (error) {
			console.error('[SyncProtection] Erro ao registrar operação:', error);
		}
	}

	/**
	 * Obtém estatísticas do sistema de proteção
	 */
	async getProtectionStats(): Promise<{
		totalDevices: number;
		onlineDevices: number;
		activeLocks: number;
		protectionActive: boolean;
	}> {
		try {
			const devices = await this.loadAuthorizedDevices();
			const onlineDevices = Object.values(devices).filter(d => d.status === 'online').length;
			
			// Contar locks ativos
			const lockFiles = await fs.readdir(this.locksPath);
			const activeLocks = lockFiles.filter(file => file.endsWith('.lock')).length;

			return {
				totalDevices: Object.keys(devices).length,
				onlineDevices,
				activeLocks,
				protectionActive: await this.isProtectionActive()
			};
		} catch (error) {
			console.error('[SyncProtection] Erro ao obter estatísticas:', error);
			return {
				totalDevices: 0,
				onlineDevices: 0,
				activeLocks: 0,
				protectionActive: false
			};
		}
	}
}

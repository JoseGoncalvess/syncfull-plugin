import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SyncFullSettingTab } from "./settings";
import { SyncProtectionManager, DeviceInfo, ProtectionResult } from "./protection";
import { SecureSyncManager, SyncResult, FileChange } from "./secureSync";

// Interface para eventos de ficheiro na fila de sincronização
interface FileChangeEvent {
	file: TFile | null;
	path: string;
	type: 'modify' | 'create' | 'delete';
	timestamp: number;
}

export default class SyncFullPlugin extends Plugin {
	settings: MyPluginSettings;

	// Propriedades para monitorização e sincronização
	private syncQueue: FileChangeEvent[] = [];
	private debounceTimer: NodeJS.Timeout | null = null;
	private debounceDelay: number = 2500; // 2.5 segundos de debounce
	private pollingTimer: NodeJS.Timeout | null = null;
	private statusBarItemEl: HTMLElement | null = null;

	// Novos gerenciadores do modelo protegido
	private protectionManager: SyncProtectionManager | null = null;
	private secureSyncManager: SecureSyncManager | null = null;
	private isServer: boolean = false;
	private deviceId: string = '';

	// Propriedades mobile
	private isMobileDevice: boolean = false;
	private isOnMobileData: boolean = false;
	private monthlyDataUsage: number = 0; // MB
	private startTime: number = 0; // Timestamp de inicialização
	private initializationGracePeriod: number = 10000; // 10 segundos para ignorar eventos iniciais

	async onload() {
		this.startTime = Date.now();
		console.log(`[SyncFull] Plugin inicializado em: ${new Date(this.startTime).toISOString()}`);

		await this.loadSettings();

		// Gerar ID do dispositivo se não existir
		await this.generateDeviceId();

		// Detectar dispositivo móvel e conexão
		this.initializeMobileDetection();

		// Inicializar o modo servidor/cliente
		await this.initializeProtectedMode();

		// Adicionar item na status bar para feedback visual
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar('connected');

		// Registrar eventos de monitorização do vault
		this.registerVaultEvents();

		// Comando para Enviar Tudo (Push)
		this.addCommand({
			id: 'syncfull-push',
			name: 'SyncFull: Enviar tudo para a PastaBase (Upload)',
			callback: async () => {
				await this.pushToServer();
			}
		});

		// Comando para Baixar Tudo (Pull)
		this.addCommand({
			id: 'syncfull-pull',
			name: 'SyncFull: Baixar tudo da PastaBase (Download)',
			callback: async () => {
				await this.pullFromServer();
			}
		});

		// Comando para Testar Servidor
		this.addCommand({
			id: 'test-server',
			name: 'Testar Configuração do Servidor',
			callback: async () => {
				await this.testServerConfiguration();
			}
		});

		// Comando para Testar Conexão
		this.addCommand({
			id: 'test-connection',
			name: 'Testar Conexão com Servidor',
			callback: async () => {
				await this.testServerConnection();
			}
		});

		// Adicionar aba de configurações
		this.addSettingTab(new SyncFullSettingTab(this.app, this));

		// Iniciar polling se configurado
		this.startAutoSync();
	}

	async onunload() {
		// Limpar timer de debounce
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
		}

		// Remover status bar item
		if (this.statusBarItemEl) {
			this.statusBarItemEl.remove();
		}
	}

	/**
	 * Gera ID único do dispositivo se não existir
	 */
	private async generateDeviceId(): Promise<void> {
		if (!this.settings.deviceId || this.settings.deviceId.trim() === '') {
			// Gerar ID baseado em timestamp e informações do sistema
			const timestamp = Date.now();
			const random = Math.random().toString(36).substr(2, 9);
			this.settings.deviceId = `device_${timestamp}_${random}`;

			// Gerar nome amigável se não existir
			if (!this.settings.deviceName || this.settings.deviceName.trim() === '') {
				const platform = navigator.platform || 'Unknown';
				const userAgent = navigator.userAgent.split(' ').pop() || 'Device';
				this.settings.deviceName = `${platform}-${userAgent.substring(0, 20)}`;
			}

			console.log(`[SyncFull] Dispositivo registrado: ${this.settings.deviceId} (${this.settings.deviceName})`);
		}

		this.deviceId = this.settings.deviceId;
	}

	/**
	 * Inicializa o modo protegido (servidor/cliente)
	 */
	private async initializeProtectedMode(): Promise<void> {
		try {
			this.isServer = this.settings.isServer;

			if (this.isServer) {
				// Modo Servidor
				await this.initializeServer();
			} else {
				// Modo Cliente
				await this.initializeClient();
			}
		} catch (error) {
			console.error('[SyncFull] Erro ao inicializar modo protegido:', error);
			if (this.settings.enableNotifications) new Notice('❌ Erro ao inicializar modo protegido');
		}
	}

	/**
	 * Inicializa modo servidor
	 */
	private async initializeServer(): Promise<void> {
		if (!this.settings.serverPath || this.settings.serverPath.trim() === '') {
			console.log('[SyncFull] Servidor: Caminho da PastaBase não configurado');
			this.updateStatusBar('error');
			return;
		}

		try {
			// Inicializar SyncProtectionManager
			this.protectionManager = new SyncProtectionManager(this.settings.serverPath);

			// Ativar proteção se configurado
			if (this.settings.enableProtection) {
				const protectionResult = await this.protectionManager.initializeProtection();
				if (!protectionResult.success) {
					throw new Error(protectionResult.error);
				}
			}

			// Inicializar SecureSyncManager
			this.secureSyncManager = new SecureSyncManager(
				this.app,
				this.protectionManager,
				this.deviceId,
				true, // isServer
				this.settings.serverPath,
				'',
				this.settings.conflictResolution
			);

			// Autorizar este dispositivo (servidor)
			const deviceInfo: DeviceInfo = {
				id: this.deviceId,
				name: this.settings.deviceName || 'Servidor',
				lastSync: Date.now(),
				status: 'online',
				vaultPath: this.settings.serverPath,
				firstSeen: Date.now()
			};

			await this.protectionManager.authorizeDevice(deviceInfo);

			console.log('[SyncFull] Servidor inicializado com sucesso');
			this.updateStatusBar('server');
			if (this.settings.enableNotifications) new Notice('✅ Servidor SyncFull inicializado');

		} catch (error) {
			console.error('[SyncFull] Erro ao inicializar servidor:', error);
			this.updateStatusBar('error');
			if (this.settings.enableNotifications) new Notice('❌ Erro ao inicializar servidor');
		}
	}

	/**
	 * Inicializa modo cliente
	 */
	private async initializeClient(): Promise<void> {
		if (!this.settings.serverAddress || this.settings.serverAddress.trim() === '') {
			console.log('[SyncFull] Cliente: Endereço do servidor não configurado');
			this.updateStatusBar('error');
			return;
		}

		if (!this.settings.clientPath || this.settings.clientPath.trim() === '') {
			console.log('[SyncFull] Cliente: Pasta local não configurada');
			this.updateStatusBar('error');
			return;
		}

		try {
			// Inicializar SyncProtectionManager (para validação)
			this.protectionManager = new SyncProtectionManager(this.settings.serverAddress);

			// Inicializar SecureSyncManager
			this.secureSyncManager = new SecureSyncManager(
				this.app,
				this.protectionManager,
				this.deviceId,
				false, // isServer
				this.settings.serverAddress,
				this.settings.clientPath,
				this.settings.conflictResolution
			);

			console.log('[SyncFull] Cliente inicializado com sucesso');
			this.updateStatusBar('client');
			if (this.settings.enableNotifications) new Notice('✅ Cliente SyncFull inicializado');

		} catch (error) {
			console.error('[SyncFull] Erro ao inicializar cliente:', error);
			this.updateStatusBar('error');
			if (this.settings.enableNotifications) new Notice('❌ Erro ao inicializar cliente');
		}
	}

	/**
	 * Testa configuração do servidor
	 */
	async testServerConfiguration(): Promise<ProtectionResult> {
		if (!this.isServer) {
			return {
				success: false,
				error: 'Este dispositivo não está configurado como servidor'
			};
		}

		if (!this.settings.serverPath || this.settings.serverPath.trim() === '') {
			return {
				success: false,
				error: 'Caminho da PastaBase não configurado'
			};
		}

		if (!this.protectionManager) {
			return {
				success: false,
				error: 'Gerenciador de proteção não inicializado'
			};
		}

		try {
			// Verificar se proteção está ativa
			const isProtectionActive = await this.protectionManager.isProtectionActive();

			// Obter estatísticas do sistema
			const stats = await this.protectionManager.getProtectionStats();

			// Listar dispositivos autorizados
			const devices = await this.protectionManager.getAuthorizedDevices();

			return {
				success: true,
				message: `Servidor OK - Proteção: ${isProtectionActive ? 'Ativa' : 'Inativa'}, Dispositivos: ${stats.totalDevices}, Locks: ${stats.activeLocks}`
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Testa conexão com o servidor
	 */
	async testServerConnection(): Promise<ProtectionResult> {
		if (this.isServer) {
			return {
				success: false,
				error: 'Este dispositivo é o servidor, não um cliente'
			};
		}

		if (!this.settings.serverAddress || this.settings.serverAddress.trim() === '') {
			return {
				success: false,
				error: 'Endereço do servidor não configurado'
			};
		}

		if (!this.protectionManager) {
			return {
				success: false,
				error: 'Gerenciador de proteção não inicializado'
			};
		}

		try {
			// Verificar se consegue acessar o servidor
			const isProtectionActive = await this.protectionManager.isProtectionActive();

			if (!isProtectionActive) {
				return {
					success: false,
					error: 'Servidor não está com proteção ativa'
				};
			}

			// Verificar se este dispositivo está autorizado
			const devices = await this.protectionManager.getAuthorizedDevices();
			const isAuthorized = devices.some(device => device.id === this.deviceId);

			return {
				success: true,
				message: `Conexão OK - Servidor acessível, Dispositivo ${isAuthorized ? 'autorizado' : 'não autorizado'}`
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Erro desconhecido'
			};
		}
	}

	/**
	 * Detecta dispositivo móvel e conexão
	 */
	private initializeMobileDetection(): void {
		// Detectar se é dispositivo móvel
		const userAgent = navigator.userAgent.toLowerCase();
		this.isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);

		// Detectar conexão de dados móveis (simplificado)
		this.isOnMobileData = this.isMobileDevice && !navigator.onLine;

		console.log(`[SyncFull] Dispositivo: ${this.isMobileDevice ? 'Móvel' : 'Desktop'}`);
		console.log(`[SyncFull] Conexão: ${this.isOnMobileData ? 'Dados móveis' : 'WiFi/Ethernet'}`);
	}

	/**
	 * Registra os eventos de monitorização do vault
	 */
	private registerVaultEvents() {
		// Evento para quando um ficheiro é modificado
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, file.path, 'modify');
				}
			})
		);

		// Evento para quando um ficheiro é criado
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, file.path, 'create');
				}
			})
		);

		// Evento para quando um ficheiro é eliminado
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, file.path, 'delete');
				}
			})
		);

		// Evento para quando um ficheiro é renomeado
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					// Trata o arquivo antigo como deletado e o novo como criado
					this.handleFileChange(null, oldPath, 'delete');
					this.handleFileChange(file, file.path, 'create');
				}
			})
		);
	}

	/**
	 * Verifica se o ficheiro deve ser processado
	 */
	private shouldProcessFile(file: TFile): boolean {
		// Sincronizar todos os ficheiros, exceto ficheiros de sistema ocultos
		return !file.path.startsWith('.');
	}

	/**
	 * Processa alterações de ficheiros com sistema de debounce
	 */
	private handleFileChange(file: TFile | null, filePath: string, type: 'modify' | 'create' | 'delete') {
		const currentTime = Date.now();
		const timeSinceInit = currentTime - this.startTime;

		console.log(`[SyncFull] Ficheiro ${type}: ${filePath}`);
		console.log(`[SyncFull] Timestamp atual: ${new Date(currentTime).toISOString()}`);
		console.log(`[SyncFull] Tempo desde inicialização: ${timeSinceInit}ms`);

		// Ignorar eventos durante o período de graça (inicialização)
		if (timeSinceInit < this.initializationGracePeriod) {
			console.log(`[SyncFull] IGNORANDO evento - dentro do período de graça (${this.initializationGracePeriod}ms)`);
			return;
		}

		console.log(`[SyncFull] Processando evento - fora do período de graça`);

		// Adicionar à fila de sincronização
		const changeEvent: FileChangeEvent = {
			file,
			path: filePath,
			type,
			timestamp: currentTime
		};

		this.syncQueue.push(changeEvent);

		// Limpar timer anterior
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		// Configurar novo timer
		this.debounceTimer = setTimeout(() => {
			console.log(`[SyncFull] Processando fila de sincronização com ${this.syncQueue.length} itens`);
			this.processSyncQueue();
		}, this.debounceDelay);

		// Atualizar status bar
		this.updateStatusBar('syncing');
	}

	/**
	 * Processa a fila de sincronização
	 */
	private async processSyncQueue() {
		if (this.syncQueue.length === 0) {
			this.updateStatusBar('connected');
			return;
		}

		console.log(`[SyncFull] Processando ${this.syncQueue.length} alterações...`);

		// Agrupar alterações por ficheiro (manter apenas a mais recente)
		const latestChanges = new Map<string, FileChangeEvent>();

		for (const change of this.syncQueue) {
			const key = change.path;
			if (!latestChanges.has(key) || latestChanges.get(key)!.timestamp < change.timestamp) {
				latestChanges.set(key, change);
			}
		}

		// Processar cada alteração única usando o novo modelo protegido
		for (const [filePath, change] of latestChanges) {
			try {
				await this.syncFileProtected(change);
				console.log(`[SyncFull] Sincronizado: ${filePath} (${change.type})`);
			} catch (error) {
				console.error(`[SyncFull] Erro ao sincronizar ${filePath}:`, error);
				const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
				if (this.settings.enableNotifications) new Notice(`Erro ao sincronizar ${filePath}: ${errorMessage}`);
			}
		}

		// Limpar fila e atualizar status
		this.syncQueue = [];
		this.updateStatusBar('connected');
	}

	/**
	 * Sincroniza um ficheiro usando o modelo protegido
	 */
	private async syncFileProtected(change: FileChangeEvent): Promise<void> {
		if (!this.secureSyncManager) {
			throw new Error('SecureSyncManager não inicializado');
		}

		if (change.type === 'delete') {
			// Para deleção, usar o fluxo de deleção segura
			console.log(`[SyncFull] Deleção de arquivo: ${change.path}`);

			if (this.isServer) {
				// Servidor: deletar arquivo localmente na PastaBase
				console.log(`[SyncFull] Servidor - Deletando arquivo localmente: ${change.path}`);

				try {
					const result = await this.secureSyncManager!.deleteFileLocally(change.path);

					if (!result.success) {
						throw new Error(result.error || 'Erro ao deletar arquivo no servidor');
					}

					console.log(`[SyncFull] Servidor - Arquivo deletado com sucesso: ${change.path}`);
				} catch (error) {
					console.error(`[SyncFull] Servidor - Erro ao deletar arquivo:`, error);
					throw error;
				}
			} else {
				// Cliente: solicitar deleção no servidor
				const result = await this.secureSyncManager.deleteFileFromServer(change.path);

				if (!result.success) {
					throw new Error(result.error || 'Erro ao deletar arquivo no servidor');
				}
			}
		} else {
			if (!change.file) return;

			// Ler conteúdo do arquivo
			const isBinaryFile = this.isBinaryFile(change.path);
			let content: string | ArrayBuffer;

			if (isBinaryFile) {
				content = await this.app.vault.readBinary(change.file);
			} else {
				content = await this.app.vault.read(change.file);
			}

			if (this.isServer) {
				// Servidor: valida e integra alteração
				console.log(`[SyncFull] Servidor recebendo alteração: ${change.path}`);

				// Salvar arquivo na PastaBase do servidor
				const serverFilePath = `${change.path}`;
				console.log(`[SyncFull] Servidor - Salvando arquivo em: ${serverFilePath}`);

				try {
					const result = await this.secureSyncManager!.validateAndIntegrate(
						serverFilePath,
						content,
						this.deviceId
					);

					if (!result.success) {
						throw new Error(result.error || 'Erro ao integrar alteração no servidor');
					}

					console.log(`[SyncFull] Servidor - Arquivo integrado com sucesso: ${change.path}`);
				} catch (error) {
					console.error(`[SyncFull] Servidor - Erro ao integrar alteração:`, error);
					throw error;
				}
			} else {
				// Cliente: envia para servidor
				const result = await this.secureSyncManager.syncFileToServer(
					change.path,
					content
				);

				if (!result.success) {
					throw new Error(result.error || 'Erro ao sincronizar com servidor');
				}
			}
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

	/**
	 * Faz o upload de todo o Vault para o servidor
	 */
	async pushToServer(): Promise<void> {
		console.log('[SyncFull] pushToServer() chamado');

		if (!this.secureSyncManager) {
			console.error('[SyncFull] SecureSyncManager não inicializado');
			if (this.settings.enableNotifications) new Notice('❌ SyncFull: Sistema de sincronização não inicializado');
			return;
		}

		try {
			if (this.settings.enableNotifications) new Notice('📤 Enviando arquivos para o servidor...');
			const result = await this.secureSyncManager.uploadToServer();

			if (result.success) {
				if (this.settings.enableNotifications) new Notice(`✅ ${result.message}`);
			} else {
				if (this.settings.enableNotifications) new Notice(`❌ Erro no upload: ${result.error}`);
			}
		} catch (error) {
			console.error('[SyncFull] Erro no upload:', error);
			if (this.settings.enableNotifications) new Notice('❌ Erro inesperado ao enviar para o servidor');
		}
	}

	/**
	 * Inicia o polling de sincronização em background
	 */
	public startAutoSync(): void {
		if (this.pollingTimer) {
			clearInterval(this.pollingTimer);
			this.pollingTimer = null;
		}

		if (this.settings.autoSync && this.settings.syncInterval > 0) {
			console.log(`[SyncFull] Iniciando polling com intervalo de ${this.settings.syncInterval} segundos.`);
			this.pollingTimer = setInterval(async () => {
				// Só fazer pull se não tiver modificações locais na fila de espera pendentes
				if (this.syncQueue.length === 0) {
					await this.pullFromServer(true);
				}
			}, this.settings.syncInterval * 1000);
		}
	}

	/**
	 * Faz o download de tudo do servidor para o Vault
	 */
	async pullFromServer(silent: boolean = false): Promise<void> {
		if (!silent) console.log('[SyncFull] pullFromServer() chamado');

		if (!this.secureSyncManager) {
			if (!silent) console.error('[SyncFull] SecureSyncManager não inicializado');
			if (!silent && this.settings.enableNotifications) new Notice('❌ SyncFull: Sistema não inicializado');
			return;
		}

		try {
			if (!silent && this.settings.enableNotifications) new Notice('📥 Baixando alterações do servidor...');
			const result = await this.secureSyncManager.downloadFromServer();

			if (result.success) {
				// Apenas loga no silent mode se algo foi processado
				if (silent && result.operationsProcessed && result.operationsProcessed > 0) {
					console.log(`[SyncFull] Polling: ${result.message}`);
				}
				if (!silent && this.settings.enableNotifications) new Notice(`✅ ${result.message}`);
			} else {
				if (!silent && this.settings.enableNotifications) new Notice(`❌ Erro no download: ${result.error}`);
			}
		} catch (error) {
			console.error('[SyncFull] Erro no download:', error);
			if (!silent && this.settings.enableNotifications) new Notice('❌ Erro inesperado ao baixar do servidor');
		}
	}

	/**
	 * Atualiza o status bar com o estado atual
	 */
	private updateStatusBar(status: 'connected' | 'syncing' | 'error' | 'server' | 'client') {
		if (!this.statusBarItemEl) return;

		const statusIcons = {
			connected: '🟢',
			syncing: '🟡',
			error: '🔴',
			server: '🖥️',
			client: '📱'
		};

		const statusTexts = {
			connected: 'Conectado',
			syncing: 'Sincronizando...',
			error: 'Erro',
			server: 'Servidor',
			client: 'Cliente'
		};

		let statusText = `${statusIcons[status]} SyncFull - ${statusTexts[status]}`;

		// Adicionar informações mobile se aplicável
		if (this.isMobileDevice) {
			const connectionIcon = this.isOnMobileData ? '📶' : '📡';
			const dataUsage = this.isOnMobileData ? ` (${this.monthlyDataUsage.toFixed(1)}MB)` : '';
			statusText += ` ${connectionIcon}${dataUsage}`;
		}

		this.statusBarItemEl.setText(statusText);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

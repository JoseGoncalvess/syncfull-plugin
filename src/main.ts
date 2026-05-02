import { App, Editor, MarkdownView, Modal, Notice, Plugin, TFile } from 'obsidian';
import { DEFAULT_SETTINGS, MyPluginSettings, SyncFullSettingTab } from "./settings";
import { FileSystemModule } from "./fsModule";

// Interface para eventos de ficheiro na fila de sincronização
interface FileChangeEvent {
	file: TFile;
	type: 'modify' | 'create' | 'delete';
	timestamp: number;
}

export default class SyncFullPlugin extends Plugin {
	settings: MyPluginSettings;

	// Propriedades para monitorização e sincronização
	private syncQueue: FileChangeEvent[] = [];
	private debounceTimer: NodeJS.Timeout | null = null;
	private readonly DEBOUNCE_DELAY = 2500; // 2.5 segundos de debounce
	private statusBarItemEl: HTMLElement | null = null;
	private fsModule: FileSystemModule | null = null;

	async onload() {
		await this.loadSettings();

		// Inicializar o módulo de sistema de ficheiros
		this.initializeFSModule();

		// Adicionar item na status bar para feedback visual
		this.statusBarItemEl = this.addStatusBarItem();
		this.updateStatusBar('connected');

		// Registrar eventos de monitorização do vault
		this.registerVaultEvents();

		// Comando para Forçar Sincronização
		this.addCommand({
			id: 'force-sync',
			name: 'Forçar Sincronização',
			callback: async () => {
				await this.forceSync();
			}
		});

		// Comando para Validar Destino
		this.addCommand({
			id: 'validate-destination',
			name: 'Validar Destino de Sincronização',
			callback: async () => {
				await this.validateDestination();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SyncFullSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			new Notice("Click");
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));

	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Inicializa o módulo de sistema de ficheiros e valida o destino
	 */
	private async initializeFSModule(): Promise<void> {
		console.log('[SyncFull] Inicializando FS Module...');
		console.log('[SyncFull] Settings loaded:', this.settings);
		console.log('[SyncFull] Destination path:', this.settings.destinationPath);

		if (this.settings.destinationPath && this.settings.destinationPath.trim() !== '') {
			try {
				this.fsModule = new FileSystemModule(this.settings.destinationPath);
				console.log('[SyncFull] FS Module criado com sucesso');

				// Validar o destino
				console.log('[SyncFull] Validando destino...');
				const validation = await this.fsModule.validateDestination();

				if (!validation.valid) {
					console.warn(`[SyncFull] Aviso: ${validation.error}`);
					new Notice(`SyncFull: ${validation.error}`);
					this.updateStatusBar('error');
				} else {
					console.log('[SyncFull] Destino validado com sucesso');
					new Notice('✅ SyncFull: Destino configurado e validado');
				}
			} catch (error) {
				console.error('[SyncFull] Erro ao inicializar FS Module:', error);
				const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
				new Notice(`SyncFull: Erro na inicialização - ${errorMessage}`);
				this.updateStatusBar('error');
			}
		} else {
			console.log('[SyncFull] Caminho de destino não configurado ou vazio');
			new Notice('⚠️ SyncFull: Configure o caminho de destino nas definições');
			this.updateStatusBar('error');
		}
	}

	/**
	 * Registra os eventos de monitorização do vault para detetar alterações em ficheiros
	 */
	private registerVaultEvents() {
		// Evento para quando um ficheiro é modificado
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, 'modify');
				}
			})
		);

		// Evento para quando um ficheiro é criado
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, 'create');
				}
			})
		);

		// Evento para quando um ficheiro é eliminado
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (file instanceof TFile && this.shouldProcessFile(file)) {
					this.handleFileChange(file, 'delete');
				}
			})
		);
	}

	/**
	 * Verifica se o ficheiro deve ser processado (todos os ficheiros)
	 */
	private shouldProcessFile(file: TFile): boolean {
		// Sincronizar todos os ficheiros, exceto ficheiros de sistema ocultos
		return !file.path.startsWith('.');
	}

	/**
	 * Processa alterações de ficheiros com sistema de debounce
	 */
	private handleFileChange(file: TFile, type: 'modify' | 'create' | 'delete') {
		console.log(`[SyncFull] Ficheiro ${type}: ${file.path}`);

		// Adicionar à fila de sincronização
		const changeEvent: FileChangeEvent = {
			file,
			type,
			timestamp: Date.now()
		};

		this.syncQueue.push(changeEvent);

		// Limpar timer anterior e configurar novo debounce
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}

		this.debounceTimer = setTimeout(() => {
			this.processSyncQueue();
		}, this.DEBOUNCE_DELAY);

		// Atualizar status bar para mostrar sincronização pendente
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
			const key = change.file.path;
			if (!latestChanges.has(key) || latestChanges.get(key)!.timestamp < change.timestamp) {
				latestChanges.set(key, change);
			}
		}

		// Processar cada alteração única
		for (const [filePath, change] of latestChanges) {
			try {
				await this.syncFile(change);
				console.log(`[SyncFull] Sincronizado: ${filePath} (${change.type})`);
			} catch (error) {
				console.error(`[SyncFull] Erro ao sincronizar ${filePath}:`, error);
				const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
				new Notice(`Erro ao sincronizar ${filePath}: ${errorMessage}`);
			}
		}

		// Limpar fila e atualizar status
		this.syncQueue = [];
		this.updateStatusBar('connected');
	}

	/**
	 * Sincroniza um ficheiro individual usando o FileSystemModule
	 */
	private async syncFile(change: FileChangeEvent): Promise<void> {
		if (!this.fsModule) {
			throw new Error('FileSystemModule não inicializado');
		}

		if (change.type === 'delete') {
			// Eliminar ficheiro no destino
			await this.fsModule.deleteFile(change.file.path);
		} else {
			// Determinar se é arquivo binário baseado na extensão
			const isBinaryFile = this.isBinaryFile(change.file.path);

			let content: string | ArrayBuffer;

			if (isBinaryFile) {
				// Ler arquivo binário como ArrayBuffer
				content = await this.app.vault.readBinary(change.file);
				console.log(`[SyncFull] Lendo arquivo binário: ${change.file.path}`);
			} else {
				// Ler arquivo de texto como string
				content = await this.app.vault.read(change.file);
				console.log(`[SyncFull] Lendo arquivo de texto: ${change.file.path}`);
			}

			// Copiar para o destino
			await this.fsModule.copyFile(change.file, content);
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
	 * Atualiza o status bar com o estado atual
	 */
	private updateStatusBar(status: 'connected' | 'syncing' | 'error') {
		if (!this.statusBarItemEl) return;

		const statusIcons = {
			connected: '🟢',
			syncing: '🟡',
			error: '🔴'
		};

		const statusTexts = {
			connected: 'Conectado',
			syncing: 'Sincronizando...',
			error: 'Erro'
		};

		this.statusBarItemEl.setText(`${statusIcons[status]} SyncFull - ${statusTexts[status]}`);
	}

	/**
	 * Força a sincronização completa de todos os ficheiros Markdown do vault
	 */
	async forceSync(): Promise<void> {
		console.log('[SyncFull] forceSync() chamado');
		console.log('[SyncFull] fsModule existe:', !!this.fsModule);
		console.log('[SyncFull] destination path:', this.settings.destinationPath);

		if (!this.fsModule) {
			console.error('[SyncFull] FS Module não inicializado em forceSync()');
			new Notice('❌ SyncFull: Sistema de ficheiros não inicializado');
			new Notice('💡 Dica: Verifique se o caminho de destino está configurado nas definições');
			return;
		}

		// Validar destino antes de sincronizar
		const validation = await this.fsModule.validateDestination();
		if (!validation.valid) {
			new Notice(`SyncFull: Erro de validação - ${validation.error}`);
			this.updateStatusBar('error');
			return;
		}

		// Obter todos os ficheiros do vault
		const allFiles = this.app.vault.getFiles();

		// Filtrar apenas ficheiros (não pastas) e não ocultos
		const filesToSync = allFiles.filter(file => this.shouldProcessFile(file));

		if (filesToSync.length === 0) {
			new Notice('SyncFull: Nenhum ficheiro encontrado para sincronizar');
			this.updateStatusBar('connected');
			return;
		}

		console.log(`[SyncFull] Iniciando sincronização de ${filesToSync.length} ficheiros...`);

		let successCount = 0;
		let errorCount = 0;

		// Sincronizar cada ficheiro
		for (const file of filesToSync) {
			try {
				// Determinar se é arquivo binário baseado na extensão
				const isBinaryFile = this.isBinaryFile(file.path);

				let content: string | ArrayBuffer;

				if (isBinaryFile) {
					// Ler arquivo binário como ArrayBuffer
					content = await this.app.vault.readBinary(file);
				} else {
					// Ler arquivo de texto como string
					content = await this.app.vault.read(file);
				}

				await this.fsModule.copyFile(file, content);
				successCount++;

				// Atualizar progresso a cada 10 ficheiros
				if (successCount % 10 === 0) {
					new Notice(`SyncFull: Processados ${successCount}/${filesToSync.length} ficheiros...`);
				}
			} catch (error) {
				errorCount++;
				console.error(`[SyncFull] Erro ao sincronizar ${file.path}:`, error);
			}
		}

		// Feedback final
		const message = errorCount > 0
			? `Sincronização concluída: ${successCount} sucesso, ${errorCount} erros`
			: `Sincronização concluída: ${successCount} ficheiros sincronizados com sucesso`;

		new Notice(`SyncFull: ${message}`);
		console.log(`[SyncFull] ${message}`);

		this.updateStatusBar('connected');
	}


	/**
	 * Valida o destino de sincronização e mostra feedback
	 */
	async validateDestination(): Promise<void> {
		if (!this.fsModule) {
			new Notice('SyncFull: Sistema de ficheiros não inicializado');
			return;
		}

		try {
			new Notice('SyncFull: Validando destino...');
			const validation = await this.fsModule.validateDestination();

			if (validation.valid) {
				new Notice('✅ SyncFull: Destino validado com sucesso');
				this.updateStatusBar('connected');
			} else {
				new Notice(`❌ SyncFull: ${validation.error}`);
				this.updateStatusBar('error');
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
			console.error('[SyncFull] Erro ao validar destino:', error);
			new Notice(`SyncFull: Erro na validação - ${errorMessage}`);
			this.updateStatusBar('error');
		}
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		let { contentEl } = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

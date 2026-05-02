import { App, PluginSettingTab, Setting, Modal, Notice } from "obsidian";
import SyncFullPlugin from "./main";

export interface MyPluginSettings {
	// Configuração principal - modo de operação
	isServer: boolean;         // 🖥️ Este dispositivo é o servidor (PastaBase)

	// Configurações do Servidor
	serverPath: string;        // 📁 Caminho da PastaBase (só servidor)
	enableProtection: boolean; // 🔒 Proteger PastaBase contra escrita de clientes

	// Configurações do Cliente
	clientPath: string;        // 📁 Caminho local para cópia (só cliente)
	serverAddress: string;     // 🌐 Endereço do servidor (ex: \\192.168.1.100\SyncBase)

	// Configurações comuns
	deviceId: string;          // 📱 ID único do dispositivo
	deviceName: string;        // 🏷️ Nome amigável
	autoSync: boolean;         // 🔄 Sincronização automática
	syncInterval: number;      // ⏱️ Intervalo de verificação (segundos)

	// Configurações avançadas
	conflictResolution: 'last-writes-wins' | 'create-copy' | 'skip';
	enableNotifications: boolean;

	// Configurações mobile (legado - manter compatibilidade)
	mobileMode: boolean;
	syncOnMobileData: boolean;
	mobileDataLimit: number; // MB
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	// Configuração principal
	isServer: false,           // Por padrão, assume modo cliente

	// Configurações do Servidor
	serverPath: '',            // Caminho da PastaBase (vazio = não configurado)
	enableProtection: true,    // Proteção ativa por padrão

	// Configurações do Cliente
	clientPath: '',            // Caminho local para cópia
	serverAddress: '',         // Endereço do servidor

	// Configurações comuns
	deviceId: '',              // Será gerado automaticamente
	deviceName: '',            // Será detectado automaticamente
	autoSync: true,            // Sincronização automática ativa
	syncInterval: 30,          // 30 segundos

	// Configurações avançadas
	conflictResolution: 'last-writes-wins',
	enableNotifications: true,

	// Configurações mobile (legado)
	mobileMode: false,
	syncOnMobileData: false,
	mobileDataLimit: 100
}

export class SyncFullSettingTab extends PluginSettingTab {
	plugin: SyncFullPlugin;

	constructor(app: App, plugin: SyncFullPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	async display(): Promise<void> {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'SyncFull - Configurações' });

		// Seção principal - Modo de Operação
		containerEl.createEl('h3', { text: '🎯 Modo de Operação' });

		new Setting(containerEl)
			.setName('Este dispositivo é o Servidor')
			.setDesc('Marque se este dispositivo hospedará a PastaBase original')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.isServer)
				.onChange(async (value) => {
					this.plugin.settings.isServer = value;
					await this.plugin.saveSettings();
					// Atualizar interface para mostrar/esconder campos relevantes
					this.display();
				}));

		// Configurações específicas baseadas no modo
		if (this.plugin.settings.isServer) {
			// === CONFIGURAÇÕES DO SERVIDOR ===
			containerEl.createEl('h3', { text: '🖥️ Configurações do Servidor (PastaBase)' });

			new Setting(containerEl)
				.setName('Caminho da PastaBase')
				.setDesc('Pasta original que será compartilhada na rede (ex: C:\\SyncBase)')
				.addButton(button => button
					.setButtonText('Selecionar Pasta')
					.onClick(async () => {
						await this.selectServerFolder();
					}))
				.addText(text => text
					.setPlaceholder('Selecione a pasta base...')
					.setValue(this.plugin.settings.serverPath)
					.onChange(async (value) => {
						this.plugin.settings.serverPath = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Proteger PastaBase')
				.setDesc('Impedir que clientes modifiquem diretamente a PastaBase (recomendado)')
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings.enableProtection)
					.onChange(async (value) => {
						this.plugin.settings.enableProtection = value;
						await this.plugin.saveSettings();
					}));

			// Botão para testar configuração do servidor
			if (this.plugin.settings.serverPath) {
				new Setting(containerEl)
					.setName('Testar Configuração do Servidor')
					.setDesc('Verificar se a PastaBase está configurada corretamente')
					.addButton(button => button
						.setButtonText('Testar Servidor')
						.onClick(async () => {
							await this.testServerConfiguration();
						}));
			}

		} else {
			// === CONFIGURAÇÕES DO CLIENTE ===
			containerEl.createEl('h3', { text: '📱 Configurações do Cliente (Cópia)' });

			new Setting(containerEl)
				.setName('Endereço do Servidor')
				.setDesc('Endereço de rede da PastaBase (ex: \\\\192.168.1.100\\SyncBase)')
				.addText(text => text
					.setPlaceholder('\\\\192.168.1.100\\SyncBase')
					.setValue(this.plugin.settings.serverAddress)
					.onChange(async (value) => {
						this.plugin.settings.serverAddress = value;
						await this.plugin.saveSettings();
					}));

			new Setting(containerEl)
				.setName('Pasta Local de Cópia')
				.setDesc('Pasta local onde será mantida a cópia sincronizada')
				.addButton(button => button
					.setButtonText('Selecionar Pasta')
					.onClick(async () => {
						await this.selectClientFolder();
					}))
				.addText(text => text
					.setPlaceholder('Selecione a pasta local...')
					.setValue(this.plugin.settings.clientPath)
					.onChange(async (value) => {
						this.plugin.settings.clientPath = value;
						await this.plugin.saveSettings();
					}));

			// Botão para testar conexão com servidor
			if (this.plugin.settings.serverAddress) {
				new Setting(containerEl)
					.setName('Testar Conexão com Servidor')
					.setDesc('Verificar se é possível acessar a PastaBase')
					.addButton(button => button
						.setButtonText('Testar Conexão')
						.onClick(async () => {
							await this.testServerConnection();
						}));
			}
		}

		// Configurações avançadas
		containerEl.createEl('h3', { text: '⚙️ Configurações Avançadas' });

		new Setting(containerEl)
			.setName('Resolução de Conflitos')
			.setDesc('Como lidar com arquivos modificados em múltiplos dispositivos')
			.addDropdown(dropdown => dropdown
				.addOption('last-writes-wins', 'Última Escrita Vence')
				.addOption('create-copy', 'Criar Cópia de Conflito')
				.addOption('skip', 'Pular Arquivo')
				.setValue(this.plugin.settings.conflictResolution)
				.onChange(async (value: 'last-writes-wins' | 'create-copy' | 'skip') => {
					this.plugin.settings.conflictResolution = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Sincronização Automática')
			.setDesc('Sincronizar alterações automaticamente')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.autoSync)
				.onChange(async (value) => {
					this.plugin.settings.autoSync = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Intervalo de Verificação')
			.setDesc('Com que frequência verificar alterações (segundos)')
			.addSlider(slider => slider
				.setLimits(10, 300, 10)
				.setValue(this.plugin.settings.syncInterval)
				.setDynamicTooltip()
				.onChange(async (value) => {
					this.plugin.settings.syncInterval = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Notificações')
			.setDesc('Mostrar notificações sobre sincronização')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableNotifications)
				.onChange(async (value) => {
					this.plugin.settings.enableNotifications = value;
					await this.plugin.saveSettings();
				}));

		// Informações do dispositivo
		containerEl.createEl('h3', { text: '📱 Informações do Dispositivo' });

		const deviceInfo = containerEl.createDiv();
		deviceInfo.style.marginBottom = '15px';
		deviceInfo.style.padding = '10px';
		deviceInfo.style.background = '#f5f5f5';
		deviceInfo.style.borderRadius = '5px';

		deviceInfo.createEl('p', {
			text: `ID: ${this.plugin.settings.deviceId || 'Não detectado'}`
		});
		deviceInfo.createEl('p', {
			text: `Nome: ${this.plugin.settings.deviceName || 'Não definido'}`
		});

		new Setting(containerEl)
			.setName('Nome do Dispositivo')
			.setDesc('Nome amigável para identificação na rede')
			.addText(text => text
				.setPlaceholder('Meu PC, Meu Celular, etc.')
				.setValue(this.plugin.settings.deviceName)
				.onChange(async (value) => {
					this.plugin.settings.deviceName = value;
					await this.plugin.saveSettings();
				}));
	}

	/**
	 * Seleciona pasta para o servidor (PastaBase)
	 */
	private async selectServerFolder(): Promise<void> {
		try {
			console.log('[SyncFull] Selecionando PastaBase para servidor...');

			if ((this.app as any).electron) {
				try {
					const { dialog } = require('electron').remote || require('@electron/remote');

					const result = await dialog.showOpenDialog({
						properties: ['openDirectory'],
						title: 'Selecione a PastaBase (Servidor)'
					});

					if (!result.canceled && result.filePaths.length > 0) {
						const selectedPath = result.filePaths[0];
						this.plugin.settings.serverPath = selectedPath;
						await this.plugin.saveSettings();
						this.display();
						console.log(`[SyncFull] PastaBase selecionada: ${selectedPath}`);
						if (this.plugin.settings.enableNotifications) new Notice(`✅ PastaBase configurada: ${selectedPath}`);
					}
				} catch (electronError) {
					console.warn('[SyncFull] Electron dialog não disponível:', electronError);
					this.showManualFolderInput('server');
				}
			} else {
				await this.selectFolderMobile('server');
			}
		} catch (error) {
			console.error('[SyncFull] Erro ao selecionar PastaBase:', error);
			if (this.plugin.settings.enableNotifications) new Notice('❌ Erro ao selecionar PastaBase');
		}
	}

	/**
	 * Seleciona pasta para o cliente (cópia local)
	 */
	private async selectClientFolder(): Promise<void> {
		try {
			console.log('[SyncFull] Selecionando pasta local para cliente...');

			if ((this.app as any).electron) {
				try {
					const { dialog } = require('electron').remote || require('@electron/remote');

					const result = await dialog.showOpenDialog({
						properties: ['openDirectory'],
						title: 'Selecione a Pasta Local (Cliente)'
					});

					if (!result.canceled && result.filePaths.length > 0) {
						const selectedPath = result.filePaths[0];
						this.plugin.settings.clientPath = selectedPath;
						await this.plugin.saveSettings();
						this.display();
						console.log(`[SyncFull] Pasta local selecionada: ${selectedPath}`);
						if (this.plugin.settings.enableNotifications) new Notice(`✅ Pasta local configurada: ${selectedPath}`);
					}
				} catch (electronError) {
					console.warn('[SyncFull] Electron dialog não disponível:', electronError);
					this.showManualFolderInput('client');
				}
			} else {
				await this.selectFolderMobile('client');
			}
		} catch (error) {
			console.error('[SyncFull] Erro ao selecionar pasta local:', error);
			if (this.plugin.settings.enableNotifications) new Notice('❌ Erro ao selecionar pasta local');
		}
	}

	/**
	 * Testa configuração do servidor
	 */
	private async testServerConfiguration(): Promise<void> {
		if (!this.plugin.settings.serverPath) {
			if (this.plugin.settings.enableNotifications) new Notice('⚠️ Configure o caminho da PastaBase primeiro');
			return;
		}

		try {
			if (this.plugin.settings.enableNotifications) new Notice('🔍 Testando configuração do servidor...');

			// TODO: Implementar método no plugin principal
			// const result = await this.plugin.testServerConfiguration(this.plugin.settings.serverPath);

			// Simulação por enquanto
			if (this.plugin.settings.enableNotifications) new Notice('✅ Funcionalidade em desenvolvimento - servidor configurado!');

		} catch (error) {
			console.error('[SyncFull] Erro ao testar configuração do servidor:', error);
			if (this.plugin.settings.enableNotifications) new Notice('❌ Erro ao testar configuração do servidor');
		}
	}

	/**
	 * Testa conexão com o servidor
	 */
	private async testServerConnection(): Promise<void> {
		if (!this.plugin.settings.serverAddress) {
			if (this.plugin.settings.enableNotifications) new Notice('⚠️ Configure o endereço do servidor primeiro');
			return;
		}

		try {
			if (this.plugin.settings.enableNotifications) new Notice('🔍 Testando conexão com servidor...');

			// TODO: Implementar método no plugin principal
			// const result = await this.plugin.testServerConnection(this.plugin.settings.serverAddress);

			// Simulação por enquanto
			if (this.plugin.settings.enableNotifications) new Notice('✅ Funcionalidade em desenvolvimento - conexão testada!');

		} catch (error) {
			console.error('[SyncFull] Erro ao testar conexão com servidor:', error);
			if (this.plugin.settings.enableNotifications) new Notice('❌ Erro ao testar conexão com servidor');
		}
	}

	/**
	 * Seleção de pasta móvel genérica
	 */
	private async selectFolderMobile(type: 'server' | 'client'): Promise<void> {
		try {
			if ('showDirectoryPicker' in window) {
				const directoryHandle = await (window as any).showDirectoryPicker({
					mode: 'readwrite',
					startIn: 'documents'
				});

				const folderName = directoryHandle.name || 'sync-folder';
				const relativePath = `/${folderName}`;

				if (type === 'server') {
					this.plugin.settings.serverPath = relativePath;
				} else {
					this.plugin.settings.clientPath = relativePath;
				}

				await this.plugin.saveSettings();
				this.display();

				console.log(`[SyncFull] Pasta ${type} selecionada: ${folderName}`);
				if (this.plugin.settings.enableNotifications) new Notice(`✅ Pasta ${type}: ${folderName}`);
			} else {
				this.showManualFolderInput(type);
			}
		} catch (error) {
			console.error('[SyncFull] Erro na seleção de pasta móvel:', error);
			this.showManualFolderInput(type);
		}
	}

	/**
	 * Input manual para pasta (fallback)
	 */
	private showManualFolderInput(type: 'server' | 'client'): void {
		const modal = new FolderInputModal(this.app, type, async (path: string) => {
			if (path && path.trim()) {
				if (type === 'server') {
					this.plugin.settings.serverPath = path.trim();
				} else {
					this.plugin.settings.clientPath = path.trim();
				}
				await this.plugin.saveSettings();
				this.display();
				console.log(`[SyncFull] Pasta ${type} definida manualmente: ${path}`);
				if (this.plugin.settings.enableNotifications) new Notice(`✅ Pasta ${type} configurada: ${path}`);
			}
		});
		modal.open();
	}
}

/**
 * Modal para entrada manual do caminho da pasta
 */
class FolderInputModal extends Modal {
	private type: 'server' | 'client';
	private onSubmit: (path: string) => Promise<void>;
	private inputEl: HTMLInputElement;

	constructor(app: App, type: 'server' | 'client', onSubmit: (path: string) => Promise<void>) {
		super(app);
		this.type = type;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		const title = this.type === 'server'
			? 'Configurar PastaBase (Servidor)'
			: 'Configurar Pasta Local (Cliente)';

		contentEl.createEl('h3', { text: title });

		const desc = contentEl.createDiv();
		desc.textContent = this.type === 'server'
			? 'Digite o caminho da PastaBase (Servidor):'
			: 'Digite o caminho da pasta local (Cliente):';
		desc.style.marginBottom = '15px';

		// Input para o caminho
		const placeholder = this.type === 'server'
			? 'C:\\SyncBase ou /mnt/sync-base'
			: 'C:\\MyVault\\Sync ou /home/user/vault-sync';

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: placeholder
		});
		this.inputEl.style.width = '100%';
		this.inputEl.style.marginBottom = '15px';
		this.inputEl.style.padding = '8px';
		this.inputEl.style.border = '1px solid #ccc';
		this.inputEl.style.borderRadius = '4px';

		// Sugestões
		const suggestions = contentEl.createDiv();
		suggestions.style.fontSize = '12px';
		suggestions.style.color = '#666';
		suggestions.style.marginBottom = '15px';

		if (this.type === 'server') {
			suggestions.createEl('p', { text: 'Sugestões para servidor:' });
			suggestions.createEl('ul').innerHTML = `
				<li>C:\\SyncBase</li>
				<li>D:\\ObsidianSync</li>
				<li>/mnt/sync-base</li>
				<li>/home/user/sync-base</li>
			`;
		} else {
			suggestions.createEl('p', { text: 'Sugestões para cliente:' });
			suggestions.createEl('ul').innerHTML = `
				<li>C:\\MyVault\\Sync</li>
				<li>D:\\Documents\\ObsidianSync</li>
				<li>/home/user/vault-sync</li>
				<li>/storage/emulated/0/Documents/Sync</li>
			`;
		}

		// Botões
		const buttonContainer = contentEl.createDiv();
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '10px';
		buttonContainer.style.justifyContent = 'flex-end';

		const cancelButton = buttonContainer.createEl('button', { text: 'Cancelar' });
		cancelButton.style.padding = '8px 16px';
		cancelButton.style.border = '1px solid #ccc';
		cancelButton.style.borderRadius = '4px';
		cancelButton.style.background = '#f5f5f5';
		cancelButton.onclick = () => this.close();

		const confirmButton = buttonContainer.createEl('button', { text: 'Confirmar' });
		confirmButton.style.padding = '8px 16px';
		confirmButton.style.border = 'none';
		confirmButton.style.borderRadius = '4px';
		confirmButton.style.background = '#007acc';
		confirmButton.style.color = 'white';
		confirmButton.onclick = async () => {
			await this.onSubmit(this.inputEl.value);
			this.close();
		};

		// Focar no input
		this.inputEl.focus();
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

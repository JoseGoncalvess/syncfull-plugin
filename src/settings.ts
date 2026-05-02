import { App, PluginSettingTab, Setting } from "obsidian";
import SyncFullPlugin from "./main";

export interface MyPluginSettings {
	destinationPath: string;
	conflictResolution: 'last-writes-wins' | 'create-copy' | 'skip';
	createConflictCopies: boolean;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	destinationPath: '',
	conflictResolution: 'last-writes-wins',
	createConflictCopies: true
}

export class SyncFullSettingTab extends PluginSettingTab {
	plugin: SyncFullPlugin;

	constructor(app: App, plugin: SyncFullPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'SyncFull - Configurações' });

		new Setting(containerEl)
			.setName('Caminho de Destino')
			.setDesc('Caminho absoluto para a pasta de sincronização (ex: /Volumes/Public/ ou C:\\Backup)')
			.addText(text => text
				.setPlaceholder('Digite o caminho de destino...')
				.setValue(this.plugin.settings.destinationPath)
				.onChange(async (value) => {
					this.plugin.settings.destinationPath = value;
					await this.plugin.saveSettings();
				}));

		containerEl.createEl('h3', { text: 'Resolução de Conflitos' });

		new Setting(containerEl)
			.setName('Estratégia de Resolução')
			.setDesc('Como lidar com arquivos modificados em ambos os lados')
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
			.setName('Criar Cópias de Conflito')
			.setDesc('Quando detectado conflito, criar uma cópia com sufixo (conflito)')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.createConflictCopies)
				.onChange(async (value) => {
					this.plugin.settings.createConflictCopies = value;
					await this.plugin.saveSettings();
				}));
	}
}

import { App, PluginSettingTab, Setting } from "obsidian";
import SyncFullPlugin from "./main";

export interface MyPluginSettings {
	destinationPath: string;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	destinationPath: ''
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
	}
}

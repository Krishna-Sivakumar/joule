import { App, PluginSettingTab } from "obsidian";
import { mount } from "svelte";
import { UnitSetting } from "./lib";
import Joule from "./main.ts";

export interface JouleSettings {
	units: string[];
}

export const DEFAULT_SETTINGS: JouleSettings = {
	units: ["g", "ml", "cup", "cups", "cnt", "count"],
};

export class JouleSettingsTab extends PluginSettingTab {
	plugin: Joule;

	constructor(app: App, plugin: Joule) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		const unitSettingElement = containerEl.createEl("div", {});

		mount(UnitSetting, {
			target: unitSettingElement,
			context: new Map().set("units", this.plugin.settings.units).set(
				"updateFunc",
				async (value: string[]) => {
					this.plugin.settings.units = value;
					await this.plugin.saveSettings();
				},
			),
		});

		/*
		new Setting(containerEl)
			.setName("Units")
			.setDesc("Manage the quantity units that Joule can use")
			.addTextArea((text) =>
				text
					.setValue(this.plugin.settings.units)
					.onChange(async (value) => {
						this.plugin.settings.units = value;
						await this.plugin.saveSettings();
					})
			);
		*/
	}
}

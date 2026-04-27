// ── Mock project fixtures — seeded data for /project mode ───────────
//
// Shared between mock runtime + tests. Mutated in place when the user
// runs `/project save`, `/project switch`, `/project set`, etc.

import type {
	PreprocessorListPayload,
	ProjectFilesPayload,
	ProjectListPayload,
	ProjectSettingsPayload,
	ProjectTreePayload,
} from "./contracts/project.js";

export interface MockProjectState {
	chainId: string;
	list: ProjectListPayload;
	tree: ProjectTreePayload;
	files: ProjectFilesPayload;
	settings: ProjectSettingsPayload;
	preprocessors: PreprocessorListPayload;
	snippet: string;
}

export function createMockProjectState(): MockProjectState {
	return {
		chainId: "Mock Project",
		list: {
			projects: [
				{ name: "Mock Project", path: "/mock/project" },
				{ name: "TestSynth", path: "/mock/TestSynth" },
				{ name: "DemoEffect", path: "/mock/DemoEffect" },
			],
			active: "Mock Project",
		},
		tree: {
			projectName: "Mock Project",
			root: {
				name: "Mock Project",
				type: "folder",
				children: [
					{
						name: "Scripts",
						type: "folder",
						children: [
							{ name: "Interface.js", type: "file", referenced: true },
							{ name: "helpers.js", type: "file", referenced: true },
							{ name: "old_unused.js", type: "file", referenced: false },
						],
					},
					{
						name: "SampleMaps",
						type: "folder",
						children: [
							{ name: "MainSamples.xml", type: "file", referenced: true },
							{ name: "Drums.xml", type: "file", referenced: false },
						],
					},
					{
						name: "Images",
						type: "folder",
						children: [
							{ name: "knob.png", type: "file", referenced: true },
							{ name: "old_bg.png", type: "file", referenced: false },
						],
					},
					{
						name: "DspNetworks",
						type: "folder",
						children: [
							{ name: "MyEffect.xml", type: "file", referenced: true },
						],
					},
					{
						name: "UserPresets",
						type: "folder",
						children: [
							{ name: "Default.preset", type: "file", referenced: true },
						],
					},
				],
			},
		},
		files: {
			files: [
				{ name: "Mock Project.xml", type: "xml", path: "XmlPresetBackups/Mock Project.xml", modified: "2026-04-10T09:00:00Z" },
				{ name: "Mock Project.hip", type: "hip", path: "Presets/Mock Project.hip", modified: "2026-04-09T15:30:00Z" },
			],
		},
		settings: {
			settings: {
				Name: { value: "Mock Project", description: "The name of the project. This is used as the default plugin name." },
				Version: { value: "1.0.0", description: "Project version." },
				Description: { value: "", description: "Free-form project description." },
				PluginCode: { value: "Mock", description: "Four-character plugin identifier required by the AU/VST3 hosts." },
				EmbedImageFiles: { value: true, description: "Embed images in the exported plugin.", options: [true, false] },
				EmbedAudioFiles: { value: true, description: "Embed audio files in the exported plugin.", options: [true, false] },
				VST3Support: { value: true, description: "Enable VST3 export.", options: [true, false] },
				AUSupport: { value: true, description: "Enable AU export.", options: [true, false] },
				AAXSupport: { value: false, description: "Enable AAX export.", options: [true, false] },
				UseRawFrontend: { value: false, description: "Use the raw frontend (advanced).", options: [true, false] },
				AAXCategoryFX: {
					value: "AAX_ePlugInCategory_Modulation",
					description: "AAX effect category.",
					options: [
						"AAX_ePlugInCategory_EQ",
						"AAX_ePlugInCategory_Dynamics",
						"AAX_ePlugInCategory_Modulation",
						"AAX_ePlugInCategory_Reverb",
					],
				},
			},
		},
		preprocessors: {
			preprocessors: {
				"*.*": { SHARED_FLAG: "1" },
				"Project.*": { HAS_LICENSE_KEY: "1" },
				"Project.Windows": { WIN_ONLY_FLAG: "2" },
			},
		},
		snippet: "HiseSnippet 1234.abcdefghijklmnopqrstuvwxyz_mock_payload",
	};
}

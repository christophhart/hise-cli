// Mock UI component tree — multi-page synth plugin captured from live HISE API.
//
// Structure: 3-layer hierarchy representing a generic plugin with
// Header (logo, title, page buttons), PageContainer (Main/FX/Settings pages),
// and Footer (version label, panic button).
//
// FXPage and SettingsPage are invisible (visible: false) to test recursive
// dimming. saveInPreset is set on interactive controls (knobs, buttons,
// combos) but not on layout panels or labels.
//
// 37 components total, 7 component types represented.

/** Raw component node shape from GET /api/ui/tree. */
export interface RawComponentNode {
	id: string;
	type: string;
	visible: boolean;
	enabled: boolean;
	saveInPreset: boolean;
	x: number;
	y: number;
	width: number;
	height: number;
	childComponents: RawComponentNode[];
}

export const MOCK_COMPONENT_TREE: RawComponentNode = {
	id: "Content",
	type: "ScriptPanel",
	visible: true,
	enabled: true,
	saveInPreset: false,
	x: 0, y: 0, width: 600, height: 500,
	childComponents: [
		{
			id: "Header",
			type: "ScriptPanel",
			visible: true, enabled: true, saveInPreset: false,
			x: 0, y: 0, width: 900, height: 50,
			childComponents: [
				{
					id: "Logo",
					type: "ScriptImage",
					visible: true, enabled: true, saveInPreset: false,
					x: 10, y: 5, width: 40, height: 40,
					childComponents: [],
				},
				{
					id: "PluginTitle",
					type: "ScriptLabel",
					visible: true, enabled: true, saveInPreset: false,
					x: 60, y: 5, width: 200, height: 40,
					childComponents: [],
				},
				{
					id: "PageBtn_Main",
					type: "ScriptButton",
					visible: true, enabled: true, saveInPreset: false,
					x: 600, y: 10, width: 80, height: 30,
					childComponents: [],
				},
				{
					id: "PageBtn_FX",
					type: "ScriptButton",
					visible: true, enabled: true, saveInPreset: false,
					x: 690, y: 10, width: 80, height: 30,
					childComponents: [],
				},
				{
					id: "PageBtn_Settings",
					type: "ScriptButton",
					visible: true, enabled: true, saveInPreset: false,
					x: 780, y: 10, width: 80, height: 30,
					childComponents: [],
				},
			],
		},
		{
			id: "PageContainer",
			type: "ScriptPanel",
			visible: true, enabled: true, saveInPreset: false,
			x: 0, y: 50, width: 900, height: 500,
			childComponents: [
				{
					id: "MainPage",
					type: "ScriptPanel",
					visible: true, enabled: true, saveInPreset: false,
					x: 0, y: 0, width: 900, height: 500,
					childComponents: [
						{
							id: "OscSection",
							type: "ScriptPanel",
							visible: true, enabled: true, saveInPreset: false,
							x: 20, y: 20, width: 400, height: 220,
							childComponents: [
								{
									id: "OscTitle",
									type: "ScriptLabel",
									visible: true, enabled: true, saveInPreset: false,
									x: 10, y: 5, width: 100, height: 25,
									childComponents: [],
								},
								{
									id: "OscTune",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "OscShape",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 160, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "OscWaveform",
									type: "ScriptComboBox",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 120, width: 150, height: 28,
									childComponents: [],
								},
								{
									id: "OscVol",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 300, y: 40, width: 80, height: 160,
									childComponents: [],
								},
							],
						},
						{
							id: "FilterSection",
							type: "ScriptPanel",
							visible: true, enabled: true, saveInPreset: false,
							x: 440, y: 20, width: 440, height: 220,
							childComponents: [
								{
									id: "FilterTitle",
									type: "ScriptLabel",
									visible: true, enabled: true, saveInPreset: false,
									x: 10, y: 5, width: 100, height: 25,
									childComponents: [],
								},
								{
									id: "FilterCutoff",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "FilterReso",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 160, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "FilterType",
									type: "ScriptComboBox",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 120, width: 150, height: 28,
									childComponents: [],
								},
							],
						},
						{
							id: "OutputSection",
							type: "ScriptPanel",
							visible: true, enabled: true, saveInPreset: false,
							x: 20, y: 260, width: 860, height: 200,
							childComponents: [
								{
									id: "OutputTitle",
									type: "ScriptLabel",
									visible: true, enabled: true, saveInPreset: false,
									x: 10, y: 5, width: 100, height: 25,
									childComponents: [],
								},
								{
									id: "MasterVol",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "MasterPan",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 160, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "OutputMeter",
									type: "ScriptAudioWaveform",
									visible: true, enabled: true, saveInPreset: true,
									x: 400, y: 30, width: 440, height: 80,
									childComponents: [],
								},
							],
						},
					],
				},
				{
					id: "FXPage",
					type: "ScriptPanel",
					visible: false, enabled: true, saveInPreset: false,
					x: 0, y: 0, width: 900, height: 500,
					childComponents: [
						{
							id: "DelaySection",
							type: "ScriptPanel",
							visible: true, enabled: true, saveInPreset: false,
							x: 20, y: 20, width: 420, height: 300,
							childComponents: [
								{
									id: "DelayTitle",
									type: "ScriptLabel",
									visible: true, enabled: true, saveInPreset: false,
									x: 10, y: 5, width: 100, height: 25,
									childComponents: [],
								},
								{
									id: "DelayTime",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "DelayFeedback",
									type: "ScriptSlider",
									visible: true, enabled: true, saveInPreset: true,
									x: 160, y: 40, width: 128, height: 48,
									childComponents: [],
								},
								{
									id: "DelaySync",
									type: "ScriptButton",
									visible: true, enabled: true, saveInPreset: true,
									x: 20, y: 120, width: 100, height: 28,
									childComponents: [],
								},
							],
						},
					],
				},
				{
					id: "SettingsPage",
					type: "ScriptPanel",
					visible: false, enabled: true, saveInPreset: false,
					x: 0, y: 0, width: 900, height: 500,
					childComponents: [
						{
							id: "OversamplingSelect",
							type: "ScriptComboBox",
							visible: true, enabled: true, saveInPreset: true,
							x: 20, y: 20, width: 200, height: 28,
							childComponents: [],
						},
						{
							id: "HQMode",
							type: "ScriptButton",
							visible: true, enabled: true, saveInPreset: true,
							x: 20, y: 70, width: 120, height: 28,
							childComponents: [],
						},
					],
				},
			],
		},
		{
			id: "Footer",
			type: "ScriptPanel",
			visible: true, enabled: true, saveInPreset: false,
			x: 0, y: 550, width: 900, height: 50,
			childComponents: [
				{
					id: "VersionLabel",
					type: "ScriptLabel",
					visible: true, enabled: true, saveInPreset: false,
					x: 10, y: 15, width: 200, height: 20,
					childComponents: [],
				},
				{
					id: "PanicButton",
					type: "ScriptButton",
					visible: true, enabled: true, saveInPreset: false,
					x: 800, y: 10, width: 80, height: 30,
					childComponents: [],
				},
			],
		},
	],
};

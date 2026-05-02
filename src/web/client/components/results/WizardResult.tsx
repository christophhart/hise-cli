// ── Inline wizard form (renders in OutputLog like any CommandResult) ─

import { useMemo, useState } from "react";
import type { CommandResult } from "../../../../engine/result.js";
import type {
	WizardAnswers,
	WizardDefinition,
	WizardField,
	WizardTab,
} from "../../../../engine/wizard/types.js";
import { isOn } from "../../../../engine/wizard/types.js";
import { submitInput } from "../../ws-client.js";
import { useStore } from "../../state/store.js";
import { formatWithClause } from "../../../../engine/commands/slash.js";

type WizardVariant = Extract<CommandResult, { type: "wizard" }>;

export function WizardResult({ result }: { result: WizardVariant }) {
	const def = result.definition;
	const initial = useMemo(() => seedAnswers(def, result.prefill), [def, result]);
	const [answers, setAnswers] = useState<WizardAnswers>(initial);
	const [activeTab, setActiveTab] = useState(0);
	const [submitted, setSubmitted] = useState(false);

	const visibleTabs = useMemo(
		() => def.tabs.map((t, i) => ({ tab: t, index: i })).filter(({ tab }) => isTabEnabled(tab, answers)),
		[def, answers],
	);
	const tab = visibleTabs[activeTab]?.tab ?? def.tabs[0]!;
	const errors = useMemo(() => collectErrors(def, answers), [def, answers]);
	const isValid = errors.length === 0;

	const setAnswer = (id: string, value: string) =>
		setAnswers((prev) => ({ ...prev, [id]: value }));

	const pushUserCommand = useStore((s) => s.pushUserCommand);

	const submit = async () => {
		if (!isValid) return;
		setSubmitted(true);
		// Dispatch through the same slash-command path as a typed `/wizard run`.
		// Server runs the wizard inline, streams progress via `wizard-progress`
		// broadcasts (existing handler), and returns a plain text/error result
		// that the regular submit-input pipeline logs to the output panel.
		const withClause = formatWithClause(answers);
		const command = withClause
			? `/wizard run ${def.id} with ${withClause}`
			: `/wizard run ${def.id}`;
		try {
			const response = await submitInput(command);
			if (response.kind === "error") {
				pushUserCommand(command, {
					type: "error",
					message: response.message,
					detail: response.detail,
				});
			}
			// On success the regular submit-input pipeline already logged the result.
		} catch (err) {
			pushUserCommand(command, {
				type: "error",
				message: "Wizard submit failed",
				detail: String(err),
			});
		}
	};

	return (
		<section className={`wizard-form ${submitted ? "running" : ""}`}>
			<header className="wizard-header">
				<strong>{def.header}</strong>
				{def.description && <span className="muted"> — {def.description}</span>}
			</header>

			{def.body && <div className="wizard-body">{def.body}</div>}

			{visibleTabs.length > 1 && (
				<nav className="wizard-tabs">
					{visibleTabs.map(({ tab: t }, i) => (
						<button
							key={t.label + i}
							type="button"
							className={i === activeTab ? "active" : ""}
							disabled={submitted}
							onClick={() => setActiveTab(i)}
						>
							{t.label}
						</button>
					))}
				</nav>
			)}

			<div className="wizard-fields">
				{tab.fields
					.filter((f) => isFieldVisible(f, answers))
					.map((field) => (
						<FieldRow
							key={field.id}
							field={field}
							value={answers[field.id] ?? ""}
							disabled={submitted}
							onChange={(v) => setAnswer(field.id, v)}
						/>
					))}
			</div>

			{errors.length > 0 && (
				<ul className="wizard-errors">
					{errors.map((e, i) => (
						<li key={i}>{e}</li>
					))}
				</ul>
			)}

			<footer className="wizard-footer">
				<button
					type="button"
					className="primary"
					disabled={!isValid || submitted}
					onClick={() => void submit()}
				>
					{submitted ? "Running…" : def.submitLabel ?? "Run"}
				</button>
			</footer>
		</section>
	);
}

// ── Field renderer ─────────────────────────────────────────────────

function FieldRow({
	field,
	value,
	disabled,
	onChange,
}: {
	field: WizardField;
	value: string;
	disabled: boolean;
	onChange(v: string): void;
}) {
	const required = field.required && !field.disabled;
	const fieldDisabled = disabled || field.disabled;
	return (
		<label className={`wizard-field type-${field.type}`}>
			<span className="field-label">
				{field.label}
				{required && <span className="required">*</span>}
			</span>
			{field.type === "toggle" && (
				<input
					type="checkbox"
					checked={isOn(value)}
					disabled={fieldDisabled}
					onChange={(e) => onChange(e.currentTarget.checked ? "true" : "false")}
				/>
			)}
			{field.type === "text" && (
				<input
					type="text"
					value={value}
					placeholder={field.emptyText}
					disabled={fieldDisabled}
					onChange={(e) => onChange(e.currentTarget.value)}
				/>
			)}
			{field.type === "file" && (
				<input
					type="text"
					value={value}
					placeholder={field.emptyText ?? (field.directory ? "/path/to/dir" : "/path/to/file")}
					disabled={fieldDisabled}
					onChange={(e) => onChange(e.currentTarget.value)}
				/>
			)}
			{field.type === "choice" && (
				<select
					value={value}
					disabled={fieldDisabled}
					onChange={(e) => onChange(e.currentTarget.value)}
				>
					<option value="">— select —</option>
					{(field.items ?? []).map((item, i) => (
						<option key={item + i} value={field.valueMode === "index" ? String(i) : item}>
							{item}
						</option>
					))}
				</select>
			)}
			{field.type === "multiselect" && (
				<div className="multiselect">
					{(field.items ?? []).map((item, i) => {
						const selected = value.split(",").map((s) => s.trim()).filter(Boolean);
						const checked = selected.includes(item);
						return (
							<label key={item + i} className="multiselect-item">
								<input
									type="checkbox"
									checked={checked}
									disabled={fieldDisabled}
									onChange={(e) => {
										const next = new Set(selected);
										if (e.currentTarget.checked) next.add(item);
										else next.delete(item);
										onChange(Array.from(next).join(", "));
									}}
								/>
								{item}
							</label>
						);
					})}
				</div>
			)}
			{field.help && <small className="field-help">{field.help}</small>}
		</label>
	);
}

// ── State helpers ───────────────────────────────────────────────────

function seedAnswers(def: WizardDefinition, initial: WizardAnswers): WizardAnswers {
	const answers: WizardAnswers = {};
	for (const tab of def.tabs) {
		for (const field of tab.fields) {
			if (field.defaultValue !== undefined) answers[field.id] = field.defaultValue;
		}
	}
	for (const [k, v] of Object.entries(def.globalDefaults)) answers[k] = v;
	for (const [k, v] of Object.entries(initial ?? {})) answers[k] = v;
	return answers;
}

function isTabEnabled(tab: WizardTab, answers: WizardAnswers): boolean {
	if (!tab.condition) return true;
	return answers[tab.condition.fieldId] === tab.condition.value;
}

function isFieldVisible(field: WizardField, answers: WizardAnswers): boolean {
	if (!field.visibleIf) return true;
	const conditions = Array.isArray(field.visibleIf) ? field.visibleIf : [field.visibleIf];
	return conditions.every((c) => {
		const actual = answers[c.fieldId] ?? "";
		if (c.match === "contains") {
			const tokens = actual.split(/\s*,\s*/).filter((t) => t.length > 0);
			return tokens.includes(c.value);
		}
		return actual === c.value;
	});
}

function collectErrors(def: WizardDefinition, answers: WizardAnswers): string[] {
	const errs: string[] = [];
	for (const tab of def.tabs) {
		if (!isTabEnabled(tab, answers)) continue;
		for (const field of tab.fields) {
			if (!isFieldVisible(field, answers)) continue;
			if (field.disabled) continue;
			if (!field.required) continue;
			const v = answers[field.id];
			if (v === undefined || v === "") {
				errs.push(`${field.label} is required`);
			}
		}
	}
	return errs;
}

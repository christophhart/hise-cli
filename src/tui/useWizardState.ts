// ── Wizard form + execution state hook ───────────────────────────────

import { useState, useRef } from "react";
import type { WizardFormState } from "../components/wizard-render.js";

export interface WizardState {
	/** Active wizard form (null when no wizard is open). */
	wizardForm: WizardFormState | null;
	setWizardForm: React.Dispatch<React.SetStateAction<WizardFormState | null>>;
	/** Ref snapshot of wizardForm (for key handler). */
	wizardFormRef: React.RefObject<WizardFormState | null>;
	/** Wizard execution progress (null when not executing). */
	wizardProgress: { percent: number; message: string } | null;
	setWizardProgress: React.Dispatch<React.SetStateAction<{ percent: number; message: string } | null>>;
	/** Abort controller for cancelling wizard execution. */
	abortRef: React.RefObject<AbortController | null>;
	/** Timestamp of last Escape press (for double-tap abort). */
	escTimestampRef: React.RefObject<number>;
	/** Last displayed wizard phase name. */
	lastPhaseRef: React.RefObject<string>;
}

export function useWizardState(): WizardState {
	const [wizardForm, setWizardForm] = useState<WizardFormState | null>(null);
	const wizardFormRef = useRef<WizardFormState | null>(null);

	const [wizardProgress, setWizardProgress] = useState<{ percent: number; message: string } | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const escTimestampRef = useRef(0);
	const lastPhaseRef = useRef("");

	// Keep ref in sync
	wizardFormRef.current = wizardForm;

	return {
		wizardForm,
		setWizardForm,
		wizardFormRef,
		wizardProgress,
		setWizardProgress,
		abortRef,
		escTimestampRef,
		lastPhaseRef,
	};
}

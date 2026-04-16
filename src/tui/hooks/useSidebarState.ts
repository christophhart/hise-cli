// ── Tree sidebar state hook ──────────────────────────────────────────

import { useState, useCallback, useRef, useEffect } from "react";
import type { TreeSidebarHandle, TreeSidebarState } from "../components/TreeSidebar.js";
import type { Session } from "../../engine/session.js";

export interface SidebarState {
	/** Imperative tree sidebar handle. */
	treeSidebarRef: React.RefObject<TreeSidebarHandle | null>;
	/** Whether sidebar is visible. */
	sidebarVisible: boolean;
	setSidebarVisible: React.Dispatch<React.SetStateAction<boolean>>;
	/** Ref snapshot of sidebarVisible (for async callbacks). */
	sidebarVisibleRef: React.RefObject<boolean>;
	/** Whether sidebar has keyboard focus. */
	sidebarFocused: boolean;
	setSidebarFocused: React.Dispatch<React.SetStateAction<boolean>>;
	/** Ref to setSidebarFocused (for imperative calls). */
	setSidebarFocusedRef: React.RefObject<(v: boolean) => void>;
	/** Persistent sidebar state across close/reopen. */
	sidebarStateRef: React.RefObject<TreeSidebarState | undefined>;
	/** Callback for sidebar state changes. */
	handleSidebarStateChange: (state: TreeSidebarState) => void;
	/** Search bar focus state. */
	searchFocused: boolean;
	setSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
	/** Search filter text. */
	searchText: string;
	setSearchText: React.Dispatch<React.SetStateAction<string>>;
}

export function useSidebarState(
	multilineMode: boolean,
	session: Session,
	currentModeId: string,
): SidebarState {
	const treeSidebarRef = useRef<TreeSidebarHandle>(null);
	const [sidebarVisible, setSidebarVisible] = useState(false);
	const sidebarVisibleBeforeEditorRef = useRef(false);
	const [sidebarFocused, setSidebarFocused] = useState(false);
	const setSidebarFocusedRef = useRef<(v: boolean) => void>(() => {});
	setSidebarFocusedRef.current = setSidebarFocused;

	// Persistent sidebar state survives close/reopen
	const sidebarStateRef = useRef<TreeSidebarState | undefined>(undefined);
	const handleSidebarStateChange = useCallback((state: TreeSidebarState) => {
		sidebarStateRef.current = state;
	}, []);

	// Ref snapshot for async callbacks
	const sidebarVisibleRef = useRef(sidebarVisible);
	sidebarVisibleRef.current = sidebarVisible;

	// Auto-show sidebar as file browser when entering editor mode
	useEffect(() => {
		if (multilineMode && session.scriptFileCache.length > 0) {
			sidebarVisibleBeforeEditorRef.current = sidebarVisible;
			if (!sidebarVisible) setSidebarVisible(true);
		} else if (!multilineMode && sidebarVisibleBeforeEditorRef.current !== sidebarVisible) {
			setSidebarVisible(sidebarVisibleBeforeEditorRef.current);
		}
	}, [multilineMode]);

	// Search state
	const [searchFocused, setSearchFocused] = useState(false);
	const [searchText, setSearchText] = useState("");

	// Clear search when mode changes
	const prevModeIdRef = useRef(currentModeId);
	useEffect(() => {
		if (prevModeIdRef.current !== currentModeId) {
			prevModeIdRef.current = currentModeId;
			setSearchText("");
			setSearchFocused(false);
		}
	}, [currentModeId]);

	return {
		treeSidebarRef,
		sidebarVisible,
		setSidebarVisible,
		sidebarVisibleRef,
		sidebarFocused,
		setSidebarFocused,
		setSidebarFocusedRef,
		sidebarStateRef,
		handleSidebarStateChange,
		searchFocused,
		setSearchFocused,
		searchText,
		setSearchText,
	};
}

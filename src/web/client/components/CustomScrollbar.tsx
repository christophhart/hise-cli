// ── Custom vertical scrollbar overlay ───────────────────────────────
//
// Hides the native scrollbar on the target element and renders a slim
// overlay matching Monaco's vs-dark scrollbar palette. Works on Safari
// (which won't style the legacy Aqua scrollbar via ::-webkit-scrollbar).

import { useEffect, useRef, useState, type RefObject } from "react";

export interface CustomScrollbarProps {
	target: RefObject<HTMLElement | null>;
}

interface State {
	visible: boolean;
	thumbTop: number;
	thumbHeight: number;
}

export function CustomScrollbar({ target }: CustomScrollbarProps) {
	const [state, setState] = useState<State>({ visible: false, thumbTop: 0, thumbHeight: 0 });
	const trackRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		const el = target.current;
		if (!el) return;
		const update = () => {
			const { scrollTop, scrollHeight, clientHeight } = el;
			if (scrollHeight <= clientHeight) {
				setState({ visible: false, thumbTop: 0, thumbHeight: 0 });
				return;
			}
			const ratio = clientHeight / scrollHeight;
			const thumbHeight = Math.max(24, ratio * clientHeight);
			const maxThumbTop = clientHeight - thumbHeight;
			const maxScroll = scrollHeight - clientHeight;
			const thumbTop = maxScroll === 0 ? 0 : (scrollTop / maxScroll) * maxThumbTop;
			setState({ visible: true, thumbTop, thumbHeight });
		};
		update();
		el.addEventListener("scroll", update, { passive: true });
		const ro = new ResizeObserver(update);
		ro.observe(el);
		// Also re-check when content size changes (children added).
		const mo = new MutationObserver(update);
		mo.observe(el, { childList: true, subtree: true, characterData: true });
		return () => {
			el.removeEventListener("scroll", update);
			ro.disconnect();
			mo.disconnect();
		};
	}, [target]);

	const onThumbMouseDown = (e: React.MouseEvent) => {
		e.preventDefault();
		const el = target.current;
		const track = trackRef.current;
		if (!el || !track) return;
		const startY = e.clientY;
		const startScroll = el.scrollTop;
		const maxScroll = el.scrollHeight - el.clientHeight;
		const maxThumbTop = track.clientHeight - state.thumbHeight;
		const onMove = (ev: MouseEvent) => {
			const delta = ev.clientY - startY;
			const scrollDelta = (delta / maxThumbTop) * maxScroll;
			el.scrollTop = startScroll + scrollDelta;
		};
		const onUp = () => {
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			document.body.style.userSelect = "";
		};
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
	};

	const onTrackMouseDown = (e: React.MouseEvent) => {
		// Click on the track (not the thumb) → page-jump in that direction.
		const el = target.current;
		const track = trackRef.current;
		if (!el || !track) return;
		const rect = track.getBoundingClientRect();
		const clickY = e.clientY - rect.top;
		if (clickY < state.thumbTop) {
			el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
		} else if (clickY > state.thumbTop + state.thumbHeight) {
			el.scrollTop = Math.min(el.scrollHeight, el.scrollTop + el.clientHeight);
		}
	};

	if (!state.visible) return null;

	return (
		<div ref={trackRef} className="custom-scrollbar" onMouseDown={onTrackMouseDown}>
			<div
				className="custom-scrollbar-thumb"
				style={{ top: state.thumbTop, height: state.thumbHeight }}
				onMouseDown={onThumbMouseDown}
			/>
		</div>
	);
}

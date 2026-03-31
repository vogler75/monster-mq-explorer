import { createSignal } from "solid-js";

type TooltipState = { text: string; x: number; y: number } | null;

export const [tooltipState, setTooltipState] = createSignal<TooltipState>(null);

export function tooltip(el: HTMLElement, accessor: () => string) {
  function show() {
    const text = accessor();
    if (!text) return;
    const rect = el.getBoundingClientRect();
    setTooltipState({ text, x: rect.left + rect.width / 2, y: rect.top });
  }
  function hide() {
    setTooltipState(null);
  }
  el.addEventListener("mouseenter", show);
  el.addEventListener("mouseleave", hide);
  el.addEventListener("click", hide);
}

declare module "solid-js" {
  namespace JSX {
    interface Directives {
      tooltip: string;
    }
  }
}

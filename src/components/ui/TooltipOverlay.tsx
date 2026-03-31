import { Show } from "solid-js";
import { tooltipState } from "./tooltip";

export function TooltipOverlay() {
  return (
    <Show when={tooltipState()}>
      {(state) => (
        <div
          class="fixed z-[9999] px-2 py-1 text-xs bg-slate-900 text-slate-100 rounded border border-slate-700 pointer-events-none whitespace-nowrap shadow-md"
          style={{
            left: `${state().x}px`,
            top: `${state().y - 6}px`,
            transform: "translate(-50%, -100%)",
          }}
        >
          {state().text}
        </div>
      )}
    </Show>
  );
}

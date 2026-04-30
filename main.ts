import {
  App,
  MarkdownPostProcessorContext,
  Plugin,
  TFile,
} from "obsidian";
import { RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

type Kind = "counter" | "switcher" | "range";

interface WidgetSpec {
  kind: Kind;
  args: string[];
  raw: string;
}

const WIDGET_PATTERN = /\b(counter|switcher|range)\(([^)\n]*)\)/g;

function parseArgs(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw.split(",").map((s) => s.trim());
}

function formatRaw(kind: Kind, args: string[]): string {
  return `${kind}(${args.join(", ")})`;
}

function toInt(s: string | undefined, fallback: number): number {
  if (s === undefined) return fallback;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : fallback;
}

function buildWidget(
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
): HTMLElement {
  const root = document.createElement("span");
  root.className = `obsidian-kit-widget obsidian-kit-${spec.kind}`;

  if (spec.kind === "counter") {
    renderCounter(root, spec, onChange);
  } else if (spec.kind === "switcher") {
    renderSwitcher(root, spec, onChange);
  } else if (spec.kind === "range") {
    renderRange(root, spec, onChange);
  }

  return root;
}

function renderCounter(
  root: HTMLElement,
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
) {
  const value = toInt(spec.args[0], 0);
  const max = toInt(spec.args[1], 0);
  const stepProvided = spec.args.length > 2;
  const step = stepProvided ? toInt(spec.args[2], 1) : 1;

  const minus = document.createElement("button");
  minus.type = "button";
  minus.className = "obsidian-kit-btn";
  minus.textContent = "−";
  minus.disabled = value <= 0;

  const display = document.createElement("span");
  display.className = "obsidian-kit-value";
  display.textContent = `${value}/${max}`;

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "obsidian-kit-btn";
  plus.textContent = "+";
  plus.disabled = value >= max;

  const stop = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const emit = (next: number) => {
    const args: string[] = [String(next), String(max)];
    if (stepProvided) args.push(String(step));
    onChange(formatRaw("counter", args));
  };

  minus.addEventListener("click", (e) => {
    stop(e);
    if (value <= 0) return;
    emit(Math.max(0, value - step));
  });
  plus.addEventListener("click", (e) => {
    stop(e);
    if (value >= max) return;
    emit(Math.min(max, value + step));
  });

  root.appendChild(minus);
  root.appendChild(display);
  root.appendChild(plus);
}

function renderSwitcher(
  root: HTMLElement,
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
) {
  const value = (spec.args[0] ?? "false").toLowerCase() === "true";

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = `obsidian-kit-toggle ${value ? "on" : "off"}`;
  toggle.textContent = value ? "ON" : "OFF";

  toggle.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onChange(formatRaw("switcher", [String(!value)]));
  });

  root.appendChild(toggle);
}

function renderRange(
  root: HTMLElement,
  spec: WidgetSpec,
  onChange: (newRaw: string) => void
) {
  const value = toInt(spec.args[0], 0);
  const max = toInt(spec.args[1], 0);
  const stepProvided = spec.args.length > 2;
  const step = stepProvided ? toInt(spec.args[2], 1) : 1;

  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "obsidian-kit-slider";
  slider.min = "0";
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);

  const display = document.createElement("span");
  display.className = "obsidian-kit-value";
  display.textContent = `${value}/${max}`;

  slider.addEventListener("input", (e) => {
    e.stopPropagation();
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    display.textContent = `${v}/${max}`;
  });
  slider.addEventListener("change", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const v = parseInt((e.target as HTMLInputElement).value, 10);
    const args: string[] = [String(v), String(max)];
    if (stepProvided) args.push(String(step));
    onChange(formatRaw("range", args));
  });

  root.appendChild(slider);
  root.appendChild(display);
}

class ObsidianKitWidget extends WidgetType {
  constructor(
    private spec: WidgetSpec,
    private from: number,
    private to: number
  ) {
    super();
  }

  eq(other: ObsidianKitWidget): boolean {
    return (
      other.spec.raw === this.spec.raw &&
      other.from === this.from &&
      other.to === this.to
    );
  }

  toDOM(view: EditorView): HTMLElement {
    return buildWidget(this.spec, (newRaw) => {
      view.dispatch({
        changes: { from: this.from, to: this.to, insert: newRaw },
      });
    });
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildLivePreviewDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const cursor = view.state.selection.main.head;

  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    WIDGET_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIDGET_PATTERN.exec(text)) !== null) {
      const start = from + match.index;
      const end = start + match[0].length;

      if (cursor >= start && cursor <= end) continue;

      const spec: WidgetSpec = {
        kind: match[1] as Kind,
        args: parseArgs(match[2]),
        raw: match[0],
      };

      builder.add(
        start,
        end,
        Decoration.replace({
          widget: new ObsidianKitWidget(spec, start, end),
        })
      );
    }
  }

  return builder.finish();
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLivePreviewDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildLivePreviewDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

async function replaceInFile(
  app: App,
  ctx: MarkdownPostProcessorContext,
  el: HTMLElement,
  oldRaw: string,
  newRaw: string
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(ctx.sourcePath);
  if (!(file instanceof TFile)) return;

  const sectionInfo = ctx.getSectionInfo(el);

  await app.vault.process(file, (content) => {
    const lines = content.split("\n");
    if (sectionInfo) {
      for (let i = sectionInfo.lineStart; i <= sectionInfo.lineEnd; i++) {
        if (i < lines.length && lines[i].includes(oldRaw)) {
          lines[i] = lines[i].replace(oldRaw, newRaw);
          return lines.join("\n");
        }
      }
    }
    const idx = content.indexOf(oldRaw);
    if (idx === -1) return content;
    return content.slice(0, idx) + newRaw + content.slice(idx + oldRaw.length);
  });
}

export default class ObsidianKitPlugin extends Plugin {
  async onload() {
    this.registerEditorExtension(livePreviewPlugin);

    this.registerMarkdownPostProcessor((el, ctx) => {
      this.processReadingMode(el, ctx);
    });
  }

  private processReadingMode(
    el: HTMLElement,
    ctx: MarkdownPostProcessorContext
  ) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent ?? "";
      if (!/\b(counter|switcher|range)\(/.test(text)) continue;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      const regex = new RegExp(WIDGET_PATTERN.source, "g");
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, match.index))
          );
        }

        const matchedRaw = match[0];
        const spec: WidgetSpec = {
          kind: match[1] as Kind,
          args: parseArgs(match[2]),
          raw: matchedRaw,
        };

        const widgetEl = buildWidget(spec, (newRaw) => {
          void replaceInFile(this.app, ctx, el, matchedRaw, newRaw);
        });

        fragment.appendChild(widgetEl);
        lastIndex = match.index + matchedRaw.length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(
          document.createTextNode(text.slice(lastIndex))
        );
      }

      textNode.parentNode?.replaceChild(fragment, textNode);
    }
  }
}

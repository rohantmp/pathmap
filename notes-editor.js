import { markdownLite, richToMarkdown } from "./notes-format.js";

export class NotesEditor {
  constructor(source, host, title) {
    this.source = source;
    this.host = host;
    this.title = title;
    host.innerHTML = `<div class="notes-mode" role="tablist" aria-label="Notes editing mode"><button type="button" id="notes-write-tab" role="tab" aria-selected="true" aria-controls="notes-write-panel">Write</button><button type="button" id="notes-source-tab" tabindex="-1" role="tab" aria-selected="false" aria-controls="notes-source-panel">Markdown source</button></div>
        <div id="notes-write-panel" role="tabpanel" aria-labelledby="notes-write-tab"><div class="notes-toolbar" role="toolbar" aria-label="Text formatting"><label>Style <select id="notes-block" aria-label="Paragraph style"><option value="p">Paragraph</option><option value="h2">Heading 1</option><option value="h3">Heading 2</option><option value="h4">Heading 3</option></select></label><button type="button" data-notes-command="bold" aria-label="Bold" aria-pressed="false"><b>B</b></button><button type="button" data-notes-command="italic" aria-label="Italic" aria-pressed="false"><i>I</i></button><button type="button" data-notes-command="underline" aria-label="Underline" aria-pressed="false"><u>U</u></button><button type="button" data-notes-command="insertUnorderedList" aria-label="Bullet list">• List</button><button type="button" data-notes-command="insertOrderedList" aria-label="Numbered list">1. List</button><button type="button" data-notes-command="removeFormat" aria-label="Clear text formatting">Clear style</button><button type="button" data-notes-command="undo" aria-label="Undo text edit">↶</button><button type="button" data-notes-command="redo" aria-label="Redo text edit">↷</button></div><div id="export-notes-rich" class="notes-rich" role="textbox" aria-labelledby="export-notes-label" aria-multiline="true" contenteditable="true" data-placeholder="Write your survey notes here. Use the buttons above to format them."></div><p class="export-hint">Select text to format it. You can use headings and lists without typing any special symbols.</p></div>
        <div id="notes-source-panel" role="tabpanel" aria-labelledby="notes-source-tab" hidden></div><section class="notes-preview-section" aria-label="Notes preview"><strong>How it will appear</strong><div id="notes-preview" class="notes-preview"></div></section><p id="notes-status" class="export-hint" role="status"></p>`;
    for (const button of host.querySelectorAll("[data-notes-command]")) button.title=button.getAttribute("aria-label");
    host.querySelector(".notes-mode").onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const sourceMode=event.key==="End" || (event.key!=="Home" && !this.sourceMode);
      this.setMode(sourceMode);
      host.querySelector(sourceMode ? "#notes-source-tab" : "#notes-write-tab").focus();
    };
    this.rich = host.querySelector("#export-notes-rich");
    this.preview = host.querySelector("#notes-preview");
    this.writePanel = host.querySelector("#notes-write-panel");
    this.sourcePanel = host.querySelector("#notes-source-panel");
    this.sourcePanel.append(source);
    source.hidden = false;
    this.sourceMode = false;
    host.querySelector("#notes-write-tab").onclick = () => this.setMode(false);
    host.querySelector("#notes-source-tab").onclick = () => this.setMode(true);
    document.addEventListener("selectionchange", () => {
      const selection = window.getSelection();
      if (
        selection?.rangeCount &&
        this.rich.contains(selection.anchorNode) &&
        this.rich.contains(selection.focusNode)
      ) {
        this.range = selection.getRangeAt(0).cloneRange();
        this.updateToolbar();
      }
    });
    host.querySelector(".notes-toolbar").onmousedown = (e) => {
      if (e.target.closest("button")) e.preventDefault();
    };
    host.querySelector(".notes-toolbar").onclick = (e) => {
      const button = e.target.closest("[data-notes-command]");
      if (button) this.command(button.dataset.notesCommand);
    };
    host.querySelector("#notes-block").onchange = (e) =>
      this.command("formatBlock", e.target.value);
    this.rich.addEventListener("input", () => this.fromRich());
    this.rich.addEventListener("paste", (e) => {
      e.preventDefault();
      this.insertText(e.clipboardData.getData("text/plain"));
    });
    this.rich.addEventListener("drop", (e) => {
      e.preventDefault();
      this.insertText(e.dataTransfer.getData("text/plain"));
    });
    source.addEventListener("input", () => {
      this.rich.innerHTML = markdownLite(source.value);
      this.renderPreview();
    });
    title.addEventListener("input", () => this.renderPreview());
    this.setMarkdown(source.value);
  }
  setMarkdown(value) {
    this.source.value = value || "";
    this.rich.innerHTML = markdownLite(this.source.value);
    this.range = null;
    this.renderPreview();
  }
  setMode(sourceMode) {
    if (!this.sourceMode) this.fromRich();
    else this.rich.innerHTML = markdownLite(this.source.value);
    this.sourceMode = sourceMode;
    this.writePanel.hidden = sourceMode;
    this.sourcePanel.hidden = !sourceMode;
    this.host
      .querySelector("#notes-write-tab")
      .setAttribute("aria-selected", String(!sourceMode));
    this.host
      .querySelector("#notes-source-tab")
      .setAttribute("aria-selected", String(sourceMode));
    this.host.querySelector("#notes-write-tab").tabIndex = sourceMode ? -1 : 0;
    this.host.querySelector("#notes-source-tab").tabIndex = sourceMode ? 0 : -1;
    (sourceMode ? this.source : this.rich).focus();
    this.renderPreview();
  }
  restoreSelection() {
    this.rich.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    if (this.range && this.rich.contains(this.range.commonAncestorContainer))
      selection.addRange(this.range);
    else {
      const range = document.createRange();
      range.selectNodeContents(this.rich);
      range.collapse(false);
      selection.addRange(range);
    }
  }
  command(command, value = null) {
    this.restoreSelection();
    // Native editing commands retain the browser's text-edit undo history. Kept behind this adapter.
    if (
      typeof document.execCommand !== "function" ||
      (document.queryCommandSupported &&
        !document.queryCommandSupported(command))
    ) {
      this.host.querySelector("#notes-status").textContent =
        "This browser does not offer that formatting control.";
      return;
    }
    document.execCommand("styleWithCSS", false, false);
    document.execCommand(command, false, value);
    this.fromRich();
    this.updateToolbar();
    const selection = window.getSelection();
    if (selection.rangeCount) this.range = selection.getRangeAt(0).cloneRange();
  }
  insertText(text) {
    this.rich.focus();
    document.execCommand("insertText", false, text);
    this.fromRich();
  }
  fromRich() {
    this.source.value = richToMarkdown(this.rich);
    this.renderPreview();
  }
  renderPreview() {
    this.preview.replaceChildren();
    if (this.title.value.trim()) {
      const h = document.createElement("h1");
      h.className = "export-title";
      h.textContent = this.title.value;
      this.preview.append(h);
    }
    const notes = document.createElement("div");
    notes.className = "export-notes";
    notes.innerHTML = markdownLite(this.source.value);
    this.preview.append(notes);
    if (!this.title.value.trim() && !this.source.value.trim()) {
      const empty = document.createElement("p");
      empty.className = "export-hint";
      empty.textContent = "Your formatted notes will appear here.";
      this.preview.append(empty);
    }
  }
  updateToolbar() {
    for (const button of this.host.querySelectorAll(
      "[aria-pressed][data-notes-command]",
    )) {
      try {
        button.setAttribute(
          "aria-pressed",
          String(document.queryCommandState(button.dataset.notesCommand)),
        );
      } catch {}
    }
    let node = window.getSelection()?.anchorNode;
    if (node?.nodeType === 3) node = node.parentElement;
    const block = node?.closest?.("p,h2,h3,h4");
    if (block && this.rich.contains(block))
      this.host.querySelector("#notes-block").value =
        block.tagName.toLowerCase();
  }
}

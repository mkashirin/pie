import { stripVTControlCharacters } from "node:util";
import {
    Editor,
    Key,
    matchesKey,
    sliceByColumn,
    truncateToWidth,
    visibleWidth,
} from "@earendil-works/pi-tui";
import { HorizontalRule } from "@narumitw/pi-tui-kit";
const BRACKETED_PASTE_START = "\u001b[200~";
const BRACKETED_PASTE_END = "\u001b[201~";

export class QuestionnaireComponent {
    options;
    border;
    editor;
    answers;
    selectedOptions;
    page = 0;
    editorKind;
    message;
    finished = false;
    _focused = false;

    constructor(options) {
        this.options = options;
        this.border = new HorizontalRule({
            ruleStyle: (text) => options.theme.fg("border", text),
        });
        this.answers = options.questions.map(() => undefined);
        this.selectedOptions = options.questions.map(() => 0);
        const editorTheme = {
            borderColor: (text) => options.theme.fg("accent", text),
            selectList: {
                selectedPrefix: (text) => options.theme.fg("accent", text),
                selectedText: (text) => options.theme.fg("accent", text),
                description: (text) => options.theme.fg("muted", text),
                scrollInfo: (text) => options.theme.fg("dim", text),
                noMatch: (text) => options.theme.fg("warning", text),
            },
        };
        this.editor = new RawPreservingEditor(options.tui, editorTheme);
        this.editor.onChange = () => {
            this.message = undefined;
        };
        this.editor.onSubmit = (text) => this.submitEditor(text);
    }

    get focused() {
        return this._focused;
    }

    set focused(value) {
        this._focused = value;
        this.editor.focused = value && this.editorKind !== undefined;
    }

    render(width) {
        const safeWidth = Math.max(1, width);
        const padding = safeWidth > 1 ? " " : "";
        const contentWidth = Math.max(1, safeWidth - visibleWidth(padding));
        const border = this.border.render(safeWidth)[0] ?? "";
        const lines = [border, "", ...this.renderHeader(contentWidth), ""];
        if (this.isReviewPage()) {
            lines.push(...this.renderReview(contentWidth));
        } else {
            lines.push(...this.renderQuestion(contentWidth));
        }
        if (this.message) {
            lines.push(...hardWrap(this.options.theme.fg("warning", this.message), contentWidth));
        }
        lines.push("", ...wrapHintGroups(this.renderHintGroups(), contentWidth), "", border);
        return lines.map((line) => {
            if (!line || line === border) {
                return line;
            }
            return `${padding}${truncateToWidth(line, contentWidth)}`;
        });
    }

    handleInput(data) {
        if (this.finished) {
            return;
        }
        if (!this.options.isCurrent()) {
            this.finish({ kind: "closed", reason: "back" });
            return;
        }
        if (matchesKey(data, Key.ctrl("c"))) {
            this.finish({ kind: "closed", reason: "close" });
            return;
        }
        if (this.options.keybindings.matches(data, "tui.select.cancel")) {
            this.finish({ kind: "closed", reason: "back" });
            return;
        }
        if (this.editorKind) {
            this.handleEditorInput(data);
        } else {
            this.handlePageInput(data);
        }
        this.options.tui.requestRender();
    }

    invalidate() {
        this.border.invalidate();
        this.editor.invalidate();
    }

    dispose() {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.editor.focused = false;
    }

    handleEditorInput(data) {
        const keybindings = this.options.keybindings;
        if (keybindings.matches(data, "tui.input.newLine")) {
            this.editor.handleInput(data);
        } else if (keybindings.matches(data, "tui.input.submit")) {
            this.submitEditor(this.editor.getExpandedText());
        } else {
            this.editor.handleInput(data);
        }
    }

    handlePageInput(data) {
        const keybindings = this.options.keybindings;
        if (keybindings.matches(data, "tui.select.up")) {
            if (!this.isReviewPage()) {
                this.moveSelection(-1);
            }
            return;
        }
        if (keybindings.matches(data, "tui.select.down")) {
            if (!this.isReviewPage()) {
                this.moveSelection(1);
            }
            return;
        }
        if (keybindings.matches(data, "tui.select.confirm")) {
            this.submitPage();
            return;
        }
        if (keybindings.matches(data, "tui.input.tab")) {
            this.movePage(1);
            return;
        }
        if (/^[1-9]$/u.test(data) && !this.isReviewPage()) {
            const index = Number(data) - 1;
            const question = this.options.questions[this.page];
            const count = (question?.options.length ?? 0) + Number(this.options.allowCustomAnswer);
            if (index < count) {
                this.selectedOptions[this.page] = index;
                this.submitPage();
            }
            return;
        }
        if (data === "k") {
            if (!this.isReviewPage()) {
                this.moveSelection(-1);
            }
            return;
        }
        if (data === "j") {
            if (!this.isReviewPage()) {
                this.moveSelection(1);
            }
            return;
        }
        if (matchesKey(data, Key.right)) {
            this.movePage(1);
            return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
            this.movePage(-1);
            return;
        }
        if (
            this.options.allowNotes
            && noteShortcutAvailable(keybindings)
            && data.toLowerCase() === "n"
        ) {
            if (this.isReviewPage()) {
                this.message = "Return to a question to add or edit its note.";
            } else {
                this.editNote();
            }
        }
    }

    renderHintGroups() {
        const { keybindings, theme } = this.options;
        const cancel = cancelHint(theme, keybindings);
        if (this.editorKind) {
            return [
                keybindingHint(
                    theme,
                    keybindings,
                    "tui.input.submit",
                    this.editorKind === "answer" && !this.hasReviewPage() ? "submit" : "save",
                ),
                keybindingHint(theme, keybindings, "tui.input.newLine", "newline"),
                cancel,
            ];
        }
        const questions = this.hasReviewPage()
            ? rawKeyHint(theme, questionNavigationKeys(keybindings), "questions")
            : "";
        if (this.isReviewPage()) {
            return [
                keybindingHint(theme, keybindings, "tui.select.confirm", "submit"),
                cancel,
                questions,
            ];
        }
        const optionCount = this.options.questions[this.page].options.length
            + Number(this.options.allowCustomAnswer);
        return [
            rawKeyHint(theme, optionCount === 1 ? "1" : `1-${optionCount}`, "answer"),
            rawKeyHint(theme, selectionNavigationKeys(keybindings), "navigate"),
            keybindingHint(
                theme,
                keybindings,
                "tui.select.confirm",
                this.hasReviewPage() ? "select" : "submit",
            ),
            cancel,
            questions,
            ...(this.options.allowNotes && noteShortcutAvailable(keybindings)
                ? [rawKeyHint(theme, "n", "note")]
                : []),
        ];
    }

    movePage(delta) {
        const pageCount = this.options.questions.length + Number(this.hasReviewPage());
        this.page = (this.page + delta + pageCount) % pageCount;
        const answer = this.answers[this.page];
        const question = this.options.questions[this.page];
        if (answer?.wasCustom && question) {
            this.selectedOptions[this.page] = question.options.length;
        } else if (answer?.optionIndex !== undefined) {
            this.selectedOptions[this.page] = answer.optionIndex - 1;
        }
        this.message = undefined;
    }

    renderHeader(width) {
        if (!this.hasReviewPage()) {
            const question = this.options.questions[0];
            if (!question) {
                return [];
            }
            const header = sanitizeQuestionnaireText(question.header) || "Question 1";
            return [this.options.theme.fg("muted", truncateToWidth(header, width, "..."))];
        }
        return this.renderTabs(width);
    }

    renderTabs(width) {
        const reviewTab = sanitizeQuestionnaireText(this.options.labels.reviewTab) || "Review";
        const tabs = [
            ...this.options.questions.map((question, index) => {
                const label = sanitizeQuestionnaireText(question.header) || `Question ${index + 1}`;
                const answered = this.answers[index] ? "x " : "";
                return this.page === index ? `[${answered}${label}]` : `${answered}${label}`;
            }),
            ...(this.hasReviewPage() ? [this.isReviewPage() ? `[${reviewTab}]` : reviewTab] : []),
        ];
        const lines = [];
        let line = "";
        for (const tab of tabs) {
            const boundedTab = truncateToWidth(tab, width, "...");
            const candidate = line ? `${line}  ${boundedTab}` : boundedTab;
            if (line && visibleWidth(candidate) > width) {
                lines.push(this.options.theme.fg("accent", line));
                line = boundedTab;
            } else {
                line = candidate;
            }
        }
        if (line) {
            lines.push(this.options.theme.fg("accent", line));
        }
        return lines;
    }

    renderQuestion(width) {
        const question = this.options.questions[this.page];
        if (!question) {
            return [];
        }
        const lines = hardWrap(
            this.options.theme.fg(
                "accent",
                this.options.theme.bold(sanitizeQuestionnaireText(question.prompt)),
            ),
            width,
        );
        lines.push("");
        question.options.forEach((option, index) => {
            const selected = this.selectedOptions[this.page] === index;
            const cursor = selected ? ">" : " ";
            const label = `${cursor} ${index + 1}. ${sanitizeQuestionnaireText(option.label)}`;
            const chosen = this.answers[this.page]?.optionIndex === index + 1;
            const description = option.description
                ? ` - ${sanitizeQuestionnaireText(option.description)}`
                : "";
            const line = selected
                ? this.options.theme.fg("accent", `${label}${chosen ? " x" : ""}${description}`)
                : `${this.options.theme.fg("text", label)}${
                    chosen ? this.options.theme.fg("success", " x") : ""
                }${description ? this.options.theme.fg("muted", description) : ""}`;
            lines.push(
                ...hardWrapWithIndent(line, width, visibleWidth(`${cursor} ${index + 1}. `)),
            );
        });
        if (this.options.allowCustomAnswer) {
            lines.push(...this.renderCustomOption(question, width));
        }
        const answer = this.answers[this.page];
        if (answer?.wasCustom) {
            lines.push(
                ...labeledRaw(this.options.labels.answer, answer.answer, width, this.options.theme),
            );
        }
        if (answer?.note) {
            lines.push(
                ...labeledRaw(this.options.labels.note, answer.note, width, this.options.theme),
            );
        }
        if (this.editorKind) {
            lines.push(
                "",
                this.options.theme.fg(
                    "accent",
                    sanitizeQuestionnaireText(
                        this.editorKind === "answer"
                            ? this.options.labels.customAnswer
                            : this.options.labels.optionalNote,
                    ),
                ),
                ...this.editor.render(width),
            );
        }
        return lines;
    }

    renderCustomOption(question, width) {
        const customIndex = question.options.length;
        const selected = this.selectedOptions[this.page] === customIndex;
        const cursor = selected ? ">" : " ";
        const label = `${cursor} ${customIndex + 1}. ${
            sanitizeQuestionnaireText(this.options.labels.otherOption)
        }`;
        const chosen = this.answers[this.page]?.wasCustom === true;
        const line = selected
            ? this.options.theme.fg("accent", `${label}${chosen ? " x" : ""}`)
            : `${this.options.theme.fg("text", label)}${
                chosen ? this.options.theme.fg("success", " x") : ""
            }`;
        return hardWrapWithIndent(line, width, visibleWidth(`${cursor} ${customIndex + 1}. `));
    }

    renderReview(width) {
        const reviewTitle = sanitizeQuestionnaireText(this.options.labels.reviewTitle)
            || "Review answers";
        const lines = [
            ...hardWrap(
                this.options.theme.fg("accent", this.options.theme.bold(reviewTitle)),
                width,
            ),
            "",
        ];
        const noteLabel = sanitizeQuestionnaireText(this.options.labels.note) || "Note";
        this.options.questions.forEach((question, index) => {
            const answer = this.answers[index];
            const header = sanitizeQuestionnaireText(question.header) || `Question ${index + 1}`;
            const label = `${index + 1}. ${header}`;
            const summary = ` - ${inlineSummary(answer?.answer ?? "Unanswered")}${
                answer?.note ? ` | ${noteLabel}: ${inlineSummary(answer.note)}` : ""
            }`;
            const line = `${this.options.theme.fg("text", label)}${
                this.options.theme.fg("muted", summary)
            }`;
            lines.push(...hardWrapWithIndent(line, width, visibleWidth(`${index + 1}. `)));
        });
        return lines;
    }

    moveSelection(delta) {
        const question = this.options.questions[this.page];
        const optionCount = (question?.options.length ?? 0)
            + Number(this.options.allowCustomAnswer);
        if (optionCount === 0) {
            return;
        }
        this.selectedOptions[this.page] =
            ((this.selectedOptions[this.page] ?? 0) + delta + optionCount) % optionCount;
    }

    submitPage() {
        if (this.isReviewPage()) {
            if (this.answers.some((answer) => !answer)) {
                this.message = "Answer every question before submitting.";
                return;
            }
            this.finish({
                kind: "submitted",
                answers: this.answers.filter((answer) => answer !== undefined),
            });
            return;
        }
        const question = this.options.questions[this.page];
        if (!question) {
            return;
        }
        const selected = this.selectedOptions[this.page] ?? 0;
        if (this.options.allowCustomAnswer && selected === question.options.length) {
            this.beginEditor(
                "answer",
                this.answers[this.page]?.wasCustom ? this.answers[this.page]?.answer : "",
            );
            return;
        }
        const option = question.options[selected];
        if (!option) {
            return;
        }
        const previous = this.answers[this.page];
        this.answers[this.page] = answerFor(question.id, option.label, {
            wasCustom: false,
            optionIndex: selected + 1,
            note: previous?.optionIndex === selected + 1 ? previous.note : undefined,
        });
        this.advance();
    }

    editNote() {
        const index = this.page;
        let answer = this.answers[index];
        const question = this.options.questions[index];
        const selected = this.selectedOptions[index] ?? 0;
        if (
            question
            && this.options.allowCustomAnswer
            && selected === question.options.length
            && !answer?.wasCustom
        ) {
            this.beginEditor("answer", "");
            return;
        }
        if (
            question && selected < question.options.length && answer?.optionIndex !== selected + 1
        ) {
            const option = question.options[selected];
            if (option) {
                answer = answerFor(question.id, option.label, {
                    wasCustom: false,
                    optionIndex: selected + 1,
                });
                this.answers[index] = answer;
            }
        }
        if (!answer) {
            this.message = "Select an answer before adding a note.";
            return;
        }
        this.beginEditor("note", answer.note ?? "");
    }

    beginEditor(kind, value) {
        this.editorKind = kind;
        this.editor.setText(value ?? "");
        this.editor.focused = this._focused;
        this.message = undefined;
    }

    submitEditor(value) {
        if (this.options.maxTextLength !== undefined && value.length > this.options.maxTextLength) {
            this.editor.setText(value);
            this.message = `${this.editorKind === "answer" ? "Answer" : "Note"} must be ${
                formatLimit(this.options.maxTextLength)
            } characters or fewer.`;
            this.options.tui.requestRender();
            return;
        }
        const index = this.page;
        if (this.editorKind === "answer") {
            if (!value.trim()) {
                this.editor.setText(value);
                this.message = "Custom answer cannot be empty.";
                this.options.tui.requestRender();
                return;
            }
            const question = this.options.questions[index];
            if (!question) {
                return;
            }
            const previous = this.answers[index];
            this.answers[index] = answerFor(question.id, value, {
                wasCustom: true,
                note: previous?.wasCustom ? previous.note : undefined,
            });
            this.editor.setText("");
            this.editorKind = undefined;
            this.editor.focused = false;
            this.advance();
            return;
        }
        const answer = this.answers[index];
        if (answer) {
            answer.note = value.trim() ? value : undefined;
        }
        this.editor.setText("");
        this.editorKind = undefined;
        this.editor.focused = false;
        this.message = value.trim() ? "Note saved." : "Note cleared.";
        this.options.tui.requestRender();
    }

    advance() {
        if (!this.hasReviewPage()) {
            const answers = this.answers.filter((answer) => answer !== undefined);
            this.finish({ kind: "submitted", answers });
            return;
        }
        this.page = Math.min(this.page + 1, this.options.questions.length);
        this.message = undefined;
    }

    hasReviewPage() {
        return this.options.questions.length > 1;
    }

    isReviewPage() {
        return this.hasReviewPage() && this.page === this.options.questions.length;
    }

    finish(value) {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.editor.focused = false;
        this.options.onDone(value);
    }
}

class RawPreservingEditor {
    editor;
    rawByMarker = new Map();
    markerCodePoint = 0xe000;
    pasteBuffer;

    constructor(tui, theme) {
        this.editor = new Editor(tui, theme, { paddingX: 0 });
    }

    get focused() {
        return this.editor.focused;
    }

    set focused(value) {
        this.editor.focused = value;
    }

    set onChange(handler) {
        this.editor.onChange = handler ? () => handler(this.getExpandedText()) : undefined;
    }

    set onSubmit(handler) {
        this.editor.onSubmit = handler ? (value) => handler(this.decode(value)) : undefined;
    }

    handleInput(data) {
        if (this.pasteBuffer !== undefined) {
            this.pasteBuffer += data;
            this.flushPasteBuffer();
            return;
        }
        if (matchesKey(data, Key.backspace)) {
            this.editor.handleInput(data);
            return;
        }
        const pasteStart = data.indexOf(BRACKETED_PASTE_START);
        if (pasteStart >= 0) {
            if (pasteStart > 0) {
                this.editor.handleInput(data.slice(0, pasteStart));
            }
            this.pasteBuffer = data.slice(pasteStart + BRACKETED_PASTE_START.length);
            this.flushPasteBuffer();
            return;
        }
        if (
            [...data].some((character) =>
                isUnsafeDirectEditorCharacter(character) || this.rawByMarker.has(character)
            )
        ) {
            this.editor.handleInput(this.encode(data));
            return;
        }
        this.editor.handleInput(data);
    }

    render(width) {
        return this.editor
            .render(width)
            .map((line) =>
                [...line].map((character) => (this.rawByMarker.has(character) ? " " : character))
                    .join("")
            );
    }

    invalidate() {
        this.editor.invalidate();
    }

    setText(value) {
        this.rawByMarker.clear();
        this.markerCodePoint = 0xe000;
        this.pasteBuffer = undefined;
        this.editor.setText(this.encode(value));
    }

    getExpandedText() {
        return this.decode(this.editor.getExpandedText());
    }

    flushPasteBuffer() {
        if (this.pasteBuffer === undefined) {
            return;
        }
        const pasteEnd = this.pasteBuffer.indexOf(BRACKETED_PASTE_END);
        if (pasteEnd < 0) {
            return;
        }
        const raw = this.pasteBuffer.slice(0, pasteEnd);
        const remaining = this.pasteBuffer.slice(pasteEnd + BRACKETED_PASTE_END.length);
        this.pasteBuffer = undefined;
        this.editor.handleInput(
            `${BRACKETED_PASTE_START}${this.encode(raw)}${BRACKETED_PASTE_END}`,
        );
        if (remaining) {
            this.handleInput(remaining);
        }
    }

    encode(value) {
        const forbidden = new Set([
            ...value,
            ...this.editor.getExpandedText(),
            ...this.rawByMarker.keys(),
        ]);
        return [...value]
            .map((character) => {
                if (!isUnsafeEditorCharacter(character) && !this.rawByMarker.has(character)) {
                    return character;
                }
                const marker = this.nextMarker(forbidden);
                this.rawByMarker.set(marker, character);
                forbidden.add(marker);
                return marker;
            })
            .join("");
    }

    decode(value) {
        return [...value].map((character) => this.rawByMarker.get(character) ?? character).join("");
    }

    nextMarker(forbidden) {
        for (;;) {
            if (this.markerCodePoint === 0xf900) {
                this.markerCodePoint = 0xf0000;
            }
            if (this.markerCodePoint === 0xffffe) {
                this.markerCodePoint = 0x100000;
            }
            if (this.markerCodePoint > 0x10fffd) {
                throw new Error("Questionnaire editor exhausted its safe input markers");
            }
            const marker = String.fromCodePoint(this.markerCodePoint++);
            if (!forbidden.has(marker)) {
                return marker;
            }
        }
    }
}

function isUnsafeDirectEditorCharacter(character) {
    const codePoint = character.codePointAt(0) ?? 0;
    return ((codePoint >= 0x7f && codePoint <= 0x9f)
        || codePoint === 0x2028
        || codePoint === 0x2029
        || isBidiControl(codePoint));
}

function isUnsafeEditorCharacter(character) {
    const codePoint = character.codePointAt(0) ?? 0;
    return (character !== "\n"
        && (codePoint <= 0x1f
            || (codePoint >= 0x7f && codePoint <= 0x9f)
            || codePoint === 0x2028
            || codePoint === 0x2029
            || isBidiControl(codePoint)));
}

function isBidiControl(codePoint) {
    return (codePoint === 0x061c
        || codePoint === 0x200e
        || codePoint === 0x200f
        || (codePoint >= 0x202a && codePoint <= 0x202e)
        || (codePoint >= 0x2066 && codePoint <= 0x2069));
}

function sanitizeQuestionnaireText(value) {
    return [...stripVTControlCharacters(value)]
        .map((character) => {
            const codePoint = character.codePointAt(0) ?? 0;
            return codePoint <= 0x1f
                    || (codePoint >= 0x7f && codePoint <= 0x9f)
                    || codePoint === 0x2028
                    || codePoint === 0x2029
                    || isBidiControl(codePoint)
                ? " "
                : character;
        })
        .join("");
}

function answerFor(questionId, answer, options) {
    return {
        questionId,
        answer,
        wasCustom: options.wasCustom,
        ...(options.optionIndex === undefined ? {} : { optionIndex: options.optionIndex }),
        ...(options.note === undefined ? {} : { note: options.note }),
    };
}

function keybindingHint(theme, keybindings, keybinding, description) {
    return rawKeyHint(theme, formatHintKeys(keybindings.getKeys(keybinding)), description);
}

function rawKeyHint(theme, keys, description) {
    if (!keys) {
        return "";
    }
    return `${theme.fg("dim", keys)}${theme.fg("muted", ` ${description}`)}`;
}

function cancelHint(theme, keybindings) {
    return rawKeyHint(
        theme,
        formatHintKeys([...keybindings.getKeys("tui.select.cancel"), "ctrl+c"]),
        "cancel",
    );
}

function selectionNavigationKeys(keybindings) {
    const up = keybindings.getKeys("tui.select.up");
    const down = keybindings.getKeys("tui.select.down");
    if (up.includes("up") && down.includes("down")) {
        return formatHintKeys([
            "^v",
            ...up.filter((key) => key !== "up"),
            ...down.filter((key) => key !== "down"),
        ]);
    }
    return formatHintKeys([...up, ...down]);
}

function questionNavigationKeys(keybindings) {
    const conflictingKeys = new Set(
        ["tui.select.cancel", "tui.select.up", "tui.select.down", "tui.select.confirm"].flatMap((
            binding,
        ) => keybindings.getKeys(binding)),
    );
    const keys = keybindings
        .getKeys("tui.input.tab")
        .filter((key) => !conflictingKeys.has(key));
    const left = !conflictingKeys.has("left");
    const right = !conflictingKeys.has("right");
    if (!conflictingKeys.has("shift+tab")) {
        keys.push("shift+tab");
    }
    if (left && right) {
        keys.push("<>");
    } else if (left) {
        keys.push("<");
    } else if (right) {
        keys.push(">");
    }
    return formatHintKeys(keys);
}

function noteShortcutAvailable(keybindings) {
    return ![
        "tui.select.cancel",
        "tui.select.up",
        "tui.select.down",
        "tui.select.confirm",
        "tui.input.tab",
    ].some((binding) => keybindings.getKeys(binding).includes("n"));
}

function formatHintKeys(keys) {
    return [...new Set(keys)].map(formatHintKey).join("/");
}

function formatHintKey(key) {
    return key
        .split("+")
        .map((part) =>
            process.platform === "darwin" && part.toLowerCase() === "alt" ? "option" : part
        )
        .join("+");
}

function inlineSummary(value) {
    return value.split("\n").map(sanitizeQuestionnaireText).join(" / ");
}

function labeledRaw(label, value, width, theme) {
    const safeLabel = sanitizeQuestionnaireText(label);
    const prefix = `${safeLabel}: `;
    const safe = sanitizeQuestionnaireText(value);
    return hardWrapWithIndent(`${theme.fg("muted", prefix)}${safe}`, width, visibleWidth(prefix));
}

function wrapHintGroups(groups, width) {
    const safeWidth = Math.max(1, width);
    const lines = [];
    let line = "";
    for (const group of groups) {
        if (!group) {
            continue;
        }
        const candidate = line ? `${line}  ${group}` : group;
        if (line && visibleWidth(candidate) > safeWidth) {
            lines.push(line);
            line = "";
        }
        if (visibleWidth(group) <= safeWidth) {
            line = line ? `${line}  ${group}` : group;
            continue;
        }
        const wrapped = hardWrap(group, safeWidth);
        lines.push(...wrapped.slice(0, -1));
        line = wrapped.at(-1) ?? "";
    }
    if (line) {
        lines.push(line);
    }
    return lines.length > 0 ? lines : [""];
}

// Keep upstream call sites; locally these helpers wrap at whitespace, not columns.
// Slice complete styled words from the original so ANSI state survives every row.
// As in the menu pickers, an oversized token is ellipsized, never fragmented.
function hardWrapWithIndent(value, width, indent) {
    const safeWidth = Math.max(1, Math.floor(width));
    const safeIndent = Math.max(0, Math.floor(indent));
    if (safeIndent >= safeWidth) {
        return [truncateToWidth(value, safeWidth, "...")];
    }
    const contentWidth = safeWidth - safeIndent;
    const prefix = sliceByColumn(value, 0, safeIndent, true);
    const plainContent = stripVTControlCharacters(
        sliceByColumn(value, safeIndent, visibleWidth(value), true),
    );
    const output = [];
    let line = prefix;
    let lineWidth = 0;
    let column = safeIndent;
    let previousEnd = 0;
    for (const match of plainContent.matchAll(/\S+/gu)) {
        column += visibleWidth(plainContent.slice(previousEnd, match.index));
        const wordWidth = visibleWidth(match[0]);
        const word = truncateToWidth(
            sliceByColumn(value, column, wordWidth, true),
            contentWidth,
            "...",
        );
        const boundedWidth = visibleWidth(word);
        if (lineWidth && lineWidth + 1 + boundedWidth > contentWidth) {
            output.push(line);
            line = " ".repeat(safeIndent);
            lineWidth = 0;
        }
        line += `${lineWidth ? " " : ""}${word}`;
        lineWidth += (lineWidth ? 1 : 0) + boundedWidth;
        column += wordWidth;
        previousEnd = match.index + match[0].length;
    }
    output.push(line);
    return output;
}

function hardWrap(value, width) {
    return value.split("\n").flatMap((line) => hardWrapWithIndent(line, width, 0));
}

function formatLimit(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ",");
}

// Resolved upstream argument metadata; no source implementations.
export const resolvedArguments: Record<string, unknown> = {
    "normal||W": {
        "ignore_punctuation": true,
    },
    "select||W": {
        "ignore_punctuation": true,
    },
    "normal||E": {
        "ignore_punctuation": true,
    },
    "select||E": {
        "ignore_punctuation": true,
    },
    "normal||B": {
        "ignore_punctuation": true,
    },
    "select||B": {
        "ignore_punctuation": true,
    },
    "normal||g|E": {
        "ignore_punctuation": true,
    },
    "select||g|E": {
        "ignore_punctuation": true,
    },
    "normal||?": {
        "backwards": true,
    },
    "select||?": {
        "backwards": true,
    },
    "normal||f": {
        "before": false,
        "multiline": true,
    },
    "select||f": {
        "before": false,
        "multiline": true,
    },
    "normal||t": {
        "before": true,
        "multiline": true,
    },
    "select||t": {
        "before": true,
        "multiline": true,
    },
    "normal||F": {
        "after": false,
        "multiline": true,
    },
    "select||F": {
        "after": false,
        "multiline": true,
    },
    "normal||T": {
        "after": true,
        "multiline": true,
    },
    "select||T": {
        "after": true,
        "multiline": true,
    },
    "normal||'": {
        "line": true,
    },
    "select||'": {
        "line": true,
    },
    "normal||`": {
        "line": false,
    },
    "select||`": {
        "line": false,
    },
    "normal||g|>": {
        "replace_newest": true,
    },
    "select||g|>": {
        "replace_newest": true,
    },
    "normal||g|<": {
        "replace_newest": true,
    },
    "select||g|<": {
        "replace_newest": true,
    },
    "normal||g|*": {
        "partial_word": true,
    },
    "select||g|*": {
        "partial_word": true,
    },
    "normal||g|#": {
        "partial_word": true,
    },
    "select||g|#": {
        "partial_word": true,
    },
    "select||g|j": {
        "display_lines": true,
    },
    "select||g|down": {
        "display_lines": true,
    },
    "select||g|k": {
        "display_lines": true,
    },
    "select||g|up": {
        "display_lines": true,
    },
    "normal||g|$": {
        "display_lines": true,
    },
    "select||g|$": {
        "display_lines": true,
    },
    "normal||g|end": {
        "display_lines": true,
    },
    "select||g|end": {
        "display_lines": true,
    },
    "normal||g|0": {
        "display_lines": true,
    },
    "select||g|0": {
        "display_lines": true,
    },
    "normal||g|home": {
        "display_lines": true,
    },
    "select||g|home": {
        "display_lines": true,
    },
    "normal||g|M": {
        "display_lines": true,
    },
    "select||g|M": {
        "display_lines": true,
    },
    "normal||g|^": {
        "display_lines": true,
    },
    "select||g|^": {
        "display_lines": true,
    },
    "normal||z|enter": "z t ^",
    "select||z|enter": "z t ^",
    "normal||z|+": "shift-l j z t ^",
    "select||z|+": "shift-l j z t ^",
    "normal||z|^": "shift-h k z b ^",
    "select||z|^": "shift-h k z b ^",
    "normal||z|.": "z z ^",
    "select||z|.": "z z ^",
    "normal||Z|Q": {
        "save_intent": "skip",
    },
    "select||Z|Q": {
        "save_intent": "skip",
    },
    "normal||Z|Z": {
        "save_intent": "save_all",
    },
    "select||Z|Z": {
        "save_intent": "save_all",
    },
    "normal||1": 1,
    "select||1": 1,
    "normal||2": 2,
    "select||2": 2,
    "normal||3": 3,
    "select||3": 3,
    "normal||4": 4,
    "select||4": 4,
    "normal||5": 5,
    "select||5": 5,
    "normal||6": 6,
    "select||6": 6,
    "normal||7": 7,
    "select||7": 7,
    "normal||8": 8,
    "select||8": 8,
    "normal||9": 9,
    "select||9": 9,
    "insert||ctrl+w": {
        "ignore_newlines": false,
        "ignore_brackets": false,
    },
    "insert||ctrl+k": {},
    "insert||ctrl+v": {},
    "insert||ctrl+q": {},
    "insert||ctrl+Q": {},
    "normal||P": {
        "before": true,
    },
    "normal||j": {
        "display_lines": true,
    },
    "normal||down": {
        "display_lines": true,
    },
    "normal||k": {
        "display_lines": true,
    },
    "normal||up": {
        "display_lines": true,
    },
    "select||P": {
        "before": true,
    },
    "normal||alt+s": {
        "keep_selections": true,
    },
    "select||alt+s": {
        "keep_selections": true,
    },
    "normal||ctrl+c": {
        "advance_downwards": false,
        "comment_empty_lines": false,
    },
    "select||ctrl+c": {
        "advance_downwards": false,
        "comment_empty_lines": false,
    },
    "normal||space|c": {
        "advance_downwards": false,
        "comment_empty_lines": false,
    },
    "select||space|c": {
        "advance_downwards": false,
        "comment_empty_lines": false,
    },
    "normal||]": {
        "around": true,
    },
    "select||]": {
        "around": true,
    },
    "normal||[": {
        "around": true,
    },
    "select||[": {
        "around": true,
    },
    "replace||ctrl+k": {},
    "replace||ctrl+v": {},
    "replace||ctrl+q": {},
    "replace||ctrl+Q": {},
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|W":
        {
            "ignore_punctuation": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|W":
        {
            "ignore_punctuation": true,
        },
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|(":
        {
            "opening": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|(":
        {
            "opening": true,
        },
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|[":
        {
            "opening": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|[":
        {
            "opening": true,
        },
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|{":
        {
            "opening": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|{":
        {
            "opening": true,
        },
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|<":
        {
            "opening": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|<":
        {
            "opening": true,
        },
    "normal|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|I":
        {
            "include_below": true,
        },
    "select|vim_operator == a || vim_operator == i || vim_operator == cs || vim_operator == helix_next || vim_operator == helix_previous|I":
        {
            "include_below": true,
        },
    "normal|vim_operator == helix_m|m": {
        "match_quotes": true,
    },
    "select|vim_operator == helix_m|m": {
        "match_quotes": true,
    },
    "normal|vim_operator == helix_previous|B": 0,
    "select|vim_operator == helix_previous|B": 0,
};

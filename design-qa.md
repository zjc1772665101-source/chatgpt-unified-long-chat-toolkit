# Design QA — v1.0.4 prompt cards

Reference: the user-provided dark hover action strip from Ophel Atlas.

## Visual checks

- Default state keeps card actions hidden (`opacity: 0`, no pointer events).
- Hover state reveals two compact icon buttons: pin and edit.
- Action buttons retain accessible Chinese `aria-label` and `title` text.
- Long titles use single-line ellipsis while preserving the complete title tooltip.
- The card body remains the primary click target for inserting a prompt.
- Touch devices keep actions visible; keyboard focus reveals them with `:focus-within`.

## Interaction checks

- Drag handlers provide before/after drop indicators and suppress the accidental click that may follow a drag.
- Reorder state is normalized to sequential `order` values and persisted through the existing prompt-library storage path.
- Runtime smoke case: moving `c` before `a` produces `c, a, b`, with sequential order values.
- Visual browser QA confirmed hidden/default state, hover/icon state, long-title overflow, and a clean error/warning console.

## Compatibility checks

- Existing pin and edit behavior is preserved.
- Delete remains inside the editor, as requested.
- No visible input, copy, or delete action buttons were reintroduced on prompt cards.
- Reduced-motion and coarse-pointer fallbacks are included.

final result: passed

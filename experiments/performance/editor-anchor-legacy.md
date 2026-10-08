# Existing legacy empty-atom ambiguity

Both baseline and candidate EditorElement public contracts reproduce this:

- Old source atoms: `("multi","ab"), ("empty",""), ("last","c")`.
- Three atoms and three code points trigger the current `anchor()` scalar shortcut.
- Source caret at2 is incorrectly assigned `empty` instead of the preceding `multi` atom.
- Updated source atoms: `("last","c"), ("empty","")`.
- Both versions retain caret1. The legacy cumulative UTF16 anchor contract would choose0 because `multi` was removed with no preceding survivor.

Logs: `/tmp/alkalye-anchor-{contracts,baseline-contracts}.log`. This is an explicit pending correctness issue; the portable seven-contract suite does not freeze the incorrect result as expected behavior. No hot full-array validation was added. A future exact scalar-source summary should come from the deep atom/source module and preserve zero-width frontmatter atoms, rather than guessing from equal counts in the editor.

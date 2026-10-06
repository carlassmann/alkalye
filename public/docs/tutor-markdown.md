---
path: Tutor
---

# Markdown Tutor

Learn markdown syntax. Plain text, beautifully formatted.

---

## Text formatting

Wrap text in symbols to style it:

- **Bold** - `**bold**` or `__bold__`
- _Italic_ - `*italic*` or `_italic_`
- ~~Strikethrough~~ - `~~strikethrough~~`
- ==Highlight== - `==highlight==`
- `Code` - surround with backticks

Combine them: **_bold italic_**, ~~**strikethrough bold**~~

---

## Headings

Start a line with `#` symbols:

```
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
```

More `#` = smaller heading.

---

## Links

```
[Link text](https://example.com)
[Link with title](https://example.com "Title on hover")
```

Examples:

- [alkalye](https://alkalye.com)
- [GitHub](https://github.com "Go to GitHub")

---

## Images

```
![Alt text](https://example.com/image.jpg)
![Alt text](https://example.com/image.jpg "Optional title")
```

Alt text describes the image for accessibility.

---

## Lists

### Unordered

Use `-`, `*`, or `+`:

```
- First item
- Second item
- Third item
```

- First item
- Second item
- Third item

### Ordered

Use numbers:

```
1. First
2. Second
3. Third
```

1. First
2. Second
3. Third

### Task lists

```
- [ ] Unchecked task
- [x] Completed task
```

- [ ] Unchecked task
- [x] Completed task

### Nested lists

Indent with 2 spaces or a tab:

```
- Parent
  - Child
  - Another child
    - Grandchild
```

- Parent
  - Child
  - Another child
    - Grandchild

---

## Blockquotes

Start lines with `>`:

```
> This is a quote.
> It can span multiple lines.
>
> Add empty lines for paragraphs.
```

> This is a quote.
> It can span multiple lines.
>
> Add empty lines for paragraphs.

Nest quotes with multiple `>`:

> Level 1
>
> > Level 2
> >
> > > Level 3

---

## Code

### Inline code

Wrap with single backticks:

```
Use `console.log()` to debug.
```

Use `console.log()` to debug.

### Code blocks

Wrap with triple backticks. Add the language for syntax highlighting:

````
```javascript
function hello() {
  console.log("Hello, world!")
}
```
````

```javascript
function hello() {
	console.log("Hello, world!")
}
```

---

## Horizontal rules

Three or more dashes, asterisks, or underscores:

```
---
***
___
```

Creates a divider like this:

---

## Tables

```
| Header 1 | Header 2 | Header 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

| Header 1 | Header 2 | Header 3 |
| -------- | -------- | -------- |
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |

Align columns with colons:

```
| Left | Center | Right |
|:-----|:------:|------:|
| L    |   C    |     R |
```

| Left | Center | Right |
| :--- | :----: | ----: |
| L    |   C    |     R |

---

## Escaping

Use backslash to show literal characters:

```
\*not italic\*
\# not a heading
\[not a link\]
```

\*not italic\*
\# not a heading
\[not a link\]

---

## Line breaks

End a line with two spaces for a line break within a paragraph.  
Like this.

Or use a blank line for a new paragraph.

---

## HTML

Markdown supports inline HTML:

```html
<details>
	<summary>Click to expand</summary>
	Hidden content here.
</details>
```

<details>
<summary>Click to expand</summary>
Hidden content here.
</details>

---

That's markdown. Simple syntax, beautiful results.

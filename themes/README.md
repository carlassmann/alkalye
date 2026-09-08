# Alkalye Themes

Example themes for testing the Alkalye theming system.

For new themes, start with the [theme authoring guide](../public/docs/theming-guide.md) and Alkalye's **New from default** action. The packages below are older examples; use the guide for current selectors and source format.

## Available Themes

### Minimalist

Clean, modern, and breathable with lots of white space.

- **Font**: Inter (Google Fonts)
- **Character**: Modern, minimal, professional
- **Presets**: Light, Dark
- **Best for**: Technical documentation, notes, modern prose

### Classic

Timeless typography with book-like elegance.

- **Font**: Playfair Display + Crimson Pro (Google Fonts)
- **Character**: Traditional, sophisticated, literary
- **Presets**: Paper, Ink
- **Best for**: Essays, articles, book chapters

### Technical

Code-focused with monospace fonts and terminal aesthetics.

- **Font**: JetBrains Mono + Space Mono (Google Fonts)
- **Character**: Utilitarian, precise, developer-focused
- **Presets**: Terminal Light, Terminal Dark
- **Best for**: Technical docs, code tutorials, developer guides

### Playful

Fun and vibrant with rounded fonts and colorful accents.

- **Font**: Fredoka + Quicksand (Google Fonts)
- **Character**: Cheerful, friendly, energetic
- **Presets**: Sunny, Berry, Ocean, Night
- **Best for**: Creative writing, personal blogs, tutorials

### Elegant

Sophisticated and refined with luxurious typography.

- **Font**: Cormorant Garamond + Montserrat (Google Fonts)
- **Character**: Luxurious, polished, premium
- **Presets**: Champagne, Midnight, Rose Gold
- **Best for**: Portfolio pieces, high-end publications, luxury content

## How to Use

### Option 1: Upload via Settings

1. Navigate to Settings > Themes in Alkalye
2. Click "Upload Theme"
3. Select a theme's zip file
4. Theme will appear in your themes list

### Option 2: Create Theme Zip

Each theme directory contains all necessary files. To create a zip:

```bash
# For Minimalist theme
cd themes/minimalist
zip ../minimalist.zip theme.json styles.css presets.json document.html

# For other themes
cd themes/classic
zip ../classic.zip theme.json styles.css presets.json document.html

# And so on...
```

Then upload the zip file in Settings.

### Using Themes in Documents

Add to your document frontmatter:

```markdown
---
title: My Document
theme: Minimalist
preset: Light
---

Your content here...
```

For slideshow mode:

```markdown
---
title: My Presentation
theme: Technical
preset: Terminal Dark
---

Slide content...
```

## Theme Customization

### Modifying Presets

Edit `presets.json` to add or modify color presets:

```json
{
	"presets": [
		{
			"name": "Custom",
			"appearance": "light",
			"colors": {
				"background": "#ffffff",
				"foreground": "#000000",
				"accent": "#0066cc",
				"heading": "#000000",
				"link": "#0066cc",
				"codeBackground": "#f5f5f5"
			}
		}
	]
}
```

### Adding Custom CSS

Edit `styles.css` to customize the visual appearance. Available CSS variables:

- `--preset-background`: Background color
- `--preset-foreground`: Text color
- `--preset-accent`: Primary accent color
- `--preset-accent-1` through `--preset-accent-6`: Accent palette
- `--preset-heading`: Heading color
- `--preset-link`: Link color
- `--preset-code-background`: Code block background

### Using Google Fonts

Import Google Fonts via `@import` at the top of `styles.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=FontName:wght@400;500;600&display=swap");

[data-theme] {
	--font-base: "FontName", sans-serif;
}

[data-theme] article {
	font-family: var(--font-base);
}
```

## Theme Structure

Required files:

- `theme.json`: Theme manifest (name, type, css path, presets path)
- `styles.css`: Main stylesheet

Optional files:

- `presets.json`: Color and font presets
- `document.html`: Custom HTML template for preview mode
- `slide.html`: Custom HTML template for slideshow mode
- `source.md`: Markdown theme source
- `fonts/`: Custom font files (woff2, woff, ttf, otf)

## License

These themes are provided as examples for testing the Alkalye theming system. Feel free to use, modify, and distribute them as you wish.

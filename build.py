from pathlib import Path
import json, re

root=Path(__file__).parent
icons=json.loads((root/'assets/icons.json').read_text())
license_text=(root/'PHOSPHOR-LICENSE.txt').read_text()
template=(root/'index.template.html').read_text()
template=template.replace('/* STYLES */',(root/'styles.css').read_text())
template=template.replace('/* ICONS */','const ICONS = '+json.dumps(icons,ensure_ascii=False)+';')
template=template.replace('/* MODEL */',re.sub(r'\bexport\s+','',(root/'model.mjs').read_text()))
template=template.replace('/* APP */',(root/'app.js').read_text())
template=template.replace('@@X@@',icons['x'])
template=template.replace('</body>','<!-- Phosphor Icons, MIT License. Copyright (c) 2020 Phosphor Icons.\n'+license_text+'\n-->\n</body>')
(root/'index.html').write_text(template)
print(f'Built {root / "index.html"} ({len(template.encode()):,} bytes)')

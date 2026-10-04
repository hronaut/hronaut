"""Generate original synthetic rectangle glyph fixtures; requires fontTools 4.61.1.

No third-party font artwork or metadata. Not an application/build dependency.
Only A or B exists in each font, forcing deterministic mixed-font fallback.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

for suffix in ('A', 'B'):
    font = FontBuilder(1000, isTTF=True)
    font.setupGlyphOrder(['.notdef', suffix])
    font.setupCharacterMap({ord(suffix): suffix})
    glyphs = {}
    for name in ['.notdef', suffix]:
        pen = TTGlyphPen(None)
        pen.moveTo((100, 0))
        pen.lineTo((500, 0))
        pen.lineTo((500, 700))
        pen.lineTo((100, 700))
        pen.closePath()
        glyphs[name] = pen.glyph()
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({name: (600, 0) for name in glyphs})
    font.setupHorizontalHeader(ascent=800, descent=-200)
    family = 'Hronaut Fixture ' + suffix
    font.setupNameTable({'familyName': family, 'styleName': 'Regular',
                        'uniqueFontIdentifier': family, 'fullName': family,
                        'psName': 'HronautFixture' + suffix})
    font.setupOS2(sTypoAscender=800, sTypoDescender=-200,
                 usWinAscent=800, usWinDescent=200)
    font.setupPost()
    font.setupMaxp()
    font.font.recalcTimestamp = False
    font.font['head'].created = font.font['head'].modified = 2082844800
    font.save(Path(__file__).parent / ('fixture-' + suffix + '.ttf'))

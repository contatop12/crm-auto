# Gera os tres SVGs da marca. O texto vira contorno (Poppins SemiBold, licenca OFL):
# um SVG usado como <img> nao carrega fonte, e cada maquina mostraria uma letra diferente.
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

fonte, saida = sys.argv[1], sys.argv[2]
f = TTFont(fonte)
glifos, cmap, hmtx = f.getGlyphSet(), f.getBestCmap(), f['hmtx']
upm = f['head'].unitsPerEm
cap = f['OS/2'].sCapHeight

VIOLETA, VIOLETA_ESCURO_TEMA = '#6E56CF', '#A999EC'
TINTA, BRANCO = '#1C2024', '#FFFFFF'

def kern(a, b):
    # pares que a Poppins aperta; sem GPOS aqui, o ajuste e' a mao (em unidades da fonte)
    return {('t', 'W'): -10, ('W', 'o'): -38, ('r', 'k'): 0}.get((a, b), 0)

def palavra(texto, x0, baseline, tamanho, ant=None):
    """Contorno de `texto` comecando em x0. Devolve (path, x final)."""
    esc = tamanho / upm
    x, partes = x0, []
    for ch in texto:
        if ant: x += kern(ant, ch) * esc
        g = cmap[ord(ch)]
        pen = SVGPathPen(glifos, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        glifos[g].draw(TransformPen(pen, (esc, 0, 0, -esc, x, baseline)))
        partes.append(pen.getCommands())
        x += hmtx[g][0] * esc
        ant = ch
    return ''.join(partes), x

def simbolo(x=0, y=0, lado=64, fundo=VIOLETA, traco=BRANCO):
    e = lado / 64
    p = lambda v: ('%.2f' % (v * e)).rstrip('0').rstrip('.')
    return (
        f'<g transform="translate({x} {y})">'
        f'<rect width="{p(64)}" height="{p(64)}" rx="{p(17)}" fill="{fundo}"/>'
        f'<path d="M{p(15)} {p(19)}C{p(28)} {p(19)} {p(28)} {p(32)} {p(41)} {p(32)}M{p(15)} {p(32)}H{p(41)}'
        f'M{p(15)} {p(45)}C{p(28)} {p(45)} {p(28)} {p(32)} {p(41)} {p(32)}" '
        f'stroke="{traco}" stroke-width="{p(5.5)}" stroke-linecap="round" fill="none"/>'
        f'<circle cx="{p(45)}" cy="{p(32)}" r="{p(7)}" fill="{traco}"/>'
        '</g>'
    )

def horizontal(cor_chat, cor_work):
    tamanho = 46
    baseline = 32 + cap * tamanho / upm / 2          # centro da altura das maiusculas no centro do simbolo
    chat, x = palavra('Chat', 82, baseline, tamanho)
    work, x = palavra('Work', x, baseline, tamanho, ant='t')
    largura = round(x + 2)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{largura}" height="64" viewBox="0 0 {largura} 64" fill="none" role="img" aria-label="ChatWork">'
            f'{simbolo()}<path d="{chat}" fill="{cor_chat}"/><path d="{work}" fill="{cor_work}"/></svg>\n')

open(f'{saida}/logo.svg', 'w', newline='\n').write(horizontal(TINTA, VIOLETA))
open(f'{saida}/logo_dark.svg', 'w', newline='\n').write(horizontal(BRANCO, VIOLETA_ESCURO_TEMA))
open(f'{saida}/logo_thumbnail.svg', 'w', newline='\n').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" fill="none" role="img" aria-label="ChatWork">{simbolo()}</svg>\n')
print('ok', upm, cap)

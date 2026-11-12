import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** O trecho do script do painel que acha o azul da marca no CSS do Chatwoot. */
function extrair(css: string): string {
  const janela: { __p12MarcaExtrair?: (css: string) => string } = {};
  vm.runInNewContext(readFileSync('panel/chatwoot-marca.js', 'utf8'), {
    window: janela,
    document: { currentScript: { src: 'https://crm.teste/ingest/categorias/script.js' }, head: null, documentElement: null },
    URL,
  });
  return janela.__p12MarcaExtrair!(css);
}

describe('troca de cor do painel', () => {
  test('repete so a declaracao que traz o azul, na cor nova', () => {
    expect(extrair('.a{color:red}.bg-n-brand{--tw-bg-opacity: 1;background-color:#2781f6}.b{margin:0}'))
      .toBe('.bg-n-brand{background-color:#6e56cf}');
  });

  test('transparencia em hex e rgb com espaco ou virgula', () => {
    expect(extrair('.x{background-color:#2781F61a}')).toBe('.x{background-color:#6e56cf1a}');
    expect(extrair('.y{color:rgb(39 129 246 / var(--tw-text-opacity, 1))}')).toBe('.y{color:rgb(110 86 207 / var(--tw-text-opacity, 1))}');
    expect(extrair(':root{--border-blue: 39, 129, 246, .5}')).toBe(':root{--border-blue: 110, 86, 207, .5}');
  });

  test('numero parecido nao e a cor da marca', () => {
    expect(extrair('.z{color:rgb(139 129 246)}.w{color:rgb(39 129 2460)}')).toBe('');
  });

  test('a regra continua dentro do @media e do @supports dela', () => {
    expect(extrair('@media (min-width:768px){.md\:bg-n-brand{background-color:#2781f6}.c{top:0}}'))
      .toBe('@media (min-width:768px){.md\:bg-n-brand{background-color:#6e56cf}}');
    expect(extrair('@media print{@supports (color:red){.p{color:#2781f6}}}'))
      .toBe('@media print{@supports (color:red){.p{color:#6e56cf}}}');
  });

  test('quadro de animacao nao e repetido', () => {
    expect(extrair('@keyframes pisca{50%{color:#2781f6}}.d{color:#2781f6}')).toBe('.d{color:#6e56cf}');
  });

  test('aspas escapadas no seletor, texto com chave e comentario nao desalinham a leitura', () => {
    const css = "/*! licenca d'agua { */.content-\[\'\'\]{content:''}.q:before{content:\"}{\"}.e{color:#2781f6}";
    expect(extrair(css)).toBe('.e{color:#6e56cf}');
  });

  test('classe com a cor no nome mantem o nome', () => {
    expect(extrair('.bg-\[\#2781F6\]{background-color:#2781f6}')).toBe('.bg-\[\#2781F6\]{background-color:#6e56cf}');
  });
});

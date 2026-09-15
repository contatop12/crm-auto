-- Tipo de correspondencia da frase-gatilho.
--
-- Ate aqui toda frase era "contem": bastava aparecer em qualquer ponto da
-- mensagem. Frase curta precisa de "fixo" — a mensagem inteira e' a frase —
-- porque "Consulta realizada" como contem casaria com "sua consulta realizada
-- ontem foi otima", que nao e' o aviso.
--
-- O padrao e' 'contem': as frases que ja existem continuam casando igual.
ALTER TABLE stage_triggers ADD COLUMN tipo TEXT NOT NULL DEFAULT 'contem'
  CHECK (tipo IN ('contem', 'fixo'));

// Motor de cálculo simplificado de CBS/IBS, rodando no navegador.
// Reproduz as regras da calculadora oficial da Receita (calculadora-rtc-regime-regular)
// para o caso ad valorem de um item: alíquota × (1 − redução) sobre a base.
// Os dados vêm de dados/*.json, exportados do banco oficial por ferramentas/exportar.py.
(function (raiz) {
  const dentro = (data, ini, fim) => (!ini || ini <= data) && (!fim || fim >= data);
  const cobre = (prefixo, codigo) => codigo.startsWith(prefixo);
  const arred = (n, casas) => { const f = 10 ** casas; return Math.round((n + Number.EPSILON) * f) / f; };

  // Mesma tabela-verdade da NcmAplicavelService/NbsAplicavelService:
  // rejeita quando nenhum vínculo vigente cobre o código, ou quando há exceção vigente
  // cobrindo o código e nenhum vínculo vigente sem exceções vigentes o cobre.
  function aplicavel(anexo, codigo, data) {
    const vigentes = (anexo || []).filter(([, ini, fim]) => dentro(data, ini, fim));
    if (!vigentes.length) return { temAnexo: false, valido: true };
    const cobrem = vigentes.filter(([pref]) => cobre(pref, codigo));
    if (!cobrem.length) return { temAnexo: true, valido: false };
    const excVig = (excs) => excs.filter(([, ini, fim]) => dentro(data, ini, fim));
    const temExcecao = cobrem.some(([, , , excs]) => excVig(excs).some(([cod]) => cobre(cod, codigo)));
    const semExcecao = cobrem.some(([, , , excs]) => excVig(excs).length === 0);
    return { temAnexo: true, valido: !(temExcecao && !semExcecao) };
  }

  function aliquotaReferencia(meta, sigla, data) {
    const r = meta.aliquotasReferencia.find((a) => a.tributo === sigla && dentro(data, a.inicio, a.fim));
    return r ? r.valor : null;
  }

  function temReferencia(meta, data) {
    return ['CBS', 'IBSUF', 'IBSMun'].every((s) => aliquotaReferencia(meta, s, data) !== null);
  }

  // Descrição hierárquica (posição › subposição › item › subitem), como a API mostra.
  function descrever(tabela, tipo, codigo) {
    if (!(codigo in tabela)) return null;
    const cortes = tipo === 'ncm' ? [4, 5, 6, 7, 8] : [3, 4, 5, 6, 7, 8, 9];
    const partes = cortes.filter((n) => n <= codigo.length).map((n) => tabela[codigo.slice(0, n)]).filter(Boolean).map((s) => s.replace(/^[-\s]+/, ''));
    return [...new Set(partes)].join(' › ');
  }

  /**
   * entrada: { classe, tipo: 'ncm'|'nbs', codigo, valor, data: 'AAAA-MM-DD', aliquotas?: {cbs, ibsUf, ibsMun} }
   * dados:   { meta, ncm, nbs }
   */
  function calcular(entrada, dados) {
    const { classe, tipo, codigo, valor, data } = entrada;
    const erros = [];
    const tamanho = tipo === 'ncm' ? 8 : 9;
    if (!classe) erros.push('Escolha a classificação tributária.');
    if (String(codigo).length !== tamanho) erros.push(`Informe o ${tipo.toUpperCase()} completo, com ${tamanho} dígitos.`);
    else if (!(codigo in dados[tipo])) erros.push(`${tipo.toUpperCase()} ${codigo} não encontrado na tabela oficial.`);
    if (!(valor > 0)) erros.push('Informe um valor maior que zero.');
    if (erros.length) return { erros };

    if (!classe.suportado) {
      return { erros: [`A classificação ${classe.codigo} (${classe.tratamento}) tem regra especial que esta versão web ainda não calcula${classe.motivo ? ': ' + classe.motivo : ''}.`] };
    }
    const anexo = tipo === 'ncm' ? classe.anexoNcm : classe.anexoNbs;
    const ap = aplicavel(anexo, codigo, data);
    if (!ap.valido) {
      return { erros: [`${tipo.toUpperCase()} ${codigo} não está vinculado à classificação ${classe.codigo} (fora do anexo da LC 214/2025).`] };
    }

    if (!classe.destacaCbsIbs) {
      return { base: valor, tributos: [], total: 0, semDestaque: true, temAnexo: ap.temAnexo };
    }
    let aliq;
    let simulado = false;
    if (entrada.aliquotas) {
      aliq = [entrada.aliquotas.cbs, entrada.aliquotas.ibsUf, entrada.aliquotas.ibsMun];
      simulado = true;
    } else {
      aliq = ['CBS', 'IBSUF', 'IBSMun'].map((s) => aliquotaReferencia(dados.meta, s, data));
      if (aliq.some((a) => a === null)) return { erros: ['Não há alíquota oficial de referência para essa data. Informe as alíquotas para simular.'] };
    }
    if (classe.aliquotaZero) aliq = [0, 0, 0];

    const base = arred(valor * classe.fatorBase, 2);
    const nomes = ['CBS (federal)', 'IBS estadual', 'IBS municipal'];
    const tributos = aliq.map((a, i) => {
      const reducao = classe.reducao[i] || 0;
      const efetiva = arred(a * (1 - reducao / 100), 4);
      const calculado = arred(base * efetiva / 100, 2);
      // Diferimento: o tributo é calculado, mas o valor devido na operação fica zerado (vai para o grupo gDif).
      return { nome: nomes[i], aliquota: a, reducao, efetiva, diferido: classe.diferimento ? calculado : 0, valor: classe.diferimento ? 0 : calculado };
    });
    const total = arred(tributos.reduce((s, t) => s + t.valor, 0), 2);
    return { base, tributos, total, simulado, diferimento: classe.diferimento, temAnexo: ap.temAnexo };
  }

  const api = { calcular, aplicavel, descrever, temReferencia, aliquotaReferencia };
  if (typeof module !== 'undefined') module.exports = api; else raiz.Calc = api;
})(this);

const CATEGORIA_LABEL = {
  aluguel: "Aluguel",
  cartao: "Cartão",
  emprestimo: "Empréstimo",
  mercado: "Mercado",
  contas_fixas: "Contas fixas",
  pessoal: "Pessoal",
  outros: "Outros",
};

const STATUS_LABEL = { a_pagar: "A pagar", pago: "Pago", atrasado: "Atrasado" };

let mesAtual = mesAtualPadrao();
let outrasEntradasRascunho = [];

function mesAtualPadrao() {
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, "0");
  return `${ano}-${mes}`;
}

function formatarMoeda(valor) {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataCurta(iso) {
  if (!iso) return "sem data";
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano}`;
}

// ---------------------------------------------------------------------
// Chamadas de API
// ---------------------------------------------------------------------

async function api(metodo, caminho, corpo) {
  const opcoes = { method: metodo, headers: { "Content-Type": "application/json" } };
  if (corpo !== undefined) opcoes.body = JSON.stringify(corpo);
  const resp = await fetch(caminho, opcoes);
  const dados = await resp.json();
  if (!resp.ok) throw new Error(dados.erro || "Erro na requisição");
  return dados;
}

// ---------------------------------------------------------------------
// Renderização
// ---------------------------------------------------------------------

function renderResumo(resumo) {
  document.getElementById("resumoTexto").textContent = resumo.resumo_texto;
  document.getElementById("totalEntradas").textContent = formatarMoeda(resumo.total_entradas);
  document.getElementById("totalSaidas").textContent = formatarMoeda(resumo.total_saidas);

  const saldoEl = document.getElementById("saldo");
  saldoEl.textContent = formatarMoeda(resumo.saldo);
  saldoEl.style.color = resumo.saldo < 0 ? "#E8935A" : "#FBF7EF";

  const barra = document.getElementById("termometroBarra");
  barra.style.width = Math.min(resumo.percentual_comprometido, 100) + "%";

  const alertasCard = document.getElementById("alertasCard");
  const lista = document.getElementById("listaAlertas");
  lista.innerHTML = "";
  if (resumo.proximos_vencimentos.length === 0) {
    alertasCard.style.display = "none";
  } else {
    alertasCard.style.display = "block";
    resumo.proximos_vencimentos.forEach((d) => {
      const li = document.createElement("li");
      const texto = d.dias_restantes < 0
        ? `${d.descricao} — venceu há ${Math.abs(d.dias_restantes)} dia(s)`
        : d.dias_restantes === 0
          ? `${d.descricao} — vence hoje!`
          : `${d.descricao} — vence em ${d.dias_restantes} dia(s)`;
      li.textContent = `${texto} (${formatarMoeda(d.valor)})`;
      lista.appendChild(li);
    });
  }
}

const TIPO_RECEBIMENTO_LABEL = {
  mensal: "Tudo de uma vez no mês",
  quinzenal: "De 15 em 15 dias",
  semanal: "Toda semana",
  outro: "Outro jeito",
};

function renderEntradas(dados) {
  document.getElementById("salarioInput").value = dados.salario || "";
  document.getElementById("tipoRecebimentoInput").value = dados.tipo_recebimento || "mensal";
  outrasEntradasRascunho = (dados.outras_entradas || []).map((e) => ({ ...e }));
  renderOutrasEntradas();
}

function renderOutrasEntradas() {
  const container = document.getElementById("outrasEntradasLista");
  container.innerHTML = "";
  outrasEntradasRascunho.forEach((entrada, i) => {
    const linha = document.createElement("div");
    linha.className = "outra-entrada-linha";
    linha.innerHTML = `
      <input type="text" placeholder="descrição" value="${entrada.descricao || ""}" data-i="${i}" data-campo="descricao">
      <input type="number" step="0.01" placeholder="valor" value="${entrada.valor || ""}" data-i="${i}" data-campo="valor" style="max-width:110px;">
      <button type="button" class="remover-btn" data-remover="${i}">x</button>
    `;
    container.appendChild(linha);
  });

  container.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", (e) => {
      const i = Number(e.target.dataset.i);
      const campo = e.target.dataset.campo;
      outrasEntradasRascunho[i][campo] = campo === "valor" ? Number(e.target.value) : e.target.value;
    });
  });
  container.querySelectorAll("[data-remover]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      outrasEntradasRascunho.splice(Number(e.target.dataset.remover), 1);
      renderOutrasEntradas();
    });
  });
}

let dividaEmEdicao = null;

function renderDividas(dados) {
  const container = document.getElementById("listaDividas");
  container.innerHTML = "";
  if (!dados.dividas || dados.dividas.length === 0) {
    container.innerHTML = '<p class="vazio">Nenhuma dívida cadastrada esse mês ainda.</p>';
    return;
  }
  dados.dividas.forEach((d) => {
    if (dividaEmEdicao === d.id) {
      container.appendChild(criarFormEdicaoDivida(d));
      return;
    }
    const item = document.createElement("div");
    item.className = "divida-item";
    item.innerHTML = `
      <div class="divida-info">
        <div class="divida-desc">${d.descricao}</div>
        <div class="divida-meta">${d.para_quem ? d.para_quem + " · " : ""}${CATEGORIA_LABEL[d.categoria] || d.categoria} · vence ${formatarDataCurta(d.vencimento)}</div>
      </div>
      <div class="divida-acoes">
        <span class="divida-valor">${formatarMoeda(d.valor)}</span>
        <select class="badge ${d.status}" data-id="${d.id}">
          ${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}" ${v === d.status ? "selected" : ""}>${l}</option>`).join("")}
        </select>
        <button type="button" class="editar-btn" data-id-editar="${d.id}">editar</button>
        <button type="button" class="remover-btn" data-id-remover="${d.id}">remover</button>
      </div>
    `;
    container.appendChild(item);
  });

  container.querySelectorAll("select[data-id]").forEach((sel) => {
    sel.addEventListener("change", async (e) => {
      const id = e.target.dataset.id;
      const resultado = await api("POST", `/api/mes/${mesAtual}/dividas/${id}/status`, { status: e.target.value });
      atualizarTela(resultado);
    });
  });
  container.querySelectorAll("[data-id-remover]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.dataset.idRemover;
      const resultado = await api("DELETE", `/api/mes/${mesAtual}/dividas/${id}`);
      atualizarTela(resultado);
    });
  });
  container.querySelectorAll("[data-id-editar]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      dividaEmEdicao = e.target.dataset.idEditar;
      renderDividas(dados);
    });
  });
}

function criarFormEdicaoDivida(d) {
  const wrap = document.createElement("div");
  wrap.className = "divida-editar-form";
  wrap.innerHTML = `
    <div class="form-linha">
      <label>Descrição</label>
      <input type="text" class="edit-descricao" value="${d.descricao}">
    </div>
    <div class="form-linha">
      <label>Valor</label>
      <input type="number" step="0.01" class="edit-valor" value="${d.valor}">
    </div>
    <div class="form-linha">
      <label>Para quem</label>
      <input type="text" class="edit-para-quem" value="${d.para_quem || ""}">
    </div>
    <div class="form-linha">
      <label>Categoria</label>
      <select class="edit-categoria">
        ${Object.keys(CATEGORIA_LABEL).map((c) => `<option value="${c}" ${c === d.categoria ? "selected" : ""}>${CATEGORIA_LABEL[c]}</option>`).join("")}
      </select>
    </div>
    <div class="form-linha">
      <label>Vencimento</label>
      <input type="date" class="edit-vencimento" value="${d.vencimento || ""}">
    </div>
    <div class="divida-editar-acoes">
      <button type="button" class="btn-principal edit-salvar">Salvar</button>
      <button type="button" class="btn-secundario edit-cancelar">Cancelar</button>
    </div>
  `;

  wrap.querySelector(".edit-cancelar").addEventListener("click", () => {
    dividaEmEdicao = null;
    carregarMes();
  });

  wrap.querySelector(".edit-salvar").addEventListener("click", async () => {
    const corpo = {
      descricao: wrap.querySelector(".edit-descricao").value,
      valor: Number(wrap.querySelector(".edit-valor").value),
      para_quem: wrap.querySelector(".edit-para-quem").value,
      categoria: wrap.querySelector(".edit-categoria").value,
      vencimento: wrap.querySelector(".edit-vencimento").value,
    };
    const resultado = await api("PUT", `/api/mes/${mesAtual}/dividas/${d.id}`, corpo);
    dividaEmEdicao = null;
    atualizarTela(resultado);
  });

  return wrap;
}

async function renderHistorico() {
  const { meses } = await api("GET", "/api/meses");
  const container = document.getElementById("listaHistorico");
  container.innerHTML = "";
  const outros = meses.filter((m) => m !== mesAtual).sort().reverse();
  if (outros.length === 0) {
    container.innerHTML = '<p class="vazio">Ainda não há outros meses registrados.</p>';
    return;
  }
  for (const m of outros) {
    const { resumo } = await api("GET", `/api/mes/${m}`);
    const item = document.createElement("div");
    item.className = "historico-item";
    const classeSaldo = resumo.saldo < 0 ? "negativo" : "positivo";
    item.innerHTML = `<span>${m}</span><span class="hist-saldo ${classeSaldo}">${formatarMoeda(resumo.saldo)}</span>`;
    item.addEventListener("click", () => {
      mesAtual = m;
      document.getElementById("mesInput").value = m;
      carregarMes();
    });
    container.appendChild(item);
  }
}

function atualizarTela({ dados, resumo }) {
  renderResumo(resumo);
  renderEntradas(dados);
  renderDividas(dados);
  renderHistorico();
}

async function carregarMes() {
  const resultado = await api("GET", `/api/mes/${mesAtual}`);
  atualizarTela(resultado);
}

async function carregarCategorias() {
  const { categorias } = await api("GET", "/api/categorias");
  const select = document.getElementById("categoriaInput");
  select.innerHTML = categorias.map((c) => `<option value="${c}">${CATEGORIA_LABEL[c] || c}</option>`).join("");
}

async function carregarTiposRecebimento() {
  const { tipos } = await api("GET", "/api/tipos-recebimento");
  const select = document.getElementById("tipoRecebimentoInput");
  select.innerHTML = tipos.map((t) => `<option value="${t}">${TIPO_RECEBIMENTO_LABEL[t] || t}</option>`).join("");
}

// ---------------------------------------------------------------------
// Abas
// ---------------------------------------------------------------------

document.querySelectorAll(".aba-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".aba-btn").forEach((b) => b.classList.remove("ativa"));
    document.querySelectorAll(".painel-aba").forEach((p) => (p.style.display = "none"));
    btn.classList.add("ativa");
    document.getElementById(`aba-${btn.dataset.aba}`).style.display = "block";
  });
});

// ---------------------------------------------------------------------
// Calculadora
// ---------------------------------------------------------------------

let calcExpressao = "";

function calcAtualizarVisor() {
  document.getElementById("calcVisor").textContent = calcExpressao || "0";
}

document.querySelectorAll("[data-calc]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tecla = btn.dataset.calc;
    if (tecla === "limpar") {
      calcExpressao = "";
    } else if (tecla === "apagar") {
      calcExpressao = calcExpressao.slice(0, -1);
    } else if (tecla === "=") {
      try {
        const expressaoSegura = calcExpressao.replace(/,/g, ".").replace(/[^0-9.+\-*/%()]/g, "");
        // eslint-disable-next-line no-new-func
        const resultado = Function(`"use strict"; return (${expressaoSegura})`)();
        calcExpressao = String(Number(resultado.toFixed(6))).replace(".", ",");
      } catch (e) {
        calcExpressao = "Erro";
      }
    } else {
      calcExpressao += tecla;
    }
    calcAtualizarVisor();
  });
});

// ---------------------------------------------------------------------
// Simulador de investimentos
// ---------------------------------------------------------------------

document.getElementById("investCalcularBtn").addEventListener("click", () => {
  const valorInicial = Number(document.getElementById("investValorInicial").value) || 0;
  const aporteMensal = Number(document.getElementById("investAporteMensal").value) || 0;
  const taxaMensal = (Number(document.getElementById("investTaxaMensal").value) || 0) / 100;
  const meses = Math.max(1, Math.round(Number(document.getElementById("investMeses").value) || 0));

  let saldo = valorInicial;
  let totalAportado = valorInicial;
  const linhas = [];

  for (let mes = 1; mes <= meses; mes++) {
    saldo += aporteMensal;
    totalAportado += aporteMensal;
    saldo *= 1 + taxaMensal;
    linhas.push({ mes, saldo });
  }

  const totalFinal = saldo;
  const totalRendimento = totalFinal - totalAportado;

  document.getElementById("investTotalGuardado").textContent = formatarMoeda(totalAportado);
  document.getElementById("investTotalRendimento").textContent = formatarMoeda(totalRendimento);
  document.getElementById("investTotalFinal").textContent = formatarMoeda(totalFinal);

  const tabela = document.getElementById("investTabela");
  tabela.innerHTML = '<div class="invest-tabela-linha cabecalho"><span>Mês</span><span>Saldo acumulado</span></div>';
  linhas.forEach((l) => {
    const linha = document.createElement("div");
    linha.className = "invest-tabela-linha";
    linha.innerHTML = `<span>${l.mes}</span><span>${formatarMoeda(l.saldo)}</span>`;
    tabela.appendChild(linha);
  });

  document.getElementById("investResultado").style.display = "block";
});

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------

document.getElementById("mesInput").addEventListener("change", (e) => {
  mesAtual = e.target.value;
  carregarMes();
});

document.getElementById("addOutraEntradaBtn").addEventListener("click", () => {
  outrasEntradasRascunho.push({ descricao: "", valor: 0 });
  renderOutrasEntradas();
});

document.getElementById("salvarEntradasBtn").addEventListener("click", async () => {
  const salario = Number(document.getElementById("salarioInput").value) || 0;
  const resultado = await api("POST", `/api/mes/${mesAtual}/entradas`, {
    salario,
    tipo_recebimento: document.getElementById("tipoRecebimentoInput").value,
    outras_entradas: outrasEntradasRascunho.filter((e) => e.descricao || e.valor),
  });
  atualizarTela(resultado);
});

document.getElementById("formDivida").addEventListener("submit", async (e) => {
  e.preventDefault();
  const corpo = {
    descricao: document.getElementById("descricaoInput").value,
    valor: Number(document.getElementById("valorInput").value),
    para_quem: document.getElementById("paraQuemInput").value,
    categoria: document.getElementById("categoriaInput").value,
    vencimento: document.getElementById("vencimentoInput").value,
  };
  const resultado = await api("POST", `/api/mes/${mesAtual}/dividas`, corpo);
  atualizarTela(resultado);
  e.target.reset();
});

// ---------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------

(async function iniciar() {
  document.getElementById("mesInput").value = mesAtual;
  await carregarCategorias();
  await carregarTiposRecebimento();
  await carregarMes();
})();

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

  const parcelasEl = document.getElementById("resumoParcelas");
  const parcelas = resumo.parcelas_recebimento;
  if (parcelas && parcelas.partes > 1) {
    parcelasEl.style.display = "block";
    parcelasEl.textContent = `Isso costuma vir em ${parcelas.partes}x de ${formatarMoeda(parcelas.valor_por_parcela)}.`;
  } else {
    parcelasEl.style.display = "none";
  }

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
    const jurosHtml = d.valor_atualizado
      ? `<div class="divida-juros">com juros hoje: ${formatarMoeda(d.valor_atualizado)} (${d.dias_atraso}d atraso)</div>`
      : "";
    item.innerHTML = `
      <div class="divida-info">
        <div class="divida-desc">${d.descricao}${d.recorrente ? " 🔁" : ""}</div>
        <div class="divida-meta">${d.para_quem ? d.para_quem + " · " : ""}${CATEGORIA_LABEL[d.categoria] || d.categoria} · vence ${formatarDataCurta(d.vencimento)}</div>
        ${jurosHtml}
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
  const temJuros = d.categoria === "cartao" || d.categoria === "emprestimo";
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
    <label class="checkbox-linha">
      <input type="checkbox" class="edit-recorrente" ${d.recorrente ? "checked" : ""}>
      Repetir todo mês
    </label>
    <div class="edit-juros-campos" style="display:${temJuros ? "block" : "none"};">
      <div class="form-linha">
        <label>Juros ao mês se atrasar (%)</label>
        <input type="number" step="0.01" class="edit-taxa-juros" value="${d.taxa_juros || ""}">
      </div>
      <div class="form-linha">
        <label>Tipo de juros</label>
        <select class="edit-tipo-juros">
          <option value="simples" ${d.tipo_juros !== "composto" ? "selected" : ""}>Simples</option>
          <option value="composto" ${d.tipo_juros === "composto" ? "selected" : ""}>Composto</option>
        </select>
      </div>
    </div>
    <div class="divida-editar-acoes">
      <button type="button" class="btn-principal edit-salvar">Salvar</button>
      <button type="button" class="btn-secundario edit-cancelar">Cancelar</button>
    </div>
  `;

  wrap.querySelector(".edit-categoria").addEventListener("change", (e) => {
    const mostrar = e.target.value === "cartao" || e.target.value === "emprestimo";
    wrap.querySelector(".edit-juros-campos").style.display = mostrar ? "block" : "none";
  });

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
      recorrente: wrap.querySelector(".edit-recorrente").checked,
      taxa_juros: Number(wrap.querySelector(".edit-taxa-juros").value) || 0,
      tipo_juros: wrap.querySelector(".edit-tipo-juros").value,
    };
    try {
      const resultado = await api("PUT", `/api/mes/${mesAtual}/dividas/${d.id}`, corpo);
      dividaEmEdicao = null;
      atualizarTela(resultado);
    } catch (erro) {
      alert("Não deu pra salvar a edição: " + erro.message);
    }
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

function mostrarPainel(nome) {
  document.querySelectorAll(".painel-aba").forEach((p) => (p.style.display = "none"));
  document.getElementById(`aba-${nome}`).style.display = "block";
  document.querySelectorAll(".aba-btn").forEach((b) => b.classList.toggle("ativa", b.dataset.aba === nome));
}

document.querySelectorAll(".aba-btn").forEach((btn) => {
  btn.addEventListener("click", () => mostrarPainel(btn.dataset.aba));
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
    } else if (tecla === "%") {
      try {
        const expressaoSegura = calcExpressao.replace(/,/g, ".").replace(/[^0-9.+\-*/()]/g, "");
        // eslint-disable-next-line no-new-func
        const valor = Function(`"use strict"; return (${expressaoSegura})`)();
        calcExpressao = String(Number((valor / 100).toFixed(6))).replace(".", ",");
      } catch (e) {
        calcExpressao = "Erro";
      }
    } else if (tecla === "=") {
      try {
        const expressaoSegura = calcExpressao.replace(/,/g, ".").replace(/[^0-9.+\-*/()]/g, "");
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

document.getElementById("categoriaInput").addEventListener("change", (e) => {
  const mostrar = e.target.value === "cartao" || e.target.value === "emprestimo";
  document.getElementById("jurosCamposNovo").style.display = mostrar ? "block" : "none";
});

document.getElementById("formDivida").addEventListener("submit", async (e) => {
  e.preventDefault();
  const corpo = {
    descricao: document.getElementById("descricaoInput").value,
    valor: Number(document.getElementById("valorInput").value),
    para_quem: document.getElementById("paraQuemInput").value,
    categoria: document.getElementById("categoriaInput").value,
    vencimento: document.getElementById("vencimentoInput").value,
    recorrente: document.getElementById("recorrenteInput").checked,
    taxa_juros: Number(document.getElementById("taxaJurosInput").value) || 0,
    tipo_juros: document.getElementById("tipoJurosInput").value,
  };
  const resultado = await api("POST", `/api/mes/${mesAtual}/dividas`, corpo);
  atualizarTela(resultado);
  e.target.reset();
  document.getElementById("jurosCamposNovo").style.display = "none";
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

// ---------------------------------------------------------------------
// Config: tema + perfil
// ---------------------------------------------------------------------

let configAtual = { tema: "padrao", perfil: { nome: "", foto: "", banner: "" } };
let perfilFotoBase64 = "";
let perfilBannerBase64 = "";

function aplicarTema(tema) {
  document.documentElement.setAttribute("data-tema", tema);
  document.querySelectorAll(".tema-btn").forEach((b) => {
    b.classList.toggle("ativo", b.dataset.tema === tema);
  });
}

function aplicarAvatarTopo(fotoBase64) {
  const img = document.getElementById("avatarTopo");
  const inicial = document.getElementById("avatarInicial");
  if (fotoBase64) {
    img.src = fotoBase64;
    img.style.display = "block";
    inicial.style.display = "none";
  } else {
    img.style.display = "none";
    inicial.style.display = "block";
  }
}

async function carregarConfig() {
  try {
    configAtual = await api("GET", "/api/config");
  } catch (erro) {
    configAtual = { tema: "padrao", perfil: { nome: "", foto: "", banner: "" } };
  }
  aplicarTema(configAtual.tema || "padrao");
  aplicarAvatarTopo(configAtual.perfil?.foto || "");
}

document.querySelectorAll(".tema-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    aplicarTema(btn.dataset.tema);
    try {
      await api("POST", "/api/config", { tema: btn.dataset.tema });
    } catch (erro) {
      // se falhar, o tema ainda fica aplicado nessa sessão
    }
  });
});

document.getElementById("abrirConfigBtn").addEventListener("click", () => mostrarPainel("config"));

document.getElementById("abrirPerfilBtn").addEventListener("click", async () => {
  mostrarPainel("perfil");
  await carregarPerfil();
});

// ---------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------

async function carregarPerfil() {
  const perfil = configAtual.perfil || {};
  document.getElementById("perfilNomeInput").value = perfil.nome || "";
  perfilFotoBase64 = perfil.foto || "";
  perfilBannerBase64 = perfil.banner || "";
  renderPerfilPreview();

  try {
    const geral = await api("GET", "/api/resumo-geral");
    document.getElementById("perfilTotalEntradas").textContent = formatarMoeda(geral.total_entradas_geral);
    document.getElementById("perfilTotalSaidas").textContent = formatarMoeda(geral.total_saidas_geral);
    document.getElementById("perfilMeses").textContent = geral.meses_registrados;
  } catch (erro) {
    // resumo geral é só um extra; se falhar, não trava o resto da tela
  }
}

function renderPerfilPreview() {
  const avatarPreview = document.getElementById("perfilAvatarPreview");
  avatarPreview.innerHTML = perfilFotoBase64
    ? `<img src="${perfilFotoBase64}" alt="">`
    : "🙂";

  const bannerPreview = document.getElementById("perfilBannerPreview");
  const editarLabel = bannerPreview.querySelector(".perfil-banner-editar");
  bannerPreview.querySelectorAll("img").forEach((img) => img.remove());
  if (perfilBannerBase64) {
    const img = document.createElement("img");
    img.src = perfilBannerBase64;
    bannerPreview.insertBefore(img, editarLabel);
  }
}

function lerArquivoComoBase64(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsDataURL(arquivo);
  });
}

document.getElementById("perfilFotoInput").addEventListener("change", async (e) => {
  if (!e.target.files[0]) return;
  perfilFotoBase64 = await lerArquivoComoBase64(e.target.files[0]);
  renderPerfilPreview();
});

document.getElementById("perfilBannerInput").addEventListener("change", async (e) => {
  if (!e.target.files[0]) return;
  perfilBannerBase64 = await lerArquivoComoBase64(e.target.files[0]);
  renderPerfilPreview();
});

document.getElementById("salvarPerfilBtn").addEventListener("click", async () => {
  const perfil = {
    nome: document.getElementById("perfilNomeInput").value,
    foto: perfilFotoBase64,
    banner: perfilBannerBase64,
  };
  try {
    configAtual = await api("POST", "/api/config", { perfil });
    aplicarAvatarTopo(perfil.foto);
    alert("Perfil salvo!");
  } catch (erro) {
    alert("Não deu pra salvar o perfil: " + erro.message);
  }
});

// ---------------------------------------------------------------------
// Gráficos (canvas simples, sem biblioteca externa)
// ---------------------------------------------------------------------

const CORES_GRAFICO = ["#235E58", "#E08A4B", "#B8503F", "#C99A3A", "#4C8C6B", "#6B4EA6", "#0B5FA5"];

document.getElementById("verGraficosBtn").addEventListener("click", async () => {
  mostrarPainel("graficos");
  await desenharGrafico();
});

async function desenharGrafico() {
  const { resumo } = await api("GET", `/api/mes/${mesAtual}`);
  const porCategoria = resumo.por_categoria || {};
  const categorias = Object.keys(porCategoria).filter((c) => porCategoria[c] > 0);

  const canvas = document.getElementById("graficoCanvas");
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const legenda = document.getElementById("graficoLegenda");
  legenda.innerHTML = "";

  if (categorias.length === 0) {
    ctx.fillStyle = "#6B6459";
    ctx.font = "14px sans-serif";
    ctx.fillText("Sem gastos registrados esse mês.", 10, 30);
    return;
  }

  const valores = categorias.map((c) => porCategoria[c]);
  const maiorValor = Math.max(...valores);
  const larguraBarra = canvas.width / categorias.length;
  const alturaMaxima = canvas.height - 50;

  categorias.forEach((cat, i) => {
    const valor = porCategoria[cat];
    const altura = maiorValor > 0 ? (valor / maiorValor) * alturaMaxima : 0;
    const x = i * larguraBarra + larguraBarra * 0.15;
    const y = canvas.height - 30 - altura;
    const largura = larguraBarra * 0.7;
    const cor = CORES_GRAFICO[i % CORES_GRAFICO.length];

    ctx.fillStyle = cor;
    ctx.fillRect(x, y, largura, altura);

    ctx.fillStyle = "#2B2A26";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(formatarMoeda(valor).replace("R$", "").trim(), x + largura / 2, y - 4);

    const item = document.createElement("div");
    item.className = "legenda-item";
    item.innerHTML = `<span class="legenda-cor" style="background:${cor}"></span>${CATEGORIA_LABEL[cat] || cat}`;
    legenda.appendChild(item);
  });
}

// ---------------------------------------------------------------------
// Backup e Restore
// ---------------------------------------------------------------------

document.getElementById("gerarBackupBtn").addEventListener("click", async () => {
  try {
    const backup = await api("GET", "/api/backup");
    const texto = JSON.stringify(backup);
    const nomeArquivo = `conta-dor-backup-${mesAtual}.txt`;

    if (window.AndroidNativo && window.AndroidNativo.salvarArquivoTexto) {
      // Dispara o seletor nativo de "salvar como" do Android
      window.AndroidNativo.salvarArquivoTexto(nomeArquivo, texto);
    } else {
      // Fallback (fora do app Android, ex: testando num navegador comum)
      const area = document.getElementById("backupTexto");
      area.value = texto;
      area.style.display = "block";
      document.getElementById("copiarBackupBtn").style.display = "block";
    }
  } catch (erro) {
    alert("Não deu pra gerar o backup: " + erro.message);
  }
});

document.getElementById("copiarBackupBtn").addEventListener("click", () => {
  const area = document.getElementById("backupTexto");
  area.select();
  try {
    document.execCommand("copy");
    alert("Copiado! Cola e guarda num lugar seguro (notas, WhatsApp pra você mesma, etc).");
  } catch (erro) {
    alert("Não consegui copiar automaticamente — seleciona o texto manualmente.");
  }
});

document.getElementById("restaurarArquivoInput").addEventListener("change", async (e) => {
  const arquivo = e.target.files[0];
  if (!arquivo) return;

  const texto = await new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = reject;
    leitor.readAsText(arquivo);
  });

  let backup;
  try {
    backup = JSON.parse(texto);
  } catch (erro) {
    alert("Esse arquivo não parece um backup válido.");
    return;
  }
  if (!confirm("Isso vai substituir os dados dos meses que já existirem no backup. Continuar?")) return;
  try {
    await api("POST", "/api/backup/restaurar", backup);
    await carregarConfig();
    await carregarMes();
    alert("Backup restaurado!");
  } catch (erro) {
    alert("Não deu pra restaurar: " + erro.message);
  }
  e.target.value = "";
});

// ---------------------------------------------------------------------
// Investimento: busca de ativo real (brapi.dev, sem custo)
// ---------------------------------------------------------------------

document.getElementById("investBuscarBtn").addEventListener("click", async () => {
  const ticker = document.getElementById("investTickerInput").value.trim().toUpperCase();
  const infoEl = document.getElementById("investAtivoInfo");
  if (!ticker) return;

  infoEl.style.display = "block";
  infoEl.textContent = "Buscando...";

  try {
    const resp = await fetch(`https://brapi.dev/api/quote/${ticker}?range=6mo&interval=1mo`);
    if (!resp.ok) throw new Error("Ativo não encontrado");
    const dados = await resp.json();
    const resultado = dados.results && dados.results[0];
    if (!resultado) throw new Error("Ativo não encontrado");

    const precoAtual = resultado.regularMarketPrice;
    let taxaEstimada = null;

    const historico = resultado.historicalDataPrice;
    if (historico && historico.length > 1) {
      const primeiro = historico[0].close;
      const ultimo = historico[historico.length - 1].close;
      const mesesPassados = historico.length - 1;
      if (primeiro > 0 && mesesPassados > 0) {
        taxaEstimada = (Math.pow(ultimo / primeiro, 1 / mesesPassados) - 1) * 100;
      }
    }

    if (taxaEstimada !== null) {
      document.getElementById("investTaxaMensal").value = taxaEstimada.toFixed(2);
      infoEl.textContent = `${resultado.longName || ticker}: preço atual ${formatarMoeda(precoAtual)} · rendimento médio histórico ~${taxaEstimada.toFixed(2)}% ao mês (baseado nos últimos 6 meses — não é garantia de retorno futuro).`;
    } else {
      infoEl.textContent = `${resultado.longName || ticker}: preço atual ${formatarMoeda(precoAtual)}. Não deu pra estimar um rendimento histórico — preenche a taxa manualmente.`;
    }
  } catch (erro) {
    infoEl.textContent = "Não consegui buscar esse ativo agora (verifique o código ou sua internet). Você ainda pode simular preenchendo a taxa manualmente.";
  }
});

// ---------------------------------------------------------------------
// Inicialização (config)
// ---------------------------------------------------------------------

carregarConfig();

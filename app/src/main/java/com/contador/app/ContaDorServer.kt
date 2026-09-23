package com.contador.app

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Conta...Dor - servidor local embutido no app.
 *
 * Mesma lógica que era o app.py no Termux, em Kotlin, rodando dentro do
 * próprio app Android. A WebView acessa http://127.0.0.1:PORT/.
 */
class ContaDorServer(private val context: Context, port: Int) : NanoHTTPD(port) {

    private val dataDir: File = File(context.filesDir, "data").apply { mkdirs() }
    private val configPath: File = File(context.filesDir, "config.json")
    private val statusValidos = setOf("a_pagar", "pago", "atrasado")
    private val tiposRecebimento = listOf("mensal", "quinzenal", "semanal", "outro")
    private val categoriasPadrao = listOf(
        "aluguel", "cartao", "emprestimo", "mercado", "contas_fixas", "pessoal", "outros"
    )
    private val categoriasComJuros = setOf("cartao", "emprestimo")
    private val categoriasFixas = setOf("aluguel", "contas_fixas", "emprestimo")
    private val temasValidos = setOf("padrao", "escuro", "daltonico", "vibrante")
    private val mesRegex = Regex("""\d{4}-\d{2}""")
    private val dataFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

    // ---------------------------------------------------------------
    // Dados de mês (um JSON por mês, em armazenamento interno do app)
    // ---------------------------------------------------------------

    private fun mesPath(mes: String) = File(dataDir, "$mes.json")

    private fun mesVazio(mes: String): JSONObject = JSONObject().apply {
        put("mes", mes)
        put("salario", 0.0)
        put("tipo_recebimento", "mensal")
        put("outras_entradas", JSONArray())
        put("dividas", JSONArray())
    }

    private fun carregarMes(mes: String): JSONObject {
        val arquivo = mesPath(mes)
        if (!arquivo.exists()) {
            val herdado = criarMesHerdado(mes)
            salvarMes(mes, herdado)
            return herdado
        }
        val dados = JSONObject(arquivo.readText())
        if (!dados.has("tipo_recebimento")) dados.put("tipo_recebimento", "mensal")
        return dados
    }

    /**
     * Mês novo herda do mês anterior mais recente: salário/tipo de
     * recebimento, e as dívidas que são "contas fixas por categoria"
     * (aluguel, contas fixas, empréstimo) OU que foram marcadas
     * manualmente como "repetir todo mês" (campo `recorrente`).
     */
    private fun criarMesHerdado(mes: String): JSONObject {
        val mesAnterior = listarMeses().filter { it < mes }.maxOrNull() ?: return mesVazio(mes)
        val arquivoAnterior = mesPath(mesAnterior)
        if (!arquivoAnterior.exists()) return mesVazio(mes)
        val anterior = JSONObject(arquivoAnterior.readText())

        val novo = mesVazio(mes)
        novo.put("salario", anterior.optDouble("salario", 0.0))
        novo.put("tipo_recebimento", anterior.optString("tipo_recebimento", "mensal"))

        val dividasAnteriores = anterior.optJSONArray("dividas") ?: JSONArray()
        val novasDividas = JSONArray()
        for (i in 0 until dividasAnteriores.length()) {
            val d = dividasAnteriores.getJSONObject(i)
            val ehFixaPorCategoria = d.optString("categoria") in categoriasFixas
            val ehRecorrente = d.optBoolean("recorrente", false)
            if (!ehFixaPorCategoria && !ehRecorrente) continue
            val copia = JSONObject(d.toString())
            copia.remove("valor_atualizado")
            copia.remove("dias_atraso")
            copia.put("id", UUID.randomUUID().toString().take(8))
            copia.put("status", "a_pagar")
            val vencAnterior = d.optString("vencimento", "")
            if (vencAnterior.length == 10) {
                val dia = vencAnterior.substring(8, 10)
                copia.put("vencimento", "$mes-$dia")
            }
            novasDividas.put(copia)
        }
        novo.put("dividas", novasDividas)
        return novo
    }

    private fun salvarMes(mes: String, dados: JSONObject) {
        mesPath(mes).writeText(dados.toString())
    }

    private fun listarMeses(): List<String> =
        dataDir.listFiles { f -> f.name.endsWith(".json") }
            ?.map { it.name.removeSuffix(".json") }
            ?.filter { mesRegex.matches(it) }
            ?.sorted()
            ?: emptyList()

    // ---------------------------------------------------------------
    // Config (tema escolhido + perfil do usuário)
    // ---------------------------------------------------------------

    private fun carregarConfig(): JSONObject {
        if (!configPath.exists()) {
            return JSONObject().apply {
                put("tema", "padrao")
                put("perfil", JSONObject().apply {
                    put("nome", "")
                    put("foto", "")
                    put("banner", "")
                })
            }
        }
        val config = JSONObject(configPath.readText())
        if (!config.has("tema")) config.put("tema", "padrao")
        if (!config.has("perfil")) {
            config.put("perfil", JSONObject().apply { put("nome", ""); put("foto", ""); put("banner", "") })
        }
        return config
    }

    private fun salvarConfig(config: JSONObject) {
        configPath.writeText(config.toString())
    }

    // ---------------------------------------------------------------
    // Cálculo do resumo (juros de atraso entram aqui)
    // ---------------------------------------------------------------

    private fun calcularResumo(dados: JSONObject): JSONObject {
        val outras = dados.getJSONArray("outras_entradas")
        var totalOutras = 0.0
        for (i in 0 until outras.length()) totalOutras += outras.getJSONObject(i).optDouble("valor", 0.0)

        val salario = dados.optDouble("salario", 0.0)
        val totalEntradas = salario + totalOutras

        val dividas = dados.getJSONArray("dividas")
        val hoje = Date()

        // Calcula juros de dívidas em atraso (cartão/empréstimo com taxa definida)
        // antes de somar totais, pra já refletir o valor atualizado.
        for (i in 0 until dividas.length()) {
            val d = dividas.getJSONObject(i)
            d.remove("valor_atualizado")
            d.remove("dias_atraso")
            val taxa = d.optDouble("taxa_juros", 0.0)
            if (taxa <= 0 || d.optString("status") == "pago") continue
            val venc = d.optString("vencimento", "")
            val vencData = try { dataFormat.parse(venc) } catch (e: Exception) { null } ?: continue
            val diasAtraso = ((hoje.time - vencData.time) / (1000 * 60 * 60 * 24)).toInt()
            if (diasAtraso <= 0) continue
            val mesesAtraso = diasAtraso / 30.0
            val valorOriginal = d.optDouble("valor", 0.0)
            val tipoJuros = d.optString("tipo_juros", "simples")
            val valorAtualizado = if (tipoJuros == "composto") {
                valorOriginal * Math.pow(1 + taxa / 100, mesesAtraso)
            } else {
                valorOriginal * (1 + (taxa / 100) * mesesAtraso)
            }
            d.put("dias_atraso", diasAtraso)
            d.put("valor_atualizado", Math.round(valorAtualizado * 100) / 100.0)
        }

        var totalSaidas = 0.0
        val porCategoria = JSONObject()
        val porStatus = JSONObject().apply { put("a_pagar", 0.0); put("pago", 0.0); put("atrasado", 0.0) }

        for (i in 0 until dividas.length()) {
            val d = dividas.getJSONObject(i)
            val valor = if (d.has("valor_atualizado")) d.getDouble("valor_atualizado") else d.optDouble("valor", 0.0)
            totalSaidas += valor
            val cat = d.optString("categoria", "outros")
            porCategoria.put(cat, porCategoria.optDouble(cat, 0.0) + valor)
            val st = d.optString("status", "a_pagar")
            porStatus.put(st, porStatus.optDouble(st, 0.0) + valor)
        }

        val saldo = totalEntradas - totalSaidas
        val percentual = if (totalEntradas > 0) (totalSaidas / totalEntradas * 100) else 0.0

        val proximos = JSONArray()
        for (i in 0 until dividas.length()) {
            val d = dividas.getJSONObject(i)
            if (d.optString("status") == "pago") continue
            val venc = d.optString("vencimento", "")
            if (venc.isBlank()) continue
            val vencData = try { dataFormat.parse(venc) } catch (e: Exception) { null } ?: continue
            val dias = ((vencData.time - hoje.time) / (1000 * 60 * 60 * 24)).toInt()
            if (dias <= 5) {
                val item = JSONObject(d.toString())
                item.put("dias_restantes", dias)
                proximos.put(item)
            }
        }
        val listaOrdenada = (0 until proximos.length()).map { proximos.getJSONObject(it) }
            .sortedBy { it.getInt("dias_restantes") }
        val proximosOrdenados = JSONArray(listaOrdenada)

        val frase = when {
            totalEntradas <= 0 -> "Ainda não registramos entradas pra esse mês."
            saldo >= 0 -> "Você recebeu R$%.2f, já comprometeu R$%.2f (%.0f%%), sobram R$%.2f livres."
                .format(totalEntradas, totalSaidas, percentual, saldo)
            else -> "Atenção: você recebeu R$%.2f, mas as contas somam R$%.2f — está faltando R$%.2f."
                .format(totalEntradas, totalSaidas, Math.abs(saldo))
        }

        val tipoRecebimento = dados.optString("tipo_recebimento", "mensal")
        val partes = when (tipoRecebimento) {
            "quinzenal" -> 2
            "semanal" -> 4
            else -> 1
        }
        val parcelas = JSONObject().apply {
            put("partes", partes)
            put("valor_por_parcela", if (partes > 1) salario / partes else salario)
        }

        return JSONObject().apply {
            put("total_entradas", totalEntradas)
            put("total_saidas", totalSaidas)
            put("saldo", saldo)
            put("percentual_comprometido", percentual)
            put("por_categoria", porCategoria)
            put("por_status", porStatus)
            put("proximos_vencimentos", proximosOrdenados)
            put("resumo_texto", frase)
            put("parcelas_recebimento", parcelas)
        }
    }

    private fun respostaMes(dados: JSONObject): JSONObject =
        JSONObject().put("dados", dados).put("resumo", calcularResumo(dados))

    // ---------------------------------------------------------------
    // Roteamento HTTP
    // ---------------------------------------------------------------

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri
        return try {
            when (session.method) {
                Method.GET -> handleGet(uri)
                Method.POST -> handlePost(uri, lerCorpo(session))
                Method.PUT -> handlePut(uri, lerCorpo(session))
                Method.DELETE -> handleDelete(uri)
                else -> jsonError(405, "Método não suportado")
            }
        } catch (e: Exception) {
            jsonError(500, "Erro interno: ${e.message}")
        }
    }

    private fun lerCorpo(session: IHTTPSession): JSONObject {
        val contentLength = session.headers["content-length"]?.toIntOrNull() ?: 0
        if (contentLength <= 0) return JSONObject()
        val buffer = ByteArray(contentLength)
        val stream = session.inputStream
        var lido = 0
        while (lido < contentLength) {
            val n = stream.read(buffer, lido, contentLength - lido)
            if (n == -1) break
            lido += n
        }
        val texto = String(buffer, 0, lido, Charsets.UTF_8)
        return if (texto.isBlank()) JSONObject() else JSONObject(texto)
    }

    private fun handleGet(uri: String): Response {
        if (uri == "/" || uri.isEmpty()) return servirAsset("www/index.html")
        if (uri.startsWith("/static/") || uri == "/style.css" || uri == "/app.js") {
            val nome = uri.removePrefix("/static/").removePrefix("/")
            return servirAsset("www/$nome")
        }

        if (uri == "/api/meses") return jsonOk(JSONObject().put("meses", JSONArray(listarMeses())))
        if (uri == "/api/categorias") return jsonOk(JSONObject().put("categorias", JSONArray(categoriasPadrao)))
        if (uri == "/api/tipos-recebimento") return jsonOk(JSONObject().put("tipos", JSONArray(tiposRecebimento)))
        if (uri == "/api/config") return jsonOk(carregarConfig())

        if (uri == "/api/resumo-geral") {
            var totalEntradasGeral = 0.0
            var totalSaidasGeral = 0.0
            val meses = listarMeses()
            for (m in meses) {
                val r = calcularResumo(carregarMes(m))
                totalEntradasGeral += r.getDouble("total_entradas")
                totalSaidasGeral += r.getDouble("total_saidas")
            }
            return jsonOk(JSONObject().apply {
                put("total_entradas_geral", totalEntradasGeral)
                put("total_saidas_geral", totalSaidasGeral)
                put("meses_registrados", meses.size)
            })
        }

        if (uri == "/api/backup") {
            val mesesObj = JSONObject()
            for (m in listarMeses()) mesesObj.put(m, JSONObject(mesPath(m).readText()))
            return jsonOk(JSONObject().put("meses", mesesObj).put("config", carregarConfig()))
        }

        Regex("""^/api/mes/(\d{4}-\d{2})$""").find(uri)?.let {
            val mes = it.groupValues[1]
            return jsonOk(respostaMes(carregarMes(mes)))
        }

        return jsonError(404, "Rota não encontrada")
    }

    private fun handlePost(uri: String, corpo: JSONObject): Response {
        if (uri == "/api/config") {
            val config = carregarConfig()
            if (corpo.has("tema") && temasValidos.contains(corpo.getString("tema"))) {
                config.put("tema", corpo.getString("tema"))
            }
            if (corpo.has("perfil")) {
                val perfilAtual = config.optJSONObject("perfil") ?: JSONObject()
                val perfilNovo = corpo.getJSONObject("perfil")
                val chaves = perfilNovo.keys()
                while (chaves.hasNext()) {
                    val k = chaves.next()
                    perfilAtual.put(k, perfilNovo.get(k))
                }
                config.put("perfil", perfilAtual)
            }
            salvarConfig(config)
            return jsonOk(config)
        }

        if (uri == "/api/backup/restaurar") {
            val mesesObj = corpo.optJSONObject("meses") ?: return jsonError(400, "Backup inválido: faltando 'meses'")
            val chaves = mesesObj.keys()
            while (chaves.hasNext()) {
                val chave = chaves.next()
                if (!mesRegex.matches(chave)) continue
                mesPath(chave).writeText(mesesObj.getJSONObject(chave).toString())
            }
            if (corpo.has("config")) salvarConfig(corpo.getJSONObject("config"))
            return jsonOk(JSONObject().put("ok", true))
        }

        Regex("""^/api/mes/(\d{4}-\d{2})/entradas$""").find(uri)?.let {
            val mes = it.groupValues[1]
            val dados = carregarMes(mes)
            dados.put("salario", corpo.optDouble("salario", dados.optDouble("salario", 0.0)))
            if (corpo.has("tipo_recebimento") && tiposRecebimento.contains(corpo.getString("tipo_recebimento"))) {
                dados.put("tipo_recebimento", corpo.getString("tipo_recebimento"))
            }
            if (corpo.has("outras_entradas")) dados.put("outras_entradas", corpo.getJSONArray("outras_entradas"))
            salvarMes(mes, dados)
            return jsonOk(respostaMes(dados))
        }

        Regex("""^/api/mes/(\d{4}-\d{2})/dividas$""").find(uri)?.let {
            val mes = it.groupValues[1]
            val dados = carregarMes(mes)
            val descricao = corpo.optString("descricao", "").trim()
            if (descricao.isEmpty()) return jsonError(400, "Descrição da dívida é obrigatória")
            val nova = JSONObject().apply {
                put("id", UUID.randomUUID().toString().take(8))
                put("descricao", descricao)
                put("valor", corpo.optDouble("valor", 0.0))
                put("para_quem", corpo.optString("para_quem", "").trim())
                put("categoria", corpo.optString("categoria", "outros"))
                put("vencimento", corpo.optString("vencimento", ""))
                put("status", "a_pagar")
                put("recorrente", corpo.optBoolean("recorrente", false))
                put("taxa_juros", corpo.optDouble("taxa_juros", 0.0))
                put("tipo_juros", corpo.optString("tipo_juros", "simples"))
            }
            dados.getJSONArray("dividas").put(nova)
            salvarMes(mes, dados)
            return jsonOk(respostaMes(dados), 201)
        }

        Regex("""^/api/mes/(\d{4}-\d{2})/dividas/([a-f0-9]+)/status$""").find(uri)?.let {
            val (mes, id) = it.destructured
            val novoStatus = corpo.optString("status", "")
            if (!statusValidos.contains(novoStatus)) return jsonError(400, "Status inválido")
            val dados = carregarMes(mes)
            val dividas = dados.getJSONArray("dividas")
            var achou = false
            for (i in 0 until dividas.length()) {
                val d = dividas.getJSONObject(i)
                if (d.optString("id") == id) { d.put("status", novoStatus); achou = true; break }
            }
            if (!achou) return jsonError(404, "Dívida não encontrada")
            salvarMes(mes, dados)
            return jsonOk(respostaMes(dados))
        }

        return jsonError(404, "Rota não encontrada")
    }

    private fun handlePut(uri: String, corpo: JSONObject): Response {
        Regex("""^/api/mes/(\d{4}-\d{2})/dividas/([a-f0-9]+)$""").find(uri)?.let {
            val (mes, id) = it.destructured
            val dados = carregarMes(mes)
            val dividas = dados.getJSONArray("dividas")
            var alvo: JSONObject? = null
            for (i in 0 until dividas.length()) {
                val d = dividas.getJSONObject(i)
                if (d.optString("id") == id) { alvo = d; break }
            }
            if (alvo == null) return jsonError(404, "Dívida não encontrada")

            val novaDescricao = corpo.optString("descricao", alvo.optString("descricao")).trim()
            if (novaDescricao.isEmpty()) return jsonError(400, "Descrição da dívida é obrigatória")

            alvo.put("descricao", novaDescricao)
            alvo.put("valor", corpo.optDouble("valor", alvo.optDouble("valor")))
            alvo.put("para_quem", corpo.optString("para_quem", alvo.optString("para_quem", "")).trim())
            alvo.put("categoria", corpo.optString("categoria", alvo.optString("categoria", "outros")))
            alvo.put("vencimento", corpo.optString("vencimento", alvo.optString("vencimento", "")))
            alvo.put("recorrente", corpo.optBoolean("recorrente", alvo.optBoolean("recorrente", false)))
            alvo.put("taxa_juros", corpo.optDouble("taxa_juros", alvo.optDouble("taxa_juros", 0.0)))
            alvo.put("tipo_juros", corpo.optString("tipo_juros", alvo.optString("tipo_juros", "simples")))
            if (statusValidos.contains(corpo.optString("status", ""))) {
                alvo.put("status", corpo.getString("status"))
            }

            salvarMes(mes, dados)
            return jsonOk(respostaMes(dados))
        }

        return jsonError(404, "Rota não encontrada")
    }

    private fun handleDelete(uri: String): Response {
        Regex("""^/api/mes/(\d{4}-\d{2})/dividas/([a-f0-9]+)$""").find(uri)?.let {
            val (mes, id) = it.destructured
            val dados = carregarMes(mes)
            val dividas = dados.getJSONArray("dividas")
            val nova = JSONArray()
            var achou = false
            for (i in 0 until dividas.length()) {
                val d = dividas.getJSONObject(i)
                if (d.optString("id") == id) { achou = true } else { nova.put(d) }
            }
            if (!achou) return jsonError(404, "Dívida não encontrada")
            dados.put("dividas", nova)
            salvarMes(mes, dados)
            return jsonOk(respostaMes(dados))
        }
        return jsonError(404, "Rota não encontrada")
    }

    // ---------------------------------------------------------------
    // Helpers de resposta
    // ---------------------------------------------------------------

    private fun servirAsset(caminho: String): Response {
        return try {
            val bytes = context.assets.open(caminho).use { it.readBytes() }
            val tipo = when {
                caminho.endsWith(".html") -> "text/html; charset=utf-8"
                caminho.endsWith(".css") -> "text/css; charset=utf-8"
                caminho.endsWith(".js") -> "application/javascript; charset=utf-8"
                else -> "application/octet-stream"
            }
            newFixedLengthResponse(Response.Status.OK, tipo, ByteArrayInputStream(bytes), bytes.size.toLong())
        } catch (e: Exception) {
            jsonError(404, "Arquivo não encontrado: $caminho")
        }
    }

    private fun jsonOk(payload: JSONObject, status: Int = 200): Response {
        val code = if (status == 201) Response.Status.CREATED else Response.Status.OK
        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
        return newFixedLengthResponse(code, "application/json; charset=utf-8", ByteArrayInputStream(bytes), bytes.size.toLong())
    }

    private fun jsonError(status: Int, mensagem: String): Response {
        val code = Response.Status.lookup(status) ?: Response.Status.INTERNAL_ERROR
        val bytes = JSONObject().put("erro", mensagem).toString().toByteArray(Charsets.UTF_8)
        return newFixedLengthResponse(code, "application/json; charset=utf-8", ByteArrayInputStream(bytes), bytes.size.toLong())
    }

    // Exposto pro NotificationWorker checar vencimentos sem duplicar a leitura de disco.
    fun listarMesesPublico(): List<String> = listarMeses()
    fun carregarMesPublico(mes: String): JSONObject = carregarMes(mes)
}

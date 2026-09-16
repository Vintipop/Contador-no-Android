package com.contador.app

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID

/**
 * Conta...Dor - servidor local embutido no app.
 *
 * É a mesma lógica do app.py original (Termux), só que em Kotlin,
 * rodando dentro do próprio app Android em vez de precisar de Python.
 * A WebView do app acessa http://127.0.0.1:PORT/ como se fosse o
 * localhost:8080 de antes.
 */
class ContaDorServer(private val context: Context, port: Int) : NanoHTTPD(port) {

    private val dataDir: File = File(context.filesDir, "data").apply { mkdirs() }
    private val statusValidos = setOf("a_pagar", "pago", "atrasado")
    private val tiposRecebimento = listOf("mensal", "quinzenal", "semanal", "outro")
    private val categoriasPadrao = listOf(
        "aluguel", "cartao", "emprestimo", "mercado", "contas_fixas", "pessoal", "outros"
    )
    private val mesRegex = Regex("""\d{4}-\d{2}""")
    private val dataFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())

    // ---------------------------------------------------------------
    // Dados (um JSON por mês, salvo em armazenamento interno do app)
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
        if (!arquivo.exists()) return mesVazio(mes)
        val dados = JSONObject(arquivo.readText())
        if (!dados.has("tipo_recebimento")) dados.put("tipo_recebimento", "mensal")
        return dados
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

    private fun calcularResumo(dados: JSONObject): JSONObject {
        val outras = dados.getJSONArray("outras_entradas")
        var totalOutras = 0.0
        for (i in 0 until outras.length()) totalOutras += outras.getJSONObject(i).optDouble("valor", 0.0)

        val salario = dados.optDouble("salario", 0.0)
        val totalEntradas = salario + totalOutras

        val dividas = dados.getJSONArray("dividas")
        var totalSaidas = 0.0
        val porCategoria = JSONObject()
        val porStatus = JSONObject().apply { put("a_pagar", 0.0); put("pago", 0.0); put("atrasado", 0.0) }

        for (i in 0 until dividas.length()) {
            val d = dividas.getJSONObject(i)
            val valor = d.optDouble("valor", 0.0)
            totalSaidas += valor
            val cat = d.optString("categoria", "outros")
            porCategoria.put(cat, porCategoria.optDouble(cat, 0.0) + valor)
            val st = d.optString("status", "a_pagar")
            porStatus.put(st, porStatus.optDouble(st, 0.0) + valor)
        }

        val saldo = totalEntradas - totalSaidas
        val percentual = if (totalEntradas > 0) (totalSaidas / totalEntradas * 100) else 0.0

        val hoje = Date()
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
        // ordenar por dias_restantes
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

        Regex("""^/api/mes/(\d{4}-\d{2})$""").find(uri)?.let {
            val mes = it.groupValues[1]
            return jsonOk(respostaMes(carregarMes(mes)))
        }

        return jsonError(404, "Rota não encontrada")
    }

    private fun handlePost(uri: String, corpo: JSONObject): Response {
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
            newFixedLengthResponse(Response.Status.OK, tipo, java.io.ByteArrayInputStream(bytes), bytes.size.toLong())
        } catch (e: Exception) {
            jsonError(404, "Arquivo não encontrado: $caminho")
        }
    }

    private fun jsonOk(payload: JSONObject, status: Int = 200): Response {
        val code = if (status == 201) Response.Status.CREATED else Response.Status.OK
        val bytes = payload.toString().toByteArray(Charsets.UTF_8)
        return newFixedLengthResponse(code, "application/json; charset=utf-8", java.io.ByteArrayInputStream(bytes), bytes.size.toLong())
    }

    private fun jsonError(status: Int, mensagem: String): Response {
        val code = Response.Status.lookup(status) ?: Response.Status.INTERNAL_ERROR
        val bytes = JSONObject().put("erro", mensagem).toString().toByteArray(Charsets.UTF_8)
        return newFixedLengthResponse(code, "application/json; charset=utf-8", java.io.ByteArrayInputStream(bytes), bytes.size.toLong())
    }
}

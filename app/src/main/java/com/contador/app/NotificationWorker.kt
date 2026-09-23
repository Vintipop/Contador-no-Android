package com.contador.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Roda uma vez por dia (agendado no MainActivity via WorkManager) e olha o
 * mês atual em busca de dívidas vencendo em breve ou já vencidas, disparando
 * uma notificação simples do Android pra cada situação.
 */
class NotificationWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    companion object {
        const val CANAL_ID = "contador_vencimentos"
    }

    override suspend fun doWork(): Result {
        criarCanalDeNotificacao()

        val temPermissao = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ActivityCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!temPermissao) return Result.success()

        val servidor = ContaDorServer(applicationContext, 0)
        val mesAtual = SimpleDateFormat("yyyy-MM", Locale.getDefault()).format(Date())
        val dados = servidor.carregarMesPublico(mesAtual)
        val dividas = dados.optJSONArray("dividas") ?: return Result.success()

        val dataFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
        val hoje = Date()
        var idNotificacao = 1000

        for (i in 0 until dividas.length()) {
            val d = dividas.getJSONObject(i)
            if (d.optString("status") == "pago") continue
            val venc = d.optString("vencimento", "")
            if (venc.isBlank()) continue
            val vencData = try { dataFormat.parse(venc) } catch (e: Exception) { null } ?: continue
            val dias = ((vencData.time - hoje.time) / (1000 * 60 * 60 * 24)).toInt()

            val descricao = d.optString("descricao", "Uma conta")
            val valor = d.optDouble("valor", 0.0)

            val mensagem = when {
                dias < 0 -> "Venceu há ${-dias} dia(s) — R$%.2f".format(valor)
                dias == 0 -> "Vence hoje — R$%.2f".format(valor)
                dias <= 3 -> "Vence em $dias dia(s) — R$%.2f".format(valor)
                else -> null
            }

            if (mensagem != null) {
                notificar(idNotificacao++, descricao, mensagem)
            }
        }

        return Result.success()
    }

    private fun criarCanalDeNotificacao() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val canal = NotificationChannel(
                CANAL_ID,
                "Vencimento de contas",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Avisa quando uma conta tá perto de vencer ou já venceu"
            }
            val manager = applicationContext.getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(canal)
        }
    }

    private fun notificar(id: Int, titulo: String, mensagem: String) {
        val temPermissao = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ActivityCompat.checkSelfPermission(applicationContext, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (!temPermissao) return

        val notificacao = NotificationCompat.Builder(applicationContext, CANAL_ID)
            .setContentTitle("Conta...Dor — $titulo")
            .setContentText(mensagem)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setAutoCancel(true)
            .build()

        androidx.core.app.NotificationManagerCompat.from(applicationContext).notify(id, notificacao)
    }
}

package com.contador.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class MainActivity : AppCompatActivity() {

    private val porta = 8080
    private var servidor: ContaDorServer? = null
    private lateinit var webView: WebView

    // Necessário pro <input type="file"> funcionar dentro da WebView (foto/banner de perfil)
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private val seletorDeArquivo = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { resultado ->
        val dados = resultado.data
        val uris: Array<Uri>? = if (resultado.resultCode == RESULT_OK && dados?.data != null) {
            arrayOf(dados.data!!)
        } else null
        filePathCallback?.onReceiveValue(uris)
        filePathCallback = null
    }

    private val pedirPermissaoNotificacao = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        servidor = ContaDorServer(applicationContext, porta).apply { start() }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                filePathCallback = callback
                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "image/*"
                }
                seletorDeArquivo.launch(Intent.createChooser(intent, "Escolher imagem"))
                return true
            }
        }

        webView.loadUrl("http://127.0.0.1:$porta/")

        pedirPermissaoDeNotificacaoSeNecessario()
        agendarChecagemDiaria()
    }

    private fun pedirPermissaoDeNotificacaoSeNecessario() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val jaTem = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!jaTem) {
                pedirPermissaoNotificacao.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun agendarChecagemDiaria() {
        val pedido = PeriodicWorkRequestBuilder<NotificationWorker>(24, TimeUnit.HOURS).build()
        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "checagem_diaria_vencimentos",
            ExistingPeriodicWorkPolicy.KEEP,
            pedido
        )
    }

    override fun onDestroy() {
        servidor?.stop()
        super.onDestroy()
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}

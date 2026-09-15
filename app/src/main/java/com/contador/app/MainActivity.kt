package com.contador.app

import android.os.Bundle
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private val porta = 8080
    private var servidor: ContaDorServer? = null
    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Liga o servidor local (a mesma lógica que era o app.py em Python,
        // agora em Kotlin, servindo os mesmos arquivos HTML/CSS/JS).
        servidor = ContaDorServer(applicationContext, porta).apply { start() }

        webView = WebView(this)
        setContentView(webView)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = WebViewClient()

        webView.loadUrl("http://127.0.0.1:$porta/")
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

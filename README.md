# Conta...Dor (Android)

Versão Android do Conta...Dor. Por baixo, é um app Kotlin bem simples que:

1. Liga um servidorzinho local (`ContaDorServer.kt`) — é a mesma lógica que
   tava no `app.py` do Termux, só que reescrita em Kotlin.
2. Abre uma WebView carregando esse servidor local — a telinha (HTML/CSS/JS)
   é a **mesma** que já usávamos, sem mudanças.

Ou seja: pro usuário parece um app de verdade, com ícone na tela e tudo,
mas por dentro continua funcionando do jeitinho que já foi testado.

## Como gerar o APK (via GitHub, sem PC/Android Studio)

Igual fizemos com o Ígnis:

1. Crie um repositório novo no GitHub (pode ser privado).
2. Suba essa pasta inteira (`conta_dor_android`) pro repositório — pode ser
   pelo próprio Termux com `git`:
   ```bash
   cd conta_dor_android
   git init
   git add .
   git commit -m "primeira versao do app"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/conta-dor-android.git
   git push -u origin main
   ```
3. O GitHub Actions (arquivo `.github/workflows/build-apk.yml`) vai ligar
   sozinho e compilar o APK na nuvem.
4. Na aba **Actions** do repositório, entre na execução mais recente e baixe
   o arquivo gerado em "Artifacts" → `conta-dor-apk`. Dentro dele tá o
   `app-debug.apk`.
5. Transfere esse `.apk` pro celular dela (WhatsApp, Google Drive, cabo,
   como preferir) e instala normalmente (pode precisar permitir
   "instalar de fontes desconhecidas" na primeira vez).

## O que ainda falta / próximos passos possíveis

- Esse é um **APK de debug** — funciona perfeitamente pra uso pessoal, mas
  se um dia quiser publicar na Play Store, precisa gerar uma versão
  "release" assinada (isso muda o workflow um pouco).
- O ícone do app é bem simples (um recibinho estilizado) — dá pra
  caprichar mais depois se quiser.
- Os dados ficam salvos dentro do próprio app (armazenamento interno do
  Android). Se ela desinstalar o app, perde os dados — dá pra pensar
  depois num botão de "exportar/fazer backup".

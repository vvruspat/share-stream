# Share Stream

**Audio, across the distance.** Mix together with a private music stream, voice and screen sharing.

[![CI](https://github.com/vvruspat/share-stream/actions/workflows/ci.yml/badge.svg)](https://github.com/vvruspat/share-stream/actions/workflows/ci.yml)
[![Release](https://github.com/vvruspat/share-stream/actions/workflows/release.yml/badge.svg)](https://github.com/vvruspat/share-stream/actions/workflows/release.yml)
[![Latest release](https://img.shields.io/github/v/release/vvruspat/share-stream?color=b5f5cf)](https://github.com/vvruspat/share-stream/releases/latest)

[**Download**](https://github.com/vvruspat/share-stream/releases/latest) · [**Voice & screen**](https://stream.whitesquirrel.digital/) · [Development](https://github.com/vvruspat/share-stream/blob/main/CONTRIBUTING.md) · [Releases & deployment](https://github.com/vvruspat/share-stream/blob/main/docs/releases.md)

![Share Stream voice and screen interface](https://raw.githubusercontent.com/vvruspat/share-stream/main/docs/images/web.png)

Native VST3 and standalone receiver for macOS, Windows and Linux; Audio Unit on macOS.
Default relay: **stream.whitesquirrel.digital:48100 UDP**.
Version **0.4.5** keeps one chat slot per participant when reopening a browser tab,
so the music listener can also join voice and screen. Browser voice playback uses
the native **Local monitor** fader style, with sample-level gain, stereo meters,
mute and a 0 dB reset.
It includes native **Voice & screen** links compatible with escaped invitations,
a compact session interface, stereo monitoring meters,
shared participant presence and remembered browser names. It includes live streaming
quality (Float32, PCM24, Opus 320 kbps), independent Send/Listen monitoring,
one-action invitations, GitHub Releases updates and combined installers.
Plugin Listen supports silent/disabled input and reconnects after DAW audio restarts.
One invitation covers music, voice and screen at **https://stream.whitesquirrel.digital/**.
The browser service uses React, TypeScript and Vite+, with styled Radix UI controls
and Heroicons. Unprocessed headphone capture remains the default.

Сервер знакомит участников: плагин и приложение пробуют прямое UDP-соединение
с hole punching. После аутентифицированной проверки в обе стороны звук идёт
**Direct P2P**, без пересылки через сервер. При недоступном прямом пути используется
**Relay**. При потере P2P автоматический переход на relay происходит примерно за 1,5 с.
Состояние и RTT выбранного пути показаны в интерфейсе. Это UDP hole punching,
а не полноценный ICE/TURN: некоторые NAT и firewall требуют relay.

## Install and update

[Download the latest release](https://github.com/vvruspat/share-stream/releases/latest). One installer includes the standalone receiver and VST3; macOS also includes AU.

- **macOS 12+ (Apple Silicon + Intel):** open `ShareStream-Setup-macOS.zip`, then `Share Stream Setup.app`. Signed with the owner's Developer ID and notarized by Apple.
- **Windows 10/11 x64:** run `ShareStream-Setup-Windows-x64.exe` (currently unsigned).
- **Ubuntu 24.04+ x86_64:** install `ShareStream-Ubuntu-amd64.deb`.
- **Fedora 44+ x86_64:** install `ShareStream-Fedora-x86_64.rpm`.

From 0.4.1, the plug-in and receiver check GitHub Releases daily and offer **Download and install update**. Save your session and restart the DAW/receiver afterwards. 0.3.1 needs this first installation manually. [Installation paths, update behavior and rollback](docs/updates.md).

## Постоянные комнаты и аккаунты

В плагине и приложении **Add account** позволяет зарегистрироваться или войти по
логину и паролю. **New room** создаёт именованную комнату, **Rename** меняет название,
**Invite user** добавляет её в список другого пользователя. Можно сохранить несколько
аккаунтов и переключаться между ними. Комнаты и приглашения сохраняются после выхода
всех участников и перезапуска сервера. Выберите комнату из списка и нажмите
**Connect to room**. В браузере доступны те же аккаунты и комнаты.

Одновременно подключаются два человека; офлайн-участники не занимают места.
Сервер хранит коды сохранённых комнат зашифрованными на диске и может их восстановить.
[Поведение, хранение данных и подготовка выкладки](docs/rooms.md).

## Быстрый старт

1. Распакуйте `ShareStream-macOS.zip`, запустите `Install.command`.
   VST3/AU установятся в пользовательскую Library, приложение — в `~/Applications`.
2. Перезапустите DAW. Добавьте **Share Stream** на мастер или нужную шину.
   В Logic: Audio FX → Audio Units → Share Stream → Share Stream.
3. Выберите **Send**, нажмите **New room**, затем **Copy invite** — это также подключает к комнате.
4. Передайте приглашение второму участнику. Он запускает **Share Stream.app**,
   выбирает **Listen** и нажимает **Paste invite** — соединение запускается автоматически.
5. В standalone кнопка **Audio output...** открывает выбор аудиовыхода
   и размера буфера. Начните с 128 samples. Приложение открывает только аудиовыход,
   не запрашивает микрофон и не открывает аудиовход.
6. Индикатор **Listener connected / Sender connected** показывает наличие второго участника.
   В плагине роль можно менять без ручного Disconnect: один участник выбирает **Send**,
   второй — **Listen**, оба остаются в той же комнате. Standalone остаётся приёмником.
7. **Send / local monitor** и **Listen / local monitor** независимо регулируют громкость
   вашего выхода (от Mute до +6 dB; двойной клик возвращает 0 dB). Уменьшение Send monitor
   не меняет громкость звука у партнёра. Значения сохраняются в проекте DAW и автоматизируются.

Готовые архивы подписаны Developer ID Application владельца проекта и проходят Apple
notarization. Tickets прикреплены к плагинам и приложению; результат конкретной сборки
указан в `NOTARIZATION.json`, контрольные суммы — в `SHA256SUMS.txt`.
macOS может показать обычное подтверждение первого запуска.

## Голос и экран

1. Нажмите **Voice & screen...** в плагине или standalone. Браузер автоматически войдёт
   в ту же комнату; новое приглашение не требуется. **Copy invite** копирует единую HTTPS-ссылку:
   её можно открыть в браузере или вставить через **Paste invite** в плагин/приёмник.
   Код комнаты и параметры аудиосервера находятся только во фрагменте после `#`.
   Старые `sharestream://`-приглашения и 32-символьные коды по-прежнему принимаются.
2. Нажмите **Enable microphone** для разговора
   и **Share screen** для выбора окна/экрана. Оба участника могут показывать экран одновременно.
   При ручном открытии пустой страницы вставьте приглашение и нажмите **Join room**.
3. **Mute microphone**, **Stop sharing** и **Leave** управляют каждым действием отдельно.
   Если браузер блокирует автовоспроизведение, нажмите **Play partner's voice**.
   Микрофон и выход голоса выбираются в **Voice devices**; в браузерах без выбора выхода
   используется выход macOS. Для разговора используйте наушники.
4. **Voice mode → Headphones · unprocessed** выбран по умолчанию: эхоподавление,
   шумоподавление и автогейн микрофона выключены. Этот режим рассчитан на сведение
   в наушниках. **Speakers · echo cancellation** включает обработку для динамиков.
   На macOS такая голосовая обработка может приглушать звук других приложений.
   При смене режима старый захват полностью закрывается до открытия нового.
   Если macOS продолжает вмешиваться, проверьте, что режим микрофона Chrome — **Standard**.

Три отдельных медиатранспорта, приоритет от высшего к низшему:

| Поток | Транспорт | Бюджет полезных данных |
|---|---|---|
| Музыкальное аудио | Нативный UDP, P2P / relay | Float32 / PCM24 / Opus 320; примерно 3,45 / 2,69 / 0,70 Мбит/с с IPv4/UDP |
| Экран | Отдельный WebRTC PeerConnection | до 1,2 Мбит/с, до 1080p / 15 fps |
| Голос | Отдельный WebRTC PeerConnection | до 64 кбит/с, mono Opus |

Экран передаётся без системного звука: микс уже идёт через нативный поток.
Обработка микрофона в режиме Speakers применяется к голосу; нативный поток микса
не меняет громкость при речи. Музыкальный UDP помечен DSCP EF; экран получает WebRTC
priority medium, голос — low (обычный сетевой класс, без фонового very-low).
При двух последовательных измерениях высокой задержки/потерь голосовой битрейт
снижается до 32 кбит/с; при дальнейшей перегрузке уменьшается бюджет экрана до 200 кбит/с.
Микрофон остаётся подключённым: автоматических пауз речи больше нет.
После стабилизации возвращается лимит 64 кбит/с и восстанавливается качество экрана.
Для приёма голоса задан целевой jitter buffer 80 мс в поддерживающих браузерах;
это добавляет запас от сетевых колебаний и не меняет задержку музыкального UDP-потока.
Это best-effort приоритет: браузер не управляет сокетом DAW, роутеры могут игнорировать
DSCP. Абсолютная гарантия полосы требует настройки QoS на роутере. Для всех трёх
потоков нужен запас сверх полосы музыкального аудио; начните с 6 Мбит/с в обе стороны.

Разрешение на микрофон/экран запрашивает только браузер, только по нажатию пользователя.
Standalone по-прежнему открывает **ноль аудиовходов**. Перезагрузка страницы отключает
захват; кратковременный разрыв сигнализации восстанавливает уже включённые пользователем
потоки. Leave останавливает все локальные захваты.

WebRTC пробует прямую связь, затем собственный TURN на сервере. Доступны UDP и TCP
3478; relay использует UDP 49160–49319. TURN не расшифровывает DTLS-SRTP.
Код комнаты хранится в URL fragment, не попадает в HTTP-запрос или Referer.
SDP/ICE зашифрованы AES-GCM ключом из кода комнаты с привязкой к участникам,
потоку и номеру сообщения; WebSocket передаёт только зашифрованные сообщения.
Сервис не записывает голос/экран. Соединения удаляются после выхода участников;
сохранённые комнаты и их состав остаются в каталоге аккаунтов.

## Задержка и качество

- Стерео, сеть 48 kHz. **Stream quality** у отправителя переключается на лету:
  **Float32** (без сжатия, исходный формат), **PCM 24-bit** (без сжатия, 24-битное
  квантование) или **Opus 320 kbps** (с потерями, restricted-lowdelay, CBR).
  Приёмник автоматически следует за форматом каждого пакета; переподключение не требуется.
  PCM24 и Opus ограничивают уровни диапазоном ±1 (0 dBFS); Float32 сохраняет headroom.
  Подстройка часов приёмника использует ресэмплинг, поэтому даже несжатый режим
  не гарантирует идентичные сэмплы на физическом выходе.
- Пакеты во всех режимах по 120 кадров (2,5 мс). Полезное аудио: 3,072 / 2,304 / 0,320 Мбит/с;
  с шифрованием и IPv4/UDP примерно 3,45 / 2,69 / 0,70 Мбит/с (без канального overhead).
  Opus добавляет собственную задержку кодека. Оставляйте запас полосы для экрана и голоса.
- Новые форматы включаются после зашифрованного обмена возможностями через обновлённый relay.
  Со старым клиентом или сервером автоматически используется совместимый Float32;
  интерфейс показывает **compatibility mode**. Ключ и единое приглашение остаются прежними.
- Разные частоты 8–192 kHz поддерживаются ресэмплингом Windowed Sinc.
- Min. net buffer: 5–100 мс. По умолчанию 40 мс для интернета; для стабильной сети
  попробуйте 20/10/5 мс. Если пакеты опаздывают, буфер автоматически увеличивается
  до 250 мс, чтобы прекратить пропуски. Текущее значение видно рядом с RTT.
  Для возвращения к меньшему буферу переподключитесь. У каждого участника свой буфер.
- Динамическая подстройка частоты приёма компенсирует разницу часов устройств.
- Peer RTT — путь до второго участника и обратно. Relay RTT — путь до сервера.
  Ни один из этих показателей не является полной задержкой звука.
  В реальную задержку входят обе аудиокарты, буферы DAW, путь через сервер,
  буфер сети и приёма. География сервера влияет на задержку в режиме Relay.
- Локальный звук в режиме Send проходит без задержки плагина. В режиме Listen
  выход заменяется удалённым звуком. В одной комнате один Send и один Listen.
- Ethernet и небольшие буферы аудиокарт помогают уменьшить задержку.
- Потерянные пакеты плавно затухают до тишины, без повторения старого звука.
- Соединение включается кнопкой Connect или действием Copy/Paste invite;
  загрузка проекта DAW по-прежнему не начинает стрим.
- Плагин передаёт аудио, пока DAW вызывает обработку. Некоторые DAW останавливают
  неактивные/пустые дорожки: используйте активную шину и включённый audio engine.

## Конфиденциальность

Код комнаты — случайный 128-битный секрет, храните его как приглашение к прослушиванию.
Аудиопакеты защищены XChaCha20-Poly1305 (Monocypher); заголовок также аутентифицирован.
Relay получает производный идентификатор комнаты, а не код или ключ шифрования.
Адреса, время и объём трафика видимы серверу. Сервер не хранит аудио. Для комнат, сохранённых в аккаунтах, каталог хранит
код зашифрованным на диске; оператор сервера может его восстановить.
Код комнаты сохраняется в проекте DAW/настройках приложения. New room меняет секрет.
Приглашение передаётся отдельно, например в личном сообщении.

## Repository and releases

Один монорепозиторий: JUCE/C++ в `Source/`, UDP relay в `server/`,
React/TypeScript/Vite+ в `web/`. Общие тестовые приглашения находятся в `Tests/Invitations.json`.
На pull request GitHub Actions запускает только lint и тесты: веб, relay и C++ тестовые программы на macOS, Windows, Ubuntu и Fedora. Плагины, приложения, установщики и Docker-образы собираются только после push/мержа в `main`; публикация релиза — по тегу уже в `main`.
Тег `vX.Y.Z` запускает подписанный релиз и выкладку backend через существующий Coolify.
Подробная схема, секреты и порядок выпуска — в [release guide](https://github.com/vvruspat/share-stream/blob/main/docs/releases.md).

## Build

```sh
SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" bash scripts/build-macos.sh
```

Нужны Xcode command line tools, CMake >= 3.22, Ninja и интернет для JUCE 8.0.4.
Можно переиспользовать checkout: `-DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE`.
`SIGNING_IDENTITY` обязателен для упаковки; ad-hoc подпись в архивы не допускается.
После подписания новой сборки выполните notarization (это не перестраивает код):

```sh
bash scripts/notarize-macos.sh SMC-notarize
```

Для продолжения уже отправленной сборки можно передать submission ID вторым аргументом.
Не запускайте упаковку/подпись повторно после notarization: скрипт notarization сам
прикрепляет tickets и обновляет оба ZIP и `SHA256SUMS.txt`.
Исходный код Monocypher включён в репозиторий. Форматы сборки: VST3, AU, Standalone.
`dist/ShareStream-macOS.zip` содержит все три варианта, установщик и инструкции.
`dist/ShareStream-Receiver-macOS.zip` — только приложение для слушателя.
Лицензии зависимостей описаны в `THIRD_PARTY.md`.

## Relay

```sh
bash scripts/deploy-relay.sh 13.140.153.191
```

Требуется SSH с правами установки сервиса. Сервис `share-stream-relay.service`
использует Python 3.10+, UDP 48100, DynamicUser и не имеет внешних Python-зависимостей.
Откройте этот UDP-порт во внешнем firewall/security group сервера.
Ограничение: 64 комнаты / 128 участников, одна пара на комнату, устаревшие сессии
удаляются за 4 секунды. UDP-cookie проверяет обратную достижимость до регистрации.
Команды состояния: `systemctl status share-stream-relay`, `journalctl -u share-stream-relay`.

## Verification

```sh
ctest --test-dir build --output-on-failure
python3 -m unittest discover -s Tests -p 'test_*.py' -v
python3 server/relay.py --host 127.0.0.1 --port 48101
build/stream_probe --port 48101 --seconds 5
build/stream_probe --server stream.whitesquirrel.digital --seconds 5
build/stream_probe --server stream.whitesquirrel.digital --seconds 15 --jitter 40 --force-relay 1
build/stream_probe --port 48101 --send-rate 44100 --receive-rate 96000
auval -v aufx Ss01 Shst
```

`stream_probe` передаёт только синтетические тестовые сигналы, проверяет оба канала
и тишину после остановки отправителя. Показанная им задержка не включает аудиокарты.

## Browser service / Coolify

Сервис управляется **Coolify → Share Stream → production → Voice and screen**:
контейнеры `web` и `turn`. HTTPS и сертификат Let's Encrypt управляются прокси Coolify.
Нативный аудиорелей на UDP 48100 продолжает работать отдельным systemd-сервисом.

```sh
bash scripts/web.sh ci
bash scripts/web.sh exec playwright install chromium
bash scripts/web.sh run dev  # http://localhost:5173, API and WS included
bash scripts/web.sh run verify
TEST_BASE_URL=https://stream.whitesquirrel.digital TEST_RELAY=1 bash scripts/web.sh run test:e2e
TEST_BASE_URL=https://stream.whitesquirrel.digital TEST_RELAY=1 TEST_TURN_TCP=1 bash scripts/web.sh run test:e2e -- --grep 'explicit capture'
```

Браузерные тесты используют синтетические звук и canvas, не микрофон и экран пользователя.
Отдельные браузерные контексты проверяют медиапакеты, декодирование кадров, независимость
транспортов, лимиты, отключение, восстановление и порядок деградации при перегрузке.

Веб-код находится в `web/`: React UI в `src/`, сигнализация на TypeScript в `server/`,
общие типы протокола в `shared/`. Сборка клиента, форматирование, линтинг и unit-тесты
идут через Vite+. Node 24.22.0 закреплён в проекте и сборочном контейнере; скрипт
`scripts/web.sh` подбирает совместимую версию без замены глобального Node.
Подробности разработки и структуры — в [web/README.md](web/README.md).

```sh
bash scripts/deploy-collaboration.sh 13.140.153.191
# Web-only hotfix without restarting the TURN container:
bash scripts/deploy-collaboration.sh 13.140.153.191 --web-only
```

Скрипт передаёт исходники из `web/` в существующий `/opt/share-stream/collaboration`
(путь сохранён для Coolify и TURN mounts), создаёт/обновляет только
этот проект и вызывает штатную очередь развёртывания Coolify через artisan.
Публичный API Coolify не включается, дополнительные API-токены не создаются.
Coolify собирает образ из указанного каталога; исходники сохраняются на сервере
для последующих перезапусков/сборок из панели. TURN-секрет генерируется на сервере,
передаётся контейнерам через read-only файлы и не попадает в Git или Docker image.
TURN выдаёт краткоживущие HMAC-учётные данные; браузер обновляет их каждые 15 минут.

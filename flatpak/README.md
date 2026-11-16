# Skybee у Flathub

Що тут: `io.github.vysocavnu.skybee.yml` — маніфест Flatpak (пакує Linux-збірку з GitHub-релізу),
`.desktop` — ярлик, `.metainfo.xml` — опис для каталогу, `icon-512.png` — іконка.

Рантайм: `org.freedesktop.Platform` **26.08** + база `org.electronjs.Electron2.BaseApp` 26.08 (у ній zypak).
Коли гілка виходить із підтримки (flatpak-builder пише «end-of-life»), підняти разом три місця:
`runtime-version` і `base-version` у маніфесті та тег контейнера `freedesktop-XX.08` у job `flatpak` (`.github/workflows/desktop.yml`; образ закріплений на `@sha256:…` — взяти digest нового тегу з ghcr.io).

Кожен реліз (тег `vX.Y.Z`) сам викладає:
- `Skybee.flatpak` — встановлюється напряму: `flatpak install --user Skybee.flatpak`
  (потрібен Flathub-ремоут для рантайму: `flatpak remote-add --if-not-exists --user flathub https://dl.flathub.org/repo/flathub.flatpakrepo`)
- `io.github.vysocavnu.skybee.flathub.yml` — той самий маніфест, але з `url` і `sha256` архіву в релізі.

## Як подати в Flathub (один раз)
1. Зробити fork https://github.com/flathub/flathub і гілку від `new-pr`.
2. Покласти в корінь: `io.github.vysocavnu.skybee.yml` (вміст `…flathub.yml` з релізу), `io.github.vysocavnu.skybee.desktop`,
   `io.github.vysocavnu.skybee.metainfo.xml`, `icon-512.png`.
3. Відкрити PR у `flathub/flathub` з базою `new-pr`, назва: «Add io.github.vysocavnu.skybee». Далі — відповідати рецензентам.
Після прийняття оновлення в Flathub: новий реліз → оновити `url`/`sha256` (і `<release>` у metainfo) у репозиторії Flathub.

## Правила Flathub (на що дивляться рецензенти)
Правила про ШІ (порожні обгортки, код від ШІ, маркування, моделі, телеметрія) для Skybee стосуються так:
- **Не «порожня веб-обгортка»**: вебчастина лежить усередині пакунка (не завантажується з сайту), є трей, сповіщення, схема `skybee://`, одиничний екземпляр, власне меню. Не видаляти ці інтеграції. Самооновлення вимкнене (`FLATPAK_ID`).
- **Код має бути підтримуваним**: автор розуміє й супроводжує код; перед подачею — `for f in js/*.js; do node --check --input-type=module < $f; done` і ручна перевірка екранів. Без вигаданих бібліотек і API (залежності — лише `electron`, `electron-updater`).
- **Прозорість**: застосунок не містить генеративного ШІ, іконка й скріншоти — справжні (`docs/screenshots/`).
- **Мережа й приватність** описані в metainfo (розділ Privacy): які сторонні сервіси і коли. Власної телеметрії немає. При додаванні нового сервісу — дописати туди.
- **Дозволи пісочниці** — мінімум (мережа, сокет вікон, звук, GPU); без `--filesystem=home`. Перед подачею: `flatpak run --command=flatpak-builder-lint org.flatpak.Builder manifest io.github.vysocavnu.skybee.yml` і `… appstream io.github.vysocavnu.skybee.metainfo.xml`.
- **Вміст**: OARS-оцінка («social-chat», «social-info» — intense) уже вказана.

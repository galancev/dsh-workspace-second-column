# dsh-workspace-second-column

Плагин DeepSeek Harness GUI: перестраивает левый сайдбар в две визуальные
колонки и позволяет сворачивать подписи навигации, оставляя только иконки.

```
┌─────────────┬───────────────────────────┬──────────────┐
│  rail       │  «Новая сессия»           │              │
│  Плагины    │  Рабочие папки            │  разговор    │
│  Задачи     │  ├─ dsh-…                 │              │
│  …          │  └─ …                     │              │
│  ⚙  ⇤       │                           │              │
└─────────────┴───────────────────────────┴──────────────┘
```

## Что делает

- **Две подколонки внутри layout-трека сайдбара**: узкий rail навигации
  (56 px со скрытыми подписями или 180 px с подписями) и колонка
  «Новая сессия + Рабочие папки».
- **Переключатель подписей** — кнопка в `sidebar.footer.action`, рядом с
  настройками. Состояние запоминается в `localStorage`
  (`dsh.workspace-second-column.labels`), по умолчанию подписи скрыты.
- **Ширина трека** подстраивается: 280 px (56 + 224) со скрытыми подписями,
  420 px (180 + 240) с развёрнутыми. Ширина меняется через layout-store,
  который ui-layout регистрирует в слоте `root`.
- **Ширина, выбранная перетаскиванием разделителя, запоминается** и
  возвращается при сворачивании подписей (а не сбрасывается к 280 px). Drag
  отличается от штатного сброса layout'а по атрибуту `data-dragging` на раме
  приложения; значение хранится в `localStorage`
  (`dsh.workspace-second-column.track`) и переживает перезапуск.
- **Нативные `title`-подсказки** для иконок, пока подписи скрыты: штатный
  Tooltip сайдбара отключён, когда сайдбар развёрнут.
- При штатном сворачивании сайдбара (Ctrl+B / кнопка в шапке) плагин
  отключает своё оформление и возвращает штатный 56 px rail.

## Установка

```powershell
dsh plugin --profile desktop add link:C:\Users\galan\Projects\dsh-workspace-second-column
```

После установки требуется перезапуск DeepSeek Harness. Плагин объявляет
`dsh.bundle.patch`, поэтому `dsh plugin add` сам добавит его в
`dsh.profile.bundles` профиля.

## Как это устроено

Плагин не заменяет React-компоненты и не подменяет слоты. Он:

1. ставит на `<html>` атрибуты `data-dsh-wsc` и `data-dsh-wsc-labels`;
2. добавляет CSS, который превращает корень сайдбара в `display: grid` с двумя
   колонками, а внутреннюю обёртку прокрутки — в такой же двухколоночный грид
   (селекторы опираются на суффиксы CSS-module-классов: `_root`, `_scrollRegion`,
   `_scrollArea`, `_panelList`, `_regionArea`, `_footArea` и т. п.);
3. регистрирует кнопку-переключатель в штатном list-слоте
   `sidebar.footer.action`;
4. для смены ширины находит layout-store через
   `ctx.slots.entries("root")` и вызывает `actions.setSidebar(px)`;
5. подписывается на изменения layout-store и запоминает ширину, выставленную
   перетаскиванием разделителя (`data-dragging` на раме): свои записи и
   штатные сбросы layout'а при этом не запоминаются.

### Разметка DSH 0.2.2

Начиная с 0.2.2 навигация и «Рабочие папки» — не прямые дети корня сайдбара,
а содержимое общей обёртки прокрутки:

```
_root
├─ _logoRow                     → колонка 1, строка 1
├─ _newSession                  → колонка 2, строка 1
├─ _scrollRegion                → обе колонки, строки 2–3
│  ├─ _scrollArea               → двухколоночный грид
│  │  ├─ _panelList             → колонка 1 (rail), своя прокрутка
│  │  └─ _regionArea            → колонка 2, на всю высоту
│  └─ _scrollFade               → скрыт
└─ _footArea                    → колонка 1, строка 3
```

Высота rail-колонки навигации считается как `100% - var(--dsh-wsc-foot)`, где
`--dsh-wsc-foot` — измеренная ResizeObserver'ом высота `_footArea` (настройки +
переключатель + строка аккаунта). Подвал при этом лежит в третьей строке корня
и приподнят по `z-index`: у растянутого `_scrollRegion` из-за `container-type`
свой stacking context, и без этого кнопки подвала не получают клики.

## Ограничения

- В DSH каркас жёстко трёхколоночный (`sidebar | center | rightbar`). Вторая
  колонка здесь — визуальная, внутри существующего layout-трека; отдельного
  resize-хэндла у неё нет.
- Ширина трека ограничена контрактом layout: 264–420 px.
- Селекторы опираются на суффиксы CSS-module-классов. При обновлении DSH имена
  могут измениться — тогда потребуется правка `lib/client.js`.
- Доступ к `layout-store` через `ctx.slots.entries("root")` — внутренний, хотя
  и публично достижимый механизм. В 0.2.2 store лежит на самом entry
  (`entry.store`), в 0.2.1 — в `entry.options.store`; плагин читает оба места.
  Если ui-layout перестанет отдавать store, плагин деградирует до двух колонок
  без изменения ширины трека.
- Плагин рассчитан на разметку DSH >= 0.2.2 (`dsh.engines.dsh`); на 0.2.1
  селекторы обёртки прокрутки не совпадут.

## Разработка

Локальный `node` из PATH может быть старее 22, поэтому скрипты удобнее гонять
bundled-рантаймом DSH через `tools/node.ps1` (запускает `$env:DSH_NODE_EXECUTABLE`
в режиме Node и корректно дожидается GUI-процесса):

```powershell
# синтаксис
powershell -File tools/node.ps1 --check lib/client.js

# shim-тесты клиентской половины (Node >= 22)
powershell -File tools/node.ps1 --test --test-isolation=none "test/client-shim.test.mjs"

# изолированный стенд DSH: второй экземпляр на своём DSH_HOME и порту
powershell -File tools/node.ps1 tools/harness.mjs `
  --plugin dsh-workspace-second-column --plugin-spec link:<путь к репозиторию> `
  --profile verify-second-column --port 52011
```

Разбор установленного DSH (внутри `app.asar`) — `tools/asar.ps1`:

```powershell
powershell -File tools/asar.ps1 ls pkg:dsh-client-ui-sidebar
powershell -File tools/asar.ps1 read pkg:dsh-client-ui-sidebar/src/client/SidebarRoot.tsx 400 40
powershell -File tools/asar.ps1 grep 'data-sidebar-collapsed' pkg:dsh-client-ui-layout
```

Именно так сверяется актуальная разметка сайдбара после обновления DSH: классы
`_root`, `_scrollRegion`, `_scrollArea`, `_panelList`, `_regionArea`, `_footArea`
в `SidebarRoot.module.css` и структура `SidebarRoot.tsx`.

/**
 * Клиентская половина плагина `dsh-workspace-second-column`.
 *
 * Что делает:
 * 1. перестраивает корень штатного сайдбара CSS-гридом в две визуальные
 *    колонки: узкий rail навигации и колонка «Новая сессия + Рабочие папки»;
 * 2. добавляет в `sidebar.footer.action` кнопку-переключатель, которая скрывает
 *    или разворачивает подписи навигации (состояние живёт в localStorage);
 * 3. при развороте подписей расширяет трек сайдбара (264–420 px), чтобы
 *    колонке «Рабочих папок» хватало места, а при сворачивании возвращает
 *    ширину, которую пользователь выставил перетаскиванием разделителя
 *    (запоминается в localStorage);
 * 4. возвращает нативные `title`-подсказки иконкам rail, пока подписи скрыты
 *    (штатный Tooltip сайдбара отключён при expanded-состоянии).
 *
 * Плагин ничего не подменяет в React-дереве: он оформляет уже отрендеренный
 * сайдбар. Селекторы опираются на суффиксы CSS-module-классов (`_panelTitle`,
 * `_regionArea` и т. п.) — хеш-префикс меняется от сборки к сборке, суффикс
 * остаётся.
 *
 * Разметка DSH 0.2.2: навигация и «Рабочие папки» лежат не прямыми детьми
 * корня, а внутри обёртки прокрутки:
 *   _root > _logoRow | _newSession | _scrollRegion > _scrollArea >
 *     (_panelList, _regionArea) | _scrollFade … и > _footArea
 * Поэтому корень раскладывается на две колонки, а `_scrollRegion` растянут на
 * обе: внутри него `_scrollArea` становится двухколоночным гридом, где
 * `_panelList` — rail, а `_regionArea` — вторая колонка на всю высоту.
 *
 * @module dsh-workspace-second-column/client
 */

window.__ModuleLoader__.load({
  id: "dsh-workspace-second-column",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    const react = require("react");
    /** ui-primitives — baseline-external для клиентских бандлов; fallback ниже. */
    let primitives = {};
    try {
      primitives = require("@deepseek-ai/dsh-client-ui-primitives") ?? {};
    } catch (error) {
      console.warn(
        "[workspace-second-column] ui-primitives недоступны, использую текстовый глиф",
        error,
      );
    }

    const NS = "workspaceSecondColumn";
    const STORAGE_KEY = "dsh.workspace-second-column.labels";
    /** Ширина трека, выбранная пользователем перетаскиванием разделителя. */
    const TRACK_STORAGE_KEY = "dsh.workspace-second-column.track";
    const STYLE_ID = "dsh-workspace-second-column";
    /** Ширина rail при скрытых и развёрнутых подписях. */
    const RAIL_COLLAPSED = 56;
    const RAIL_EXPANDED = 180;
    /** Ширина трека по умолчанию: 56 + 224 (свёрнуто) / 180 + 240 (развёрнуто). */
    const TRACK_COLLAPSED = 280;
    const TRACK_EXPANDED = 420;
    /** Диапазон ширины трека из контракта layout-store (clampWidth 264…420). */
    const TRACK_MIN = 264;
    const TRACK_MAX = 420;
    /** Пауза перед записью ширины в localStorage во время перетаскивания, мс. */
    const TRACK_PERSIST_DELAY = 250;
    /** Сколько раз пробовать найти layout-store, если он ещё не зарегистрирован. */
    const LAYOUT_RETRIES = 40;
    /** CSS-переменная с измеренной высотой подвала (настройки + переключатель). */
    const FOOT_VAR = "--dsh-wsc-foot";

    /** Словари подписей кнопки (обязательная пара en/zh в API локали). */
    const dictionaries = {
      en: {
        expand: "Expand navigation labels",
        collapse: "Collapse navigation labels",
      },
      zh: {
        expand: "展开导航标签",
        collapse: "收起导航标签",
      },
    };

    // ───────────────────────────── состояние ─────────────────────────────

    /** Подписчики локального стора (для useSyncExternalStore). */
    const listeners = new Set();
    /** Текущий режим подписей: `collapsed` | `expanded`. */
    let labels = readLabels();
    /**
     * Ширина трека, которую выбрал пользователь, перетаскивая разделитель.
     * `undefined` — пользователь ещё не трогал разделитель, действует штатная.
     */
    let preferredTrack = readTrack();
    /** Ширина, которую последним записал плагин (чтобы не путать её с drag'ом). */
    let appliedTrack;
    /** Отписка от layout-store (одна на страницу). */
    let trackUnsubscribe;
    /** Таймер отложенной записи ширины в localStorage. */
    let trackPersistTimer = 0;
    /** Таймер повторного поиска layout-store. */
    let layoutRetryTimer = 0;
    /** Сколько раз уже искали layout-store по таймеру. */
    let layoutRetryCount = 0;

    /** Прочитать сохранённый режим; по умолчанию подписи скрыты. */
    function readLabels() {
      try {
        return globalThis.localStorage?.getItem(STORAGE_KEY) === "expanded"
          ? "expanded"
          : "collapsed";
      } catch {
        return "collapsed";
      }
    }

    /**
     * Прочитать сохранённую пользователем ширину трека.
     * @returns {number | undefined} ширина в px или `undefined`, если её нет.
     */
    function readTrack() {
      try {
        const raw = globalThis.localStorage?.getItem(TRACK_STORAGE_KEY);
        if (raw === null || raw === undefined) return undefined;
        const value = Number.parseInt(raw, 10);
        if (!Number.isFinite(value)) return undefined;
        return Math.min(TRACK_MAX, Math.max(TRACK_MIN, value));
      } catch {
        return undefined;
      }
    }

    /** Записать текущую запомненную ширину в localStorage. */
    function persistTrack() {
      if (preferredTrack === undefined) return;
      try {
        globalThis.localStorage?.setItem(TRACK_STORAGE_KEY, String(preferredTrack));
      } catch {
        /* приватный режим — ширина останется только в памяти */
      }
    }

    /**
     * Запомнить ширину, выбранную пользователем. Во время перетаскивания
     * значение меняется каждый кадр, поэтому запись в localStorage отложена.
     * @param {number} width - ширина трека в px.
     */
    function rememberTrack(width) {
      const value = Math.min(TRACK_MAX, Math.max(TRACK_MIN, Math.round(width)));
      if (value === preferredTrack) return;
      preferredTrack = value;
      if (trackPersistTimer !== 0) clearTimeout(trackPersistTimer);
      trackPersistTimer = setTimeout(() => {
        trackPersistTimer = 0;
        persistTrack();
      }, TRACK_PERSIST_DELAY);
    }

    /** Подписаться на изменения режима. */
    function subscribeLabels(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    /** Хук режима подписей (значение — стабильная строка). */
    function useLabels() {
      return react.useSyncExternalStore(subscribeLabels, () => labels, () => labels);
    }

    /** Сменить режим, сохранить его и переприменить оформление. */
    function setLabels(next) {
      const value = next === "expanded" ? "expanded" : "collapsed";
      if (value === labels) return;
      labels = value;
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, labels);
      } catch {
        /* приватный режим — состояние останется только в памяти */
      }
      applyAttributes();
      applyTrackWidth();
      decorateTitles();
      for (const listener of listeners) listener();
    }

    // ───────────────────────────── DOM / CSS ─────────────────────────────

    /**
     * Атрибуты на <html> — единственная точка, от которой зависят CSS-правила.
     * Так плагин не ищет корень сайдбара и не зависит от его монтирования.
     */
    function applyAttributes() {
      const root = document.documentElement;
      root.setAttribute("data-dsh-wsc", "");
      root.setAttribute("data-dsh-wsc-labels", labels);
    }

    /** Удалить атрибуты при выгрузке плагина. */
    function retractAttributes() {
      const root = document.documentElement;
      root.removeAttribute("data-dsh-wsc");
      root.removeAttribute("data-dsh-wsc-labels");
      root.style?.removeProperty?.(FOOT_VAR);
    }

    /** Вставить стили плагина (идемпотентно). */
    function injectStyles() {
      if (document.querySelector(`style[data-dsh-plugin-css="${STYLE_ID}"]`) !== null) return undefined;
      const tag = document.createElement("style");
      tag.dataset.dshPluginCss = STYLE_ID;
      tag.textContent = STYLES;
      document.head.appendChild(tag);
      return () => tag.remove();
    }

    // ───────────────────────────── ширина трека ─────────────────────────────

    /** Найденный экземпляр layout-store (кэш на время жизни плагина). */
    let layoutInstance;
    /** Контекст плагина: нужен для поиска layout-store из обработчиков. */
    let activeCtx;

    /**
     * Найти экземпляр layout-store через реестр слотов: `root` регистрирует
     * ui-layout, а его `store.create()` возвращает тот же instance, что и
     * собственный рендер AppFrame.
     * @param {object} ctx - клиентский контекст Cordis.
     * @returns {object | undefined} instance с actions.setSidebar.
     */
    function findLayoutInstance(ctx) {
      if (layoutInstance !== undefined) return layoutInstance;
      try {
        if (typeof ctx.slots?.entries !== "function") return undefined;
        for (const entry of ctx.slots.entries("root")) {
          // DSH 0.2.2 переносит store регистрации на сам entry (раньше он жил
          // в entry.options.store) — читаем оба места.
          const store = entry?.store ?? entry?.options?.store;
          if (store === undefined || typeof store.create !== "function") continue;
          const instance = store.create();
          if (
            instance?.actions !== undefined &&
            typeof instance.actions.setSidebar === "function"
          ) {
            layoutInstance = instance;
            watchTrack(instance);
            return layoutInstance;
          }
        }
      } catch (error) {
        console.warn("[workspace-second-column] не удалось получить layout-store", error);
      }
      return undefined;
    }

    /**
     * Разделитель трека сейчас перетаскивают? Штатный AppFrame ставит на раму
     * `data-dragging` на время drag'а — только такие изменения ширины считаем
     * выбором пользователя (а не штатным сбросом layout'а).
     * @returns {boolean} true, если идёт перетаскивание.
     */
    function isResizing() {
      return document.querySelector('[class*="_frame"]')?.hasAttribute("data-dragging") === true;
    }

    /**
     * Следить за шириной трека и запоминать ту, которую выставил пользователь.
     * Свои записи (`appliedTrack`) и штатные сбросы layout'а игнорируются.
     * @param {object} instance - экземпляр layout-store.
     */
    function watchTrack(instance) {
      if (trackUnsubscribe !== undefined || typeof instance.subscribe !== "function") return;
      trackUnsubscribe = instance.subscribe(() => {
        const width = instance.getSnapshot?.()?.layoutInfo?.sidebar;
        if (!Number.isFinite(width) || width <= 0) return;
        if (width === appliedTrack) return;
        if (!isResizing()) return;
        rememberTrack(width);
      });
    }

    /** Повторить поиск layout-store, если ui-layout ещё не зарегистрировался. */
    function scheduleLayoutRetry() {
      if (layoutRetryTimer !== 0 || layoutRetryCount >= LAYOUT_RETRIES) return;
      layoutRetryTimer = setTimeout(() => {
        layoutRetryTimer = 0;
        layoutRetryCount += 1;
        applyTrackWidth();
      }, 250);
    }

    /**
     * Ширина, которую плагин должен выставить в текущем режиме: развёрнутым
     * подписям нужен максимум трека, свёрнутым — ширина, выбранная
     * пользователем, иначе штатные 280 px.
     * @returns {number} ширина трека в px.
     */
    function trackTarget() {
      if (labels === "expanded") return TRACK_EXPANDED;
      return preferredTrack ?? TRACK_COLLAPSED;
    }

    /**
     * Привести ширину трека сайдбара в соответствие режиму подписей.
     * При штатном collapsed-сайдбаре ширину не трогаем: её ведёт layout.
     */
    function applyTrackWidth() {
      if (activeCtx === undefined) return;
      // Ищем store даже при штатно свёрнутом сайдбаре: подписка на drag нужна
      // до того, как пользователь развернёт его обратно.
      const instance = findLayoutInstance(activeCtx);
      if (instance === undefined) {
        scheduleLayoutRetry();
        return;
      }
      layoutRetryCount = 0;
      const frame = document.querySelector('[class*="_frame"]');
      if (frame?.hasAttribute("data-sidebar-collapsed") === true) return;
      const target = trackTarget();
      try {
        const current = instance.getSnapshot?.()?.layoutInfo?.sidebar;
        // Отметить ширину своей ДО записи: подписчик стора сработает
        // синхронно и не должен принять её за drag пользователя.
        appliedTrack = target;
        if (current !== target) instance.actions.setSidebar(target);
      } catch (error) {
        console.warn("[workspace-second-column] setSidebar недоступен", error);
      }
    }

    // ───────────────────────────── высота подвала ─────────────────────────────

    /**
     * Подвал сайдбара лежит в третьей строке грида и перекрывает нижнюю часть
     * растянутого `_scrollRegion`. Чтобы rail-колонка навигации не уезжала под
     * него, её высота считается как `100% - var(--dsh-wsc-foot)`, а переменную
     * ставит ResizeObserver по фактической высоте `_footArea`.
     */
    let footElement;
    let footObserver;
    let footFrame = 0;

    /** Записать измеренную высоту подвала в CSS-переменную на <html>. */
    function measureFoot() {
      if (footElement === undefined) return;
      const height = footElement.getBoundingClientRect?.().height ?? 0;
      if (!(height > 0)) return;
      document.documentElement.style?.setProperty?.(FOOT_VAR, `${Math.round(height)}px`);
    }

    /** Найти подвал (он может смонтироваться позже плагина) и следить за ним. */
    function watchFoot() {
      if (footObserver !== undefined) return;
      const foot = document.querySelector('[class*="_footArea"]');
      if (foot === null || foot === undefined) {
        footFrame = requestAnimationFrame(watchFoot);
        return;
      }
      footElement = foot;
      if (typeof ResizeObserver === "function") {
        footObserver = new ResizeObserver(measureFoot);
        footObserver.observe(foot);
      }
      measureFoot();
    }

    // ───────────────────────────── нативные подсказки ─────────────────────────────

    let titleFrame = 0;

    /**
     * Поставить/снять `title` у иконок rail: навигация и подвал. Список
     * «Рабочих папок» не трогаем — он широкий и живёт во второй колонке.
     */
    function decorateTitles() {
      const column = document.querySelector('[class*="_sidebarCol"]');
      if (column === null) return;
      const hosts = column.querySelectorAll(
        '[class*="_panelList"], [class*="_footArea"]',
      );
      for (const host of hosts) {
        const buttons = host.querySelectorAll('button[aria-label], [role="menuitem"][aria-label]');
        for (const element of buttons) {
          const label = element.getAttribute("aria-label");
          if (label === null || label === "") continue;
          if (labels === "collapsed") {
            if (element.title !== label) element.title = label;
            element.dataset.dshWscTitle = "1";
          } else if (element.dataset.dshWscTitle === "1") {
            element.removeAttribute("title");
            delete element.dataset.dshWscTitle;
          }
        }
      }
    }

    /** Отложить обновление подсказок до следующего кадра. */
    function scheduleTitles() {
      if (titleFrame !== 0) return;
      titleFrame = requestAnimationFrame(() => {
        titleFrame = 0;
        decorateTitles();
      });
    }

    // ───────────────────────────── React-компонент кнопки ─────────────────────────────

    /**
     * Кнопка-переключатель подписей навигации.
     * @param {object} props - слот-пропсы: `t` из локали + injected-функции.
     * @returns {object} React-элемент кнопки.
     */
    function ToggleButton({ t, toggleLabels }) {
      const mode = useLabels();
      const collapsed = mode === "collapsed";
      const label = collapsed
        ? t?.("expand") ?? "Expand navigation labels"
        : t?.("collapse") ?? "Collapse navigation labels";
      const Icon = primitives.IconPanelLeftOutlineRegular;
      const glyph =
        Icon !== undefined
          ? react.createElement(Icon, { size: 16 })
          : react.createElement(
              "span",
              { "aria-hidden": "true", style: { fontSize: 14, lineHeight: 1 } },
              collapsed ? "»" : "«",
            );
      return react.createElement(
        "button",
        {
          type: "button",
          className: "dsh-wsc-toggle",
          "aria-label": label,
          title: label,
          "aria-pressed": collapsed,
          "data-collapsed": String(collapsed),
          onClick: toggleLabels,
        },
        glyph,
      );
    }

    // ───────────────────────────── Cordis-плагин ─────────────────────────────

    /** Сервисы, без которых клиентская половина не имеет смысла. */
    const inject = ["slots", "locale"];

    /**
     * Смонтировать клиентскую половину.
     * @param {object} ctx - клиентский контекст Cordis.
     */
    function apply(ctx) {
      ctx.effect(
        () => ctx.locale.register(NS, dictionaries),
        "workspace-second-column: dictionaries",
      );

      ctx.effect(() => {
        activeCtx = ctx;
        const removeStyles = injectStyles();
        applyAttributes();

        /** Наблюдатель за DOM: обновляет title после перерисовок React. */
        const domObserver = new MutationObserver(() => {
          scheduleTitles();
        });
        domObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributeFilter: ["aria-label"],
        });
        // Первичная расстановка подсказок: сайдбар мог смонтироваться раньше нас.
        scheduleTitles();
        watchFoot();

        /** Наблюдатель за треком: после ручного разворота сайдбара вернуть ширину. */
        let frameObserver;
        let frameWatchFrame = 0;
        const watchFrame = () => {
          if (frameObserver !== undefined) return;
          const frame = document.querySelector('[class*="_frame"]');
          if (frame === null) {
            frameWatchFrame = requestAnimationFrame(watchFrame);
            return;
          }
          frameObserver = new MutationObserver(() => {
            if (frame.hasAttribute("data-sidebar-collapsed")) return;
            applyTrackWidth();
            measureFoot();
          });
          frameObserver.observe(frame, {
            attributes: true,
            attributeFilter: ["data-sidebar-collapsed"],
          });
          applyTrackWidth();
        };
        watchFrame();

        return () => {
          domObserver.disconnect();
          frameObserver?.disconnect();
          footObserver?.disconnect();
          trackUnsubscribe?.();
          trackUnsubscribe = undefined;
          layoutInstance = undefined;
          appliedTrack = undefined;
          footObserver = undefined;
          footElement = undefined;
          if (frameWatchFrame !== 0) cancelAnimationFrame(frameWatchFrame);
          if (footFrame !== 0) cancelAnimationFrame(footFrame);
          if (titleFrame !== 0) cancelAnimationFrame(titleFrame);
          if (trackPersistTimer !== 0) {
            // Не терять последний drag, если плагин выгружают сразу после него.
            clearTimeout(trackPersistTimer);
            trackPersistTimer = 0;
            persistTrack();
          }
          if (layoutRetryTimer !== 0) clearTimeout(layoutRetryTimer);
          layoutRetryTimer = 0;
          layoutRetryCount = 0;
          footFrame = 0;
          titleFrame = 0;
          removeStyles?.();
          retractAttributes();
          activeCtx = undefined;
        };
      }, "workspace-second-column: sidebar layout");

      ctx.effect(() => {
        const disposeSlot = ctx.slots.inject("sidebar.footer.action", () =>
          ctx.slots.register(
            {
              name: "sidebar.footer.action",
              id: "workspace-second-column-labels",
              locale: NS,
              inject: () => ({
                useLabels,
                toggleLabels: () => setLabels(labels === "collapsed" ? "expanded" : "collapsed"),
              }),
            },
            ToggleButton,
          ),
        );
        return disposeSlot;
      }, "workspace-second-column: labels toggle");
    }

    exports.apply = apply;
    exports.inject = inject;

    // ───────────────────────────── стили ─────────────────────────────

    /** Цепочка от рамы приложения до корня сайдбара (без режима подписей). */
    const CHAIN =
      '[class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"]' +
      ' > [data-slot="sidebar"] > [class*="_root"]';
    /** Область действия: только при включённом плагине. */
    const S = `html[data-dsh-wsc] ${CHAIN}`;
    /** То же при скрытых подписях. */
    const SC = `html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] ${CHAIN}`;
    /** То же при развёрнутых подписях. */
    const SE = `html[data-dsh-wsc][data-dsh-wsc-labels="expanded"] ${CHAIN}`;

    /**
     * CSS-оформление. Префикс `html[data-dsh-wsc]` ставит плагин, поэтому
     * правила не задевают чужую разметку; `:not([data-sidebar-collapsed])`
     * отключает перестройку, пока работает штатный rail-режим.
     */
    const STYLES = `
/* Переменные плагина: ширина rail и высота подвала. */
html[data-dsh-wsc] {
  --dsh-wsc-rail: ${RAIL_COLLAPSED}px;
  --dsh-wsc-foot: 78px;
}
html[data-dsh-wsc][data-dsh-wsc-labels="expanded"] { --dsh-wsc-rail: ${RAIL_EXPANDED}px; }

/* Кнопка-переключатель подписей. */
.dsh-wsc-toggle {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-wsc-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-wsc-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dsh-wsc-toggle[data-collapsed="true"] svg { transform: rotate(180deg); }

/* Корень сайдбара: две визуальные колонки в одном layout-треке. */
${S} {
  display: grid;
  grid-template-columns: var(--dsh-wsc-rail) minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  box-sizing: border-box;
  padding: 6px 0;
  overflow: hidden;
}

/* Верх rail: логотип/переключатель сайдбара. */
${S} > [class*="_topStrip"],
${S} > [class*="_logoRow"] {
  grid-column: 1;
  grid-row: 1;
}
${S} > [class*="_logoRow"] {
  height: 44px;
  margin: 0;
  padding: 0 4px;
  overflow: visible;
  justify-content: center;
}
${S} > [class*="_logoRow"] > [class*="_brand"] { display: none; }

/* «Новая сессия» переезжает во вторую колонку, над «Рабочими папками». */
${S} > [class*="_newSession"] {
  grid-column: 2;
  grid-row: 1;
  align-self: start;
  width: auto;
  margin: 0 10px 6px 4px;
}

/* Навигация и «Рабочие папки» живут в общей обёртке прокрутки: растягиваем её
   на обе колонки и обе нижние строки, а внутри раскладываем на две колонки. */
${S} > [class*="_scrollRegion"] {
  grid-column: 1 / -1;
  grid-row: 2 / -1;
  margin: 0;
  min-height: 0;
  min-width: 0;
}
${S} > [class*="_scrollRegion"] > [class*="_scrollArea"] {
  display: grid;
  grid-template-columns: var(--dsh-wsc-rail) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  align-content: stretch;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
/* Служебные распорки и градиент штатной одноколоночной прокрутки не нужны. */
${S} > [class*="_scrollRegion"] > [class*="_scrollArea"]::before,
${S} > [class*="_scrollRegion"] > [class*="_scrollArea"]::after,
${S} > [class*="_scrollRegion"] > [class*="_scrollFade"] { display: none; }

/* Навигация — первая колонка, скроллится отдельно; подвал сайдбара лежит в
   третьей строке корня и перекрывает нижнюю часть колонки, поэтому высота
   навигации урезана на измеренную высоту подвала. */
${S} [class*="_panelList"] {
  grid-column: 1;
  grid-row: 1;
  align-self: start;
  height: calc(100% - var(--dsh-wsc-foot));
  margin: 0;
  padding: 4px 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* «Рабочие папки» — вторая колонка на всю высоту. */
${S} [class*="_regionArea"] {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 0 8px 0 6px;
  border-left: 0.5px solid var(--dsw-alias-border-l3);
}

/* Низ rail: настройки и переключатель. Подвал поднимается над растянутым
   scrollRegion (у того из-за container-type свой stacking context), иначе
   он рисуется под ним и перестаёт принимать клики. */
${S} > [class*="_footArea"] {
  grid-column: 1;
  grid-row: 3;
  position: relative;
  z-index: 1;
  min-width: 0;
  overflow: hidden;
}
${S} [class*="_settingsArea"] { min-width: 0; }

/* Скрытые подписи: иконки по центру rail. */
${SC} [class*="_panelList"] {
  align-items: center;
  gap: 8px;
}
${SC} [class*="_panelEntry"] {
  width: 36px;
  margin: 0 auto;
  border-inline: 0;
}
${SC} [class*="_panelRow"] {
  width: 36px;
  height: 36px;
  min-height: 36px;
  margin: 0;
  padding: 0;
  justify-content: center;
  gap: 0;
}
${SC} [class*="_panelTitle"] { display: none; }
${SC} [class*="_panelUnpin"] { display: none; }
${SC} [class*="_moreAnchor"] {
  width: 36px;
  margin: 0 auto;
  align-items: center;
}
${SC} [class*="_footerActions"] {
  justify-content: center;
  gap: 2px;
}
${SC} [class*="_settingsArea"] {
  display: flex;
  justify-content: center;
  width: auto;
}
/* В 56-пиксельном rail у строки аккаунта остаётся только иконка. */
${SC} [class*="_settingsArea"] [class*="_label"] { display: none; }
${SC} [class*="_settingsArea"] [class*="_trigger"] {
  width: 36px;
  padding: 0;
  justify-content: center;
}

/* Развёрнутые подписи: строки навигации занимают ширину rail. */
${SE} [class*="_panelEntry"] { margin: 0; }
${SE} [class*="_panelRow"] {
  width: 100%;
  justify-content: flex-start;
  gap: 8px;
}
`;

    return module.exports;
  },
});

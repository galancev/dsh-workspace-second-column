/**
 * Клиентская половина плагина `dsh-workspace-second-column`.
 *
 * Что делает:
 * 1. перестраивает корень штатного сайдбара CSS-гридом в две визуальные
 *    колонки: узкий rail навигации и колонка «Новая сессия + Рабочие папки»;
 * 2. добавляет в `sidebar.footer.action` кнопку-переключатель, которая скрывает
 *    или разворачивает подписи навигации (состояние живёт в localStorage);
 * 3. при развороте подписей расширяет трек сайдбара (264–420 px), чтобы
 *    колонке «Рабочих папок» хватало места;
 * 4. возвращает нативные `title`-подсказки иконкам, пока подписи скрыты
 *    (штатный Tooltip сайдбара отключён при expanded-состоянии).
 *
 * Плагин ничего не подменяет в React-дереве: он оформляет уже отрендеренный
 * сайдбар. Селекторы опираются на суффиксы CSS-module-классов (`_panelTitle`,
 * `_regionArea` и т. п.) — хеш-префикс меняется от сборки к сборке, суффикс
 * остаётся.
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
    const STYLE_ID = "dsh-workspace-second-column";
    /** Ширина rail при скрытых и развёрнутых подписях. */
    const RAIL_COLLAPSED = 56;
    const RAIL_EXPANDED = 180;
    /** Ширина трека сайдбара: 56 + 224 (свёрнуто) / 180 + 240 (развёрнуто). */
    const TRACK_COLLAPSED = 280;
    const TRACK_EXPANDED = 420;

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
          const store = entry?.options?.store;
          if (store === undefined || typeof store.create !== "function") continue;
          const instance = store.create();
          if (
            instance?.actions !== undefined &&
            typeof instance.actions.setSidebar === "function"
          ) {
            layoutInstance = instance;
            return layoutInstance;
          }
        }
      } catch (error) {
        console.warn("[workspace-second-column] не удалось получить layout-store", error);
      }
      return undefined;
    }

    /**
     * Привести ширину трека сайдбара в соответствие режиму подписей.
     * При штатном collapsed-сайдбаре ширину не трогаем: её ведёт layout.
     */
    function applyTrackWidth() {
      if (activeCtx === undefined) return;
      const frame = document.querySelector('[class*="_frame"]');
      if (frame?.hasAttribute("data-sidebar-collapsed") === true) return;
      const instance = findLayoutInstance(activeCtx);
      if (instance === undefined) return;
      const target = labels === "expanded" ? TRACK_EXPANDED : TRACK_COLLAPSED;
      try {
        const current = instance.getSnapshot?.()?.layoutInfo?.sidebar;
        if (current !== target) instance.actions.setSidebar(target);
      } catch (error) {
        console.warn("[workspace-second-column] setSidebar недоступен", error);
      }
    }

    // ───────────────────────────── нативные подсказки ─────────────────────────────

    let titleFrame = 0;

    /** Поставить/снять `title` у иконок внутри сайдбара. */
    function decorateTitles() {
      const column = document.querySelector('[class*="_sidebarCol"]');
      if (column === null) return;
      const buttons = column.querySelectorAll('button[aria-label], [role="menuitem"][aria-label]');
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
          if (frameWatchFrame !== 0) cancelAnimationFrame(frameWatchFrame);
          if (titleFrame !== 0) cancelAnimationFrame(titleFrame);
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

    /**
     * CSS-оформление. Префикс `html[data-dsh-wsc]` ставит плагин, поэтому
     * правила не задевают чужую разметку; `:not([data-sidebar-collapsed])`
     * отключает перестройку, пока работает штатный rail-режим.
     */
    const STYLES = `
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
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] {
  display: grid;
  grid-template-columns: ${RAIL_COLLAPSED}px minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr) auto;
  box-sizing: border-box;
  padding: 6px 0;
}
html[data-dsh-wsc][data-dsh-wsc-labels="expanded"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] {
  grid-template-columns: ${RAIL_EXPANDED}px minmax(0, 1fr);
}

/* Верх rail: логотип/переключатель сайдбара. */
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_topStrip"],
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_logoRow"] {
  grid-column: 1;
  grid-row: 1;
}
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_logoRow"] {
  height: 44px;
  margin: 0;
  padding: 0 4px;
  justify-content: center;
}
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_logoRow"] > [class*="_brand"] {
  display: none;
}

/* «Новая сессия» переезжает во вторую колонку, над «Рабочими папками». */
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_newSession"] {
  grid-column: 2;
  grid-row: 1;
  align-self: start;
  width: auto;
  margin: 0 10px 6px 4px;
}

/* Навигация — первая колонка, скроллится отдельно. */
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_panelList"] {
  grid-column: 1;
  grid-row: 2;
  margin: 0;
  padding: 4px 0;
  overflow-x: hidden;
  overflow-y: auto;
}

/* «Рабочие папки» — вторая колонка на всю высоту. */
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_regionArea"] {
  grid-column: 2;
  grid-row: 2 / span 2;
  min-height: 0;
  margin: 0;
  padding: 0 8px 0 6px;
  border-left: 0.5px solid var(--dsw-alias-border-l3);
}

/* Низ rail: настройки и переключатель. */
html[data-dsh-wsc] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_footArea"] {
  grid-column: 1;
  grid-row: 3;
}

/* Скрытые подписи: иконки по центру rail. */
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] > [class*="_panelList"] {
  align-items: center;
  gap: 8px;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_panelRow"] {
  width: 36px;
  height: 36px;
  margin: 0 auto;
  padding: 0;
  justify-content: center;
  gap: 0;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_panelTitle"] {
  display: none;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_triggerRow"] {
  width: 36px;
  margin: 8px auto 10px;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_triggerRow"] > button {
  flex: none;
  width: 36px;
  height: 36px;
  padding: 0;
  justify-content: center;
  gap: 0;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_triggerLabel"] {
  display: none;
}
html[data-dsh-wsc][data-dsh-wsc-labels="collapsed"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_footerActions"] {
  justify-content: center;
  gap: 2px;
}

/* Развёрнутые подписи: обычная ширина строк навигации. */
html[data-dsh-wsc][data-dsh-wsc-labels="expanded"] [class*="_frame"]:not([data-sidebar-collapsed]) [class*="_sidebarCol"] > [data-slot="sidebar"] > [class*="_root"] [class*="_panelRow"] {
  width: auto;
  margin: 0 6px;
  padding: 7px 8px;
  justify-content: flex-start;
  gap: 8px;
}
`;

    return module.exports;
  },
});


/**
 * Shim-тест клиентской половины: исполняет разданный клиентский бандл в
 * `node:vm` с минимальной браузерной обвязкой и проверяет, что `apply()`
 * ставит атрибуты режима, вставляет стили, регистрирует кнопку в
 * `sidebar.footer.action`, находит layout-store и меряет высоту подвала.
 *
 * Запуск (Node >= 22, например bundled runtime DSH):
 *   node --test --test-isolation=none "test/*.test.mjs"
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const CLIENT_PATH = new URL("../lib/client.js", import.meta.url);
const SOURCE = readFileSync(CLIENT_PATH, "utf8");
const STORAGE_KEY = "dsh.workspace-second-column.labels";
const TRACK_KEY = "dsh.workspace-second-column.track";

/**
 * Создать минимальный DOM-стаб.
 * @param {object} [options] - `{ storedLabels, storedTrack, footHeight }`.
 * @returns {object} DOM, localStorage и наблюдаемые коллекции.
 */
function createDom(options = {}) {
  const attributes = new Map();
  const properties = new Map();
  const storage = new Map();
  if (options.storedLabels !== undefined) storage.set(STORAGE_KEY, options.storedLabels);
  if (options.storedTrack !== undefined) storage.set(TRACK_KEY, options.storedTrack);
  const documentElement = {
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    hasAttribute(name) {
      return attributes.has(name);
    },
    style: {
      setProperty(name, value) {
        properties.set(name, String(value));
      },
      getPropertyValue(name) {
        return properties.get(name) ?? "";
      },
      removeProperty(name) {
        properties.delete(name);
      },
    },
  };
  const element = (tagName) => ({
    tagName: tagName.toUpperCase(),
    dataset: {},
    textContent: "",
    style: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() {
      return null;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    getBoundingClientRect() {
      return { x: 0, y: 0, width: 0, height: 0 };
    },
  });
  const head = element("head");
  const frameAttributes = new Map();
  const frame = element("div");
  frame.hasAttribute = (name) => frameAttributes.has(name);
  frame.setAttribute = (name, value) => frameAttributes.set(name, String(value));
  frame.removeAttribute = (name) => frameAttributes.delete(name);
  const foot = element("div");
  foot.getBoundingClientRect = () => ({ x: 0, y: 0, width: 56, height: options.footHeight ?? 0 });
  const document = {
    documentElement,
    head,
    body: element("body"),
    createElement: element,
    querySelector(selector) {
      if (selector.includes("_frame")) return frame;
      if (selector.includes("_footArea")) return options.footHeight === undefined ? null : foot;
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  return { document, head, attributes, properties, frameAttributes, storage };
}

/**
 * Исполнить клиентский бандл и вернуть его экспорт.
 * @param {object} dom - результат createDom().
 * @returns {object} module.exports плагина.
 */
function loadClient(dom) {
  let captured;
  const window = {
    __ModuleLoader__: {
      load(definition) {
        captured = definition;
      },
    },
  };
  const sandbox = {
    window,
    document: dom.document,
    localStorage: {
      getItem(key) {
        return dom.storage.get(key) ?? null;
      },
      setItem(key, value) {
        dom.storage.set(key, String(value));
      },
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    ResizeObserver: class {
      constructor(callback) {
        this.callback = callback;
      }
      observe() {
        // Немедленный вызов имитирует первичное измерение после монтирования.
        this.callback();
      }
      disconnect() {}
    },
    requestAnimationFrame() {
      // Кадр не выполняем: тест проверяет только синхронный монтаж.
      return 1;
    },
    cancelAnimationFrame() {},
    setTimeout,
    clearTimeout,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: "lib/client.js" });
  assert.ok(captured !== undefined, "клиентский бандл должен вызвать __ModuleLoader__.load");
  assert.equal(captured.id, "dsh-workspace-second-column");
  const requireMock = (specifier) => {
    if (specifier === "react") {
      return { createElement() {}, useSyncExternalStore() {} };
    }
    if (specifier === "@deepseek-ai/dsh-client-ui-primitives") {
      return {};
    }
    throw new Error(`unexpected require(${specifier})`);
  };
  return captured.factory(requireMock);
}

/**
 * Собрать минимальный клиентский контекст Cordis.
 * @param {object} [options] - `{ entries, registered }`.
 * @returns {object} ctx.
 */
function createCtx(options = {}) {
  const registered = options.registered ?? [];
  const ctx = {
    effect(fn) {
      const dispose = fn();
      return typeof dispose === "function" ? dispose : () => {};
    },
    locale: { register() {} },
    slots: {
      entries() {
        return options.entries ?? [];
      },
      inject(_slot, register) {
        register();
        return () => {};
      },
      register(definition) {
        registered.push(definition);
        return () => {};
      },
    },
  };
  return ctx;
}

/**
 * Фабрика layout-store: записывает setSidebar, поддерживает subscribe и
 * позволяет имитировать перетаскивание разделителя (`setSidebar` + data-dragging).
 * @param {number[]} calls - журнал вызовов actions.setSidebar.
 * @param {number} initialSidebar - стартовая ширина трека.
 * @returns {object} store-дескриптор с `instance`, `sidebar` и `setSidebar`.
 */
function layoutStore(calls, initialSidebar) {
  let sidebar = initialSidebar;
  const listeners = new Set();
  const instance = {
    getSnapshot: () => ({ layoutInfo: { sidebar } }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    actions: {
      setSidebar(px) {
        calls.push(px);
        sidebar = px;
        for (const listener of listeners) listener();
      },
    },
  };
  return {
    create: () => instance,
    instance,
    /** Изменение ширины «извне»: как drag разделителя или сброс layout'а. */
    setSidebar(px) {
      sidebar = px;
      for (const listener of listeners) listener();
    },
    get sidebar() {
      return sidebar;
    },
  };
}

test("apply ставит атрибуты режима и вставляет стили", () => {
  const dom = createDom();
  const client = loadClient(dom);
  const registered = [];
  client.apply(createCtx({ registered }));

  assert.equal(dom.attributes.get("data-dsh-wsc"), "");
  assert.equal(dom.attributes.get("data-dsh-wsc-labels"), "collapsed");
  assert.equal(dom.head.children.length, 1);
  assert.match(dom.head.children[0].textContent, /_panelTitle/);
  assert.equal(registered.length, 1);
  assert.equal(registered[0].name, "sidebar.footer.action");
  assert.equal(registered[0].id, "workspace-second-column-labels");
  assert.equal(registered[0].locale, "workspaceSecondColumn");
});

test("CSS описывает разметку DSH 0.2.2 (обёртка прокрутки)", () => {
  const dom = createDom();
  const client = loadClient(dom);
  client.apply(createCtx());
  const css = dom.head.children[0].textContent;
  // Корень раскладывается в грид, а навигация и «Рабочие папки» живут внутри
  // _scrollRegion > _scrollArea и позиционируются уже там.
  assert.match(css, /grid-template-columns: var\(--dsh-wsc-rail\) minmax\(0, 1fr\)/);
  assert.match(css, /\[class\*="_scrollRegion"\]/);
  assert.match(css, /\[class\*="_scrollArea"\]/);
  assert.match(css, /\[class\*="_panelEntry"\]/);
  assert.match(css, /\[class\*="_footArea"\]/);
  // Подвал должен перекрывать растянутый scrollRegion, иначе он не кликается.
  assert.match(css, /\[class\*="_footArea"\] \{[^}]*z-index: 1/);
});

test("сохранённый expanded применяется при монтировании", () => {
  const dom = createDom({ storedLabels: "expanded" });
  const client = loadClient(dom);
  client.apply(createCtx());
  assert.equal(dom.attributes.get("data-dsh-wsc-labels"), "expanded");
});

test("ширина трека берётся из layout-store при развёрнутых подписях", () => {
  const dom = createDom({ storedLabels: "expanded" });
  const client = loadClient(dom);
  const calls = [];
  client.apply(createCtx({ entries: [{ options: { store: layoutStore(calls, 280) } }] }));
  assert.deepEqual(calls, [420]);
});

test("store читается с entry (DSH 0.2.2), а не только из options", () => {
  const dom = createDom({ storedLabels: "expanded" });
  const client = loadClient(dom);
  const calls = [];
  client.apply(createCtx({ entries: [{ options: {}, store: layoutStore(calls, 280) }] }));
  assert.deepEqual(calls, [420]);
});

test("высота подвала попадает в --dsh-wsc-foot", () => {
  const dom = createDom({ footHeight: 68 });
  const client = loadClient(dom);
  client.apply(createCtx());
  assert.equal(dom.properties.get("--dsh-wsc-foot"), "68px");
});

test("без drag'а сворачивание подписей возвращает штатные 280", () => {
  const dom = createDom();
  const client = loadClient(dom);
  const registered = [];
  const calls = [];
  const store = layoutStore(calls, 280);
  client.apply(createCtx({ registered, entries: [{ store }] }));

  registered[0].inject().toggleLabels();
  assert.equal(store.sidebar, 420);
  registered[0].inject().toggleLabels();
  assert.equal(store.sidebar, 280);
  assert.deepEqual(calls, [420, 280]);
});

test("ширина, выбранная drag'ом, восстанавливается после сворачивания подписей", async () => {
  const dom = createDom();
  const client = loadClient(dom);
  const registered = [];
  const calls = [];
  const store = layoutStore(calls, 280);
  client.apply(createCtx({ registered, entries: [{ store }] }));

  // 1. Пользователь растянул трек до максимума, пока подписи свёрнуты.
  dom.frameAttributes.set("data-dragging", "");
  store.setSidebar(420);
  dom.frameAttributes.delete("data-dragging");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(dom.storage.get(TRACK_KEY), "420");

  // 2. Развернул подписи: трек уже максимальный, rail забирает место у колонки.
  registered[0].inject().toggleLabels();
  assert.equal(dom.attributes.get("data-dsh-wsc-labels"), "expanded");
  assert.equal(store.sidebar, 420);

  // 3. Свернул: трек остаётся таким, каким его оставил пользователь.
  registered[0].inject().toggleLabels();
  assert.equal(dom.attributes.get("data-dsh-wsc-labels"), "collapsed");
  assert.equal(store.sidebar, 420);
  assert.ok(!calls.includes(280), "сворачивание не должно сбрасывать ширину к 280");
});

test("сохранённая ширина применяется при монтировании", () => {
  const dom = createDom({ storedTrack: "400" });
  const client = loadClient(dom);
  const calls = [];
  client.apply(createCtx({ entries: [{ store: layoutStore(calls, 280) }] }));
  assert.deepEqual(calls, [400]);
});

test("ширина вне drag'а (штатный сброс layout'а) не запоминается", async () => {
  const dom = createDom();
  const client = loadClient(dom);
  const registered = [];
  const calls = [];
  const store = layoutStore(calls, 280);
  client.apply(createCtx({ registered, entries: [{ store }] }));

  store.setSidebar(300);
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(dom.storage.get(TRACK_KEY), undefined);

  registered[0].inject().toggleLabels();
  registered[0].inject().toggleLabels();
  assert.equal(store.sidebar, 280);
});

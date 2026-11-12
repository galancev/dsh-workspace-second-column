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

/**
 * Создать минимальный DOM-стаб.
 * @param {object} [options] - `{ storedLabels, frame, footHeight }`.
 * @returns {object} DOM и наблюдаемые коллекции.
 */
function createDom(options = {}) {
  const attributes = new Map();
  const properties = new Map();
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
  const frame = element("div");
  frame.hasAttribute = () => false;
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
  return { document, head, attributes, properties, storedLabels: options.storedLabels };
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
  const store = new Map();
  if (dom.storedLabels !== undefined) store.set(STORAGE_KEY, dom.storedLabels);
  const sandbox = {
    window,
    document: dom.document,
    localStorage: {
      getItem(key) {
        return store.get(key) ?? null;
      },
      setItem(key, value) {
        store.set(key, String(value));
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

/** Фабрика layout-store с записью вызовов setSidebar. */
function layoutStore(calls, sidebar) {
  return {
    create() {
      return {
        getSnapshot: () => ({ layoutInfo: { sidebar } }),
        actions: {
          setSidebar(px) {
            calls.push(px);
          },
        },
      };
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

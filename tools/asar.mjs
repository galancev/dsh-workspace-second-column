/**
 * Чтение установленного DSH внутри `app.asar` через ASAR-aware runtime.
 *
 * Обычный `node` из PATH не умеет читать ASAR, поэтому скрипт запускается
 * Electron-бинарём с `ELECTRON_RUN_AS_NODE=1` (см. tools/asar.ps1).
 *
 * Команды:
 *   ls    <dir>                        — содержимое каталога (до 200 записей)
 *   read  <file> [offset] [limit]      — строки файла (1-based offset)
 *   grep  <literal> <dir> [maxBytes]   — литеральный поиск по файлам каталога
 *
 * @module tools/asar
 */

import fs from "node:fs";
import path from "node:path";

const [command, ...rest] = process.argv.slice(2);

/** Каталог установки DSH внутри asar (пакеты). */
const ASAR = "C:\\Users\\galan\\AppData\\Local\\Programs\\DeepSeek Harness\\resources\\app.asar";
const PKGS = path.join(ASAR, "dsh", "node_modules", "@deepseek-ai");

/** Развернуть `pkg:<имя>` в каталог пакета, иначе — как есть. */
function resolve(target) {
  if (target.startsWith("pkg:")) return path.join(PKGS, target.slice(4));
  return target;
}

/** Рекурсивный обход файлов с ограничением глубины. */
function* walk(dir, depth = 0) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth < 8) yield* walk(full, depth + 1);
    } else {
      yield full;
    }
  }
}

if (command === "ls") {
  const dir = resolve(rest[0]);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).slice(0, 200)) {
    const full = path.join(dir, entry.name);
    const size = entry.isDirectory() ? "" : ` (${fs.statSync(full).size})`;
    console.log(`${entry.isDirectory() ? "[d]" : "   "} ${entry.name}${size}`);
  }
} else if (command === "read") {
  const file = resolve(rest[0]);
  const offset = Number(rest[1] ?? 1);
  const limit = Number(rest[2] ?? 200);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = offset - 1; index < Math.min(lines.length, offset - 1 + limit); index += 1) {
    console.log(`${index + 1}: ${lines[index]}`);
  }
} else if (command === "grep") {
  const needle = rest[0];
  const dir = resolve(rest[1]);
  const maxBytes = Number(rest[2] ?? 1_048_576);
  let files = 0;
  let hits = 0;
  for (const file of walk(dir)) {
    if (!/\.(?:js|mjs|cjs|ts|tsx|css|json|md|d\.ts)$/.test(file)) continue;
    const size = fs.statSync(file).size;
    if (size > maxBytes) continue;
    files += 1;
    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    let printed = 0;
    for (let index = 0; index < lines.length; index += 1) {
      if (!lines[index].includes(needle)) continue;
      hits += 1;
      if (printed === 0) console.log(`\n== ${path.relative(ASAR, file)}`);
      if (printed < 20) console.log(`${index + 1}: ${lines[index].slice(0, 200)}`);
      printed += 1;
    }
    if (printed > 20) console.log(`   … ещё ${printed - 20} совпадений в файле`);
  }
  console.log(`\n# files scanned: ${files}, matches: ${hits}`);
} else {
  console.error("usage: ls <dir> | read <file> [offset] [limit] | grep <literal> <dir> [maxBytes]");
  process.exitCode = 2;
}
